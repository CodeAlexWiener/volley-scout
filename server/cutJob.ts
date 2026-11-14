/**
 * Rally cut job: split the match window into overlapping chunks, shrink each
 * chunk with ffmpeg, ask Gemini for rally times, and publish results as they
 * arrive so scouting can start before the whole match is done.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { findRalliesInClip, GeminiError } from './gemini.ts'
import { chunkSpans, mergeSpans, padSpans, toFileTimes, unionSpans, type Span } from './rallies.ts'

export type CutJobView = {
  id: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  model: string
  window: Span
  chunksTotal: number
  chunksDone: number
  /** Parts of the window the model has already looked at. */
  covered: Span[]
  /** Padded rally ranges found so far, in file seconds. */
  rallies: Span[]
  warnings: string[]
  error?: string
}

type CutJob = CutJobView & {
  raw: Span[]
  abort: AbortController
}

const jobs = new Map<string, CutJob>()
const PARALLEL = 3

/**
 * Gemini's free tier allows 15 requests per minute for Flash-Lite. Space calls
 * out so a whole match never trips the limit. Override with GEMINI_RPM.
 */
let nextSlot = 0
function rateLimitedSlot(rpm: number, signal: AbortSignal): Promise<void> {
  const gap = 60_000 / Math.max(1, rpm)
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + gap
  return sleep(at - now, signal)
}

export function getJob(id: string): CutJobView | null {
  const job = jobs.get(id)
  if (!job) return null
  const { raw: _raw, abort: _abort, ...view } = job
  return view
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return false
  job.abort.abort()
  job.status = 'cancelled'
  return true
}

export function startCutJob(opts: {
  videoPath: string
  window: Span
  apiKey: string
  model: string
  rpm: number
  workDir: string
}): CutJobView {
  // 60s chunks found clearly more rallies than 120s chunks in testing.
  const chunks = chunkSpans(opts.window, 60, 15)
  const job: CutJob = {
    id: `cut_${randomUUID().slice(0, 8)}`,
    status: 'running',
    model: opts.model,
    window: opts.window,
    chunksTotal: chunks.length,
    chunksDone: 0,
    covered: [],
    rallies: [],
    warnings: [],
    raw: [],
    abort: new AbortController(),
  }
  jobs.set(job.id, job)
  void run(job, chunks, opts).catch((error: unknown) => {
    if (job.status === 'running') {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    }
  })
  return getJob(job.id)!
}

async function run(
  job: CutJob,
  chunks: Span[],
  opts: { videoPath: string; apiKey: string; model: string; rpm: number; workDir: string },
): Promise<void> {
  const dir = path.join(opts.workDir, job.id)
  await mkdir(dir, { recursive: true })
  let next = 0
  let consecutiveFailures = 0

  async function worker(): Promise<void> {
    while (job.status === 'running') {
      const index = next++
      const chunk = chunks[index]
      if (!chunk) return
      const clipPath = path.join(dir, `chunk_${String(index).padStart(3, '0')}.mp4`)
      try {
        await shrinkClip(opts.videoPath, chunk, clipPath, job.abort.signal)
        const clip = await readFile(clipPath)
        const local = await withRetry(
          async () => {
            await rateLimitedSlot(opts.rpm, job.abort.signal)
            return findRalliesInClip({
              apiKey: opts.apiKey,
              model: opts.model,
              clip,
              clipSeconds: chunk.end - chunk.start,
              signal: job.abort.signal,
            })
          },
          job.abort.signal,
        )
        job.raw.push(...toFileTimes(chunk, local))
        job.rallies = padSpans(mergeSpans(job.raw), job.window)
        job.covered = unionSpans([...job.covered, chunk])
        consecutiveFailures = 0
      } catch (error) {
        if (job.status !== 'running') return
        const message = error instanceof Error ? error.message : String(error)
        job.warnings.push(`Chunk ${index + 1} (${clock(chunk.start)}–${clock(chunk.end)}): ${message}`)
        consecutiveFailures++
        if (error instanceof GeminiError && !error.retryable) {
          // Bad key, bad model id, request too large: every chunk will fail the same way.
          job.status = 'failed'
          job.error = message
          job.abort.abort()
          return
        }
        if (consecutiveFailures >= 4) {
          job.status = 'failed'
          job.error = `Stopped after repeated failures. Last: ${message}`
          job.abort.abort()
          return
        }
      } finally {
        job.chunksDone++
        await rm(clipPath, { force: true })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker))
  await rm(dir, { recursive: true, force: true })
  if (job.status === 'running') job.status = 'done'
}

async function withRetry<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      if (!(error instanceof GeminiError) || !error.retryable || signal.aborted) throw error
      // Use the wait the server asks for; otherwise back off.
      await sleep(error.retryAfterMs ?? Math.min(60_000, 5000 * 2 ** attempt), signal)
    }
  }
  throw lastError
}

/** Small, silent, low-res copy of one chunk: cheap to send, enough to see rallies. */
function shrinkClip(input: string, chunk: Span, output: string, signal: AbortSignal): Promise<void> {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg-static has no binary for this platform'))
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    chunk.start.toFixed(2),
    '-i',
    input,
    '-t',
    (chunk.end - chunk.start).toFixed(2),
    '-vf',
    'scale=-2:360,fps=4',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '32',
    '-movflags',
    '+faststart',
    output,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath as unknown as string, args, { signal, windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.trim().slice(0, 300)}`))
    })
  })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
