import { isCellEnabled, type CandidateGrid, type FocusCell, type GridColumn } from './candidates'
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
                <th
                  key={`${col.action}-${col.outcome}`}
                  scope="col"
                  title={`${col.action} / ${col.outcome}`}
                  className={col.action === 'opponent_error' ? 'opp-col' : undefined}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.players.map((player, ri) => {
              const opponentRow = isOpponentPlayerId(player.id)
              return (
                <tr key={player.id} className={opponentRow ? 'opponent-row' : undefined}>
                  <th scope="row" className="player-col">
                    {playerLabel(player)}
                  </th>
                  {grid.columns.map((col, ci) => {
                    const enabled = isCellEnabled(player.id, col)
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
                            !enabled ? 'unavailable' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          disabled={disabled || !enabled}
                          aria-label={`${playerLabel(player)} ${col.action} ${col.outcome}`}
                          aria-current={focused ? 'true' : undefined}
                          onClick={() => {
                            if (!enabled) return
                            onFocusChange({ rowIndex: ri, columnIndex: ci })
                            onLog(player, col)
                          }}
                          onFocus={() => {
                            if (!enabled) return
                            onFocusChange({ rowIndex: ri, columnIndex: ci })
                          }}
                        >
                          {!enabled ? '·' : focused ? '●' : isDefault ? '○' : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
