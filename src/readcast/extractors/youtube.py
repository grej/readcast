"""YouTube transcript extraction via yt-dlp."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import register

log = logging.getLogger(__name__)


def fetch_youtube_transcript(video_id: str) -> str:
    """Fetch auto-generated subtitles for a YouTube video via yt-dlp.

    Returns plain text transcript, or empty string if unavailable.
    """
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        log.warning("yt-dlp not found in PATH")
        return ""

    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmp:
        out_template = str(Path(tmp) / "sub")
        cmd = [
            yt_dlp,
            "--skip-download",
            "--write-auto-sub",
            "--sub-lang", "en",
            "--sub-format", "vtt",
            "--output", out_template,
            url,
        ]
        try:
            subprocess.run(cmd, capture_output=True, timeout=30, check=False)
        except subprocess.TimeoutExpired:
            log.warning("yt-dlp timed out for %s", video_id)
            return ""

        # Find the downloaded subtitle file
        sub_files = list(Path(tmp).glob("*.vtt"))
        if not sub_files:
            # Try SRT fallback
            cmd[cmd.index("vtt")] = "srt"
            try:
                subprocess.run(cmd, capture_output=True, timeout=30, check=False)
            except subprocess.TimeoutExpired:
                return ""
            sub_files = list(Path(tmp).glob("*.srt"))

        if not sub_files:
            log.info("No subtitles found for %s", video_id)
            return ""

        raw = sub_files[0].read_text(encoding="utf-8", errors="replace")

    return _parse_subtitles(raw)


def _parse_subtitles(raw: str) -> str:
    """Strip timestamps and deduplicate lines from VTT/SRT subtitle text."""
    lines: list[str] = []
    prev = ""

    for line in raw.splitlines():
        line = line.strip()
        # Skip VTT header, timing lines, sequence numbers, blank lines
        if not line or line.startswith("WEBVTT") or line.startswith("NOTE"):
            continue
        if re.match(r"^\d+$", line):
            continue
        if re.match(r"[\d:.]+\s*-->", line):
            continue
        # Strip VTT positioning tags
        line = re.sub(r"<[^>]+>", "", line)
        line = re.sub(r"\{[^}]+\}", "", line)
        line = line.strip()
        if not line or line == prev:
            continue
        prev = line
        lines.append(line)

    return " ".join(lines)


def extract_for_plugin(scraped_data: dict) -> str:
    """Called by the plugin API when the youtube plugin submits data."""
    video = scraped_data.get("video", {})
    video_id = video.get("video_id", "")
    if not video_id:
        return ""
    return fetch_youtube_transcript(video_id)


register("youtube", extract_for_plugin)
