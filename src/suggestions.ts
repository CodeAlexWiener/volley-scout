import {
  findSetterId,
  playerAt,
  preferBackRowReceiver,
  preferFrontRowBlocker,
  preferFrontRowHitter,
} from './rotation'
import type {
  FlowSuggestion,
  MatchState,
  RosterPlayer,
  ScoutEvent,
  SuggestionOption,
} from './types'

function opt(
  playerId: string | null,
  action: string,
  outcome: string | null,
  reason: string,
): SuggestionOption {
  return { playerId, action, outcome, reason }
}

function digAndBlock(
  roster: RosterPlayer[],
  match: MatchState,
  digReason: string,
  blockReason: string,
): FlowSuggestion {
  const digPlayer = preferBackRowReceiver(roster, match.positions)
  const blockPlayer = preferFrontRowBlocker(roster, match.positions)
  return {
    primary: opt(digPlayer, 'dig', null, digReason),
    alternates: [opt(blockPlayer, 'block', null, blockReason)],
  }
}

function suggestServe(roster: RosterPlayer[], match: MatchState, reason: string): FlowSuggestion {
  const server = playerAt(match.positions, 1) ?? roster[0]?.id ?? null
  return {
    primary: opt(server, 'serve', null, reason),
    alternates: [],
  }
}

function suggestReception(roster: RosterPlayer[], match: MatchState, reason: string): FlowSuggestion {
  return {
    primary: opt(preferBackRowReceiver(roster, match.positions), 'reception', null, reason),
    alternates: [],
  }
}

function passToSet(
  outcome: string,
  roster: RosterPlayer[],
  match: MatchState,
  kind: 'reception' | 'dig',
): FlowSuggestion {
  const label = kind === 'reception' ? 'Reception' : 'Dig'
  // Set is not graded in/out — only suggest who sets; outcome stays unset (user picks set|error).
  if (outcome === 'in_system') {
    const setter = findSetterId(roster) ?? preferBackRowReceiver(roster, match.positions)
    return {
      primary: opt(setter, 'set', null, `${label} in system → setter set`),
      alternates: [],
    }
  }
  if (outcome === 'out_of_system') {
    return {
      primary: opt(null, 'set', null, `${label} out of system → set (any)`),
      alternates: [],
    }
  }
  if (outcome === 'overpass') {
    return digAndBlock(
      roster,
      match,
      'Overpass — dig if ball comes back',
      'Overpass — block if they attack',
    )
  }
  // error: point against us (after applyPossessionChange, servingTeam is them unless rare)
  if (match.servingTeam === 'us') {
    return suggestServe(roster, match, `${label} error but we serve — P1`)
  }
  return suggestReception(roster, match, `${label} error → opponent serves, reception`)
}

/**
 * Suggest next own-side action + player from the last accepted event
 * and current (already-updated) match state.
 */
export function suggestNext(
  last: ScoutEvent | null,
  roster: RosterPlayer[],
  match: MatchState,
): FlowSuggestion | null {
  if (!last || roster.length === 0) {
    if (match.servingTeam === 'us') {
      return suggestServe(roster, match, 'We serve — P1')
    }
    return suggestReception(roster, match, 'They serve — reception')
  }

  const { action, outcome, playerId } = last

  if (action === 'serve') {
    if (outcome === 'ace') {
      return {
        primary: opt(playerId, 'serve', null, 'Ace — same server again'),
        alternates: [],
      }
    }
    if (outcome === 'in_play') {
      return digAndBlock(
        roster,
        match,
        'Serve in play — dig when ball returns',
        'Serve in play — block (front row)',
      )
    }
    if (outcome === 'serve_error') {
      return suggestReception(roster, match, 'Serve error — they serve, reception')
    }
  }

  if (action === 'reception' || action === 'dig') {
    return passToSet(outcome, roster, match, action)
  }

  if (action === 'set') {
    if (outcome === 'error') {
      if (match.servingTeam === 'us') {
        return suggestServe(roster, match, 'Set error but we serve')
      }
      return suggestReception(roster, match, 'Set error → reception')
    }
    const hitter = preferFrontRowHitter(roster, match.positions)
    const setter = findSetterId(roster) ?? playerId
    return {
      primary: opt(hitter, 'attack', null, 'Set → front-row attack'),
      alternates: [opt(setter, 'dump', null, 'Setter may dump')],
    }
  }

  if (action === 'attack' || action === 'dump') {
    const weScored =
      (action === 'attack' && outcome === 'kill') ||
      (action === 'dump' && outcome === 'point')
    if (weScored) {
      return suggestServe(roster, match, 'Point — we serve (P1 after rotate if side-out)')
    }
    if (outcome === 'defended') {
      return digAndBlock(
        roster,
        match,
        'Attack defended — dig',
        'Attack defended — block',
      )
    }
    if (outcome === 'blocked') {
      return {
        primary: opt(
          preferBackRowReceiver(roster, match.positions),
          'dig',
          null,
          'Blocked — cover dig',
        ),
        alternates: [],
      }
    }
    if (outcome === 'error_own' || outcome === 'error_bad_set') {
      if (match.servingTeam === 'us') {
        return suggestServe(roster, match, 'Error but we still serve')
      }
      return suggestReception(roster, match, 'Error against us → reception')
    }
  }

  if (action === 'block') {
    if (outcome === 'kill_block') {
      return suggestServe(roster, match, 'Kill block — we serve')
    }
    if (outcome === 'recycle') {
      return digAndBlock(
        roster,
        match,
        'Block recycle — dig continuation',
        'Block recycle — re-block',
      )
    }
    if (outcome === 'block_error') {
      if (match.servingTeam === 'us') {
        return suggestServe(roster, match, 'Block error but we serve')
      }
      return suggestReception(roster, match, 'Block error → reception')
    }
  }

  if (action === 'freeball_send') {
    if (outcome === 'error') {
      if (match.servingTeam === 'us') {
        return suggestServe(roster, match, 'Freeball error but we serve')
      }
      return suggestReception(roster, match, 'Freeball error → reception')
    }
    return digAndBlock(
      roster,
      match,
      'Freeball sent — dig when returned',
      'Freeball sent — block if they attack',
    )
  }

  return null
}
