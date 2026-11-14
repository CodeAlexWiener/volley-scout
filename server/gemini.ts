/** One Gemini call per chunk: inline video in, rally start/end times out. */

import type { Span } from './rallies.ts'

/** Tested on a real match: best rally recall of the Flash-Lite models, ~3s per 60s chunk. */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const CALL_TIMEOUT_MS = 90_000

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rallies: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          start: { type: 'NUMBER' },
          end: { type: 'NUMBER' },
        },
        required: ['start', 'end'],
      },
    },
  },
  required: ['rallies'],
}

export function rallyPrompt(clipSeconds: number): string {
  const n = Math.round(clipSeconds)
  return [
    `This is a ${n}-second clip from a fixed-camera amateur indoor volleyball match.`,
    'List every rally that is at least partly inside the clip.',
    'A rally starts when the server tosses the ball for a serve. If a rally is already in progress at the very start of the clip, start it at 0.',
    'A rally ends when the ball is dead: it touches the floor, lands out, a serve hits the net and drops, or the referee whistles a fault.',
    `If a rally is still going at the end of the clip, end it at ${n}.`,
    'Not rallies: players walking back between points, timeouts, substitutions, set breaks, celebrations, warm-up hitting.',
    'A scoreboard may be visible. If it is, a score change confirms that a rally just ended; use it only if it helps.',
    `Give times in seconds from the start of this clip (0 to ${n}), with one decimal.`,
    'Return {"rallies": []} if there is no rally in the clip.',
  ].join('\n')
}

export class GeminiError extends Error {
  readonly retryable: boolean
  /** Server-suggested wait before retrying (rate limits), if it gave one. */
  readonly retryAfterMs: number | null
  constructor(message: string, retryable: boolean, retryAfterMs: number | null = null) {
    super(message)
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

export async function findRalliesInClip(opts: {
  apiKey: string
  model: string
  clip: Buffer
  clipSeconds: number
  signal?: AbortSignal
  fps?: number
  mediaResolution?: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH'
}): Promise<Span[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: { mimeType: 'video/mp4', data: opts.clip.toString('base64') },
            videoMetadata: { fps: opts.fps ?? 2 },
          },
          { text: rallyPrompt(opts.clipSeconds) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      mediaResolution: opts.mediaResolution ?? 'MEDIA_RESOLUTION_LOW',
    },
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
        : AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (error) {
    throw new GeminiError(`Network error: ${(error as Error).message}`, true)
  }
  const text = await response.text()
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    const message = extractMessage(text)
    const wait = /retry in ([\d.]+)s/i.exec(message)
    // Keep the first line: the full quota text is long.
    throw new GeminiError(
      `Gemini ${response.status}: ${message.split('\n')[0]}`,
      retryable,
      wait ? Math.ceil(Number(wait[1]) * 1000) + 1000 : null,
    )
  }
  return parseRallies(text)
}

/** Pull `{rallies:[...]}` out of a generateContent response body. */
export function parseRallies(responseBody: string): Span[] {
  let payload: unknown
  try {
    payload = JSON.parse(responseBody)
  } catch {
    throw new GeminiError('Gemini returned something that is not JSON', true)
  }
  const parts = (payload as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    .candidates?.[0]?.content?.parts
  const answer = parts?.map((part) => part.text ?? '').join('').trim()
  if (!answer) throw new GeminiError('Gemini returned an empty answer', true)
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new GeminiError('Gemini answer was not valid JSON', true)
  }
  const list = (parsed as { rallies?: unknown }).rallies
  if (!Array.isArray(list)) return []
  return list
    .map((item) => item as { start?: unknown; end?: unknown })
    .map((item) => ({ start: Number(item.start), end: Number(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return parsed.error?.message ?? body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}
