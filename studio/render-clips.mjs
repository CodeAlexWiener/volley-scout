import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { cp, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioRoot = path.dirname(fileURLToPath(import.meta.url))

function usage() {
  console.error('Usage: node render-clips.mjs <manifest.json> <video.mp4> [outDir]')
  process.exit(1)
}

const manifestPath = process.argv[2]
const videoPath = process.argv[3]
const outDir = path.resolve(process.argv[4] ?? path.join(studioRoot, 'out'))
if (!manifestPath || !videoPath) usage()

const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'))
const clips = Array.isArray(manifest.clips) ? manifest.clips : []
if (clips.length === 0) {
  console.error('Manifest has no clips. Set a game window or log a touch first.')
  process.exit(1)
}

const publicDir = path.join(studioRoot, 'public')
await mkdir(publicDir, { recursive: true })
await mkdir(outDir, { recursive: true })
await cp(path.resolve(videoPath), path.join(publicDir, 'source.mp4'))

console.log(`Bundling Remotion studio (${clips.length} clip${clips.length === 1 ? '' : 's'})…`)
const serveUrl = await bundle({
  entryPoint: path.join(studioRoot, 'src', 'index.ts'),
  webpackOverride: (config) => config,
})

for (const [index, clip] of clips.entries()) {
  const startSec = Number(clip.start)
  const endSec = Number(clip.end)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    console.error(`Skipping clip ${clip.id ?? index}: bad range ${clip.start}–${clip.end}`)
    continue
  }
  const inputProps = {
    src: 'source.mp4',
    startSec,
    endSec,
    label: String(clip.label ?? 'Scout clip'),
  }
  const composition = await selectComposition({
    serveUrl,
    id: 'LabeledClip',
    inputProps,
  })
  const safeId = String(clip.id ?? `clip-${index + 1}`).replace(/[^\w.-]+/g, '_')
  const outputLocation = path.join(outDir, `${String(index + 1).padStart(2, '0')}-${safeId}.mp4`)
  console.log(`Rendering ${outputLocation} (${startSec.toFixed(2)}s–${endSec.toFixed(2)}s)`)
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    chromiumOptions: { gl: 'swangle' },
  })
}

console.log(`Wrote ${clips.length} clip(s) to ${outDir}`)
