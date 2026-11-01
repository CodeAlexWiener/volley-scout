"""Cut one rally clip. The file timestamp of a clip-local time is clip start + t."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .intervals import Rally


def has_audio(video: Path) -> bool:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(video),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    return bool(result.stdout.strip())


def cut_clip(video: Path, rally: Rally, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    start = max(0.0, rally.start)
    duration = max(0.1, rally.duration)
    pre = 1.0 if start > 1.0 else 0.0
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start - pre:.3f}",
        "-i",
        str(video),
        "-ss",
        f"{pre:.3f}",
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-movflags",
        "+faststart",
    ]
    if has_audio(video):
        command.extend(["-c:a", "aac"])
    else:
        command.append("-an")
    command.append(str(dest))
    subprocess.run(command, check=True, capture_output=True)
