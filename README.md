# volley-scout

Local-first **video scout** for volleyball. Open a match video, let AI cut it into rallies, then log `player → action → outcome` for every touch while the player jumps over dead time. Own-side stats plus opponent errors. The goal: a complete, accurate stat record of a match in under 30 minutes of your time.

The AI only finds where rallies start and end. Every stat is entered by you.

## Quick start

```bash
npm install
cp .env.example .env   # then put your Gemini key in .env
npm run dev
```

Open `http://localhost:5173`. One command starts both the app and a small local server (inside Vite) that cuts rallies and saves matches.

**Gemini key:** create one at [aistudio.google.com](https://aistudio.google.com) → *Get API key* → *Create API key*, and put it in `.env` as `GEMINI_API_KEY=...`. `.env` is git-ignored. Restart `npm run dev` after changing it.

## Workflow

1. **Open the match video** (*Load video*). The file stays on this PC. It is copied once into `.cache/videos/` so the local server can cut it.
2. **Mark the match.** Scrub to the first serve and press **S**, then to the end of the last point and press **E**. Warm-up and the time after the match are never sent to the AI and never played.
3. **Cut rallies.** The match window is split into 60-second pieces. Each piece is shrunk to a small, silent 360p copy and sent to Gemini (`gemini-3.5-flash-lite` by default), which returns rally start/end times. Rallies appear on the timeline as they are found; start scouting right away.
4. **Scout.** The video plays a rally, then jumps to the next one. Log touches with the scout grid as before. When a rally ends without a deciding entry, playback pauses until you log one or press **P** / **O**.

### Keys while scouting

| Key | Does |
|---|---|
| Space | play / pause |
| ↑↓ | grid: choose the player row (the likely player is pre-selected) |
| 1–5 (or ←→ + Enter) | grid: step 1, then step 2 (Enter = first detail) |
| Esc | grid: back out of step 2 |
| , / . | grid: switch situation by hand |
| Backspace / U | undo |
| B / N, V / M | seek ±5 s, ±1 min |
| **P** / **O** | point us / point them (when the deciding touch is not tracked) |
| **[** | rally starts here (in dead time: add a missed rally) |
| **]** | rally ends here (in dead time: extend the previous rally) |
| **K** | split the rally here (two rallies merged into one) |
| **J** | join this rally with the next (one rally cut in two) |
| **X** | not a rally |
| **G** | skip dead time on / off |

Click grey dead time on the timeline to watch it; skipping leaves it alone until the next rally. Striped parts are not analysed yet and play normally.

## Where data lives

- `matches/<video>-<size>.json` — the whole match (roster, rallies, events, score state), saved automatically on every change. Git-ignored.
- `.cache/videos/` — the local copy of each video used for cutting. Safe to delete; it is recreated when you open the file again. Git-ignored.
- Browser `localStorage` — crash backup of the current match.
- `http://localhost:5173/?match=<video>-<size>` reopens a match from the local copy, without picking the file.

## Rally cutting: what was tested

On a real 85-minute fixed-camera match, 60-second pieces with `gemini-3.5-flash-lite` found clearly more rallies than 120-second pieces or `gemini-3.1-flash-lite`. In a hand-checked 2-minute stretch it found 8 of about 9 rallies and merged two close ones. Expect the occasional missed or merged rally; that is what the fix keys are for. A burned-in scoreboard is used only as a hint (in that match it updated ~9 s late).

Override the model with `GEMINI_MODEL=...` in `.env`. Gemini's free tier is enough for one match at a time; on the free tier Google may use uploaded content to improve its products (outside the EEA/UK/CH).

## Scout grid (v3, two steps)

The full grid with every option and what it does to the score: [`docs/action-outcome-grid.md`](docs/action-outcome-grid.md). Machine-readable vocabulary: [`data/action-outcome-grid.yaml`](data/action-outcome-grid.yaml).

The grid follows the rally through five situations (we serve, they serve, second touch, attack, ball comes over). Each has player rows plus an **Opponent** row and a **Team** row (Down, Fault, Replay). Sets end automatically at 25 (15 in set 3) with a two-point lead. Substitutions are made from the roster ("Sub in for…"). Matches saved with the old grid are converted when they are opened.

## Event schema

```ts
{
  id: string
  playerId: string // roster id, "__opponent__" for opponent_error, "__team__" for team / rally_point
  action: string   // grid action id, "rally_point" (P/O) or "substitution"
  outcome: string  // grid outcome id; for substitution, the id of the player going off
  detail?: string  // step-2 detail id, e.g. "tip_dump"
  set?: number     // set number the entry was logged in
  t: number        // seconds in the video file
  source: "human"
  status: "accepted"
}
```

## Development

```bash
npm run build      # type-check + production build
npm run lint
npm test           # rally interval tests (server/)
```

## License

MIT
