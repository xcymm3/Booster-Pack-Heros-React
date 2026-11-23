import scene from '../data/scene-canvas.json'
import type { Point } from './rules'
import { evaluateCurve } from './unity-curve'

const settings = scene.damageNumbers
export type DamageNumberMode = 'all' | 'big' | 'off'
export type DamageNumberKind = keyof typeof settings.colors
type Target = Point & { hp: number }
type Channel = 'dealt' | 'taken' | 'heal'

export type DamageNumber = {
  id: number
  anchor: Point
  target: Target | null
  channel: Channel
  amount: number
  strongest: number
  kind: DamageNumberKind
  critical: boolean
  born: number
  lastHit: number
  shown: number | null
  fall: number | null
  dropped: number | null
  activelyAggregating: boolean
  magnitude: number
  scale: number
}

export type DamageNumbers = {
  clock: number
  mode: DamageNumberMode
  entries: DamageNumber[]
  quests: { position: Point; at: number }[]
  typical: Partial<Record<Channel, number>>
  nextId: number
}

export function createDamageNumbers(mode: DamageNumberMode = 'all'): DamageNumbers {
  return { clock: 0, mode, entries: [], quests: [], typical: {}, nextId: 0 }
}

export function showQuestPopup(state: DamageNumbers, position: Point) {
  state.quests.push({ position: { x: position.x, y: position.y }, at: state.clock })
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const displayLog = (amount: number) => Math.log10(Math.max(1, amount * 10))
const sizeForMagnitude = (magnitude: number) => settings.sizeMin + (settings.sizeMax - settings.sizeMin) * magnitude

function endAggregation(state: DamageNumbers, number: DamageNumber) {
  if (!number.activelyAggregating) return
  number.activelyAggregating = false
  const log = displayLog(number.amount)
  const typical = state.typical[number.channel] ?? log
  state.typical[number.channel] = typical + settings.adaptRate * (log - typical)
}

function admit(state: DamageNumbers, number: DamageNumber) {
  if (number.shown !== null || (state.mode === 'big' && number.magnitude < settings.bigOnlyMinMagnitude)) return
  let count = 0
  let weakest: DamageNumber | undefined
  for (const displayed of state.entries) {
    if (displayed.shown === null || displayed.dropped !== null) continue
    count++
    if (!weakest || displayed.magnitude < weakest.magnitude) weakest = displayed
  }
  if (count >= settings.maxVisible && weakest) {
    if (number.magnitude <= weakest.magnitude) return
    weakest.dropped = state.clock
    endAggregation(state, weakest)
  }
  number.shown = state.clock
}

export function showDamageNumber(
  state: DamageNumbers, point: Point, amount: number, kind: DamageNumberKind, target: Target | null = null
) {
  if (amount <= 0 || state.mode === 'off') return
  const channel = kind === 'taken' || kind === 'heal' ? kind : 'dealt'
  state.typical[channel] ??= displayLog(amount)
  const previous = target && state.entries.find(number => number.target === target &&
    number.channel === channel && number.activelyAggregating)
  const number: DamageNumber = previous || {
    id: state.nextId++, anchor: { ...point }, target, channel, amount: 0, strongest: 0, kind,
    critical: false, born: state.clock, lastHit: state.clock, shown: null, fall: null, dropped: null,
    activelyAggregating: target !== null, magnitude: 0, scale: settings.sizeMin
  }
  number.amount += amount
  number.critical ||= kind === 'crit'
  number.lastHit = state.clock
  if (amount >= number.strongest) {
    number.strongest = amount
    number.kind = kind
  }
  number.magnitude = clamp((displayLog(number.amount) - state.typical[channel] + 1) / 2 +
    (number.critical ? settings.critMagnitudeBonus : 0))
  if (previous) admit(state, number)
  else {
    number.scale = sizeForMagnitude(number.magnitude)
    admit(state, number)
    state.entries.push(number)
  }
}

export function advanceDamageNumbers(state: DamageNumbers, dt: number) {
  state.clock += dt
  if (state.quests.length) state.quests = state.quests.filter(quest =>
    state.clock - quest.at < settings.riseDuration + settings.fallDuration)
  if (state.mode === 'off') {
    state.entries = []
    return
  }
  for (const number of state.entries) {
    if (number.target) {
      number.anchor.x = number.target.x
      number.anchor.y = number.target.y
      if (number.target.hp <= 0) {
        endAggregation(state, number)
        number.target = null
      }
    }
    if (state.clock - number.lastHit >= settings.window || state.clock - number.born >= settings.maxDuration) {
      endAggregation(state, number)
    }
    number.scale += (sizeForMagnitude(number.magnitude) - number.scale) * (1 - Math.exp(-12 * dt))
    if (number.shown !== null && number.fall === null && !number.activelyAggregating &&
        state.clock - number.shown >= settings.riseDuration) {
      number.fall = state.clock
    }
  }
  state.entries = state.entries.filter(number => {
    if (number.shown === null) return number.activelyAggregating
    const afterFall = number.fall !== null && state.clock - number.fall >= settings.fallDuration
    const afterDrop = number.dropped !== null && state.clock - number.dropped >= settings.dropFadeDuration
    return !afterFall && !afterDrop
  })
}

export function questPopupLook(age: number) {
  const rise = clamp(age / settings.riseDuration)
  const fall = clamp((age - settings.riseDuration) / settings.fallDuration)
  const scale = clamp(evaluateCurve(settings.riseScale, rise)) * (1 - clamp(evaluateCurve(settings.fallScale, fall)))
  const alpha = fall > 0 ? evaluateCurve(settings.fallAlpha, fall) : evaluateCurve(settings.riseAlpha, rise)
  return {
    alpha: clamp(alpha), scale: settings.fontSize * settings.questText.fontSizeMultiplier / settings.questText.sourcePixelsPerEm * scale,
    lift: settings.risePixels * rise - settings.fallPixels * fall
  }
}

export function damageNumberLook(number: DamageNumber, clock: number) {
  const rise = clamp((clock - (number.shown ?? clock)) / settings.riseDuration)
  const fall = number.fall === null ? 0 : clamp((clock - number.fall) / settings.fallDuration)
  const riseScale = clamp(evaluateCurve(settings.riseScale, rise))
  const fallScale = 1 - clamp(evaluateCurve(settings.fallScale, fall))
  const dropAlpha = number.dropped === null ? 1 : 1 - clamp((clock - number.dropped) / settings.dropFadeDuration)
  const alpha = dropAlpha * (fall > 0 ? evaluateCurve(settings.fallAlpha, fall) : evaluateCurve(settings.riseAlpha, rise))
  const punch = number.lastHit > number.born && rise >= 1
    ? settings.mergePunch * (1 - clamp((clock - number.lastHit) / settings.mergePunchDuration)) : 0
  const scale = number.scale * riseScale * fallScale * (1 + punch)
  const tint = clamp((number.magnitude - settings.colorRampStart) / (settings.colorRampEnd - settings.colorRampStart))
  const color = settings.colors[number.critical ? 'crit' : number.kind]
  const channels = settings.smallColor.map((base, index) => base + (color[index] - base) * tint)
  const scaled = Math.fround(Math.fround(number.amount) * 10)
  const floor = Math.floor(scaled)
  const rounded = scaled - floor === .5 ? floor + (floor % 2) : Math.round(scaled)
  return {
    text: String(rounded),
    color: 'rgb(' + channels.join(',') + ')',
    alpha: clamp(alpha),
    fontSize: settings.fontSize * scale * (number.critical ? settings.critFontMultiplier : 1),
    lift: settings.risePixels * rise - settings.fallPixels * fall
  }
}
