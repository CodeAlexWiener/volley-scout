/**
 * Local API, mounted inside the Vite dev server so `npm run dev` starts everything.
 *
 *   GET  /api/health              -> { geminiKey, ffmpeg, model }
 *   GET  /api/video/:key          -> { exists }
 *   PUT  /api/video/:key          (raw video body) -> { ok }
 *   GET  /api/video/:key/file     -> the local copy, with Range support
 *   POST /api/cut                 { videoKey, start, end } -> CutJobView
 *   GET  /api/cut/:id             -> CutJobView
 *   DELETE /api/cut/:id           -> { cancelled }
 *   GET  /api/matches/:id         -> match JSON | 404
 *   PUT  /api/matches/:id         (match JSON) -> { ok }
 *
 * Everything stays on this machine except the shrunken chunks sent to Gemini.
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import ffmpegPath from 'ffmpeg-static'
import type { Plugin } from 'vite'
import { cancelJob, getJob, startCutJob } from './cutJob.ts'
import { DEFAULT_MODEL } from './gemini.ts'

type Env = Record<string, string | undefined>

const SAFE_ID = /^[\w.-]{1,160}$/

export function scoutApi(root: string, env: Env): Plugin {
  const videoDir = path.join(root, '.cache', 'videos')
  const workDir = path.join(root, '.cache', 'jobs')
  const matchDir = path.join(root, 'matches')
  const apiKey = () => env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || ''
  const model = () => env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  const rpm = () => Number(env.GEMINI_RPM) > 0 ? Number(env.GEMINI_RPM) : 14

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'api') return false
    const [, area, id] = parts
    const method = req.method ?? 'GET'

    if (area === 'health' && method === 'GET') {
      return send(res, 200, {
        geminiKey: apiKey().length > 0,
        ffmpeg: Boolean(ffmpegPath && existsSync(ffmpegPath as unknown as string)),
        model: model(),
      })
    }

    if (area === 'video' && id && SAFE_ID.test(id)) {
      const file = path.join(videoDir, `${id}.mp4`)
      if (method === 'GET' && parts[3] === 'file') {
        return streamVideo(req, res, file)
      }
      if (method === 'GET') {
        return send(res, 200, { exists: existsSync(file) })
      }
      if (method === 'PUT') {
        await mkdir(videoDir, { recursive: true })
        const partial = `${file}.part`
        try {
          await pipeline(req, createWriteStream(partial))
          await rename(partial, file)
        } catch (error) {
          await rm(partial, { force: true })
          throw error
        }
        const size = (await stat(file)).size
        return send(res, 200, { ok: true, size })
      }
    }

    if (area === 'cut') {
      if (method === 'POST' && !id) {
        const body = (await readJson(req)) as { videoKey?: string; start?: number; end?: number }
        const key = apiKey()
        if (!key) return send(res, 400, { error: 'GEMINI_API_KEY is missing. Add it to .env and restart npm run dev.' })
        if (!body.videoKey || !SAFE_ID.test(body.videoKey)) return send(res, 400, { error: 'Bad video key' })
        const videoPath = path.join(videoDir, `${body.videoKey}.mp4`)
        if (!existsSync(videoPath)) return send(res, 404, { error: 'Video not on the local server yet' })
        const start = Number(body.start)
        const end = Number(body.end)
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 5) {
          return send(res, 400, { error: 'Mark a match start and end at least 5 seconds apart' })
        }
        return send(res, 200, startCutJob({ videoPath, window: { start, end }, apiKey: key, model: model(), rpm: rpm(), workDir }))
      }
      if (id && method === 'GET') {
        const job = getJob(id)
        return job ? send(res, 200, job) : send(res, 404, { error: 'Unknown job (the server may have restarted)' })
      }
      if (id && method === 'DELETE') {
        return send(res, 200, { cancelled: cancelJob(id) })
      }
    }

    if (area === 'matches' && id && SAFE_ID.test(id)) {
      const file = path.join(matchDir, `${id}.json`)
      if (method === 'GET') {
        if (!existsSync(file)) return send(res, 404, { error: 'No saved match' })
        res.setHeader('content-type', 'application/json')
        res.end(await readFile(file, 'utf8'))
        return true
      }
      if (method === 'PUT') {
        const body = await readJson(req)
        await mkdir(matchDir, { recursive: true })
        const temp = `${file}.tmp`
        await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`)
        await rename(temp, file)
        return send(res, 200, { ok: true })
      }
    }

    return send(res, 404, { error: 'Not found' })
  }

  return {
    name: 'volley-scout-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handle(req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            if (!res.headersSent) send(res, 500, { error: message })
          })
      })
    },
  }
}

/** Serve the local video copy with HTTP Range support so the player can seek. */
async function streamVideo(req: IncomingMessage, res: ServerResponse, file: string): Promise<true> {
  if (!existsSync(file)) return send(res, 404, { error: 'No local copy of this video' })
  const size = (await stat(file)).size
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('content-type', 'video/mp4')
  if (!range) {
    res.setHeader('content-length', size)
    await pipeline(createReadStream(file), res)
    return true
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
  if (start >= size || start > end) {
    res.statusCode = 416
    res.setHeader('content-range', `bytes */${size}`)
    res.end()
    return true
  }
  res.statusCode = 206
  res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
  res.setHeader('content-length', end - start + 1)
  await pipeline(createReadStream(file, { start, end }), res).catch(() => {
    // The player cancels range requests all the time while seeking.
  })
  return true
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
  return true
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 20_000_000) throw new Error('Request body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}
