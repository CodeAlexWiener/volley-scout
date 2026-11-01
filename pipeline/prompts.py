"""Prompts for rally cuts and grid labels. The grid is the only legal vocabulary."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
GRID_PATH = ROOT / "data" / "action-outcome-grid.yaml"

BOUNDARY_SCHEMA = {
    "type": "object",
    "properties": {
        "rallies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                },
                "required": ["start", "end"],
            },
        }
    },
    "required": ["rallies"],
}


def load_grid() -> dict:
    return yaml.safe_load(GRID_PATH.read_text())


def action_ids(grid: dict) -> list[str]:
    return [action["id"] for action in grid["actions"]]


def label_schema(grid: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "touches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "t": {"type": "number"},
                        "player": {"type": "string"},
                        "number": {"type": "string"},
                        "action": {"type": "string", "enum": action_ids(grid)},
                        "outcome": {"type": "string"},
                        "confidence": {"type": "number"},
                        "evidence": {"type": "string"},
                    },
                    "required": ["t", "player", "action", "outcome", "confidence", "evidence"],
                },
            }
        },
        "required": ["touches"],
    }


def grid_lines(grid: dict) -> str:
    lines = []
    for action in grid["actions"]:
        outcomes = " | ".join(outcome["id"] for outcome in action["outcomes"])
        note = f" — {action['note']}" if action.get("note") else ""
        lines.append(f"- {action['id']}: {outcomes}{note}")
    return "\n".join(lines)


def boundary_prompt(start: float, end: float, *, scoreboard: bool) -> str:
    graphic = (
        "A scoreboard is burned into the picture. A change in the score is the end of a point. Use it."
        if scoreboard
        else "Do not look for a scoreboard. Judge the whistle, the serve, and the dead ball."
    )
    return "\n".join(
        [
            "Find every volleyball point that is in play in this window of a match.",
            graphic,
            "Include the serve. End when the ball is dead.",
            "Skip timeouts, celebrations, and replay if you can tell them apart.",
            f"This window is seconds {start:.2f} to {end:.2f} of the full match.",
            "start and end are seconds from the beginning of the full match, not from this window.",
            'Return JSON: {"rallies": [{"start": number, "end": number}]}',
        ]
    )


def label_prompt(
    roster_block: str,
    grid: dict,
    *,
    scoreboard_line: str | None,
) -> str:
    check = (
        f"A scoreboard read at the start of this clip says {scoreboard_line}. You may disagree if the picture says otherwise."
        if scoreboard_line
        else "No scoreboard reading is available for this clip."
    )
    return "\n".join(
        [
            "You label one volleyball rally. Own side only. Do not invent actions or outcomes.",
            "t is seconds from the start of this clip.",
            "player is the roster name. number is the jersey number when you can read it, otherwise an empty string.",
            'Use player "Opponent" and action opponent_error only when they end the rally with no useful touch of ours.',
            "Pass quality (in_system / out_of_system) and set versus save are visual judgments.",
            "If you are unsure a touch happened, leave it out.",
            "confidence is from 0 to 1.",
            "evidence is one short sentence.",
            check,
            "",
            roster_block,
            "",
            "Legal action → outcome ids:",
            grid_lines(grid),
        ]
    )


def roster_block(session: dict, match: dict) -> str:
    roster = {player["id"]: player for player in session.get("roster", [])}
    positions = match.get("positions") or {}
    lines = [f"Serving side at the start of this rally: {match.get('servingTeam', 'us')}"]
    lines.append(
        f"Score at the start of this rally: us {match.get('scoreUs', 0)} – them {match.get('scoreThem', 0)}"
    )
    for pos in range(1, 7):
        player_id = positions.get(str(pos))
        if player_id is None:
            player_id = positions.get(pos)
        player = roster.get(player_id) if player_id else None
        if not player:
            lines.append(f"P{pos}: empty")
            continue
        number = f"#{player['number']} " if player.get("number") else ""
        role = player.get("role") or "role unspecified"
        lines.append(f"P{pos}: {number}{player['name']} ({role})")
    return "\n".join(lines)
