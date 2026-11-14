import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkSpans, mergeSpans, padSpans, toFileTimes, unionSpans } from './rallies.ts'

test('chunks cover the window with overlap and end exactly at the window end', () => {
  const chunks = chunkSpans({ start: 100, end: 400 })
  assert.deepEqual(chunks[0], { start: 100, end: 220 })
  assert.deepEqual(chunks[1], { start: 190, end: 310 })
  assert.equal(chunks.at(-1)!.end, 400)
  assert.deepEqual(chunkSpans({ start: 0, end: 60 }), [{ start: 0, end: 60 }])
  assert.deepEqual(chunkSpans({ start: 50, end: 50 }), [])
})

test('model times become file times, clamped to the chunk, junk dropped', () => {
  const chunk = { start: 300, end: 420 }
  const out = toFileTimes(chunk, [
    { start: 10, end: 25.5 },
    { start: 118, end: 140 }, // runs past the clip end
    { start: 40, end: 30 }, // swapped
    { start: Number.NaN, end: 5 },
    { start: 50, end: 50.2 }, // too short
  ])
  assert.deepEqual(out, [
    { start: 310, end: 325.5 },
    { start: 418, end: 420 },
    { start: 330, end: 340 },
  ])
})

test('halves of a rally seen in two overlapping chunks merge into one', () => {
  const merged = mergeSpans([
    { start: 200, end: 220 }, // chunk A sees the start
    { start: 205, end: 231 }, // chunk B sees it whole
    { start: 260, end: 261 }, // too short to be a rally
    { start: 280, end: 290 },
  ])
  assert.deepEqual(merged, [
    { start: 200, end: 231 },
    { start: 280, end: 290 },
  ])
})

test('padding never overlaps neighbours and stays in the window', () => {
  const padded = padSpans(
    [
      { start: 9.5, end: 20 },
      { start: 21.5, end: 30 },
      { start: 58, end: 60 },
    ],
    { start: 9, end: 60 },
  )
  assert.deepEqual(padded, [
    { start: 9, end: 20.75 },
    { start: 20.75, end: 31 },
    { start: 57, end: 60 },
  ])
})

test('pieces of one rally a few seconds apart become one rally; real gaps stay', () => {
  assert.deepEqual(
    mergeSpans([
      { start: 100, end: 108 },
      { start: 110.5, end: 118 }, // 2.5s later: same rally, split by the model
      { start: 130, end: 140 }, // 12s later: next point
    ]),
    [
      { start: 100, end: 118 },
      { start: 130, end: 140 },
    ],
  )
})

test('coverage union joins touching chunks', () => {
  assert.deepEqual(
    unionSpans([
      { start: 190, end: 310 },
      { start: 100, end: 220 },
      { start: 400, end: 500 },
    ]),
    [
      { start: 100, end: 310 },
      { start: 400, end: 500 },
    ],
  )
})
