import { labelForAction, labelForOutcome } from './data/grid'
import { playerLabel, resolveEventPlayer } from './format'
import type { GameWindow, RosterPlayer, ScoutEvent } from './types'

/** Dead-ball gap that starts a new rally clip. */
const RALLY_GAP_SEC = 6
const PAD_BEFORE_SEC = 2
const PAD_AFTER_SEC = 3

export type RallyClip = {
  id: string
  start: number
  end: number
  label: string
  eventIds: string[]
  origin: 'scout'
}

export type EditManifest = {
  version: 1
  videoFileName: string | null
  gameWindow: GameWindow
  clips: RallyClip[]
}

function finiteEnd(gameWindow: GameWindow, duration: number): number {
  if (gameWindow.end != null) return gameWindow.end
  if (Number.isFinite(duration) && duration > 0) return duration
  return Number.POSITIVE_INFINITY
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function touchLabel(event: ScoutEvent, roster: RosterPlayer[]): string {
  const player = resolveEventPlayer(event.playerId, roster)
  return `${playerLabel(player)} ${labelForAction(event.action)} → ${labelForOutcome(event.action, event.outcome)}`
}

/**
 * Rally clips inside the game window.
 * Touches closer than 6s stay in one clip. Each clip is padded around the touches
 * and clamped to the window. With no touches, the window itself is the only clip.
 */
export function buildRallyClips(
  events: ScoutEvent[],
  roster: RosterPlayer[],
  gameWindow: GameWindow,
  duration: number,
): RallyClip[] {
  const windowStart = Math.max(0, gameWindow.start ?? 0)
  const windowEnd = finiteEnd(gameWindow, duration)
  if (!(windowEnd > windowStart)) return []

  const inWindow = events
    .filter((event) => event.status !== 'rejected')
    .filter((event) => event.t >= windowStart - 0.001 && event.t <= windowEnd + 0.001)
    .sort((a, b) => a.t - b.t)

  if (inWindow.length === 0) {
    const bounded = gameWindow.start != null || gameWindow.end != null
    if (!bounded || !Number.isFinite(windowEnd)) return []
    return [
      {
        id: 'game-window',
        start: windowStart,
        end: windowEnd,
        label: 'Game window',
        eventIds: [],
        origin: 'scout',
      },
    ]
  }

  const groups: ScoutEvent[][] = []
  for (const event of inWindow) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    if (!current || !previous || event.t - previous.t > RALLY_GAP_SEC) groups.push([event])
    else current.push(event)
  }

  return groups.map((group) => {
    const first = group[0]!
    const last = group.at(-1)!
    const start = clamp(first.t - PAD_BEFORE_SEC, windowStart, windowEnd)
    let end = clamp(last.t + PAD_AFTER_SEC, windowStart, windowEnd)
    if (end <= start) end = Math.min(windowEnd, start + 0.5)
    const names = group.slice(0, 3).map((event) => touchLabel(event, roster))
    const extra = group.length > 3 ? ` +${group.length - 3}` : ''
    return {
      id: `rally_${group.map((event) => event.id).join('_')}`,
      start,
      end,
      label: names.join(' · ') + extra,
      eventIds: group.map((event) => event.id),
      origin: 'scout',
    }
  })
}

export function toEditManifest(
  videoFileName: string | null,
  gameWindow: GameWindow,
  clips: RallyClip[],
): EditManifest {
  return { version: 1, videoFileName, gameWindow, clips }
}
