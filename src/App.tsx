import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getCandidateGrid,
  isCellEnabled,
  moveFocusSkippingDisabled,
  resolveFocus,
} from './candidates'
import type { FocusCell, GridColumn } from './candidates'
import { ACTION_OUTCOME_GRID, labelForAction, labelForOutcome } from './data/grid'
import { formatTime, playerLabel, resolveEventPlayer } from './format'
import {
  applyPossessionChange,
  playerAt,
  positionOf,
  positionsFromRoster,
  possessionAfterEvent,
  rotateClockwise,
} from './rotation'
import { defaultSession } from './defaultRoster'
import { ScoutGrid } from './ScoutGrid'
import {
  exportSessionJson,
  loadSession,
  newId,
  parseImportedSession,
  saveSession,
} from './storage'
import { suggestNext } from './suggestions'
import type {
  CourtPosition,
  FlowSuggestion,
  MatchSession,
  PlayerRole,
  RosterPlayer,
  ScoutEvent,
  SuggestionOption,
} from './types'
import {
  COURT_POSITIONS,
  isOpponentPlayerId,
  OPPONENT_PLAYER_ID,
  PLAYER_ROLES,
} from './types'
import './App.css'

type UndoSnapshot = {
  events: ScoutEvent[]
  match: MatchSession['match']
  currentPlayerId: string | null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

type RosterDraft = {
  name: string
  role: '' | PlayerRole
  startingPosition: '' | CourtPosition
}

const emptyDraft = (): RosterDraft => ({
  name: '',
  role: '',
  startingPosition: '',
})

export default function App() {
  const [session, setSession] = useState<MatchSession>(() => loadSession())
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [actionId, setActionId] = useState(ACTION_OUTCOME_GRID.actions[0]?.id ?? 'serve')
  const [outcomeId, setOutcomeId] = useState(
    ACTION_OUTCOME_GRID.actions[0]?.outcomes[0]?.id ?? 'ace',
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rosterDraft, setRosterDraft] = useState<RosterDraft>(emptyDraft)
  const [editPlayerId, setEditPlayerId] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<FlowSuggestion | null>(null)
  const [gridFocus, setGridFocus] = useState<FocusCell | null>(null)
  const [gridActive, setGridActive] = useState(true)
  /** Bumps on rotate so court slots re-animate. */
  const [courtPulse, setCourtPulse] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const undoStackRef = useRef<UndoSnapshot[]>([])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const positionsSig = useMemo(
    () => COURT_POSITIONS.map((p) => session.match.positions[p] ?? '').join('|'),
    [session.match.positions],
  )
  useEffect(() => {
    setCourtPulse((n) => n + 1)
  }, [positionsSig])

  const outcomes = useMemo(() => {
    return ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)?.outcomes ?? []
  }, [actionId])

  useEffect(() => {
    if (!outcomes.some((o) => o.id === outcomeId)) {
      setOutcomeId(outcomes[0]?.id ?? '')
    }
  }, [outcomes, outcomeId])

  useEffect(() => {
    saveSession(session)
  }, [session])

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  const updateSession = useCallback((updater: (prev: MatchSession) => MatchSession) => {
    setSession((prev) => updater(prev))
  }, [])

  const currentPlayer = session.roster.find((p) => p.id === session.currentPlayerId)

  const lastEvent = useMemo(() => {
    if (session.events.length === 0) return null
    return [...session.events].sort((a, b) => a.t - b.t).at(-1) ?? null
  }, [session.events])

  const candidateGrid = useMemo(() => {
    if (editingId) {
      return getCandidateGrid(null, [], session.match)
    }
    return getCandidateGrid(lastEvent, session.roster, session.match)
  }, [lastEvent, session.roster, session.match, editingId])

  // Recompute suggestion when match/events change (not while editing an old event).
  useEffect(() => {
    if (editingId) {
      setSuggestion(null)
      return
    }
    setSuggestion(candidateGrid.suggestion ?? suggestNext(lastEvent, session.roster, session.match))
  }, [candidateGrid, lastEvent, session.roster, session.match, editingId])

  // After each log / state change, snap focus to the new primary suggestion cell.
  useEffect(() => {
    if (editingId) {
      setGridFocus(null)
      return
    }
    setGridFocus((prev) => resolveFocus(candidateGrid, prev))
    setGridActive(true)
  }, [candidateGrid, editingId])

  function onPickVideo(file: File | undefined) {
    if (!file) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    updateSession((s) => ({ ...s, videoName: file.name }))
  }

  function seekBy(delta: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  function addOrUpdatePlayer() {
    const name = rosterDraft.name.trim()
    if (!name) return
    const role = rosterDraft.role || undefined
    const startingPosition = rosterDraft.startingPosition || undefined
    if (editPlayerId) {
      updateSession((s) => {
        const roster = s.roster.map((p) =>
          p.id === editPlayerId ? { ...p, name, role, startingPosition } : p,
        )
        return {
          ...s,
          roster,
          match: {
            ...s.match,
            positions: mergeStartingIntoPositions(s.match.positions, roster, editPlayerId),
          },
        }
      })
      setEditPlayerId(null)
    } else {
      const player: RosterPlayer = {
        id: newId('pl'),
        name,
        role,
        startingPosition,
      }
      updateSession((s) => {
        const roster = [...s.roster, player]
        const positions = { ...s.match.positions }
        if (startingPosition) positions[startingPosition] = player.id
        return {
          ...s,
          roster,
          currentPlayerId: s.currentPlayerId ?? player.id,
          match: { ...s.match, positions },
        }
      })
    }
    setRosterDraft(emptyDraft())
  }

  function startEditPlayer(player: RosterPlayer) {
    setEditPlayerId(player.id)
    setRosterDraft({
      name: player.name,
      role: player.role ?? '',
      startingPosition: player.startingPosition ?? '',
    })
  }

  function removePlayer(id: string) {
    updateSession((s) => {
      const positions = { ...s.match.positions }
      for (const pos of COURT_POSITIONS) {
        if (positions[pos] === id) delete positions[pos]
      }
      return {
        ...s,
        roster: s.roster.filter((p) => p.id !== id),
        currentPlayerId: s.currentPlayerId === id ? null : s.currentPlayerId,
        events: s.events.filter((e) => e.playerId !== id),
        match: { ...s.match, positions },
      }
    })
    if (editPlayerId === id) {
      setEditPlayerId(null)
      setRosterDraft(emptyDraft())
    }
  }

  function applyStartingLineup() {
    updateSession((s) => ({
      ...s,
      match: { ...s.match, positions: positionsFromRoster(s.roster) },
    }))
  }

  function rotateNow() {
    updateSession((s) => ({
      ...s,
      match: { ...s.match, positions: rotateClockwise(s.match.positions) },
    }))
  }

  function resolveOutcome(action: string, preferred: string | null): string | null {
    if (preferred) return preferred
    return ACTION_OUTCOME_GRID.actions.find((a) => a.id === action)?.outcomes[0]?.id ?? null
  }

  function pushUndoSnapshot() {
    const s = sessionRef.current
    undoStackRef.current.push({
      events: s.events,
      match: s.match,
      currentPlayerId: s.currentPlayerId,
    })
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
  }

  /** Log player + action + outcome at the video playhead. */
  function logCell(playerId: string, action: string, outcome: string): boolean {
    if (editingId) return false
    if (!playerId || !action || !outcome) return false
    if (action === 'opponent_error' && !isOpponentPlayerId(playerId)) return false
    if (action !== 'opponent_error' && isOpponentPlayerId(playerId)) return false

    const t = videoRef.current?.currentTime ?? currentTime
    const event: ScoutEvent = {
      id: newId('ev'),
      playerId: action === 'opponent_error' ? OPPONENT_PLAYER_ID : playerId,
      action,
      outcome,
      t,
      source: 'human',
      status: 'accepted',
    }
    pushUndoSnapshot()
    updateSession((s) => {
      const change = possessionAfterEvent(action, outcome, s.match.servingTeam)
      const match = applyPossessionChange(s.match, change)
      return {
        ...s,
        // Don't bind "current player" to the synthetic Opponent sentinel
        currentPlayerId: isOpponentPlayerId(event.playerId)
          ? s.currentPlayerId
          : event.playerId,
        match,
        events: [...s.events, event].sort((a, b) => a.t - b.t),
      }
    })
    setActionId(action)
    setOutcomeId(outcome)
    return true
  }

  /**
   * One-click / Enter: apply suggested player/action/outcome at playhead and append event.
   * Returns true if an event was logged.
   */
  function logSuggestion(option: SuggestionOption): boolean {
    const playerId = option.playerId ?? session.currentPlayerId
    const outcome = resolveOutcome(option.action, option.outcome)
    if (!playerId || !option.action || !outcome) return false
    return logCell(playerId, option.action, outcome)
  }

  function logFocusedCell(): boolean {
    if (!gridActive || !gridFocus || editingId) return false
    const player = candidateGrid.players[gridFocus.rowIndex]
    const column = candidateGrid.columns[gridFocus.columnIndex]
    if (!player || !column) return false
    if (!isCellEnabled(player.id, column)) return false
    return logCell(player.id, column.action, column.outcome)
  }

  function onGridLog(player: RosterPlayer, column: GridColumn) {
    if (!isCellEnabled(player.id, column)) return
    logCell(player.id, column.action, column.outcome)
  }

  function undoLastEvent() {
    const snap = undoStackRef.current.pop()
    if (snap) {
      updateSession((s) => ({
        ...s,
        events: snap.events,
        match: snap.match,
        currentPlayerId: snap.currentPlayerId,
      }))
      setEditingId(null)
      return
    }
    // Fallback: drop last event only (match state may drift until next log)
    if (session.events.length === 0) return
    const sorted = [...session.events].sort((a, b) => a.t - b.t)
    const last = sorted.at(-1)
    if (!last) return
    updateSession((s) => ({
      ...s,
      events: s.events.filter((e) => e.id !== last.id),
    }))
    setEditingId(null)
  }

  function moveGridFocus(dRow: number, dCol: number) {
    if (candidateGrid.players.length === 0 || candidateGrid.columns.length === 0) return
    setGridActive(true)
    setGridFocus((prev) => {
      const base = prev ?? resolveFocus(candidateGrid, null) ?? { rowIndex: 0, columnIndex: 0 }
      return moveFocusSkippingDisabled(candidateGrid, base, dRow, dCol)
    })
  }

  function jumpToPrimaryFocus() {
    const next = resolveFocus(candidateGrid, null)
    if (next) {
      setGridActive(true)
      setGridFocus(next)
    }
  }

  function markEvent() {
    const isOppErr = actionId === 'opponent_error'
    const playerId = isOppErr ? OPPONENT_PLAYER_ID : session.currentPlayerId
    if (!playerId || !actionId || !outcomeId) return
    const t = videoRef.current?.currentTime ?? currentTime
    if (editingId) {
      updateSession((s) => ({
        ...s,
        events: s.events.map((e) =>
          e.id === editingId
            ? {
                ...e,
                playerId,
                action: actionId,
                outcome: outcomeId,
                t,
              }
            : e,
        ),
        currentPlayerId: isOppErr ? s.currentPlayerId : playerId,
      }))
      setEditingId(null)
      return
    }
    const event: ScoutEvent = {
      id: newId('ev'),
      playerId,
      action: actionId,
      outcome: outcomeId,
      t,
      source: 'human',
      status: 'accepted',
    }
    pushUndoSnapshot()
    updateSession((s) => {
      const change = possessionAfterEvent(actionId, outcomeId, s.match.servingTeam)
      const match = applyPossessionChange(s.match, change)
      return {
        ...s,
        match,
        events: [...s.events, event].sort((a, b) => a.t - b.t),
      }
    })
  }

  function loadEventForEdit(event: ScoutEvent) {
    setEditingId(event.id)
    setActionId(event.action)
    setOutcomeId(event.outcome)
    setSuggestion(null)
    if (!isOpponentPlayerId(event.playerId)) {
      updateSession((s) => ({ ...s, currentPlayerId: event.playerId }))
    }
    const v = videoRef.current
    if (v) v.currentTime = event.t
  }

  function deleteEvent(id: string) {
    updateSession((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }))
    if (editingId === id) setEditingId(null)
  }

  function downloadExport() {
    const blob = new Blob([exportSessionJson(session)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `volley-scout-${session.videoName?.replace(/\W+/g, '_') ?? 'session'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function onImportFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const next = parseImportedSession(String(reader.result))
        setSession(next)
        undoStackRef.current = []
        setEditingId(null)
        setSuggestion(null)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Import failed')
      }
    }
    reader.readAsText(file)
  }

  function resetToDefaultRoster() {
    if (
      !confirm(
        'Reset to the default six (Peter, Julia, Manu, Alex, Lucas, Kathi) and clear events?',
      )
    ) {
      return
    }
    const next = defaultSession()
    saveSession(next)
    setSession(next)
    undoStackRef.current = []
    setEditingId(null)
    setSuggestion(null)
    setRosterDraft(emptyDraft())
    setEditPlayerId(null)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return

      // Video seek — B/N ±5s, V/M ±1min; plain arrows stay on the scout grid
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        seekBy(-5)
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        seekBy(5)
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        seekBy(-60)
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        seekBy(60)
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }

      if (e.key === 'Backspace' || e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        undoLastEvent()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setGridActive(false)
        return
      }

      if (e.key === 'Tab' && !editingId && candidateGrid.players.length > 0) {
        e.preventDefault()
        jumpToPrimaryFocus()
        return
      }

      // Grid navigation (plain arrows — never steal for seek)
      if (!editingId && gridActive && candidateGrid.players.length > 0) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          moveGridFocus(0, -1)
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          moveGridFocus(0, 1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          moveGridFocus(-1, 0)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          moveGridFocus(1, 0)
          return
        }
      }

      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        if (editingId) return
        if (logFocusedCell()) return
        if (suggestion?.primary) {
          logSuggestion(suggestion.primary)
          return
        }
        if (session.currentPlayerId && actionId && outcomeId) markEvent()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        markEvent()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.currentPlayerId,
    session.events,
    actionId,
    outcomeId,
    editingId,
    suggestion,
    candidateGrid,
    gridFocus,
    gridActive,
  ])

  const sortedEvents = useMemo(
    () => [...session.events].sort((a, b) => a.t - b.t),
    [session.events],
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>volley-scout</h1>
            <p>Own-side flow scout · player → action → outcome</p>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()}>
            {session.videoName ? 'Change video' : 'Load video'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => onPickVideo(e.target.files?.[0])}
          />
          <button type="button" className="ghost" onClick={downloadExport}>
            Export JSON
          </button>
          <button type="button" className="ghost" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => onImportFile(e.target.files?.[0])}
          />
          <button type="button" className="ghost danger" onClick={resetToDefaultRoster}>
            Reset roster
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          <div className="video-shell">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              />
            ) : (
              <button
                type="button"
                className="video-empty"
                onClick={() => fileInputRef.current?.click()}
              >
                <strong>Load a local video</strong>
                <span>File stays in your browser — nothing is uploaded.</span>
              </button>
            )}
          </div>
          <div className="transport">
            <div className="transport-group" aria-label="Fine scrub">
              <button type="button" onClick={() => seekBy(-1)}>
                −1s
              </button>
              <button type="button" onClick={() => seekBy(-0.1)}>
                −0.1s
              </button>
              <button type="button" className="primary" onClick={togglePlay}>
                Play / Pause
              </button>
              <button type="button" onClick={() => seekBy(0.1)}>
                +0.1s
              </button>
              <button type="button" onClick={() => seekBy(1)}>
                +1s
              </button>
            </div>
            <div className="transport-group" aria-label="Jump seek">
              <button type="button" onClick={() => seekBy(-60)} title="Jump back 1 minute">
                −1 min
              </button>
              <button type="button" onClick={() => seekBy(-10)} title="Jump back 10 seconds">
                −10s
              </button>
              <button type="button" onClick={() => seekBy(10)} title="Jump forward 10 seconds">
                +10s
              </button>
              <button type="button" onClick={() => seekBy(60)} title="Jump forward 1 minute">
                +1 min
              </button>
            </div>
            <span className="time-readout">
              {formatTime(currentTime)}
              {duration > 0 ? ` / ${formatTime(duration)}` : ''}
              {session.videoName ? ` · ${session.videoName}` : ''}
            </span>
          </div>
          <p className="hint">
            Grid: ←→↑↓ · Enter log · Tab primary · Esc clear · Backspace/U undo · Space
            play/pause · Seek B/N ±5s · V/M ±1min · ⌘/Ctrl+Enter mark form
          </p>

          <section className="panel match-panel">
            <div className="match-head">
              <h2>Match · rotation</h2>
              <div className="score-line">
                <label>
                  Us
                  <input
                    className="score-input"
                    type="number"
                    min={0}
                    value={session.match.scoreUs}
                    onChange={(e) =>
                      updateSession((s) => ({
                        ...s,
                        match: { ...s.match, scoreUs: Number(e.target.value) || 0 },
                      }))
                    }
                  />
                </label>
                <span className="score-sep">–</span>
                <label>
                  Them
                  <input
                    className="score-input"
                    type="number"
                    min={0}
                    value={session.match.scoreThem}
                    onChange={(e) =>
                      updateSession((s) => ({
                        ...s,
                        match: { ...s.match, scoreThem: Number(e.target.value) || 0 },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="serve-row">
              <span className="muted">Serving</span>
              <button
                type="button"
                className={session.match.servingTeam === 'us' ? 'primary' : 'ghost'}
                onClick={() =>
                  updateSession((s) => ({ ...s, match: { ...s.match, servingTeam: 'us' } }))
                }
              >
                Us
              </button>
              <button
                type="button"
                className={session.match.servingTeam === 'them' ? 'primary' : 'ghost'}
                onClick={() =>
                  updateSession((s) => ({ ...s, match: { ...s.match, servingTeam: 'them' } }))
                }
              >
                Them
              </button>
              <button type="button" className="ghost" onClick={rotateNow}>
                Rotate
              </button>
              <button type="button" className="ghost" onClick={applyStartingLineup}>
                Apply starting P1–P6
              </button>
            </div>
            <CourtDiagram
              session={session}
              pulseKey={courtPulse}
              onPick={(playerId) =>
                updateSession((s) => ({ ...s, currentPlayerId: playerId }))
              }
            />
            <p className="hint">
              Our half · front P2–P4 / back P5–P6–P1 · P1 serves when we have serve. Attack
              suggest: P4 outside, P2 opposite/outside, P3 middle. Auto-rotates on side-out.
            </p>
          </section>
        </section>

        <aside className="side">
          <section className="panel">
            <div className="panel-head">
              <h2>Roster</h2>
              <button type="button" className="ghost" onClick={resetToDefaultRoster}>
                Reset roster
              </button>
            </div>
            <div className="roster-form">
              <input
                placeholder="Name"
                value={rosterDraft.name}
                onChange={(e) => setRosterDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addOrUpdatePlayer()}
              />
              <select
                value={rosterDraft.role}
                onChange={(e) =>
                  setRosterDraft((d) => ({
                    ...d,
                    role: e.target.value as RosterDraft['role'],
                  }))
                }
                aria-label="Role"
              >
                <option value="">Role</option>
                {PLAYER_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select
                value={rosterDraft.startingPosition}
                onChange={(e) =>
                  setRosterDraft((d) => ({
                    ...d,
                    startingPosition: e.target.value
                      ? (Number(e.target.value) as CourtPosition)
                      : '',
                  }))
                }
                aria-label="Starting position"
              >
                <option value="">Start P</option>
                {COURT_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
              <button type="button" className="primary" onClick={addOrUpdatePlayer}>
                {editPlayerId ? 'Save' : 'Add'}
              </button>
              {editPlayerId && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setEditPlayerId(null)
                    setRosterDraft(emptyDraft())
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            <ul className="roster-list">
              {session.roster.length === 0 && (
                <li className="muted">
                  Add players (Setter / Outside / Opposite / Middle) + starting P1–P6.
                </li>
              )}
              {session.roster.map((player) => {
                const active = player.id === session.currentPlayerId
                const pos = positionOf(session.match.positions, player.id)
                return (
                  <li key={player.id} className={active ? 'active' : undefined}>
                    <button
                      type="button"
                      className="player-pick"
                      onClick={() =>
                        updateSession((s) => ({ ...s, currentPlayerId: player.id }))
                      }
                    >
                      <span>{player.name}</span>
                      {player.role && (
                        <span className="meta-chip">{roleLabel(player.role)}</span>
                      )}
                      {pos && <span className="meta-chip">P{pos}</span>}
                      {active && <span className="badge">current</span>}
                    </button>
                    <div className="row-actions">
                      <button type="button" className="ghost" onClick={() => startEditPlayer(player)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => removePlayer(player.id)}
                      >
                        Del
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="panel entry">
            <h2>{editingId ? 'Edit event' : 'Scout grid'}</h2>
            {!editingId && (
              <ScoutGrid
                grid={candidateGrid}
                focus={gridActive ? gridFocus : null}
                onFocusChange={(f) => {
                  setGridActive(true)
                  setGridFocus(f)
                }}
                onLog={onGridLog}
              />
            )}
            <p className="current-line">
              Player:{' '}
              <strong>{playerLabel(currentPlayer, 'select a player')}</strong>
              {' · '}t = <strong>{formatTime(currentTime)}</strong>
            </p>
            <label>
              Action
              <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
                {ACTION_OUTCOME_GRID.actions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Outcome
              <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}>
                {outcomes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {o.note ? ` (${o.note})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="entry-actions">
              <button
                type="button"
                className="primary wide"
                disabled={
                  actionId === 'opponent_error' ? !outcomeId : !session.currentPlayerId
                }
                onClick={markEvent}
              >
                {editingId ? 'Update event' : 'Mark at playhead'}
              </button>
              {editingId && (
                <button type="button" className="ghost" onClick={() => setEditingId(null)}>
                  Cancel edit
                </button>
              )}
            </div>
          </section>

          <section className="panel log">
            <h2>Verified event log ({sortedEvents.length})</h2>
            <ul className="event-list">
              {sortedEvents.length === 0 && (
                <li className="muted">No events yet — scrub and mark touches.</li>
              )}
              {sortedEvents.map((event) => {
                const player = resolveEventPlayer(event.playerId, session.roster)
                return (
                  <li key={event.id} className={editingId === event.id ? 'editing' : undefined}>
                    <button
                      type="button"
                      className="event-main"
                      onClick={() => {
                        const v = videoRef.current
                        if (v) v.currentTime = event.t
                      }}
                    >
                      <span className="t">{formatTime(event.t)}</span>
                      <span className="who">{playerLabel(player)}</span>
                      <span className="what">
                        {labelForAction(event.action)} →{' '}
                        {labelForOutcome(event.action, event.outcome)}
                      </span>
                      <span className="src">{event.source}</span>
                    </button>
                    <div className="row-actions">
                      <button type="button" className="ghost" onClick={() => loadEventForEdit(event)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => deleteEvent(event.id)}
                      >
                        Del
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  )
}

function roleLabel(role: PlayerRole): string {
  return PLAYER_ROLES.find((r) => r.id === role)?.label ?? role
}

function roleShort(role: PlayerRole | undefined): string {
  if (!role) return ''
  if (role === 'setter') return 'S'
  if (role === 'outside') return 'OH'
  if (role === 'opposite') return 'OPP'
  return 'MB'
}

function CourtDiagram({
  session,
  pulseKey,
  onPick,
}: {
  session: MatchSession
  pulseKey: number
  onPick: (playerId: string) => void
}) {
  const weServe = session.match.servingTeam === 'us'
  return (
    <div className="court-wrap" aria-label="Our side court positions P1–P6">
      <div className="court-banner">
        <span>Our side</span>
        <span className={weServe ? 'serve-pill on' : 'serve-pill'}>
          {weServe ? 'We serve · P1' : 'They serve'}
        </span>
      </div>
      <div className="court" data-pulse={pulseKey}>
        <svg className="court-lines" viewBox="0 0 300 220" aria-hidden>
          <rect x="8" y="8" width="284" height="204" rx="4" className="court-outline" />
          <line x1="8" y1="18" x2="292" y2="18" className="court-net-line" />
          <text x="150" y="14" textAnchor="middle" className="court-svg-label">
            Net
          </text>
          {/* Attack line between front and back */}
          <line x1="8" y1="112" x2="292" y2="112" className="court-attack-line" />
          <text x="16" y="106" className="court-svg-label muted-svg">
            Attack line
          </text>
          <text x="16" y="40" className="court-svg-label muted-svg">
            Front
          </text>
          <text x="16" y="200" className="court-svg-label muted-svg">
            Back
          </text>
        </svg>
        <div className="court-slots">
          <div className="court-row front" aria-label="Front row P4 P3 P2">
            {([4, 3, 2] as CourtPosition[]).map((pos) => (
              <CourtSlot
                key={`${pos}-${pulseKey}`}
                pos={pos}
                row="front"
                session={session}
                onPick={onPick}
              />
            ))}
          </div>
          <div className="court-row back" aria-label="Back row P5 P6 P1">
            {([5, 6, 1] as CourtPosition[]).map((pos) => (
              <CourtSlot
                key={`${pos}-${pulseKey}`}
                pos={pos}
                row="back"
                session={session}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="court-legend">
        <span>
          <i className="leg front" /> Front P2–P4
        </span>
        <span>
          <i className="leg back" /> Back P5–P6–P1
        </span>
        <span>
          <i className="leg server" /> Server
        </span>
      </div>
    </div>
  )
}

function CourtSlot({
  pos,
  row,
  session,
  onPick,
}: {
  pos: CourtPosition
  row: 'front' | 'back'
  session: MatchSession
  onPick: (playerId: string) => void
}) {
  const playerId = playerAt(session.match.positions, pos)
  const player = session.roster.find((p) => p.id === playerId)
  const isServer = session.match.servingTeam === 'us' && pos === 1
  return (
    <button
      type="button"
      className={[
        'court-slot',
        row,
        isServer ? 'server' : '',
        playerId === session.currentPlayerId ? 'active' : '',
        playerId ? '' : 'empty',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => playerId && onPick(playerId)}
      disabled={!playerId}
      title={player ? `${playerLabel(player)}${player.role ? ` · ${roleLabel(player.role)}` : ''}` : `P${pos} empty`}
    >
      <span className="slot-top">
        <span className="slot-pos">P{pos}</span>
        {isServer && <span className="server-tag">Serve</span>}
        {player?.role && <span className="slot-role">{roleShort(player.role)}</span>}
      </span>
      <span className="slot-body">
        <span className="slot-name">{player ? player.name : '—'}</span>
      </span>
    </button>
  )
}

/** Keep live positions in sync when editing a player's starting slot. */
function mergeStartingIntoPositions(
  positions: MatchSession['match']['positions'],
  roster: RosterPlayer[],
  editedId: string,
): MatchSession['match']['positions'] {
  const edited = roster.find((p) => p.id === editedId)
  if (!edited?.startingPosition) return positions
  const next = { ...positions }
  for (const pos of COURT_POSITIONS) {
    if (next[pos] === editedId) delete next[pos]
  }
  next[edited.startingPosition] = editedId
  return next
}
