import { formatTime } from './format'
import { labelForAction, labelForOutcome } from './data/grid'
import type { RallyClip } from './clips'
import type { ActionProposal } from './proposals'
import type { GameWindow } from './types'

type Props = {
  videoName: string | null
  gameWindow: GameWindow
  duration: number
  clips: RallyClip[]
  proposals: ActionProposal[]
  importErrors: string[]
  onImport: (file: File | undefined) => void
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onExportManifest: () => void
  onExportPrompt: () => void
}

export function Studio({
  videoName,
  gameWindow,
  duration,
  clips,
  proposals,
  importErrors,
  onImport,
  onAccept,
  onReject,
  onExportManifest,
  onExportPrompt,
}: Props) {
  const openProposals = proposals.filter((proposal) => proposal.status === 'proposed')
  return (
    <section className="panel studio">
      <div className="panel-head">
        <h2>Studio</h2>
        <span className="muted">{videoName ?? 'No video yet'}</span>
      </div>
      <p className="studio-lead">
        Clips stay on this machine. The scout grid is the label set. A video model should only
        propose touches inside the game window, in that vocabulary. You accept or reject them
        before anything is cut.
      </p>
      <ol className="studio-steps">
        <li>Bound the game with start and end. Warmup and the walk-off stay out.</li>
        <li>Log touches, or import proposals. Touches within 6s become one rally clip.</li>
        <li>Export the edit, then render the mp4s with the local Remotion studio.</li>
      </ol>
      <p className="hint">
        Finding the rally is a local timing problem. Naming the touch — especially in system vs
        out of system — is not reliable from pixels alone. A video-language model on these short
        clips, forced to emit the grid, is the step that matches this scout. Broadcast event
        spotters time contacts; they do not know this outcome list, so they wait until accepted
        clips exist to train on.
      </p>
      <p className="studio-window">
        Window{' '}
        <strong>
          {formatTime(gameWindow.start ?? 0)} –{' '}
          {gameWindow.end == null ? (duration > 0 ? formatTime(duration) : 'end') : formatTime(gameWindow.end)}
        </strong>
        {' · '}
        {clips.length} clip{clips.length === 1 ? '' : 's'} saved with this file name
      </p>
      <div className="entry-actions">
        <button type="button" className="primary" onClick={onExportManifest} disabled={clips.length === 0}>
          Export edit
        </button>
        <button type="button" className="ghost" onClick={onExportPrompt}>
          LLM instructions
        </button>
        <label className="file-label">
          Import proposals
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              onImport(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="hint studio-cmd">
        <code>cd studio && npm install && node render-clips.mjs edit.json match.mp4</code>
      </p>
      {importErrors.length > 0 && (
        <ul className="studio-errors">
          {importErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <h3>Rally clips</h3>
      <ul className="clip-list">
        {clips.length === 0 && (
          <li className="muted">Set the game window or log a touch. The edit is stored in this browser.</li>
        )}
        {clips.map((clip) => (
          <li key={clip.id}>
            <span className="t">
              {formatTime(clip.start)}–{formatTime(clip.end)}
            </span>
            <span>{clip.label}</span>
          </li>
        ))}
      </ul>
      <h3>Proposals ({openProposals.length})</h3>
      <ul className="clip-list">
        {proposals.length === 0 && <li className="muted">No imported proposals.</li>}
        {proposals.map((proposal) => (
          <li key={proposal.id} className={proposal.status === 'proposed' ? undefined : 'done'}>
            <span className="t">{formatTime(proposal.t)}</span>
            <span>
              {proposal.playerName} {labelForAction(proposal.action)} →{' '}
              {labelForOutcome(proposal.action, proposal.outcome)}
              {proposal.note ? ` · ${proposal.note}` : ''}
              {proposal.status !== 'proposed' ? ` · ${proposal.status}` : ''}
            </span>
            {proposal.status === 'proposed' && (
              <span className="row-actions">
                <button type="button" className="primary" onClick={() => onAccept(proposal.id)}>
                  Accept
                </button>
                <button type="button" className="ghost" onClick={() => onReject(proposal.id)}>
                  Reject
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
