"""
Keyframe extraction pipeline for Claude Vision video analysis.

All functions are synchronous — called via asyncio.to_thread() from async routes.
Reuses _find_ffmpeg() from video_splitter.py.

Pipeline: extract frames at 0.5fps → resize 640×360 → SSIM dedup → batch.
"""

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from app.services.video.video_splitter import _find_ffmpeg

logger = logging.getLogger(__name__)


def extract_frames(
    video_path: str,
    output_dir: str,
    fps: float = 0.5,
) -> list[str]:
    """
    Extract frames from video using FFmpeg at the given fps, resized to 640×360.

    Args:
        video_path: Path to input video file
        output_dir: Directory to write frame_XXXX.jpg files
        fps: Frames per second to extract (default 0.5 = one every 2s)

    Returns:
        Sorted list of frame file paths
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            "FFmpeg is not installed. Install FFmpeg to enable frame extraction."
        )

    os.makedirs(output_dir, exist_ok=True)
    pattern = os.path.join(output_dir, "frame_%04d.jpg")

    cmd = [
        ffmpeg,
        "-y",
        "-i", video_path,
        "-vf", f"fps={fps},scale=640:360",
        "-q:v", "5",
        pattern,
    ]

    logger.info(f"Extracting frames at {fps}fps from {video_path}")
    result = subprocess.run(cmd, capture_output=True, timeout=300)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-500:]
        raise RuntimeError(f"FFmpeg frame extraction failed: {stderr}")

    frames = sorted(
        [os.path.join(output_dir, f) for f in os.listdir(output_dir) if f.startswith("frame_") and f.endswith(".jpg")]
    )
    logger.info(f"Extracted {len(frames)} frames")
    return frames


def compute_ssim(img1_path: str, img2_path: str) -> float:
    """
    Compute structural similarity (SSIM) between two images.

    Downscales to 256×256 grayscale for speed. Returns 0.0-1.0.
    """
    size = (256, 256)
    img1 = cv2.imread(img1_path, cv2.IMREAD_GRAYSCALE)
    img2 = cv2.imread(img2_path, cv2.IMREAD_GRAYSCALE)

    if img1 is None or img2 is None:
        return 0.0

    img1 = cv2.resize(img1, size)
    img2 = cv2.resize(img2, size)

    # Constants for SSIM
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    mu1 = cv2.GaussianBlur(img1.astype(np.float64), (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(img2.astype(np.float64), (11, 11), 1.5)

    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(img1.astype(np.float64) ** 2, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(img2.astype(np.float64) ** 2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(img1.astype(np.float64) * img2.astype(np.float64), (11, 11), 1.5) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / (
        (mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2)
    )
    return float(ssim_map.mean())


def filter_static_frames(
    frame_paths: list[str],
    threshold: float = 0.90,
    fps: float = 0.5,
) -> tuple[list[str], list[float]]:
    """
    Remove frames that are too similar to their predecessor (SSIM > threshold).

    Args:
        frame_paths: Sorted list of frame file paths
        threshold: SSIM threshold — higher = more aggressive (drops more)
        fps: Extraction fps (used to compute timestamps)

    Returns:
        (surviving_paths, timestamps_sec) — filtered frames with their timestamps
    """
    if not frame_paths:
        return [], []

    interval = 1.0 / fps  # seconds between frames

    surviving: list[str] = [frame_paths[0]]
    timestamps: list[float] = [0.0]

    for i in range(1, len(frame_paths)):
        ssim = compute_ssim(surviving[-1], frame_paths[i])
        if ssim < threshold:
            surviving.append(frame_paths[i])
            timestamps.append(i * interval)

    reduction_pct = (1 - len(surviving) / len(frame_paths)) * 100 if frame_paths else 0
    logger.info(
        f"SSIM filter: {len(frame_paths)} → {len(surviving)} frames "
        f"({reduction_pct:.0f}% reduction, threshold={threshold})"
    )
    return surviving, timestamps


def create_batches(
    frame_paths: list[str],
    timestamps: list[float],
    batch_size: int = 15,
) -> list[tuple[list[str], list[float], int]]:
    """
    Group frames into consecutive batches for Claude Vision.

    Args:
        frame_paths: Filtered frame paths
        timestamps: Corresponding timestamps in seconds
        batch_size: Frames per batch

    Returns:
        List of (frame_paths, timestamps, batch_index) tuples
    """
    batches = []
    for i in range(0, len(frame_paths), batch_size):
        batch_paths = frame_paths[i:i + batch_size]
        batch_ts = timestamps[i:i + batch_size]
        batch_index = i // batch_size
        batches.append((batch_paths, batch_ts, batch_index))

    logger.info(f"Created {len(batches)} batches of ~{batch_size} frames")
    return batches
