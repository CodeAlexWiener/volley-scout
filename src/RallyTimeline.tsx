import { useRef } from 'react'
import { formatTime } from './format'
import { rallyAt, rallyDecided } from './rallies'
import type { MatchWindow, Rally, ScoutEvent, Span } from './types'

type Props = {
  duration: number
  window: MatchWindow
  rallies: Rally[]
  events: ScoutEvent[]
  covered: Span[]
  currentTime: number
  /** Seek; `inGap` is true when you clicked dead time on purpose (skipping pauses there). */
  onSeek: (t: number, inGap: boolean) => void
}

const DETAIL_HALF_SEC = 45

/**
 * Two strips: the whole file (window, rallies, what the AI has seen) and a
 * ±45s close-up around the playhead where single rallies are easy to hit.
 */
export function RallyTimeline({ duration, window, rallies, events, covered, currentTime, onSeek }: Props) {
  if (!(duration > 0)) return null
  const winStart = window.start ?? 0
  const winEnd = window.end ?? duration
  const current = rallyAt(rallies, currentTime)
  const detailStart = Math.max(0, Math.min(currentTime - DETAIL_HALF_SEC, duration - DETAIL_HALF_SEC * 2))
  const detailEnd = Math.min(duration, detailStart + DETAIL_HALF_SEC * 2)
  const decided = new Map(rallies.map((r) => [r.id, rallyDecided(r, events)]))
  // Only rallies you have already scouted past (before your latest entry) count as missing a winner.
  const lastEntry = events.reduce((max, e) => Math.max(max, e.t), -1)
  const unfinished = rallies.filter((r) => r.end < lastEntry && !decided.get(r.id)).length
  const index = current ? rallies.findIndex((r) => r.id === current.id) + 1 : 0

  return (
    <div className="timeline">
      <div className="timeline-meta">
        <span>
          {current ? (
            <>
              Rally <strong>{index}</strong> of {rallies.length}
            </>
          ) : (
            <>
              Dead time · {rallies.length} rall{rallies.length === 1 ? 'y' : 'ies'}
            </>
          )}
        </span>
        {unfinished > 0 && <span className="warn">{unfinished} earlier rall{unfinished === 1 ? 'y has' : 'ies have'} no point winner</span>}
      </div>
      <Strip
        from={0}
        to={duration}
        winStart={winStart}
        winEnd={winEnd}
        rallies={rallies}
        decided={decided}
        covered={covered}
        currentId={current?.id ?? null}
        currentTime={currentTime}
        events={[]}
        className="strip overview"
        onSeek={onSeek}
        label="Whole file"
      />
      <Strip
        from={detailStart}
        to={detailEnd}
        winStart={winStart}
        winEnd={winEnd}
        rallies={rallies}
        decided={decided}
        covered={covered}
        currentId={current?.id ?? null}
        currentTime={currentTime}
        events={events}
        className="strip detail"
        onSeek={onSeek}
        label={`${formatTime(detailStart)} – ${formatTime(detailEnd)}`}
      />
      <div className="timeline-legend">
        <span><i className="leg-rally done" /> rally with point</span>
        <span><i className="leg-rally open" /> rally, no point yet</span>
        <span><i className="leg-gap" /> dead time (skipped)</span>
        <span><i className="leg-unseen" /> not analysed yet</span>
        <span><i className="leg-outside" /> outside match</span>
      </div>
    </div>
  )
}

function Strip(props: {
  from: number
  to: number
  winStart: number
  winEnd: number
  rallies: Rally[]
  decided: Map<string, boolean>
  covered: Span[]
  currentId: string | null
  currentTime: number
  events: ScoutEvent[]
  className: string
  label: string
  onSeek: (t: number, inGap: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { from, to } = props
  const span = to - from
  const pct = (t: number) => `${((Math.min(to, Math.max(from, t)) - from) / span) * 100}%`
  const width = (a: number, b: number) => `${((Math.min(to, b) - Math.max(from, a)) / span) * 100}%`
  const visible = (a: number, b: number) => b > from && a < to

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const t = from + ((e.clientX - rect.left) / rect.width) * span
    props.onSeek(t, !rallyAt(props.rallies, t))
  }

  return (
    <div className="strip-wrap">
      <span className="strip-label">{props.label}</span>
      <div ref={ref} className={props.className} onClick={onClick} role="slider" aria-label={props.label} aria-valuenow={props.currentTime} tabIndex={-1}>
        {visible(from, props.winStart) && <div className="seg outside" style={{ left: pct(from), width: width(from, props.winStart) }} />}
        {visible(props.winEnd, to) && <div className="seg outside" style={{ left: pct(props.winEnd), width: width(props.winEnd, to) }} />}
        {visible(props.winStart, props.winEnd) && (
          <div className="seg unseen" style={{ left: pct(props.winStart), width: width(props.winStart, props.winEnd) }} />
        )}
        {props.covered.filter((c) => visible(c.start, c.end)).map((c) => (
          <div key={`c${c.start}`} className="seg gap" style={{ left: pct(c.start), width: width(c.start, c.end) }} />
        ))}
        {props.rallies.filter((r) => visible(r.start, r.end)).map((r) => (
          <div
            key={r.id}
            className={['seg rally', props.decided.get(r.id) ? 'done' : 'open', r.id === props.currentId ? 'current' : '', r.source === 'human' ? 'human' : '']
              .filter(Boolean)
              .join(' ')}
            style={{ left: pct(r.start), width: width(r.start, r.end) }}
            title={`${formatTime(r.start)} – ${formatTime(r.end)}${r.source === 'human' ? ' (adjusted)' : ''}`}
          />
        ))}
        {props.events.filter((e) => e.t >= from && e.t <= to).map((e) => (
          <div key={e.id} className="tick" style={{ left: pct(e.t) }} />
        ))}
        <div className="playhead" style={{ left: pct(props.currentTime) }} />
      </div>
    </div>
  )
}
