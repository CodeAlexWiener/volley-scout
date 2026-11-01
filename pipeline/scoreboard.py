"""Burned-in scoreboard reads. Digits are clustered into a stable pair, then debounced."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

PAIR_RE = re.compile(r"^(\d{1,2})\s*[-–:]\s*(\d{1,2})$")
SINGLE_RE = re.compile(r"^(\d{1,2})$")
CELL = 0.025


@dataclass(frozen=True)
class Token:
    t: float
    text: str
    cx: float
    cy: float


@dataclass(frozen=True)
class ScoreSample:
    t: float
    us: int
    them: int


def _cell(token: Token) -> tuple[float, float]:
    return (round(token.cx / CELL) * CELL, round(token.cy / CELL) * CELL)


def _parse(text: str) -> tuple[int, int] | int | None:
    cleaned = text.strip()
    pair = PAIR_RE.fullmatch(cleaned)
    if pair:
        return int(pair.group(1)), int(pair.group(2))
    single = SINGLE_RE.fullmatch(cleaned)
    if single:
        return int(single.group(1))
    return None


def score_timeline(
    tokens: list[Token],
    start_us: int,
    start_them: int,
) -> tuple[list[ScoreSample], list[float], str]:
    """Return debounced samples, point-change times, and 'ok' or a failure reason."""
    singles: list[tuple[float, tuple[float, float], int]] = []
    pairs: list[tuple[float, tuple[float, float], int, int]] = []
    for token in tokens:
        parsed = _parse(token.text)
        if parsed is None:
            continue
        if isinstance(parsed, tuple):
            pairs.append((token.t, _cell(token), parsed[0], parsed[1]))
        else:
            singles.append((token.t, _cell(token), parsed))

    readings = _readings(singles, pairs)
    if not readings:
        return [], [], "failed: no stable score"
    oriented, unconfirmed = _orient(readings, start_us, start_them)
    samples = _debounce(oriented)
    if not samples:
        return [], [], "failed: no stable score"
    changes = [sample.t for previous, sample in zip(samples, samples[1:]) if (previous.us, previous.them) != (sample.us, sample.them)]
    status = "ok" if not unconfirmed else "ok: scoreboard side did not match the starting score; left is treated as us"
    return samples, changes, status


def _readings(
    singles: list[tuple[float, tuple[float, float], int]],
    pairs: list[tuple[float, tuple[float, float], int, int]],
) -> list[tuple[float, int, int]]:
    pair_frames = _mode_pairs(pairs)
    single_frames = _mode_singles(singles)
    if len(pair_frames) >= len(single_frames) and len(pair_frames) >= 4:
        return pair_frames
    if len(single_frames) >= 4:
        return single_frames
    if len(pair_frames) >= 4:
        return pair_frames
    return []


def _mode_pairs(
    pairs: list[tuple[float, tuple[float, float], int, int]],
) -> list[tuple[float, int, int]]:
    counts: dict[tuple[float, float], set[float]] = {}
    for moment, cell, _left, _right in pairs:
        counts.setdefault(cell, set()).add(round(moment, 2))
    if not counts:
        return []
    cell = max(counts, key=lambda key: len(counts[key]))
    if len(counts[cell]) < 4:
        return []
    frames: dict[float, tuple[int, int]] = {}
    for moment, candidate, left, right in pairs:
        if abs(candidate[0] - cell[0]) <= CELL and abs(candidate[1] - cell[1]) <= CELL:
            frames[round(moment, 2)] = (left, right)
    return [(moment, left, right) for moment, (left, right) in sorted(frames.items())]


def _mode_singles(
    singles: list[tuple[float, tuple[float, float], int]],
) -> list[tuple[float, int, int]]:
    by_frame: dict[float, list[tuple[tuple[float, float], int]]] = {}
    for moment, cell, value in singles:
        by_frame.setdefault(round(moment, 2), []).append((cell, value))
    pair_counts: dict[tuple[tuple[float, float], tuple[float, float]], set[float]] = {}
    for moment, items in by_frame.items():
        for index, (left_cell, _left_value) in enumerate(items):
            for right_cell, _right_value in items[index + 1 :]:
                if abs(left_cell[1] - right_cell[1]) > 0.03:
                    continue
                gap = abs(left_cell[0] - right_cell[0])
                if gap < 0.02 or gap > 0.22:
                    continue
                ordered = (left_cell, right_cell) if left_cell[0] <= right_cell[0] else (right_cell, left_cell)
                pair_counts.setdefault(ordered, set()).add(moment)
    if not pair_counts:
        return []
    cells = max(pair_counts, key=lambda key: len(pair_counts[key]))
    if len(pair_counts[cells]) < 4:
        return []
    frames: list[tuple[float, int, int]] = []
    for moment, items in sorted(by_frame.items()):
        left = _value_at(items, cells[0])
        right = _value_at(items, cells[1])
        if left is None or right is None:
            continue
        frames.append((moment, left, right))
    return frames


def _value_at(
    items: list[tuple[tuple[float, float], int]],
    cell: tuple[float, float],
) -> int | None:
    for candidate, value in items:
        if abs(candidate[0] - cell[0]) <= CELL and abs(candidate[1] - cell[1]) <= CELL:
            return value
    return None


def _orient(
    readings: list[tuple[float, int, int]],
    start_us: int,
    start_them: int,
) -> tuple[list[tuple[float, int, int]], bool]:
    _moment, left, right = readings[0]
    same = (left, right) == (start_us, start_them)
    swapped = (right, left) == (start_us, start_them)
    # A 0–0 board matches either way. Keep the left number as us.
    use_swap = swapped and not same
    unconfirmed = not same and not swapped
    oriented = [(moment, right, left) if use_swap else (moment, left, right) for moment, left, right in readings]
    return oriented, unconfirmed


def _debounce(readings: list[tuple[float, int, int]]) -> list[ScoreSample]:
    accepted: tuple[int, int] | None = None
    pending: tuple[int, int] | None = None
    pending_t = 0.0
    pending_count = 0
    samples: list[ScoreSample] = []
    for moment, us, them in readings:
        reading = (us, them)
        if reading == pending:
            pending_count += 1
        else:
            pending = reading
            pending_t = moment
            pending_count = 1
        if pending_count < 2 or pending == accepted or pending is None:
            continue
        if accepted is not None and (pending[0] < accepted[0] or pending[1] < accepted[1]):
            continue
        if accepted is not None and pending[0] + pending[1] <= accepted[0] + accepted[1]:
            continue
        accepted = pending
        samples.append(ScoreSample(pending_t, pending[0], pending[1]))
    return samples


def sample_at(samples: list[ScoreSample], moment: float) -> ScoreSample | None:
    current: ScoreSample | None = None
    for sample in samples:
        if sample.t <= moment + 0.5:
            current = sample
        else:
            break
    return current


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None and shutil.which("ffmpeg") is not None


def read_scoreboard(
    video: Path,
    work: Path,
    start_us: int,
    start_them: int,
) -> tuple[list[ScoreSample], list[float], str]:
    if not tesseract_available():
        return [], [], "failed: tesseract or ffmpeg is not installed"
    duration, width, height = probe_video(video)
    probe_dir = work / "score-probe"
    probe_tokens = _ocr_frames(video, probe_dir, duration=duration, sparse=True)
    region = _region_box(probe_tokens, width, height)
    if region is None:
        return [], [], "failed: no stable score"
    full_dir = work / "score-frames"
    tokens = _ocr_frames(video, full_dir, duration=duration, crop=region)
    return score_timeline(tokens, start_us, start_them)


def probe_video(video: Path) -> tuple[float, int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    duration = float(payload.get("format", {}).get("duration") or 0)
    video_stream = next(stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video")
    return duration, int(video_stream["width"]), int(video_stream["height"])


def _region_box(
    tokens: list[Token],
    width: int,
    height: int,
) -> tuple[int, int, int, int] | None:
    """Pixel crop (w, h, x, y) around the stable digit pair, or None."""
    singles: list[tuple[float, tuple[float, float], int]] = []
    pairs: list[tuple[float, tuple[float, float], int, int]] = []
    for token in tokens:
        parsed = _parse(token.text)
        if parsed is None:
            continue
        if isinstance(parsed, tuple):
            pairs.append((token.t, _cell(token), parsed[0], parsed[1]))
        else:
            singles.append((token.t, _cell(token), parsed))
    cells: list[tuple[float, float]] = []
    pair_frames = _mode_pairs(pairs)
    single_frames = _mode_singles(singles)
    if len(single_frames) >= len(pair_frames) and len(single_frames) >= 4:
        # Recover the two cells from the singles that produced the timeline.
        cells = _cells_for_singles(singles)
    elif len(pair_frames) >= 4 and pairs:
        counts: dict[tuple[float, float], int] = {}
        for _moment, cell, _left, _right in pairs:
            counts[cell] = counts.get(cell, 0) + 1
        cells = [max(counts, key=lambda key: counts[key])]
    if not cells:
        return None
    min_x = min(cell[0] for cell in cells) - 0.04
    max_x = max(cell[0] for cell in cells) + 0.08
    min_y = min(cell[1] for cell in cells) - 0.04
    max_y = max(cell[1] for cell in cells) + 0.06
    x = max(0, int(min_x * width))
    y = max(0, int(min_y * height))
    right = min(width, int(max_x * width))
    bottom = min(height, int(max_y * height))
    if right - x < 8 or bottom - y < 8:
        return None
    return right - x, bottom - y, x, y


def _cells_for_singles(
    singles: list[tuple[float, tuple[float, float], int]],
) -> list[tuple[float, float]]:
    frames = _mode_singles(singles)
    if len(frames) < 4:
        return []
    by_frame: dict[float, list[tuple[tuple[float, float], int]]] = {}
    for moment, cell, value in singles:
        by_frame.setdefault(round(moment, 2), []).append((cell, value))
    pair_counts: dict[tuple[tuple[float, float], tuple[float, float]], int] = {}
    for items in by_frame.values():
        for index, (left_cell, _left) in enumerate(items):
            for right_cell, _right in items[index + 1 :]:
                if abs(left_cell[1] - right_cell[1]) > 0.03:
                    continue
                gap = abs(left_cell[0] - right_cell[0])
                if gap < 0.02 or gap > 0.22:
                    continue
                ordered = (left_cell, right_cell) if left_cell[0] <= right_cell[0] else (right_cell, left_cell)
                pair_counts[ordered] = pair_counts.get(ordered, 0) + 1
    if not pair_counts:
        return []
    left, right = max(pair_counts, key=lambda key: pair_counts[key])
    return [left, right]


def _ocr_frames(
    video: Path,
    directory: Path,
    *,
    duration: float,
    sparse: bool = False,
    crop: tuple[int, int, int, int] | None = None,
) -> list[Token]:
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("*.jpg"):
        old.unlink()
    step = max(duration / 24, 1.0) if sparse else 1.0
    filters: list[str] = []
    if crop is not None:
        crop_w, crop_h, crop_x, crop_y = crop
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
    filters.append(f"fps=1/{step:.3f}" if sparse else "fps=1")
    filters.append("scale=960:-1")
    pattern = directory / "frame_%05d.jpg"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-vf",
            ",".join(filters),
            "-q:v",
            "5",
            str(pattern),
        ],
        check=True,
        capture_output=True,
    )
    frames = sorted(directory.glob("frame_*.jpg"))
    if not frames:
        return []
    jpeg_w, jpeg_h = _image_size(frames[0])
    tokens: list[Token] = []
    for index, frame in enumerate(frames):
        tokens.extend(_tesseract_tokens(frame, index * step, jpeg_w, jpeg_h))
    return tokens


def _image_size(image: Path) -> tuple[int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            str(image),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    width, height = result.stdout.strip().split("x")
    return int(width), int(height)


def _tesseract_tokens(image: Path, moment: float, width: int, height: int) -> list[Token]:
    result = subprocess.run(
        ["tesseract", str(image), "stdout", "--psm", "6", "tsv"],
        check=False,
        capture_output=True,
        text=True,
    )
    tokens: list[Token] = []
    if result.returncode != 0:
        return tokens
    lines = result.stdout.splitlines()
    if not lines:
        return tokens
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 12 or parts[0] != "5":
            continue
        text = parts[11].strip()
        if not text:
            continue
        try:
            left, top, box_w, box_h = (int(parts[6]), int(parts[7]), int(parts[8]), int(parts[9]))
        except ValueError:
            continue
        if width <= 0 or height <= 0:
            continue
        tokens.append(
            Token(
                t=moment,
                text=text,
                cx=(left + box_w / 2) / width,
                cy=(top + box_h / 2) / height,
            )
        )
    return tokens
