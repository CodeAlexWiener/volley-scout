import type { Health } from './api'
import { formatTime } from './format'
import type { CutState, MatchWindow } from './types'

export type CopyState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'copying'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }

type Props = {
  window: MatchWindow
  duration: number
  health: Health | null
  copy: CopyState
  cut: CutState | null
  hasVideo: boolean
  onMark: (edge: 'start' | 'end') => void
  onClear: (edge: 'start' | 'end') => void
  onSeek: (t: number) => void
  onCut: () => void
  onDone: () => void
}

/**
 * Step 1 before scouting: bound the played match inside the file so the AI never
 * looks at warm-up or the time after the match, then start the rally cut.
 */
export function MatchSetup({ window, duration, health, copy, cut, hasVideo, onMark, onClear, onSeek, onCut, onDone }: Props) {
  const { start, end } = window
  const bothSet = start != null && end != null
  const valid = bothSet && end - start >= 5
  const kept = valid ? end - start : 0
  const blockers: string[] = []
  if (!hasVideo) blockers.push('Open a video file.')
  if (!bothSet) blockers.push('Mark where the match starts (S) and ends (E).')
  else if (!valid) blockers.push('The end must be after the start.')
  if (health && !health.geminiKey) blockers.push('Gemini key missing: add GEMINI_API_KEY to .env and restart npm run dev.')
  if (health && !health.ffmpeg) blockers.push('ffmpeg is missing: run npm install.')
  if (!health) blockers.push('Local server not reachable: start the app with npm run dev.')
  if (copy.status === 'copying') blockers.push(`Preparing the video for cutting… ${Math.round(copy.progress * 100)}%`)
  if (copy.status === 'checking') blockers.push('Checking the video on the local server…')
  if (copy.status === 'error') blockers.push(`Could not prepare the video: ${copy.message}`)
  const canCut = blockers.length === 0 && copy.status === 'ready'
  const recut = cut != null

  return (
    <section className="panel setup" aria-label="Match setup">
      <div className="panel-head">
        <h2>{recut ? 'Match window' : 'Step 1 · Mark the match'}</h2>
        {recut && (
          <button type="button" className="ghost" onClick={onDone}>
            Back to scouting
          </button>
        )}
      </div>
      <p className="setup-lead">
        Scrub to the first serve and press <kbd>S</kbd>, then to the end of the last point and press{' '}
        <kbd>E</kbd>. Warm-up and everything after the match are never sent to the AI and never played.
      </p>
      <div className="window-edges">
        {(['start', 'end'] as const).map((edge) => {
          const value = window[edge]
          return (
            <div key={edge} className={value == null ? 'edge empty' : 'edge'}>
              <span className="edge-label">{edge === 'start' ? 'Match starts' : 'Match ends'}</span>
              <strong className="edge-time">{value == null ? '—' : formatTime(value)}</strong>
              <div className="edge-actions">
                <button type="button" className="primary" onClick={() => onMark(edge)} disabled={!hasVideo}>
                  Set to playhead <kbd>{edge === 'start' ? 'S' : 'E'}</kbd>
                </button>
                <button type="button" className="ghost" disabled={value == null} onClick={() => value != null && onSeek(value)}>
                  Go
                </button>
                <button type="button" className="ghost" disabled={value == null} onClick={() => onClear(edge)}>
                  Clear
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {valid && duration > 0 && (
        <p className="window-summary">
          <strong>{formatTime(kept)}</strong> of {formatTime(duration)} kept · {formatTime(duration - kept)} of
          warm-up and after-match skipped
        </p>
      )}
      <div className="setup-cut">
        <h3>{recut ? 'Cut again' : 'Step 2 · Cut rallies'}</h3>
        {blockers.length > 0 ? (
          <ul className="setup-blockers">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">
            Sends a small, silent, low-resolution copy of the match window to {health?.model ?? 'Gemini'} in
            one-minute pieces. Rallies appear on the timeline as they are found, so you can start scouting right away.
            {recut && ' Rallies you adjusted by hand are kept.'}
          </p>
        )}
        <button type="button" className="primary wide" disabled={!canCut} onClick={onCut}>
          {recut ? 'Cut rallies again' : 'Cut rallies'}
        </button>
      </div>
    </section>
  )
}
