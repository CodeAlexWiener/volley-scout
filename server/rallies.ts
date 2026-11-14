/** Rally interval math shared by the cut job. Pure functions, no I/O. */

export type Span = { start: number; end: number }

/** Shortest thing we keep as a rally (a missed serve is still ~2s of footage). */
export const MIN_RALLY_SEC = 1.5

/**
 * Overlapping chunks of the match window. Overlap lets a rally that crosses a
 * chunk edge be seen whole in at least one chunk; merging joins the halves.
 */
export function chunkSpans(window: Span, length = 120, overlap = 30): Span[] {
  const total = window.end - window.start
  if (!(total > 0)) return []
  if (total <= length) return [{ start: window.start, end: window.end }]
  const stride = Math.max(1, length - overlap)
  const spans: Span[] = []
  for (let start = window.start; start < window.end; start += stride) {
    const end = Math.min(window.end, start + length)
    spans.push({ start, end })
    if (end >= window.end) break
  }
  return spans
}

/** Clip-local model times → file times, clamped to the chunk. Drops nonsense. */
export function toFileTimes(chunk: Span, local: Span[]): Span[] {
  const length = chunk.end - chunk.start
  const out: Span[] = []
  for (const item of local) {
    let a = Number(item.start)
    let b = Number(item.end)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (b < a) [a, b] = [b, a]
    a = Math.max(0, Math.min(length, a))
    b = Math.max(0, Math.min(length, b))
    if (b - a < 0.5) continue
    out.push({ start: round(chunk.start + a), end: round(chunk.start + b) })
  }
  return out
}

/**
 * Between two real points there is always ball retrieval and a serve setup
 * (several seconds). Detections closer than this are pieces of one rally.
 */
export const SAME_RALLY_GAP_SEC = 4

/** Join overlapping spans or spans closer than `joinGap`; drop very short ones. */
export function mergeSpans(spans: Span[], joinGap = SAME_RALLY_GAP_SEC): Span[] {
  const sorted = [...spans].sort((x, y) => x.start - y.start || x.end - y.end)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged.at(-1)
    if (last && span.start <= last.end + joinGap) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged.filter((span) => span.end - span.start >= MIN_RALLY_SEC)
}

/**
 * Pad each rally so the serve toss and the ball landing are not clipped.
 * Neighbours meet in the middle instead of overlapping. Stays inside `bounds`.
 */
export function padSpans(spans: Span[], bounds: Span, before = 1, after = 1): Span[] {
  const padded = spans.map((span) => ({
    start: Math.max(bounds.start, span.start - before),
    end: Math.min(bounds.end, span.end + after),
  }))
  for (let i = 1; i < padded.length; i++) {
    const prev = padded[i - 1]!
    const cur = padded[i]!
    if (cur.start < prev.end) {
      const mid = round((spans[i - 1]!.end + spans[i]!.start) / 2)
      prev.end = mid
      cur.start = mid
    }
  }
  return padded.map((span) => ({ start: round(span.start), end: round(span.end) }))
}

/** Union of spans, for "which parts of the window has the model already seen". */
export function unionSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((x, y) => x.start - y.start)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
