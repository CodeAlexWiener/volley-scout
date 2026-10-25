import type { CandidateGrid, FocusCell, GridColumn } from './candidates'
import { playerLabel } from './format'
import type { RosterPlayer } from './types'

export type { FocusCell }

type Props = {
  grid: CandidateGrid
  focus: FocusCell | null
  onFocusChange: (focus: FocusCell) => void
  onLog: (player: RosterPlayer, column: GridColumn) => void
  disabled?: boolean
}

export function ScoutGrid({ grid, focus, onFocusChange, onLog, disabled }: Props) {
  if (grid.players.length === 0 || grid.columns.length === 0) {
    return (
      <div className="scout-grid empty" aria-live="polite">
        <p className="muted">No candidates — set roster / serving side.</p>
      </div>
    )
  }

  return (
    <div
      className={`scout-grid${disabled ? ' disabled' : ''}`}
      role="grid"
      aria-label="Scout candidates — arrows move, Enter logs"
      aria-disabled={disabled || undefined}
    >
      {grid.reason && (
        <div className="scout-grid-reason" aria-live="polite">
          {grid.reason}
          <span className="scout-grid-keys">
            ←→↑↓ move · Enter log · Tab primary · Esc clear
          </span>
        </div>
      )}
      <div className="scout-grid-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="player-col">
                Player
              </th>
              {grid.columns.map((col) => (
                <th key={`${col.action}-${col.outcome}`} scope="col" title={`${col.action} / ${col.outcome}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.players.map((player, ri) => (
              <tr key={player.id}>
                <th scope="row" className="player-col">
                  {playerLabel(player)}
                </th>
                {grid.columns.map((col, ci) => {
                  const focused =
                    focus?.rowIndex === ri && focus?.columnIndex === ci
                  const isDefault =
                    grid.defaultFocus?.playerId === player.id &&
                    grid.defaultFocus?.columnIndex === ci
                  return (
                    <td key={`${col.action}-${col.outcome}`}>
                      <button
                        type="button"
                        className={[
                          'scout-cell',
                          focused ? 'focused' : '',
                          isDefault && !focused ? 'default-hint' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        disabled={disabled}
                        aria-label={`${playerLabel(player)} ${col.action} ${col.outcome}`}
                        aria-current={focused ? 'true' : undefined}
                        onClick={() => {
                          onFocusChange({ rowIndex: ri, columnIndex: ci })
                          onLog(player, col)
                        }}
                        onFocus={() => onFocusChange({ rowIndex: ri, columnIndex: ci })}
                      >
                        {focused ? '●' : isDefault ? '○' : '·'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
