import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ACTION_OUTCOME_GRID } from './data/grid'
import {
  cancelCut,
  getCut,
  getHealth,
  loadMatch,
  saveMatch,
  startCut,
  uploadVideo,
  videoKeyFor,
  videoOnServer,
  type CutJobView,
  type Health,
} from './api'
import { formatTime, playerLabel, resolveEventPlayer } from './format'
import { MatchSetup, type CopyState } from './MatchSetup'
import {
  mergeAiRallies,
  nextRallyAfter,
  rallyAt,
  joinWithNext,
  rallyDecided,
  rallyFor,
  removeRally,
  setRallyEnd,
  setRallyStart,
  spanCovered,
  splitRally,
} from './rallies'
import { RallyTimeline } from './RallyTimeline'
import {
  applyPossessionChange,
  playerAt,
  positionOf,
  positionsFromRoster,
  isSetOver,
  pointWinner,
  possessionAfterEvent,
  rotateClockwise,
} from './rotation'
import { defaultSession, emptyMatchFields } from './defaultRoster'
import { ScoutGrid, type GridPick } from './ScoutGrid'
import {
  exportSessionJson,
  loadSession,
  newId,
  parseImportedSession,
  saveSession,
} from './storage'
import { defaultPlayer, describeEvent, gridPlayers, lastBallEvent, nextSituation, type Situation } from './flow'
import type {
  CourtPosition,
  CutState,
  MatchSession,
  PlayerRole,
  Rally,
  RosterPlayer,
  ScoutEvent,
  Span,
} from './types'
import {
  COURT_POSITIONS,
  isOpponentPlayerId,
  OPPONENT_PLAYER_ID,
  PLAYER_ROLES,
  RALLY_POINT_ACTION,
  SUBSTITUTION_ACTION,
  TEAM_PLAYER_ID,
} from './types'
import './App.css'

