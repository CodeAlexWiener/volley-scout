import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { replayJob, type ReplayJob } from '../src/replayEvents.ts'
import type { MatchSession, RosterPlayer } from '../src/types.ts'

const roster: RosterPlayer[] = [
  { id: 'p1', name: 'Peter', role: 'middle', startingPosition: 1, number: '1' },
  { id: 'p2', name: 'Julia', role: 'setter', startingPosition: 2, number: '7' },
  { id: 'p3', name: 'Manu', role: 'outside', startingPosition: 3 },
  { id: 'p4', name: 'Alex', role: 'middle', startingPosition: 4 },
  { id: 'p5', name: 'Lucas', role: 'opposite', startingPosition: 5 },
  { id: 'p6', name: 'Kathi', role: 'outside', startingPosition: 6 },
]

function session(serving: 'us' | 'them'): MatchSession {
  return {
    version: 2,
    videoName: 'match.mp4',
    roster,
    bindings: [],
    currentPlayerId: 'p1',
    events: [],
    match: { positions: {}, servingTeam: serving, scoreUs: 0, scoreThem: 0 },
    scoreboardBurnedIn: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function run(job: ReplayJob) {
  return replayJob(job)
}

describe('replay', () => {
  it('forces reception on the first pass when they serve, then rotates on a kill', () => {
    const result = run({
      session: session('them'),
      rallies: [
        {
          id: 'rally_001',
          start: 1,
          end: 12,
          touches: [
            { t: 2, player: 'Kathi', action: 'dig', outcome: 'in_system', confidence: 0.9, evidence: 'pass' },
            { t: 4, number: '7', action: 'second_touch', outcome: 'set', confidence: 0.8, evidence: 'set' },
            { t: 6, player: 'Alex', action: 'attack', outcome: 'kill', confidence: 0.86, evidence: 'kill' },
          ],
        },
      ],
    })
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(
      result.session.events.map((event) => [event.action, event.playerId, event.priorEventId ?? null]),
      [
        ['reception', 'p6', null],
        ['second_touch', 'p2', 'ai_rally_001_0'],
        ['attack', 'p4', 'ai_rally_001_1'],
      ],
    )
    assert.equal(result.session.events[0]?.note, 'reception, not dig — pass')
    assert.equal(result.match.servingTeam, 'us')
    assert.equal(result.match.scoreUs, 1)
    assert.equal(result.match.positions[1], 'p2')
    assert.equal(result.session.events.every((event) => event.status === 'proposed' && event.source === 'ai'), true)
  })

  it('turns a pass after our serve into a dig and keeps the server on an ace', () => {
    const served = run({
      session: session('us'),
      rallies: [
        {
          id: 'rally_001',
          start: 0,
          end: 8,
          touches: [
            { t: 1, player: 'Peter', action: 'serve', outcome: 'in_play_in_system', confidence: 0.9, evidence: 'serve' },
            { t: 4, player: 'Kathi', action: 'reception', outcome: 'out_of_system', confidence: 0.7, evidence: 'dig' },
          ],
        },
      ],
    })
    assert.equal(served.session.events[1]?.action, 'dig')
    assert.match(served.session.events[1]?.note ?? '', /dig, not reception/)
    assert.equal(served.match.scoreUs, 0)

    const ace = run({
      session: session('us'),
      rallies: [
        {
          id: 'rally_002',
          start: 0,
          end: 4,
          touches: [
            { t: 1, player: 'Peter', action: 'serve', outcome: 'ace', confidence: 0.95, evidence: 'ace' },
          ],
        },
      ],
    })
    assert.equal(ace.match.scoreUs, 1)
    assert.equal(ace.match.servingTeam, 'us')
    assert.equal(ace.match.positions[1], 'p1')
  })

  it('drops unknown players and illegal outcomes, and notes a back-row attack', () => {
    const result = run({
      session: session('us'),
      rallies: [
        {
          id: 'rally_009',
          start: 0,
          end: 10,
          touches: [
            { t: 1, player: 'Nobody', action: 'attack', outcome: 'kill', confidence: 0.9, evidence: 'no' },
            { t: 2, player: 'Peter', action: 'serve', outcome: 'not_an_outcome', confidence: 0.9, evidence: 'bad' },
            { t: 3, player: 'Lucas', action: 'attack', outcome: 'kill', confidence: 0.2, evidence: 'tip' },
          ],
        },
      ],
    })
    assert.equal(result.session.events.length, 1)
    assert.equal(result.session.events[0]?.playerId, 'p5')
    assert.match(result.session.events[0]?.note ?? '', /back-row attack/)
    assert.match(result.session.events[0]?.note ?? '', /low confidence/)
    assert.equal(result.warnings.length, 2)
  })
})
