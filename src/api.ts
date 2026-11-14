/** Calls to the local server started by `npm run dev` (see server/api.ts). */

import type { Span } from './types'

export type Health = { geminiKey: boolean; ffmpeg: boolean; model: string }

export type CutJobView = {
  id: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  model: string
  window: Span
  chunksTotal: number
  chunksDone: number
  covered: Span[]
  rallies: Span[]
  warnings: string[]
  error?: string
}

/** Stable id for a video file: safe name + byte size. Also the match file name. */
export function videoKeyFor(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 100)
  return `${base}-${file.size}`
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Server error ${response.status}`)
  return body
}

export async function getHealth(): Promise<Health | null> {
  try {
    return await json<Health>(await fetch('/api/health'))
  } catch {
    return null
  }
}

export async function videoOnServer(key: string): Promise<boolean> {
  const body = await json<{ exists: boolean }>(await fetch(`/api/video/${key}`))
  return body.exists
}

/** Copy the video to the local server (same machine), reporting progress 0–1. */
export function uploadVideo(key: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/video/${key}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Copy failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Copy failed: is npm run dev still running?'))
    xhr.send(file)
  })
}

export async function startCut(videoKey: string, window: Span): Promise<CutJobView> {
  return json<CutJobView>(
    await fetch('/api/cut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoKey, start: window.start, end: window.end }),
    }),
  )
}

export async function getCut(jobId: string): Promise<CutJobView> {
  return json<CutJobView>(await fetch(`/api/cut/${jobId}`))
}

export async function cancelCut(jobId: string): Promise<void> {
  await fetch(`/api/cut/${jobId}`, { method: 'DELETE' })
}

export async function loadMatch(key: string): Promise<unknown | null> {
  const response = await fetch(`/api/matches/${key}`)
  if (response.status === 404) return null
  return json<unknown>(response)
}

export async function saveMatch(key: string, session: unknown): Promise<void> {
  await json(
    await fetch(`/api/matches/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(session),
    }),
  )
}
