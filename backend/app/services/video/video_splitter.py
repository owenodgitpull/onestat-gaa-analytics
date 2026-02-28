"""
FFmpeg stream-copy video splitter for half-time splitting.

Splits a full-match video into two halves at a given timestamp using
FFmpeg's -c copy (no re-encoding). Takes ~3 seconds for a 2GB file.

All operations are file-based (no large in-memory buffers).
"""

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

# Known install locations for FFmpeg (checked if not on PATH)
_FFMPEG_SEARCH_PATHS = [
    # Linux / Docker
    "/usr/bin/ffmpeg",
    # macOS homebrew
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
]

# Windows: winget puts it in a deeply nested package dir — search dynamically
if sys.platform == "win32":
    _local_app = os.environ.get("LOCALAPPDATA", "")
    if _local_app:
        _winget_base = os.path.join(_local_app, "Microsoft", "WinGet", "Packages")
        if os.path.isdir(_winget_base):
            for pkg_dir in os.listdir(_winget_base):
                if "FFmpeg" in pkg_dir:
                    # Search for bin/ffmpeg.exe inside the package
                    for root, dirs, files in os.walk(os.path.join(_winget_base, pkg_dir)):
                        if "ffmpeg.exe" in files:
                            _FFMPEG_SEARCH_PATHS.append(os.path.join(root, "ffmpeg.exe"))


def _find_ffmpeg() -> str | None:
    """Find the FFmpeg binary — checks PATH first, then known install locations."""
    # Check PATH
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path

    # Check known locations
    for path in _FFMPEG_SEARCH_PATHS:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            logger.info(f"Found FFmpeg at: {path}")
            return path

    return None


def split_video_at_timestamp(input_path: str, halftime_ms: int, output_dir: str) -> tuple[str, str]:
    """
    Split video into two halves at the given timestamp.

    All I/O is file-based — no multi-GB memory buffers.

    Args:
        input_path: Path to the full-match video file on disk
        halftime_ms: Half-time timestamp in milliseconds
        output_dir: Directory to write half1.mp4 and half2.mp4

    Returns:
        Tuple of (half1_path, half2_path) as strings

    Raises:
        RuntimeError: If FFmpeg is not installed or fails
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            "FFmpeg is not installed. Install FFmpeg to enable video splitting. "
            "On Windows: winget install ffmpeg | On Linux: apt-get install ffmpeg"
        )

    halftime_secs = halftime_ms / 1000.0
    half1_path = str(Path(output_dir) / "half1.mp4")
    half2_path = str(Path(output_dir) / "half2.mp4")

    input_size_mb = Path(input_path).stat().st_size / 1024 / 1024
    logger.info(f"Splitting video at {halftime_secs:.1f}s ({input_size_mb:.1f} MB) using {ffmpeg}")

    # Split half 1: start to halftime
    _run_ffmpeg(ffmpeg, [
        "-y",
        "-i", input_path,
        "-t", str(halftime_secs),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        half1_path,
    ])

    # Split half 2: halftime to end
    _run_ffmpeg(ffmpeg, [
        "-y",
        "-ss", str(halftime_secs),
        "-i", input_path,
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        half2_path,
    ])

    h1_mb = Path(half1_path).stat().st_size / 1024 / 1024
    h2_mb = Path(half2_path).stat().st_size / 1024 / 1024
    logger.info(f"Split complete: half1={h1_mb:.1f} MB, half2={h2_mb:.1f} MB")

    return half1_path, half2_path


def _run_ffmpeg(ffmpeg_path: str, args: list[str]) -> None:
    """Run an FFmpeg command with timeout and error handling."""
    cmd = [ffmpeg_path] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")[-500:]
            raise RuntimeError(f"FFmpeg failed (code {result.returncode}): {stderr}")
    except subprocess.TimeoutExpired:
        raise RuntimeError("FFmpeg timed out after 120 seconds")
