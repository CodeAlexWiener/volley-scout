"""Cut a match into points, label each clip on the scout grid, and write a session to import."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .cuts import cut_clip
from .gemini import GeminiVideo
from .intervals import Rally, fuse_score_changes, merge_rallies, pad_rallies, rallies_from_changes, windows
from .prompts import BOUNDARY_SCHEMA, label_prompt, label_schema, load_grid, roster_block
from .prompts import boundary_prompt
from .scoreboard import probe_video, read_scoreboard, sample_at

ROOT = Path(__file__).resolve().parents[1]


def analyze(
    video: Path,
    session_path: Path,
    out_dir: Path,
    *,
    scoreboard: bool | None = None,
    model: str | None = None,
) -> None:
    session = json.loads(session_path.read_text())
    if scoreboard is not None:
        session["scoreboardBurnedIn"] = scoreboard
    use_scoreboard = session.get("scoreboardBurnedIn") is True
    out_dir.mkdir(parents=True, exist_ok=True)
    duration, _width, _height = probe_video(video)
    warnings: list[str] = []
    samples = []
    changes: list[float] = []
    scoreboard_status = "off"
    if use_scoreboard:
        samples, changes, scoreboard_status = read_scoreboard(
            video,
            out_dir / "scoreboard",
            int(session.get("match", {}).get("scoreUs") or 0),
            int(session.get("match", {}).get("scoreThem") or 0),
        )
        print(f"Scoreboard: {scoreboard_status}", file=sys.stderr)
        if scoreboard_status.startswith("failed"):
            warnings.append(scoreboard_status + ". Continuing with model windows only.")
            samples = []
            changes = []
    else:
        print("Scoreboard: off", file=sys.stderr)

    grid = load_grid()
    gemini = GeminiVideo(video, model)
    try:
        rough = _detect(gemini, duration, use_scoreboard)
        if not rough and changes:
            warnings.append("Model returned no rallies. Using scoreboard changes.")
            rough = rallies_from_changes(changes, duration)
        elif changes and not scoreboard_status.startswith("failed"):
            rough = fuse_score_changes(rough, changes, duration)
        rallies = pad_rallies(merge_rallies(rough), duration)
        if not rallies:
            raise SystemExit("No rallies found. Check the video and, if you expected a graphic, the scoreboard switch.")

        labeled: list[dict] = []
        manifest_rallies = []
        clips = out_dir / "clips"
        for index, rally in enumerate(rallies, start=1):
            rally_id = f"rally_{index:03d}"
            clip_path = clips / f"{rally_id}.mp4"
            print(f"Cutting {rally_id} {rally.start:.2f}-{rally.end:.2f}", file=sys.stderr)
            cut_clip(video, rally, clip_path)
            match = _replay(session, labeled, state=True)
            reading = sample_at(samples, rally.start) if samples else None
            scoreboard_line = None if reading is None else f"us {reading.us} – them {reading.them}"
            print(f"Labeling {rally_id}", file=sys.stderr)
            touches = _label(gemini, rally, grid, roster_block(session, match), scoreboard_line)
            labeled.append(
                {"id": rally_id, "start": rally.start, "end": rally.end, "touches": touches}
            )
            manifest_rallies.append(
                {
                    "id": rally_id,
                    "start": rally.start,
                    "end": rally.end,
                    "clip": str(clip_path.relative_to(out_dir)),
                    "scoreboard": None if reading is None else {"us": reading.us, "them": reading.them},
                }
            )
    finally:
        gemini.close()

    session_out = out_dir / "session.ai.json"
    replay_warnings = _replay(session, labeled, write=session_out)
    warnings.extend(replay_warnings)
    manifest = {
        "video": str(video),
        "timeMap": "fileSeconds = clipSeconds + start",
        "scoreboardBurnedIn": use_scoreboard,
        "scoreboardStatus": scoreboard_status,
        "warnings": warnings,
        "rallies": manifest_rallies,
    }
    (out_dir / "rallies.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {session_out}", file=sys.stderr)
    if warnings:
        print("\n".join(warnings), file=sys.stderr)


def _detect(model: GeminiVideo, duration: float, scoreboard: bool) -> list[Rally]:
    found: list[Rally] = []
    for start, end in windows(duration):
        print(f"Boundaries {start:.0f}-{end:.0f}", file=sys.stderr)
        payload = model.ask(start, end, 1, boundary_prompt(start, end, scoreboard=scoreboard), BOUNDARY_SCHEMA)
        for item in payload.get("rallies") or []:
            try:
                rally_start = float(item["start"])
                rally_end = float(item["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if rally_end < rally_start:
                rally_start, rally_end = rally_end, rally_start
            if rally_end < start - 2 or rally_start > end + 2:
                continue
            found.append(Rally(max(0.0, rally_start), min(duration, rally_end)))
    return merge_rallies(found)


def _label(model: GeminiVideo, rally: Rally, grid: dict, roster: str, scoreboard_line: str | None) -> list[dict]:
    payload = model.ask(
        rally.start,
        rally.end,
        5,
        label_prompt(roster, grid, scoreboard_line=scoreboard_line),
        label_schema(grid),
    )
    touches = []
    for item in payload.get("touches") or []:
        try:
            local_t = float(item["t"])
        except (KeyError, TypeError, ValueError):
            continue
        touches.append(
            {
                "t": _file_time(local_t, rally),
                "player": str(item.get("player") or ""),
                "number": str(item.get("number") or ""),
                "action": str(item.get("action") or ""),
                "outcome": str(item.get("outcome") or ""),
                "confidence": float(item["confidence"]) if _is_number(item.get("confidence")) else None,
                "evidence": str(item.get("evidence") or ""),
            }
        )
    return touches


def _is_number(value: object) -> bool:
    try:
        float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return True


def _file_time(local_t: float, rally: Rally) -> float:
    span = rally.duration
    if local_t <= span + 0.25:
        return round(rally.start + max(0.0, local_t), 3)
    if rally.start - 1 <= local_t <= rally.end + 1:
        return round(local_t, 3)
    return round(rally.start + local_t, 3)


def _replay(session: dict, rallies: list[dict], *, state: bool = False, write: Path | None = None):
    command = _tsx_command(ROOT / "pipeline" / "replay.ts")
    if state:
        command.append("--state")
    else:
        command.extend(["--write", str(write)])
    result = subprocess.run(
        command,
        input=json.dumps({"session": session, "rallies": rallies}),
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or "Replay failed.")
    warnings = [line for line in result.stderr.splitlines() if line.strip()]
    if state:
        if not result.stdout.strip():
            raise SystemExit("Replay did not return a match state.")
        return json.loads(result.stdout)
    return warnings


def _tsx_command(script: Path) -> list[str]:
    local = ROOT / "node_modules" / ".bin" / "tsx"
    if local.exists():
        return [str(local), str(script)]
    return ["npx", "--no-install", "tsx", str(script)]