type UndoSnapshot = {
  events: ScoutEvent[]
  match: MatchSession['match']
  currentPlayerId: string | null
  sets: MatchSession['sets']
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
  /** Bumps on rotate so court slots re-animate. */
  const [courtPulse, setCourtPulse] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const undoStackRef = useRef<UndoSnapshot[]>([])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [health, setHealth] = useState<Health | null>(null)
  const [copy, setCopy] = useState<CopyState>({ status: 'none' })
  /** Setup panel (mark match + cut). Opens by itself until a cut has been started. */
  const [setupOpen, setSetupOpen] = useState(() => session.cut == null)
  /** A rally that ended without a point winner; playback paused on it. */
  const [unfinished, setUnfinished] = useState<Rally | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Dead time you clicked into on purpose; skipping leaves it alone. */
  const gapHoldRef = useRef<Span | null>(null)
  const lastRallyIdRef = useRef<string | null>(null)
  const unfinishedShownRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void getHealth().then(setHealth)
  }, [])

  // Every change is written to matches/<videoKey>.json (browser storage stays as a crash backup).
  useEffect(() => {
    const key = session.videoKey
    if (!key) return
    const timer = setTimeout(() => {
      saveMatch(key, session).then(
        () => setSaveError(null),
        (error: unknown) => setSaveError(error instanceof Error ? error.message : 'Save failed'),
      )
    }, 700)
    return () => clearTimeout(timer)
  }, [session])

  const applyJob = useCallback((job: CutJobView) => {
    setSession((s) => {
      if (s.cut?.jobId !== job.id) return s
      const cut: CutState = {
        jobId: job.id,
        status: job.status,
        model: job.model,
        chunksTotal: job.chunksTotal,
        chunksDone: job.chunksDone,
        covered: job.covered,
        warnings: job.warnings,
        error: job.error,
      }
      return { ...s, cut, rallies: mergeAiRallies(s.rallies, job.rallies, s.dismissedAi) }
    })
  }, [])

  // Poll the cut job while it runs; rallies stream onto the timeline.
  const cutJobId = session.cut?.status === 'running' ? session.cut.jobId : null
  useEffect(() => {
    if (!cutJobId) return
    let stopped = false
    const poll = async () => {
      try {
        const job = await getCut(cutJobId)
        if (!stopped) applyJob(job)
        if (!stopped && job.status === 'running') timer = setTimeout(poll, 2000)
      } catch (error) {
        if (stopped) return
        setSession((s) =>
          s.cut?.jobId === cutJobId
            ? {
                ...s,
                cut: {
                  ...s.cut,
                  status: 'failed',
                  error: `${error instanceof Error ? error.message : 'Lost the cut job'}. Rallies found so far are kept; cut again to finish.`,
                },
              }
            : s,
        )
      }
    }
    let timer = setTimeout(poll, 500)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [cutJobId, applyJob])

  async function onCutRallies() {
    const s = sessionRef.current
    const { start, end } = s.matchWindow
    if (!s.videoKey || start == null || end == null) return
    try {
      if (s.cut?.status === 'running') await cancelCut(s.cut.jobId)
      const job = await startCut(s.videoKey, { start, end })
      setSession((prev) => ({
        ...prev,
        // A fresh cut replaces the AI's rallies; yours stay.
        rallies: prev.rallies.filter((r) => r.source === 'human'),
        cut: {
          jobId: job.id,
          status: job.status,
          model: job.model,
          chunksTotal: job.chunksTotal,
          chunksDone: 0,
          covered: [],
          warnings: [],
        },
      }))
      setSetupOpen(false)
      const v = videoRef.current
      // First cut: scouting starts at the first serve. A re-cut keeps your place.
      if (v && (s.cut == null || v.currentTime < start || v.currentTime >= end)) v.currentTime = start
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not start the cut')
    }
  }

  function markWindow(edge: 'start' | 'end') {
    const t = videoRef.current?.currentTime
    if (t == null) return
    updateSession((s) => {
      const next = { ...s.matchWindow, [edge]: Math.round(t * 10) / 10 }
      if (next.start != null && next.end != null && next.end <= next.start) {
        if (edge === 'start') next.end = null
        else next.start = null
      }
      return { ...s, matchWindow: next }
    })
  }

  function editRallies(edit: (rallies: Rally[], t: number, bounds: Span) => Rally[]) {
    const v = videoRef.current
    if (!v) return
    const s = sessionRef.current
    const bounds = { start: s.matchWindow.start ?? 0, end: s.matchWindow.end ?? (v.duration || 0) }
    updateSession((prev) => ({ ...prev, rallies: edit(prev.rallies, v.currentTime, bounds) }))
  }

  function dropRallyHere() {
    const t = videoRef.current?.currentTime
    if (t == null) return
    updateSession((prev) => {
      const { rallies, dismissed } = removeRally(prev.rallies, t)
      return { ...prev, rallies, dismissedAi: dismissed ? [...prev.dismissedAi, dismissed] : prev.dismissedAi }
    })
  }

  function seekFromTimeline(t: number, inGap: boolean) {
    const v = videoRef.current
    if (!v) return
    const s = sessionRef.current
    if (inGap) {
      const prev = [...s.rallies].filter((r) => r.end <= t).sort((a, b) => b.end - a.end)[0]
      const next = nextRallyAfter(s.rallies, t)
      gapHoldRef.current = { start: prev?.end ?? 0, end: next?.start ?? (v.duration || t) }
    } else {
      gapHoldRef.current = null
    }
    v.currentTime = t
  }

  // Skip dead time while playing, and stop on a rally that ended without a point winner.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const v = videoRef.current
      const s = sessionRef.current
      if (!v || v.paused || v.seeking || !s.cut) return
      const t = v.currentTime
      const ws = s.matchWindow.start ?? 0
      const we = s.matchWindow.end ?? v.duration
      const hold = gapHoldRef.current
      const holding = hold != null && t >= hold.start - 0.5 && t <= hold.end + 0.5

      const rally = rallyAt(s.rallies, t)
      if (rally) {
        lastRallyIdRef.current = rally.id
        gapHoldRef.current = null
        return
      }
      const left = lastRallyIdRef.current ? s.rallies.find((r) => r.id === lastRallyIdRef.current) : null
      lastRallyIdRef.current = null
      if (left && t >= left.end && !rallyDecided(left, s.events, s.rallies) && !unfinishedShownRef.current.has(left.id)) {
        unfinishedShownRef.current.add(left.id)
        v.pause()
        setUnfinished(left)
        return
      }
      if (!s.skipDeadTime || holding) return
      if (t >= we - 0.05) {
        v.pause()
        return
      }
      if (t < ws - 0.25) {
        v.currentTime = ws
        return
      }
      const next = nextRallyAfter(s.rallies, t)
      const target = next ? next.start : we
      if (target - t > 0.4 && spanCovered(s.cut.covered, t, target)) {
        if (next) v.currentTime = next.start
        else {
          v.pause()
          v.currentTime = we
        }
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  // Clear the "no point winner" banner as soon as the rally is decided.
  useEffect(() => {
    if (unfinished && rallyDecided(unfinished, session.events, session.rallies)) setUnfinished(null)
  }, [unfinished, session.events, session.rallies])
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

  // Situation follows the rally (last ball entry + score state); a manual switch
  // holds only until the next entry.
  const ballLast = useMemo(() => lastBallEvent(session.events), [session.events])
  const flowSituation = useMemo(() => nextSituation(ballLast, session.match), [ballLast, session.match])
  const [situationOverride, setSituationOverride] = useState<{ situation: Situation; after: string | null } | null>(null)
  const situation =
    situationOverride && situationOverride.after === (ballLast?.id ?? null) ? situationOverride.situation : flowSituation
  const courtPlayers = useMemo(() => gridPlayers(session.roster, session.match), [session.roster, session.match])
  const likelyPlayer = useMemo(
    () => defaultPlayer(situation, ballLast, session.roster, session.match),
    [situation, ballLast, session.roster, session.match],
  )
  /** Set that just ended; the dialog asks who serves and which lineup starts the next. */
  const [setEnd, setSetEnd] = useState<{ set: number; us: number; them: number } | null>(null)
  const currentSet = session.sets.length + 1

  function onPickVideo(file: File | undefined) {
    if (!file) return
    if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    void openMatch(videoKeyFor(file), file.name, URL.createObjectURL(file), file)
  }

  // ?match=<key> reopens a match whose video the local server already has.
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('match')
    if (key && /^[\w.-]{1,160}$/.test(key)) {
      void openMatch(key, sessionRef.current.videoKey === key ? (sessionRef.current.videoName ?? key) : key, `/api/video/${key}/file`, null)
    }
    // Run once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openMatch(key: string, name: string, url: string, file: File | null) {
    setVideoUrl(url)
    setUnfinished(null)
    unfinishedShownRef.current = new Set()
    gapHoldRef.current = null

    // Same file again → continue that match. New file → new match with the same roster.
    let saved: unknown = null
    try {
      saved = await loadMatch(key)
    } catch {
      saved = null
    }
    const current = sessionRef.current
    if (current.videoKey === key) {
      // Already on this match (page reload): keep what is in memory.
    } else if (saved) {
      try {
        const next = parseImportedSession(JSON.stringify(saved))
        setSession({ ...next, videoName: file?.name ?? next.videoName ?? name, videoKey: key })
        setSetupOpen(next.cut == null)
      } catch {
        saved = null
      }
    }
    if (current.videoKey !== key && !saved) {
      setSession({
        ...current,
        ...emptyMatchFields(),
        videoName: name,
        videoKey: key,
        events: [],
        match: { ...current.match, positions: positionsFromRoster(current.roster), scoreUs: 0, scoreThem: 0, servingTeam: 'us' },
      })
      setSetupOpen(true)
    }
    undoStackRef.current = []
    setEditingId(null)

    // The cutter needs the file on disk; copy it to the local server once (same machine).
    setCopy({ status: 'checking' })
    try {
      if (!(await videoOnServer(key))) {
        if (!file) throw new Error('the local server has no copy of this video; open the file instead')
        setCopy({ status: 'copying', progress: 0 })
        await uploadVideo(key, file, (progress) => setCopy({ status: 'copying', progress }))
      }
      setCopy({ status: 'ready' })
    } catch (error) {
      setCopy({ status: 'error', message: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  /** P / O: the point went to us / them, when the deciding touch is not one you track. */
  function logPoint(winner: 'us' | 'them') {
    logEvent({ playerId: TEAM_PLAYER_ID, action: RALLY_POINT_ACTION, outcome: winner, t: videoRef.current?.currentTime ?? currentTime })
  }

  function seekBy(delta: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      setUnfinished(null)
      void v.play()
    } else v.pause()
  }

  // Match + rally keys. Kept apart from the scout grid keys, which own arrows/Enter/Tab.
  const setupOpenRef = useRef(setupOpen)
  setupOpenRef.current = setupOpen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (setupOpenRef.current && (key === 's' || key === 'e')) {
        e.preventDefault()
        markWindow(key === 's' ? 'start' : 'end')
        return
      }
      const actions: Record<string, () => void> = {
        '[': () => editRallies(setRallyStart),
        ']': () => editRallies((rallies, t) => setRallyEnd(rallies, t)),
        k: () => editRallies((rallies, t) => splitRally(rallies, t)),
        j: () => editRallies((rallies, t) => joinWithNext(rallies, t)),
        x: dropRallyHere,
        g: () => updateSession((s) => ({ ...s, skipDeadTime: !s.skipDeadTime })),
        p: () => logPoint('us'),
        o: () => logPoint('them'),
      }
      const run = actions[key]
      if (run) {
        e.preventDefault()
        run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Handlers read live state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function pushUndoSnapshot() {
    const s = sessionRef.current
    undoStackRef.current.push({
      events: s.events,
      match: s.match,
      currentPlayerId: s.currentPlayerId,
      sets: s.sets,
    })
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
  }

  /**
   * The one way entries are logged (grid, P/O, mark form). Applies score and
   * rotation, warns before a second deciding entry in one rally, and opens the
   * set-end dialog when the set is won.
   */
  function logEvent(entry: { playerId: string; action: string; outcome: string; detail?: string; t: number }): boolean {
    if (editingId) return false
    const s = sessionRef.current
    const winner = pointWinner(entry.action, entry.outcome, entry.detail)
    if (winner !== null) {
      const rally = rallyFor(s.rallies, entry.t)
      if (
        rally &&
        rallyDecided(rally, s.events, s.rallies) &&
        !confirm('This rally already has an entry that decided the point. Log another one anyway? The score would count twice.')
      ) {
        return false
      }
    }
    const event: ScoutEvent = {
      id: newId('ev'),
      playerId: entry.playerId,
      action: entry.action,
      outcome: entry.outcome,
      ...(entry.detail ? { detail: entry.detail } : {}),
      t: entry.t,
      source: 'human',
      status: 'accepted',
      set: s.sets.length + 1,
    }
    const match = applyPossessionChange(s.match, possessionAfterEvent(entry.action, entry.outcome, s.match.servingTeam, entry.detail))
    pushUndoSnapshot()
    const isPlayer = s.roster.some((p) => p.id === entry.playerId)
    setSession({
      ...s,
      currentPlayerId: isPlayer ? entry.playerId : s.currentPlayerId,
      match,
      events: [...s.events, event].sort((a, b) => a.t - b.t),
    })
    setSituationOverride(null)
    if (winner === 'us' || winner === 'them') {
      const setNumber = s.sets.length + 1
      if (isSetOver(match, setNumber)) setSetEnd({ set: setNumber, us: match.scoreUs, them: match.scoreThem })
    }
    return true
  }

  function onGridPick(pick: GridPick) {
    const playerId =
      pick.row.kind === 'opponent' ? OPPONENT_PLAYER_ID : pick.row.kind === 'team' ? TEAM_PLAYER_ID : pick.row.id
    const outcome = pick.step?.outcome ?? pick.choice.outcome
    if (!outcome) return
    logEvent({ playerId, action: pick.choice.action, outcome, detail: pick.step?.detail, t: pick.t })
  }

  /** Close the finished set: store its score, reset to 0–0, set server and lineup for the next one. */
  function startNextSet(serving: 'us' | 'them', lineup: 'starting' | 'current') {
    if (!setEnd) return
    pushUndoSnapshot()
    updateSession((s) => ({
      ...s,
      sets: [...s.sets, { us: setEnd.us, them: setEnd.them }],
      match: {
        ...s.match,
        scoreUs: 0,
        scoreThem: 0,
        servingTeam: serving,
        positions: lineup === 'starting' ? positionsFromRoster(s.roster) : s.match.positions,
      },
    }))
    setSetEnd(null)
  }

  /** Bench player `inId` replaces `outId` in the same court position. */
  function substitute(inId: string, outId: string) {
    const s = sessionRef.current
    const pos = positionOf(s.match.positions, outId)
    if (!pos) return
    pushUndoSnapshot()
    const event: ScoutEvent = {
      id: newId('ev'),
      playerId: inId,
      action: SUBSTITUTION_ACTION,
      outcome: outId,
      t: videoRef.current?.currentTime ?? currentTime,
      source: 'human',
      status: 'accepted',
      set: s.sets.length + 1,
    }
    setSession({
      ...s,
      match: { ...s.match, positions: { ...s.match.positions, [pos]: inId } },
      events: [...s.events, event].sort((a, b) => a.t - b.t),
    })
  }

  function undoLastEvent() {
    const snap = undoStackRef.current.pop()
    if (snap) {
      updateSession((s) => ({
        ...s,
        events: snap.events,
        match: snap.match,
        currentPlayerId: snap.currentPlayerId,
        sets: snap.sets,
      }))
      setEditingId(null)
      setSetEnd(null)
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

  function markEvent() {
    const isOppErr = actionId === 'opponent_error'
    const playerId = isOppErr ? OPPONENT_PLAYER_ID : actionId === 'team' ? TEAM_PLAYER_ID : session.currentPlayerId
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
    logEvent({ playerId, action: actionId, outcome: outcomeId, t })
  }

  function loadEventForEdit(event: ScoutEvent) {
    setEditingId(event.id)
    setActionId(event.action)
    setOutcomeId(event.outcome)
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
    // Keep the loaded video, its match window and rallies; only roster and stats reset.
    const s = sessionRef.current
    const next: MatchSession = {
      ...defaultSession(),
      videoName: s.videoName,
      videoKey: s.videoKey,
      matchWindow: s.matchWindow,
      rallies: s.rallies,
      dismissedAi: s.dismissedAi,
      cut: s.cut,
      skipDeadTime: s.skipDeadTime,
    }
    saveSession(next)
    setSession(next)
    undoStackRef.current = []
    setEditingId(null)
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
                <strong>Open a match video</strong>
                <span>The file stays on this PC. Only a small copy of the match window goes to the AI for cutting.</span>
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
          {session.cut && !setupOpen && (
            <RallyTimeline
              duration={duration}
              window={session.matchWindow}
              rallies={session.rallies}
              events={session.events}
              covered={session.cut.covered}
              currentTime={currentTime}
              onSeek={seekFromTimeline}
            />
          )}
          {unfinished && (
            <div className="banner warn" role="alert">
              <strong>This rally has no point winner yet.</strong> Log the deciding touch, or press{' '}
              <kbd>P</kbd> point us / <kbd>O</kbd> point them. <kbd>Space</kbd> plays on anyway.
            </div>
          )}
          {session.cut && !setupOpen && (
            <CutStatus
              cut={session.cut}
              rallies={session.rallies.length}
              skip={session.skipDeadTime}
              saveError={saveError}
              onToggleSkip={() => updateSession((s) => ({ ...s, skipDeadTime: !s.skipDeadTime }))}
              onCancel={() => session.cut && void cancelCut(session.cut.jobId)}
              onOpenSetup={() => setSetupOpen(true)}
            />
          )}
          {setupOpen && (
            <MatchSetup
              window={session.matchWindow}
              duration={duration}
              health={health}
              copy={copy}
              cut={session.cut}
              hasVideo={Boolean(videoUrl)}
              onMark={markWindow}
              onClear={(edge) => updateSession((s) => ({ ...s, matchWindow: { ...s.matchWindow, [edge]: null } }))}
              onSeek={(t) => {
                const v = videoRef.current
                if (v) v.currentTime = t
              }}
              onCut={() => void onCutRallies()}
              onDone={() => setSetupOpen(false)}
            />
          )}
          <p className="hint">
            {setupOpen
              ? 'Setup: S match start · E match end · Space play/pause · Seek B/N ±5s · V/M ±1min'
              : 'Grid: ←→↑↓ · Enter log · Tab primary · Esc clear · Backspace/U undo · Space play/pause · Seek B/N ±5s · V/M ±1min · Rallies: [ start here · ] end here · K split · X not a rally · G skip dead time · P point us · O point them'}
          </p>

          <section className="panel match-panel">
            <div className="match-head">
              <h2>
                Set {currentSet}
                {session.sets.length > 0 && (
                  <span className="set-scores">
                    {session.sets.map((x, i) => (
                      <span key={i} className={x.us > x.them ? 'won' : 'lost'}>
                        {x.us}–{x.them}
                      </span>
                    ))}
                  </span>
                )}
              </h2>
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
                      {!pos && courtPlayers.length > 0 && (
                        <select
                          className="sub-select"
                          aria-label={`Sub ${player.name} in for`}
                          value=""
                          onChange={(e) => e.target.value && substitute(player.id, e.target.value)}
                        >
                          <option value="">Sub in for…</option>
                          {courtPlayers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (P{positionOf(session.match.positions, p.id)})
                            </option>
                          ))}
                        </select>
                      )}
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
                situation={situation}
                players={courtPlayers}
                playerMeta={(p) => {
                  const pos = positionOf(session.match.positions, p.id)
                  return [pos ? `P${pos}` : '', roleShort(p.role)].filter(Boolean).join(' · ')
                }}
                defaultPlayerId={likelyPlayer}
                active={!setEnd}
                getTime={() => videoRef.current?.currentTime ?? currentTime}
                onSituationChange={(next) => setSituationOverride({ situation: next, after: ballLast?.id ?? null })}
                onPick={onGridPick}
              />
            )}
            {setEnd && (
              <SetEndDialog
                setEnd={setEnd}
                deciding={setEnd.set >= 3}
                onNext={startNextSet}
                onUndo={undoLastEvent}
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
                        {event.action === SUBSTITUTION_ACTION
                          ? `Sub, for ${playerLabel(resolveEventPlayer(event.outcome, session.roster))}`
                          : describeEvent(event)}
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

function SetEndDialog({
  setEnd,
  deciding,
  onNext,
  onUndo,
}: {
  setEnd: { set: number; us: number; them: number }
  deciding: boolean
  onNext: (serving: 'us' | 'them', lineup: 'starting' | 'current') => void
  onUndo: () => void
}) {
  const [serving, setServing] = useState<'us' | 'them'>('us')
  const [lineup, setLineup] = useState<'starting' | 'current'>('starting')
  const won = setEnd.us > setEnd.them
  return (
    <div className="banner set-end" role="dialog" aria-label={`Set ${setEnd.set} finished`}>
      <strong>
        Set {setEnd.set} {won ? 'won' : 'lost'} {setEnd.us}–{setEnd.them}.
      </strong>
      {deciding ? (
        <p>That was the deciding set. The match is over; the score is stored with the match.</p>
      ) : (
        <>
          <p>Set {setEnd.set + 1}: who serves first, and which lineup starts?</p>
          <div className="set-end-choices">
            <span>
              <button type="button" className={serving === 'us' ? 'primary' : 'ghost'} onClick={() => setServing('us')}>
                We serve
              </button>
              <button type="button" className={serving === 'them' ? 'primary' : 'ghost'} onClick={() => setServing('them')}>
                They serve
              </button>
            </span>
            <span>
              <button type="button" className={lineup === 'starting' ? 'primary' : 'ghost'} onClick={() => setLineup('starting')}>
                Starting lineup (roster P1–P6)
              </button>
              <button type="button" className={lineup === 'current' ? 'primary' : 'ghost'} onClick={() => setLineup('current')}>
                Keep current rotation
              </button>
            </span>
          </div>
        </>
      )}
      <div className="set-end-choices">
        <button type="button" className="primary" onClick={() => onNext(serving, lineup)}>
          {deciding ? 'Store final set' : `Start set ${setEnd.set + 1}`}
        </button>
        <button type="button" className="ghost" onClick={onUndo}>
          Undo last point
        </button>
      </div>
    </div>
  )
}

function CutStatus({
  cut,
  rallies,
  skip,
  saveError,
  onToggleSkip,
  onCancel,
  onOpenSetup,
}: {
  cut: CutState
  rallies: number
  skip: boolean
  saveError: string | null
  onToggleSkip: () => void
  onCancel: () => void
  onOpenSetup: () => void
}) {
  const progress = cut.chunksTotal > 0 ? Math.round((cut.chunksDone / cut.chunksTotal) * 100) : 0
  return (
    <div className="cut-status">
      <span className={`cut-state ${cut.status}`}>
        {cut.status === 'running' && `Cutting… ${progress}% · ${rallies} rallies so far`}
        {cut.status === 'done' && `${rallies} rallies`}
        {cut.status === 'failed' && `Cut stopped: ${cut.error ?? 'unknown error'}`}
        {cut.status === 'cancelled' && `Cut cancelled · ${rallies} rallies`}
      </span>
      {cut.warnings.length > 0 && (
        <span className="muted" title={cut.warnings.join('\n')}>
          {cut.warnings.length} piece{cut.warnings.length === 1 ? '' : 's'} not analysed (played normally)
        </span>
      )}
      {saveError && <span className="cut-state failed">Not saved to matches/: {saveError}</span>}
      <span className="cut-actions">
        <button type="button" className={skip ? 'primary' : 'ghost'} onClick={onToggleSkip} title="G">
          Skip dead time: {skip ? 'on' : 'off'}
        </button>
        {cut.status === 'running' && (
          <button type="button" className="ghost" onClick={onCancel}>
            Stop cutting
          </button>
        )}
        <button type="button" className="ghost" onClick={onOpenSetup}>
          Match window…
        </button>
      </span>
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
