"""python -m pipeline analyze --video match.mp4 --session session.json --out out/match"""

from __future__ import annotations

import argparse
from pathlib import Path

from .analyze import analyze


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut volleyball points and propose grid events.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("analyze", help="Analyze one match file")
    run.add_argument("--video", required=True, type=Path)
    run.add_argument("--session", required=True, type=Path, help="Exported scout session JSON")
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--model", default=None, help="Gemini model id. Defaults to GEMINI_MODEL or gemini-3.8-flash.")
    board = run.add_mutually_exclusive_group()
    board.add_argument("--scoreboard", action="store_true", help="Read a burned-in scoreboard for this file")
    board.add_argument("--no-scoreboard", action="store_true", help="Ignore a burned-in scoreboard for this file")
    args = parser.parse_args()
    if args.command == "analyze":
        override = True if args.scoreboard else False if args.no_scoreboard else None
        analyze(args.video, args.session, args.out, scoreboard=override, model=args.model)


if __name__ == "__main__":
    main()
