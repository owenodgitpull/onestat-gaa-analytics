"""
Cloudflare R2 Storage Service

S3-compatible object storage for:
- GPS data files
- Fitness test uploads
- Knowledge base documents
- Media files (future)
"""

import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Optional, BinaryIO
import logging
import uuid

logger = logging.getLogger(__name__)


class StorageService:
    """
    Cloudflare R2 storage service using S3-compatible API.

    Usage:
        storage = StorageService()

        # Upload a file
        key = await storage.upload_file(file, "gps", "session_123.csv")

        # Get download URL
        url = storage.get_download_url(key)

        # Delete file
        storage.delete_file(key)
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

    def _generate_key(self, folder: str, filename: str, include_date: bool = True) -> str:
        """
        Generate a unique S3 key for the file.

        Args:
            folder: Top-level folder (gps, fitness, knowledge, media)
            filename: Original filename
            include_date: Whether to include date in path

        Returns:
            S3 key like "gps/2024/01/uuid_filename.csv"
        """
        # Generate unique prefix to avoid collisions
        unique_id = str(uuid.uuid4())[:8]

        # Clean filename
        safe_filename = "".join(c for c in filename if c.isalnum() or c in "._-")

        if include_date:
            now = datetime.utcnow()
            return f"{folder}/{now.year}/{now.month:02d}/{unique_id}_{safe_filename}"
        else:
            return f"{folder}/{unique_id}_{safe_filename}"

    def upload_file(
        self,
        file_data: BinaryIO,
        folder: str,
        filename: str,
        content_type: Optional[str] = None,
        metadata: Optional[dict] = None
    ) -> Optional[str]:
        """
        Upload a file to R2.

        Args:
            file_data: File-like object to upload
            folder: Folder name (gps, fitness, knowledge, media)
            filename: Original filename
            content_type: MIME type (auto-detected if not provided)
            metadata: Additional metadata to store with file

        Returns:
            S3 key of uploaded file, or None if upload failed
        """
        if not self.is_configured:
            logger.error("R2 not configured - cannot upload file")
            return None

        try:
            key = self._generate_key(folder, filename)

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
        content_type: Optional[str] = None
    ) -> Optional[str]:
        """Upload bytes directly to R2."""
        if not self.is_configured:
            return None

        try:
            key = self._generate_key(folder, filename)

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

    def download_file(self, key: str) -> Optional[bytes]:
        """
        Download a file from R2.

        Args:
            key: S3 key of the file

        Returns:
            File contents as bytes, or None if download failed
        """
        if not self.is_configured:
            return None

        try:
            response = self.client.get_object(
                Bucket=self.bucket_name,
                Key=key
            )
            return response['Body'].read()

        except ClientError as e:
            logger.error(f"Failed to download from R2: {e}")
            return None

    def download_file_to_path(self, key: str, dest_path: str) -> bool:
        """
        Stream a file from R2 directly to a local path (no full-file memory buffer).

        Args:
            key: S3 key of the file
            dest_path: Local file path to write to

        Returns:
            True if successful, False otherwise
        """
        if not self.is_configured:
            return False

        try:
            self.client.download_file(self.bucket_name, key, dest_path)
            return True
        except ClientError as e:
            logger.error(f"Failed to stream download from R2: {e}")
            return False

    def get_download_url(self, key: str, expires_in: int = 3600) -> Optional[str]:
        """
        Generate a pre-signed URL for downloading a file.

        Args:
            key: S3 key of the file
            expires_in: URL expiration time in seconds (default 1 hour)

        Returns:
            Pre-signed download URL, or None if generation failed
        """
        if not self.is_configured:
            return None

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

    def generate_presigned_upload_url(
        self,
        folder: str,
        filename: str,
        content_type: str = "video/mp4",
        expires_in: int = 3600,
    ) -> Optional[dict]:
        """
        Generate a presigned PUT URL for direct browser-to-R2 upload.

        Args:
            folder: Folder name (e.g., "video")
            filename: Original filename
            content_type: MIME type of the file
            expires_in: URL expiration time in seconds (default 1 hour)

        Returns:
            Dict with 'upload_url' and 'key', or None if generation failed
        """
        if not self.is_configured:
            logger.error("R2 not configured - cannot generate presigned upload URL")
            return None

        try:
            key = self._generate_key(folder, filename)

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

    def delete_file(self, key: str) -> bool:
        """
        Delete a file from R2.

        Args:
            key: S3 key of the file

        Returns:
            True if deleted successfully, False otherwise
        """
        if not self.is_configured:
            return False

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

    def list_files(self, prefix: str = "", max_keys: int = 1000) -> list:
        """
        List files in a folder.

        Args:
            prefix: Folder prefix to filter by (e.g., "gps/2024/")
            max_keys: Maximum number of files to return

        Returns:
            List of file info dicts with key, size, last_modified
        """
        if not self.is_configured:
            return []

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

    def file_exists(self, key: str) -> bool:
        """Check if a file exists in R2."""
        if not self.is_configured:
            return False

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
