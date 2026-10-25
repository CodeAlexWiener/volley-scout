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
    error_bad_set: 'BadSet',
    point: 'Pt',
    kill_block: 'Kill',
    recycle: 'Recyc',
    block_error: 'Err',
    in_play: 'In',
  }
  return map[outcomeId] ?? full
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
    return {
      players: [],
      columns: [],
      defaultFocus: null,
      reason: null,
      suggestion: null,
    }
  }

  const options = [suggestion.primary, ...suggestion.alternates]
  const columns = columnsForActions(options.map((o) => o.action))
  const players = mergePlayers(options, roster, match)

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
  if (!focusPlayerId || !players.some((p) => p.id === focusPlayerId)) {
    focusPlayerId = players[0]?.id ?? null
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

/** Clamp / resolve focus when the grid rebuilds. */
export function resolveFocus(
  grid: CandidateGrid,
  prev: FocusCell | null,
): FocusCell | null {
  if (grid.players.length === 0 || grid.columns.length === 0) return null
  if (grid.defaultFocus) {
    const rowIndex = grid.players.findIndex((p) => p.id === grid.defaultFocus!.playerId)
    if (rowIndex >= 0) {
      return {
        rowIndex,
        columnIndex: Math.min(
          grid.defaultFocus.columnIndex,
          grid.columns.length - 1,
        ),
      }
    }
  }
  if (prev) {
    return {
      rowIndex: Math.min(prev.rowIndex, grid.players.length - 1),
      columnIndex: Math.min(prev.columnIndex, grid.columns.length - 1),
    }
  }
  return { rowIndex: 0, columnIndex: 0 }
}
