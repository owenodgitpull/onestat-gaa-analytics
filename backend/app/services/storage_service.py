"""
Cloudflare R2 Storage Service

S3-compatible object storage for:
- GPS data files
- Fitness test uploads
- Knowledge base documents
- Media files (future)

Multi-tenant: all new uploads are scoped under {club_id}/ prefix.
Legacy keys (pre-scoping) are allowed through with a warning.
"""

import os
import re
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Optional, BinaryIO
import logging
import uuid

logger = logging.getLogger(__name__)

# Pattern: keys starting with a UUID prefix (club-scoped) or "shared/"
_CLUB_SCOPED_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
)


class StorageService:
    """
    Cloudflare R2 storage service using S3-compatible API.
    All new uploads are club-scoped: {club_id}/{folder}/...
    """

    def __init__(self):
        """Initialize R2 client with credentials from environment."""
        self.account_id = os.getenv("R2_ACCOUNT_ID")
        self.access_key = os.getenv("R2_ACCESS_KEY_ID")
        self.secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
        self.bucket_name = os.getenv("R2_BUCKET_NAME", "dungloe-gaa-data")

        # R2 endpoint URL
        self.endpoint_url = os.getenv(
            "R2_ENDPOINT_URL",
            f"https://{self.account_id}.r2.cloudflarestorage.com"
        )

        # Check if R2 is configured
        self.is_configured = all([
            self.account_id,
            self.access_key,
            self.secret_key
        ])

        if self.is_configured:
            # Create S3 client configured for R2
            self.client = boto3.client(
                's3',
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3}
                ),
                region_name='auto'  # R2 uses 'auto' for region
            )
            logger.info("R2 Storage initialized successfully")
        else:
            self.client = None
            logger.warning("R2 Storage not configured - file uploads will be disabled")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _generate_key(
        self, folder: str, filename: str, club_id: Optional[str] = None, include_date: bool = True
    ) -> str:
        """
        Generate a unique S3 key for the file.

        New format: {club_id}/{folder}/{year}/{month}/{uuid}_{filename}
        Shared:     shared/{folder}/{uuid}_{filename}
        """
        unique_id = str(uuid.uuid4())[:8]
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._-")

        prefix = f"{club_id}/" if club_id else "shared/"

        if include_date:
            now = datetime.utcnow()
            return f"{prefix}{folder}/{now.year}/{now.month:02d}/{unique_id}_{safe_filename}"
        else:
            return f"{prefix}{folder}/{unique_id}_{safe_filename}"

    @staticmethod
    def _is_legacy_key(key: str) -> bool:
        """Detect pre-scoping keys that don't start with a club UUID or 'shared/'."""
        if key.startswith("shared/"):
            return False
        if _CLUB_SCOPED_RE.match(key):
            return False
        # Old format: folder/year/month/uuid_file  e.g. "video/2026/02/abc_file.mp4"
        return True

    def _validate_club_access(self, key: str, club_id: Optional[str]) -> None:
        """
        Guard: ensure the requesting club owns the key.
        Legacy keys (pre-scoping) are allowed through with a warning.
        Shared keys are accessible to everyone.
        """
        if not club_id:
            return  # No club context (e.g. background tasks) — skip
        if key.startswith("shared/"):
            return
        if self._is_legacy_key(key):
            logger.warning(f"Legacy key accessed: {key} by club {club_id}")
            return
        if not key.startswith(f"{club_id}/"):
            raise PermissionError(f"Access denied to key for club {club_id}")

    # ------------------------------------------------------------------
    # Upload methods
    # ------------------------------------------------------------------

    def upload_file(
        self,
        file_data: BinaryIO,
        folder: str,
        filename: str,
        content_type: Optional[str] = None,
        metadata: Optional[dict] = None,
        club_id: Optional[str] = None,
    ) -> Optional[str]:
        """Upload a file to R2 under the club's prefix."""
        if not self.is_configured:
            logger.error("R2 not configured - cannot upload file")
            return None

        try:
            key = self._generate_key(folder, filename, club_id=club_id)

            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            if metadata:
                extra_args['Metadata'] = metadata

            self.client.upload_fileobj(
                file_data,
                self.bucket_name,
                key,
                ExtraArgs=extra_args if extra_args else None
            )

            logger.info(f"Uploaded file to R2: {key}")
            return key

        except ClientError as e:
            logger.error(f"Failed to upload to R2: {e}")
            return None

    def upload_bytes(
        self,
        data: bytes,
        folder: str,
        filename: str,
        content_type: Optional[str] = None,
        club_id: Optional[str] = None,
    ) -> Optional[str]:
        """Upload bytes directly to R2 under the club's prefix."""
        if not self.is_configured:
            return None

        try:
            key = self._generate_key(folder, filename, club_id=club_id)

            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type

            self.client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=data,
                **extra_args
            )

            logger.info(f"Uploaded bytes to R2: {key}")
            return key

        except ClientError as e:
            logger.error(f"Failed to upload bytes to R2: {e}")
            return None

    def generate_presigned_upload_url(
        self,
        folder: str,
        filename: str,
        content_type: str = "video/mp4",
        expires_in: int = 3600,
        club_id: Optional[str] = None,
    ) -> Optional[dict]:
        """Generate a presigned PUT URL for direct browser-to-R2 upload."""
        if not self.is_configured:
            logger.error("R2 not configured - cannot generate presigned upload URL")
            return None

        try:
            key = self._generate_key(folder, filename, club_id=club_id)

            url = self.client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key,
                    'ContentType': content_type,
                },
                ExpiresIn=expires_in,
            )

            return {"upload_url": url, "key": key}

        except ClientError as e:
            logger.error(f"Failed to generate presigned upload URL: {e}")
            return None

    def generate_presigned_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        club_id: Optional[str] = None,
    ) -> Optional[str]:
        """Generate a presigned GET URL for downloading a file from R2."""
        if not self.is_configured:
            logger.error("R2 not configured - cannot generate presigned download URL")
            return None

        self._validate_club_access(key, club_id)

        try:
            url = self.client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key,
                },
                ExpiresIn=expires_in,
            )
            return url
        except ClientError as e:
            logger.error(f"Failed to generate presigned download URL: {e}")
            return None

    # ------------------------------------------------------------------
    # Download / read methods
    # ------------------------------------------------------------------

    def download_file(self, key: str, club_id: Optional[str] = None) -> Optional[bytes]:
        """Download a file from R2 with club access validation."""
        if not self.is_configured:
            return None

        self._validate_club_access(key, club_id)

        try:
            response = self.client.get_object(
                Bucket=self.bucket_name,
                Key=key
            )
            return response['Body'].read()

        except ClientError as e:
            logger.error(f"Failed to download from R2: {e}")
            return None

    def download_file_to_path(self, key: str, dest_path: str, club_id: Optional[str] = None) -> bool:
        """Stream a file from R2 directly to a local path with club access validation."""
        if not self.is_configured:
            return False

        self._validate_club_access(key, club_id)

        try:
            self.client.download_file(self.bucket_name, key, dest_path)
            return True
        except ClientError as e:
            logger.error(f"Failed to stream download from R2: {e}")
            return False

    def get_download_url(self, key: str, expires_in: int = 3600, club_id: Optional[str] = None) -> Optional[str]:
        """Generate a pre-signed download URL with club access validation."""
        if not self.is_configured:
            return None

        self._validate_club_access(key, club_id)

        try:
            url = self.client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key
                },
                ExpiresIn=expires_in
            )
            return url

        except ClientError as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return None

    # ------------------------------------------------------------------
    # Delete / list / exists
    # ------------------------------------------------------------------

    def delete_file(self, key: str, club_id: Optional[str] = None) -> bool:
        """Delete a file from R2 with club access validation."""
        if not self.is_configured:
            return False

        self._validate_club_access(key, club_id)

        try:
            self.client.delete_object(
                Bucket=self.bucket_name,
                Key=key
            )
            logger.info(f"Deleted file from R2: {key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to delete from R2: {e}")
            return False

    def list_files(self, prefix: str = "", club_id: Optional[str] = None, max_keys: int = 1000) -> list:
        """List files, auto-injecting club_id prefix when provided."""
        if not self.is_configured:
            return []

        if club_id:
            prefix = f"{club_id}/{prefix}"

        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_keys
            )

            files = []
            for obj in response.get('Contents', []):
                files.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'last_modified': obj['LastModified'].isoformat()
                })

            return files

        except ClientError as e:
            logger.error(f"Failed to list files from R2: {e}")
            return []

    def file_exists(self, key: str, club_id: Optional[str] = None) -> bool:
        """Check if a file exists in R2 with club access validation."""
        if not self.is_configured:
            return False

        self._validate_club_access(key, club_id)

        try:
            self.client.head_object(
                Bucket=self.bucket_name,
                Key=key
            )
            return True
        except ClientError:
            return False


# Global instance for easy importing
storage = StorageService()
