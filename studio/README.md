# volley-scout studio

Local Remotion project. It does not detect actions. It cuts clips the scout already understands: the game window plus rally ranges from accepted touches (or from an imported proposal file).

```bash
npm install
node render-clips.mjs path/to/manifest.json path/to/match.mp4
```

The manifest is the “Export edit” download from the Studio tab. Rendered files land in `studio/out/`.

Each clip is the source video trimmed with `trimBefore` / `durationInFrames`, with the scout label burned in. The source file is copied to `studio/public/source.mp4` for that render and is not committed.
