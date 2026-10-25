import { ACTION_OUTCOME_GRID } from './data/grid'
import {
  findSetterId,
  playerAt,
  playersInRow,
  preferBackRowReceiver,
  preferFrontRowBlocker,
  preferFrontRowHitter,
} from './rotation'
import { suggestNext } from './suggestions'
import type {
  FlowSuggestion,
  MatchState,
  RosterPlayer,
  ScoutEvent,
  SuggestionOption,
} from './types'
import { isOpponentPlayerId, OPPONENT_PLAYER } from './types'

export type GridColumn = {
  action: string
  outcome: string
  /** Short header for the matrix (outcome label, or action+outcome when mixed). */
  label: string
}

export type CandidateGrid = {
  players: RosterPlayer[]
  columns: GridColumn[]
  /** Primary suggestion cell — default keyboard focus. */
  defaultFocus: { playerId: string; columnIndex: number } | null
  /** Flow reason from the primary suggestion (for UI hint). */
  reason: string | null
  suggestion: FlowSuggestion | null
}

function outcomeLabel(actionId: string, outcomeId: string): string {
  const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
  return action?.outcomes.find((o) => o.id === outcomeId)?.label ?? outcomeId
}

function shortOutcomeLabel(actionId: string, outcomeId: string): string {
  const full = outcomeLabel(actionId, outcomeId)
  // Compact headers for common outcomes
  const map: Record<string, string> = {
    ace: 'Ace',
    in_play_in_system: 'InSys',
    in_play_out_of_system: 'OutSys',
    serve_error: 'Err',
    in_system: 'InSys',
    out_of_system: 'OutSys',
    overpass: 'Over',
    error: 'Err',
    set: 'Set',
    save: 'Save',
    kill: 'Kill',
    defended: 'Def',
    blocked: 'Blk',
    error_own: 'OwnErr',
    error_tried_save: 'TriedSave',
    error_bad_set: 'BadSet',
    point: 'Pt',
    kill_block: 'Kill',
    recycle: 'Recyc',
    block_error: 'Err',
    in_play: 'In',
    out: 'Out',
    net: 'Net',
    other: 'Other',
  }
  return map[outcomeId] ?? full
}

/** Opponent × opponent_error cells only; roster players never use opponent_error columns. */
export function isCellEnabled(playerId: string, column: GridColumn): boolean {
  const isOpp = isOpponentPlayerId(playerId)
  const isOppErr = column.action === 'opponent_error'
  return isOpp === isOppErr
}

function opponentErrorColumns(): GridColumn[] {
  return columnsForActions(['opponent_error'])
}

/** Always offer Opponent × opponent_error as an escape hatch on the matrix. */
function withOpponentEscapeHatch(
  players: RosterPlayer[],
  columns: GridColumn[],
): { players: RosterPlayer[]; columns: GridColumn[] } {
  const nextColumns = [...columns]
  for (const col of opponentErrorColumns()) {
    if (!nextColumns.some((c) => c.action === col.action && c.outcome === col.outcome)) {
      nextColumns.push(col)
    }
  }
  const nextPlayers = players.some((p) => isOpponentPlayerId(p.id))
    ? players
    : [...players, OPPONENT_PLAYER]
  return { players: nextPlayers, columns: nextColumns }
}

function columnsForActions(actionIds: string[]): GridColumn[] {
  const columns: GridColumn[] = []
  const unique = [...new Set(actionIds)]
  const multi = unique.length > 1
  for (const actionId of unique) {
    const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
    if (!action) continue
    for (const outcome of action.outcomes) {
      const short = shortOutcomeLabel(actionId, outcome.id)
      columns.push({
        action: actionId,
        outcome: outcome.id,
        label: multi ? `${action.label.slice(0, 3)} ${short}` : short,
      })
    }
  }
  return columns
}

function onCourtPlayers(roster: RosterPlayer[], match: MatchState): RosterPlayer[] {
  const ids = new Set(
    ([1, 2, 3, 4, 5, 6] as const)
      .map((p) => match.positions[p])
      .filter((id): id is string => Boolean(id)),
  )
  if (ids.size === 0) return roster
  const ordered = roster.filter((p) => ids.has(p.id))
  return ordered.length > 0 ? ordered : roster
}

