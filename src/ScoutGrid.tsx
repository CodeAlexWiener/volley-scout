import { useEffect, useRef, useState } from 'react'
import { choicesFor, SITUATIONS, type Choice, type RowKind, type Situation, type StepTwo } from './flow'
import type { RosterPlayer } from './types'

export type GridRow = { kind: RowKind; id: string; label: string; meta?: string }

export type GridPick = {
  row: GridRow
  choice: Choice
  step: StepTwo | null
  /** Playhead when step 1 was picked: the touch time, not the confirm time. */
  t: number
}

type Props = {
  situation: Situation
  players: RosterPlayer[]
  /** Short tag per player, e.g. "P1 · S". */
  playerMeta: (player: RosterPlayer) => string
  defaultPlayerId: string | null
  active: boolean
  getTime: () => number
  onSituationChange: (situation: Situation) => void
  onPick: (pick: GridPick) => void
}

type Focus = { row: number; col: number }
type Pending = { row: number; col: number; t: number; index: number }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Two-step scout grid. Step 1: player row × outcome (keys 1–5). Step 2: detail or
 * outcome (keys 1–5, Enter = first). Opponent and Team rows sit at the bottom;
 * Replay is the very last Team option.
 */
export function ScoutGrid(props: Props) {
  const { situation, players, defaultPlayerId, active } = props
  const rows: GridRow[] = [
    ...players.map((p) => ({ kind: 'player' as const, id: p.id, label: p.name, meta: props.playerMeta(p) })),
    { kind: 'opponent', id: 'opponent', label: 'Opponent' },
    { kind: 'team', id: 'team', label: 'Team' },
  ]
  const defaultRow = Math.max(0, rows.findIndex((r) => r.id === defaultPlayerId))
  const [focus, setFocus] = useState<Focus>({ row: defaultRow, col: 0 })
  const [pending, setPending] = useState<Pending | null>(null)

  // New situation or new likely player: jump to the default cell, drop a half-made pick.
  useEffect(() => {
    setFocus({ row: defaultRow, col: 0 })
    setPending(null)
  }, [situation, defaultRow])

  const state = useRef({ rows, focus, pending, props })
  state.current = { rows, focus, pending, props }

  function choose(rowIndex: number, colIndex: number) {
    const { rows: r, props: p } = state.current
    const row = r[rowIndex]
    const choice = row ? choicesFor(p.situation, row.kind)[colIndex] : undefined
    if (!row || !choice) return
    setFocus({ row: rowIndex, col: colIndex })
    const t = p.getTime()
    if (choice.next && choice.next.length > 0) {
      setPending({ row: rowIndex, col: colIndex, t, index: 0 })
    } else {
      p.onPick({ row, choice, step: null, t })
    }
  }

  function confirm(index: number) {
    const { rows: r, pending: pend, props: p } = state.current
    if (!pend) return
    const row = r[pend.row]
    const choice = row ? choicesFor(p.situation, row.kind)[pend.col] : undefined
    const step = choice?.next?.[index]
    if (!row || !choice || !step) return
    setPending(null)
    p.onPick({ row, choice, step, t: pend.t })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { rows: r, focus: f, pending: pend, props: p } = state.current
      if (!p.active || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const rowChoices = (i: number) => (r[i] ? choicesFor(p.situation, r[i]!.kind) : [])

      if (pend) {
        const options = rowChoices(pend.row)[pend.col]?.next ?? []
        const digit = Number(e.key)
        if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
          e.preventDefault()
          confirm(digit - 1)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          confirm(pend.index)
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          setPending({ ...pend, index: Math.min(options.length - 1, pend.index + 1) })
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          setPending({ ...pend, index: Math.max(0, pend.index - 1) })
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
          // Backspace backs out of step 2 instead of undoing the previous entry.
          e.preventDefault()
          e.stopImmediatePropagation()
          setPending(null)
        }
        return
      }

      const digit = Number(e.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= rowChoices(f.row).length) {
        e.preventDefault()
        choose(f.row, digit - 1)
        return
      }
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          const row = Math.max(0, Math.min(r.length - 1, f.row + (e.key === 'ArrowUp' ? -1 : 1)))
          setFocus({ row, col: Math.min(f.col, rowChoices(row).length - 1) })
          return
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const max = rowChoices(f.row).length - 1
          setFocus({ row: f.row, col: Math.max(0, Math.min(max, f.col + (e.key === 'ArrowLeft' ? -1 : 1))) })
          return
        }
        case 'Enter':
          e.preventDefault()
          choose(f.row, f.col)
          return
        case 'Tab':
        case 'Escape':
          e.preventDefault()
          setFocus({ row: Math.max(0, r.findIndex((x) => x.id === p.defaultPlayerId)), col: 0 })
          return
        case ',':
        case '.': {
          e.preventDefault()
          const i = SITUATIONS.findIndex((s) => s.id === p.situation)
          const next = SITUATIONS[(i + (e.key === ',' ? -1 : 1) + SITUATIONS.length) % SITUATIONS.length]!
          p.onSituationChange(next.id)
          return
        }
      }
    }
    // Capture phase: step-2 Backspace must win over the app's undo key.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // Reads live state through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`scout-grid two-step${active ? '' : ' disabled'}`} aria-label="Scout grid">
      <div className="situation-tabs" role="tablist" aria-label="Situation (, and . to switch)">
        {SITUATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === situation}
            className={s.id === situation ? 'on' : undefined}
            title={s.hint}
            onClick={() => props.onSituationChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="scout-grid-keys">↑↓ player · 1–5 or ←→ Enter pick · then 1–5 or Enter · Esc back · , . situation</p>
      <div className="grid-rows">
        {rows.map((row, ri) => {
          const choices = choicesFor(situation, row.kind)
          const open = pending?.row === ri ? pending : null
          const openChoice = open ? choices[open.col] : null
          return (
            <div
              key={row.id}
              className={['grid-row', row.kind, ri === focus.row ? 'focused' : '', ri === defaultRow ? 'likely' : ''].filter(Boolean).join(' ')}
            >
              <span className="grid-who">
                {row.label}
                {row.meta && <small>{row.meta}</small>}
              </span>
              <span className="grid-choices">
                {choices.map((c, ci) => (
                  <button
                    key={c.key}
                    type="button"
                    disabled={!active}
                    className={[
                      'grid-choice',
                      ri === focus.row && ci === focus.col ? 'focused' : '',
                      open?.col === ci ? 'open' : '',
                      c.key === 'team:replay' ? 'far' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => choose(ri, ci)}
                  >
                    {ri === focus.row && <kbd>{ci + 1}</kbd>}
                    {c.label}
                    {c.next && <span className="more">›</span>}
                  </button>
                ))}
              </span>
              {open && openChoice?.next && (
                <span className="grid-step-two" role="listbox" aria-label={`${openChoice.label}: pick detail`}>
                  {openChoice.next.map((s, si) => (
                    <button
                      key={s.label}
                      type="button"
                      role="option"
                      aria-selected={si === open.index}
                      className={si === open.index ? 'focused' : undefined}
                      onClick={() => confirm(si)}
                    >
                      <kbd>{si + 1}</kbd>
                      {s.label}
                    </button>
                  ))}
                  <button type="button" className="ghost" onClick={() => setPending(null)}>
                    Esc
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
