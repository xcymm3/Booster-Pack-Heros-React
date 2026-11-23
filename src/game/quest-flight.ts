import { world, type Point } from './rules'
import type { BattleQuestHud, BattleQuestRow } from './upgrades'

// SurviveHUD Quests RectTransform, GridLayoutGroup and QuestIcon prefab.
export const questPanel = { left: 16.44482421875 / 1920, bottom: 1 - 13.781982421875 / 1080,
  width: 320 / 1920, rowHeight: 32 / 1080, gap: 4 / 1080, collapsedRows: 3, flySize: 50 / 1080,
  flyAlpha: 0 } // QuestIcon Image in sharedassets1.assets:3364.
export const questFlightDuration = .42
const popRise = .11
const popFall = .09

type Flight = { id: number; row: BattleQuestRow; from: Point; to: Point; started: number; arrived?: number }
export type QuestMotion = {
  nextId: number
  flights: Flight[]
  waiting: Map<string, number>
  popped: Map<string, number>
}

export function createQuestMotion(): QuestMotion {
  return { nextId: 0, flights: [], waiting: new Map(), popped: new Map() }
}

export function queueQuestFlights(motion: QuestMotion, previous: BattleQuestHud, next: BattleQuestHud,
  position: Point, now: number, expanded: boolean) {
  const { left, bottom, width, rowHeight, gap, collapsedRows } = questPanel
  const visible = expanded ? next.rows : next.rows.slice(0, collapsedRows)
  const oldProgress = new Map(previous.rows.map(row => [row.cell.id, row.progress]))
  const from = { x: .5 + position.x / world.width, y: .5 - position.y / world.height }
  visible.forEach((row, index) => {
    const before = oldProgress.get(row.cell.id)
    if (before === undefined || row.progress <= before) return
    const to = { x: left + width / 2, y: bottom - rowHeight / 2 - (visible.length - index - 1) * (rowHeight + gap) }
    motion.flights.push({ id: motion.nextId++, row, from, to, started: now })
    if (!motion.waiting.has(row.cell.id)) motion.waiting.set(row.cell.id, before)
  })
}

export function advanceQuestFlights(motion: QuestMotion, hud: BattleQuestHud, now: number) {
  const active = new Set(hud.rows.map(row => row.cell.id))
  motion.flights = motion.flights.filter(flight => {
    if (now < flight.started + questFlightDuration) return true
    // The Unity coroutine yields once after putting the icon at its destination.
    flight.arrived ??= now
    if (now <= flight.arrived) return true
    const id = flight.row.cell.id
    motion.waiting.delete(id)
    if (active.has(id)) motion.popped.set(id, now)
    return false
  })
  for (const [id, time] of motion.popped) {
    if (!active.has(id) || now >= time + popRise + popFall) motion.popped.delete(id)
  }
}

function smoothStep(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

// SurviveHUD.QuestFlyRoutine uses unclipped Canvas positions and unscaled time.
export function questFlightPosition(flight: Flight, now: number) {
  const { from, to, started } = flight
  const t = smoothStep((now - started) / questFlightDuration)
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

export function questRowScale(elapsed: number) {
  return elapsed < popRise ? 1 + .14 * smoothStep(elapsed / popRise) :
    1.14 - .14 * smoothStep((elapsed - popRise) / popFall)
}
