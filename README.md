# volley-scout

Local-first video scout mask for volleyball. Load a match video in the browser, bind on-screen players to a roster, and log `player → action → outcome` events at the current timestamp. Own-side only.

A separate local pipeline can cut each point and propose those same grid events. You accept or edit them in the mask. The mask still owns rotation, score, and what is legal.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Pick a local video file, add roster players (role + starting P1–P6), select a current player, choose action + outcome from the grid, and mark the event. After each mark, accept a **Suggested next** chip or override freely.

## What it does

- Load a local video (file picker; nothing uploaded to a server)
- Default six-player roster on first load (editable); roles setter / outside / opposite / middle + P1–P6; optional jersey number
- Per-match **Scoreboard burned in** switch, stored on the session and used by analysis
- Live court diagram of our side (P1–P6, front vs back, server highlight)
- Court rotation + auto side-out rotate when we earn serve
- Flow-aware next-action suggestions (player + action; set outcome not graded in/out)
- Scrub video; mark events at the playhead
- Event log with edit / delete; proposed events show a badge until you accept or edit them
- Persist session in `localStorage`; export / import JSON

## Analysis pipeline

The browser does not upload the video. Export the session after you set the starting lineup, the score at the start of the file, who serves, and the scoreboard switch. Jersey numbers are optional context for the model.

```bash
pip install -r pipeline/requirements.txt
npm install
# tesseract is used only when the scoreboard switch is on
python -m pipeline analyze --video match.mp4 --session session.json --out pipeline-out/match
```

Needs `ffmpeg` and `GEMINI_API_KEY`. `--scoreboard` or `--no-scoreboard` overrides the switch for that file. The command writes `clips/`, `rallies.json`, and `session.ai.json`. Import `session.ai.json` in the mask. Proposed events stay proposed until you accept or edit them.

With the switch on, a stable scoreboard graphic confirms or inserts point boundaries. If the graphic cannot be read, the run says so and continues from the model windows. With the switch off, the scoreboard is never read.

## Action → outcome grid (v2.5)

Machine-readable source of truth: [`data/action-outcome-grid.yaml`](data/action-outcome-grid.yaml). Explainer: [`docs/action-outcome-grid.md`](docs/action-outcome-grid.md). Flow: [`docs/scouting-flow.md`](docs/scouting-flow.md).

Actions: serve, reception, dig, second_touch (`set`|`save`|`error_own`|`error_tried_save`), attack, dump, block, freeball_send. Pass quality lives on reception/dig; setter analytics are derived later.

## Event schema (v1)

```ts
{
  id: string
  playerId: string
  action: string   // grid action id
  outcome: string  // grid outcome id for that action
  t: number        // seconds
  source: "human" | "ai"
  status: "accepted" | "proposed" | "rejected"
  pointId?: string
  priorEventId?: string
  note?: string
}
```

The mask logs `source: "human"`. The pipeline logs `source: "ai"` and `status: "proposed"`. Accept or edit marks that event accepted and leaves the source as `ai`.

## License

MIT
