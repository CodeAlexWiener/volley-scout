import { readFileSync, writeFileSync } from 'node:fs'
import { replayJob, type ReplayJob } from '../src/replayEvents.ts'

const raw = readFileSync(0, 'utf8')
const job = JSON.parse(raw) as ReplayJob
if (!job || typeof job !== 'object' || !job.session || !Array.isArray(job.rallies)) {
  process.stderr.write('Replay input must be { session, rallies }.\n')
  process.exit(1)
}

const result = replayJob(job)
if (result.warnings.length > 0) {
  process.stderr.write(`${result.warnings.join('\n')}\n`)
}

if (process.argv.includes('--state')) {
  process.stdout.write(JSON.stringify(result.match))
} else {
  const flag = process.argv.indexOf('--write')
  const out = flag >= 0 ? process.argv[flag + 1] : ''
  if (!out) {
    process.stderr.write('Pass --write <session.ai.json> or --state.\n')
    process.exit(1)
  }
  writeFileSync(out, `${JSON.stringify(result.session, null, 2)}\n`)
}
