import type { CandidateGrid, FocusCell, GridColumn } from './candidates'
import { suggestedOutcomeIndex } from './candidates'
import { labelForOutcome } from './data/grid'
import { playerLabel } from './format'
import { isOpponentPlayerId, type RosterPlayer } from './types'

export type { FocusCell }

type Props = {
  grid: CandidateGrid
  focus: FocusCell | null
  onFocusChange: (focus: FocusCell) => void
  onLog: (player: RosterPlayer, column: GridColumn) => void
  disabled?: boolean
}

export function ScoutGrid({ grid, focus, onFocusChange, onLog, disabled }: Props) {
  if (grid.choices.length === 0) {
    return (
      <div className="scout-grid empty" aria-live="polite">
        <p className="muted">No candidates — set roster / serving side.</p>
      </div>
    )
  }

  const expandedIndex =
    focus?.groupIndex ?? Math.max(0, grid.choices.findIndex((choice) => choice.primary))

  return (
    <div
      className={`scout-grid${disabled ? ' disabled' : ''}`}
      aria-disabled={disabled || undefined}
    >
      {grid.reason && (
        <div className="scout-grid-reason" aria-live="polite">
          {grid.reason}
          <span className="scout-grid-keys">↑↓ touch · ←→ outcome · Enter logs</span>
        </div>
      )}
      <div className="scout-choices" role="list" aria-label="Scout touches">
        {grid.choices.map((choice, groupIndex) => {
          const expanded = groupIndex === expandedIndex
          const opponent = isOpponentPlayerId(choice.player.id)
          const headFocused = focus?.groupIndex === groupIndex
          return (
            <div
              key={`${choice.player.id}-${choice.action}`}
              className={[
                'scout-choice',
                expanded ? 'expanded' : '',
                choice.primary ? 'primary' : '',
                opponent ? 'opponent' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="listitem"
            >
              <button
                type="button"
                className="scout-choice-head"
                aria-expanded={expanded}
                disabled={disabled}
                onClick={() =>
                  onFocusChange({
                    groupIndex,
                    outcomeIndex: suggestedOutcomeIndex(choice),
                  })
                }
              >
                <span className="who">{playerLabel(choice.player)}</span>
                <span className="act">{choice.actionLabel}</span>
              </button>
              {expanded && (
                <div
                  className="scout-outcomes"
                  role="group"
                  aria-label={`${playerLabel(choice.player)} ${choice.actionLabel} outcomes`}
                >
                  {choice.outcomes.map((column, outcomeIndex) => {
                    const focused = headFocused && focus?.outcomeIndex === outcomeIndex
                    return (
                      <button
                        key={column.outcome}
                        type="button"
                        className={['scout-outcome', focused ? 'focused' : ''].filter(Boolean).join(' ')}
                        disabled={disabled}
                        aria-current={focused ? 'true' : undefined}
                        title={labelForOutcome(choice.action, column.outcome)}
                        onClick={() => {
                          onFocusChange({ groupIndex, outcomeIndex })
                          onLog(choice.player, column)
                        }}
                      >
                        {column.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