function playersForAction(
  action: string,
  roster: RosterPlayer[],
  match: MatchState,
  hintPlayerId: string | null,
): RosterPlayer[] {
  const byId = new Map(roster.map((p) => [p.id, p]))
  const pick = (id: string | null | undefined) => (id && byId.get(id) ? [byId.get(id)!] : [])
  const fromIds = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is RosterPlayer => Boolean(p))

  if (action === 'serve') {
    const server = hintPlayerId ?? playerAt(match.positions, 1) ?? roster[0]?.id ?? null
    return pick(server)
  }

  if (action === 'reception') {
    const preferred = hintPlayerId ?? preferBackRowReceiver(roster, match.positions)
    const back = playersInRow(match.positions, 'back')
    const list = fromIds(back)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'dig') {
    const preferred = hintPlayerId ?? preferBackRowReceiver(roster, match.positions)
    const back = playersInRow(match.positions, 'back')
    const list = fromIds(back)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'block') {
    const preferred = hintPlayerId ?? preferFrontRowBlocker(roster, match.positions)
    const front = playersInRow(match.positions, 'front')
    const list = fromIds(front)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'second_touch' || action === 'set') {
    // Unconstrained (null hint) → all on court; otherwise setter-first then others
    if (!hintPlayerId) return onCourtPlayers(roster, match)
    const setter = findSetterId(roster)
    const court = onCourtPlayers(roster, match)
    const ordered = [...court]
    const bump = (id: string | null) => {
      if (!id) return
      const idx = ordered.findIndex((p) => p.id === id)
      if (idx > 0) {
        const [p] = ordered.splice(idx, 1)
        ordered.unshift(p)
      }
    }
    bump(setter)
    bump(hintPlayerId)
    return ordered
  }

  if (action === 'attack') {
    const front = playersInRow(match.positions, 'front')
    const list = fromIds(front)
    const preferred = hintPlayerId ?? preferFrontRowHitter(roster, match.positions)
    if (preferred && byId.get(preferred)) {
      const idx = list.findIndex((p) => p.id === preferred)
      if (idx > 0) {
        const [p] = list.splice(idx, 1)
        list.unshift(p)
      } else if (idx < 0) list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'dump') {
    const setter = hintPlayerId ?? findSetterId(roster)
    const list = pick(setter)
    // Allow other on-court as alternates
    for (const p of onCourtPlayers(roster, match)) {
      if (!list.some((x) => x.id === p.id)) list.push(p)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'freeball_send') {
    if (hintPlayerId && byId.get(hintPlayerId)) {
      const rest = onCourtPlayers(roster, match).filter((p) => p.id !== hintPlayerId)
      return [byId.get(hintPlayerId)!, ...rest]
    }
    return onCourtPlayers(roster, match)
  }

  return onCourtPlayers(roster, match)
}

function mergePlayers(
  options: SuggestionOption[],
  roster: RosterPlayer[],
  match: MatchState,
): RosterPlayer[] {
  const seen = new Set<string>()
  const out: RosterPlayer[] = []
  const addAll = (list: RosterPlayer[]) => {
    for (const p of list) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
  }

  for (const opt of options) {
    addAll(playersForAction(opt.action, roster, match, opt.playerId))
  }

  // Primary player's action first — keep primary-suggested player at top
  const primaryId = options[0]?.playerId
  if (primaryId) {
    const idx = out.findIndex((p) => p.id === primaryId)
    if (idx > 0) {
      const [p] = out.splice(idx, 1)
      out.unshift(p)
    }
  }

  return out
}

function defaultColumnIndex(
  columns: GridColumn[],
  primary: SuggestionOption | undefined,
): number {
  if (!primary || columns.length === 0) return 0
  if (primary.outcome) {
    const exact = columns.findIndex(
      (c) => c.action === primary.action && c.outcome === primary.outcome,
    )
    if (exact >= 0) return exact
  }
  const firstOfAction = columns.findIndex((c) => c.action === primary.action)
  return firstOfAction >= 0 ? firstOfAction : 0
}

/**
 * Build the keyboard scout matrix: eligible players × legal (action, outcome) columns.
 * Flow suggestions decide which actions/players are offered; arrows pick among cells.
 */
export function getCandidateGrid(
  last: ScoutEvent | null,
  roster: RosterPlayer[],
  match: MatchState,
): CandidateGrid {
  const suggestion = suggestNext(last, roster, match)
  if (!suggestion || roster.length === 0) {
    // Still offer Opponent escape hatch when roster exists but suggestion is null
    if (roster.length > 0) {
      const { players, columns } = withOpponentEscapeHatch([], [])
      return {
        players,
        columns,
        defaultFocus: players[0]
          ? { playerId: players[0].id, columnIndex: 0 }
          : null,
        reason: 'Opponent error escape hatch',
        suggestion: null,
      }
    }
    return {
      players: [],
      columns: [],
      defaultFocus: null,
      reason: null,
      suggestion: null,
    }
  }

  const options = [suggestion.primary, ...suggestion.alternates]
  const baseColumns = columnsForActions(options.map((o) => o.action))
  const basePlayers = mergePlayers(options, roster, match)
  const { players, columns } = withOpponentEscapeHatch(basePlayers, baseColumns)

  if (players.length === 0 || columns.length === 0) {
    return {
      players,
      columns,
      defaultFocus: null,
      reason: suggestion.primary.reason,
      suggestion,
    }
  }

  const colIndex = defaultColumnIndex(columns, suggestion.primary)
  let focusPlayerId = suggestion.primary.playerId
  if (
    !focusPlayerId ||
    isOpponentPlayerId(focusPlayerId) ||
    !players.some((p) => p.id === focusPlayerId)
  ) {
    focusPlayerId =
      players.find((p) => !isOpponentPlayerId(p.id))?.id ?? players[0]?.id ?? null
  }

  return {
    players,
    columns,
    defaultFocus:
      focusPlayerId != null
        ? { playerId: focusPlayerId, columnIndex: colIndex }
        : null,
    reason: suggestion.primary.reason,
    suggestion,
  }
}

export type FocusCell = {
  rowIndex: number
  columnIndex: number
}

/** Clamp / resolve focus when the grid rebuilds; prefer an enabled cell. */
export function resolveFocus(
  grid: CandidateGrid,
  prev: FocusCell | null,
): FocusCell | null {
  if (grid.players.length === 0 || grid.columns.length === 0) return null

  const clamp = (cell: FocusCell): FocusCell => ({
    rowIndex: Math.min(Math.max(0, cell.rowIndex), grid.players.length - 1),
    columnIndex: Math.min(Math.max(0, cell.columnIndex), grid.columns.length - 1),
  })

  const enabledOrNearest = (cell: FocusCell): FocusCell => {
    const c = clamp(cell)
    const player = grid.players[c.rowIndex]
    const column = grid.columns[c.columnIndex]
    if (player && column && isCellEnabled(player.id, column)) return c
    // Prefer same row, first enabled column
    for (let ci = 0; ci < grid.columns.length; ci++) {
      if (player && isCellEnabled(player.id, grid.columns[ci]!)) {
        return { rowIndex: c.rowIndex, columnIndex: ci }
      }
    }
    // Any enabled cell
    for (let ri = 0; ri < grid.players.length; ri++) {
      for (let ci = 0; ci < grid.columns.length; ci++) {
        if (isCellEnabled(grid.players[ri]!.id, grid.columns[ci]!)) {
          return { rowIndex: ri, columnIndex: ci }
        }
      }
    }
    return c
  }

  if (grid.defaultFocus) {
    const rowIndex = grid.players.findIndex((p) => p.id === grid.defaultFocus!.playerId)
    if (rowIndex >= 0) {
      return enabledOrNearest({
        rowIndex,
        columnIndex: grid.defaultFocus.columnIndex,
      })
    }
  }
  if (prev) return enabledOrNearest(prev)
  return enabledOrNearest({ rowIndex: 0, columnIndex: 0 })
}

/**
 * Move focus by delta, skipping disabled (roster×opponent_error / Opponent×own) cells.
 */
export function moveFocusSkippingDisabled(
  grid: CandidateGrid,
  from: FocusCell,
  dRow: number,
  dCol: number,
): FocusCell {
  const rows = grid.players.length
  const cols = grid.columns.length
  if (rows === 0 || cols === 0) return from

  let row = from.rowIndex
  let col = from.columnIndex
  const maxSteps = rows * cols
  for (let step = 0; step < maxSteps; step++) {
    if (dRow !== 0) {
      row = (row + dRow + rows) % rows
      // When changing row, land on first enabled column in that row (prefer keep col)
      if (isCellEnabled(grid.players[row]!.id, grid.columns[col]!)) {
        return { rowIndex: row, columnIndex: col }
      }
      for (let offset = 0; offset < cols; offset++) {
        const ci = (col + offset) % cols
        if (isCellEnabled(grid.players[row]!.id, grid.columns[ci]!)) {
          return { rowIndex: row, columnIndex: ci }
        }
      }
    } else if (dCol !== 0) {
      col = (col + dCol + cols) % cols
      if (isCellEnabled(grid.players[row]!.id, grid.columns[col]!)) {
        return { rowIndex: row, columnIndex: col }
      }
    } else {
      break
    }
  }
  return from
}
