import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choicesFor, nextSituation } from './flow'
import { migrateLegacyEvent } from './migrate'
import { joinWithNext, rallyDecided, rallyFor } from './rallies'
import { applyPossessionChange, isSetOver, pointWinner, possessionAfterEvent } from './rotation'
import type { MatchState, Rally, ScoutEvent } from './types'

const match = (servingTeam: 'us' | 'them', scoreUs = 0, scoreThem = 0): MatchState => ({
  positions: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f' },
  servingTeam,
  scoreUs,
  scoreThem,
})

const ev = (action: string, outcome: string, detail?: string, t = 10): ScoutEvent => ({
  id: `${action}-${outcome}-${detail ?? ''}-${t}`,
  playerId: 'a',
  action,
  outcome,
  ...(detail ? { detail } : {}),
  t,
  source: 'human',
  status: 'accepted',
})

test('point winners follow the agreed grid', () => {
  const cases: [string, string, string | undefined, ReturnType<typeof pointWinner>][] = [
    ['serve', 'ace', 'no_touch', 'us'],
    ['serve', 'error', undefined, 'them'],
    ['serve', 'in_play', 'overpass', null],
    ['reception', 'error', undefined, 'them'],
    ['reception', 'overpass', undefined, null],
    ['second_touch', 'error', 'lift_double', 'them'],
    ['second_touch', 'attack_on_2', undefined, null],
    ['attack', 'kill', 'tip_dump', 'us'],
    ['attack', 'blocked', 'stuffed', 'them'],
    ['attack', 'blocked', 'covered', null],
    ['attack', 'error', 'violation', 'them'],
    ['dig', 'error', undefined, 'them'],
    ['block', 'kill_block', undefined, 'us'],
    ['block', 'tooled', undefined, 'them'],
    ['block', 'soft_block', undefined, null],
    ['freeball_send', 'error', undefined, 'them'],
    ['opponent_error', 'serve_error', undefined, 'us'],
    ['opponent_error', 'out', undefined, 'us'],
    ['team', 'down', undefined, 'them'],
    ['team', 'fault', undefined, 'them'],
    ['team', 'replay', undefined, 'replay'],
    ['rally_point', 'us', undefined, 'us'],
  ]
  for (const [action, outcome, detail, expected] of cases) {
    assert.equal(pointWinner(action, outcome, detail), expected, `${action}/${outcome}/${detail}`)
  }
})

test('side-out rotates, replay changes nothing', () => {
  const rotated = applyPossessionChange(match('them'), possessionAfterEvent('attack', 'kill', 'them', 'spike'))
  assert.equal(rotated.servingTeam, 'us')
  assert.equal(rotated.scoreUs, 1)
  assert.equal(rotated.positions[1], 'b')
  const replay = applyPossessionChange(match('us', 5, 5), possessionAfterEvent('team', 'replay', 'us'))
  assert.deepEqual(replay, match('us', 5, 5))
})

test('sets end at 25 (15 in set 3) with a two-point lead', () => {
  assert.equal(isSetOver({ scoreUs: 25, scoreThem: 23 }, 1), true)
  assert.equal(isSetOver({ scoreUs: 25, scoreThem: 24 }, 1), false)
  assert.equal(isSetOver({ scoreUs: 27, scoreThem: 29 }, 2), true)
  assert.equal(isSetOver({ scoreUs: 15, scoreThem: 13 }, 3), true)
  assert.equal(isSetOver({ scoreUs: 15, scoreThem: 13 }, 2), false)
})

test('the situation follows the rally', () => {
  assert.equal(nextSituation(null, match('us')), 'serve')
  assert.equal(nextSituation(null, match('them')), 'reception')
  assert.equal(nextSituation(ev('serve', 'in_play', 'in_system'), match('us')), 'defense')
  assert.equal(nextSituation(ev('reception', 'in_system'), match('them')), 'second')
  assert.equal(nextSituation(ev('reception', 'overpass'), match('them')), 'defense')
  assert.equal(nextSituation(ev('second_touch', 'set'), match('them')), 'attack')
  assert.equal(nextSituation(ev('second_touch', 'attack_on_2'), match('them')), 'attack')
  assert.equal(nextSituation(ev('attack', 'blocked', 'covered'), match('them')), 'defense')
  assert.equal(nextSituation(ev('dig', 'out_of_system'), match('us')), 'second')
  // Point decided: back to serve / reception for whoever serves now.
  assert.equal(nextSituation(ev('attack', 'kill', 'spike'), match('us')), 'serve')
  assert.equal(nextSituation(ev('team', 'down'), match('them')), 'reception')
})

test('grid choices: Replay last, opponent serve error only when they serve', () => {
  for (const situation of ['serve', 'reception', 'second', 'attack', 'defense'] as const) {
    assert.equal(choicesFor(situation, 'team').at(-1)?.key, 'team:replay')
  }
  assert.equal(choicesFor('reception', 'opponent')[0]?.key, 'opponent_error:serve_error')
  assert.ok(!choicesFor('serve', 'opponent').some((c) => c.outcome === 'serve_error'))
  assert.deepEqual(
    choicesFor('reception', 'player').map((c) => c.outcome),
    ['in_system', 'out_of_system', 'overpass', 'error'],
  )
  assert.equal(choicesFor('serve', 'player').find((c) => c.outcome === 'error')?.next, undefined)
})

test('old v2 events map onto the new grid', () => {
  assert.deepEqual(
    [
      migrateLegacyEvent(ev('serve', 'in_play_out_of_system')),
      migrateLegacyEvent(ev('serve', 'serve_error')),
      migrateLegacyEvent(ev('dump', 'point')),
      migrateLegacyEvent(ev('attack', 'error_bad_set')),
      migrateLegacyEvent(ev('block', 'recycle')),
    ].map((e) => [e.action, e.outcome, e.detail]),
    [
      ['serve', 'in_play', 'out_of_system'],
      ['serve', 'error', undefined],
      ['attack', 'kill', 'tip_dump'],
      ['attack', 'error', 'bad_set'],
      ['block', 'soft_block', undefined],
    ],
  )
})

test('a late entry belongs to the nearest rally; J joins split rallies', () => {
  const rallies: Rally[] = [
    { id: 'r1', start: 0, end: 10, source: 'ai' },
    { id: 'r2', start: 11, end: 20, source: 'ai' },
    { id: 'r3', start: 40, end: 50, source: 'ai' },
  ]
  assert.equal(rallyFor(rallies, 10.4)?.id, 'r1')
  assert.equal(rallyFor(rallies, 10.8)?.id, 'r2')
  assert.equal(rallyFor(rallies, 30), null)
  assert.equal(rallyDecided(rallies[0]!, [ev('attack', 'kill', 'spike', 10.3)], rallies), true)
  assert.equal(rallyDecided(rallies[1]!, [ev('attack', 'kill', 'spike', 10.3)], rallies), false)
  const joined = joinWithNext(rallies, 5)
  assert.deepEqual(
    joined.map((r) => [r.start, r.end]),
    [
      [0, 20],
      [40, 50],
    ],
  )
})
