import scene from '../data/scene-canvas.json'
import { heroes, type Point, type UnitId } from './rules'

const { combatFeel, heroPackEntry, unitDeath } = scene
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const portal = heroes.Hero3_Portal.native

export const portalSprites = portal.spawnerAliveAnimationSprites.map(sprite => `chapter-2-3/${sprite.pathId}-${sprite.name}.png`)

export function portalIdleSprite(age: number) {
  return portalSprites[Math.floor(age * portal.spawnerAliveAnimationFps) % portalSprites.length]
}

export function portalCastScale(age: number) {
  const progress = clamp(age / portal.spawnerCastPopDuration)
  const peak = portal.spawnerCastPopScale
  if (progress < .3) return 1 + (peak - 1) * progress / .3
  const back = (progress - .3) / .7 - 1
  const easeOutBack = clamp(1 + 2.70158 * back ** 3 + 1.70158 * back ** 2)
  return peak + (1 - peak) * easeOutBack
}

export function portalExpireScale(age: number) {
  const progress = clamp(age / portal.spawnerExpireDuration)
  const peak = portal.spawnerCastPopScale
  if (progress < .2) return 1 + (peak - 1) * progress / .2
  return peak * (1 - ((progress - .2) / .8) ** 2)
}

export type Lunge = { origin: Point; direction: Point; at: number }

export type HeroEntry = { origin: Point; target: Point; fromReveal: boolean }
export const heroEntryDuration = heroPackEntry.travelDuration + heroPackEntry.landingDuration

export function heroEntryPose(entry: HeroEntry, age: number) {
  const { travelDuration, landingDuration, landingScale } = heroPackEntry
  if (age >= travelDuration) {
    const landing = clamp((age - travelDuration) / landingDuration)
    return { ...entry.target, scale: 1 + landingScale * Math.sin(landing * Math.PI) }
  }
  const progress = clamp(age / travelDuration)
  const back = progress - 1
  const travel = entry.fromReveal ? 1 - (1 - progress) ** 3 : progress
  return {
    x: entry.origin.x + (entry.target.x - entry.origin.x) * travel,
    y: entry.origin.y + (entry.target.y - entry.origin.y) * travel,
    scale: entry.fromReveal ? 1 : progress * (1 - back + 2.70158 * back ** 2)
  }
}

export type FallenUnit = Point & {
  uid: number
  id: UnitId
  flip: boolean
  giant: boolean
  at: number
  direction: Point
  kind: keyof typeof unitDeath
  hasHitSprite: boolean
}

export function unitDirection(from: Point, to: Point, minimum: number) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return length > minimum ? { x: dx / length, y: dy / length } : { x: 0, y: 1 }
}

export function lungeOffset(age: number) {
  const out = clamp(age / combatFeel.lungeOutDuration)
  const back = clamp((age - combatFeel.lungeOutDuration) / combatFeel.lungeReturnDuration)
  return combatFeel.lungeDistance * (out - back)
}

export function fallenLifetime(unit: FallenUnit) {
  const { hitDuration, flyDuration, holdDuration, fadeDuration } = unitDeath[unit.kind]
  return (unit.hasHitSprite ? hitDuration : 0) + flyDuration + holdDuration + fadeDuration
}

export function fallenUnitPose(unit: FallenUnit, age: number, rotation: number, motion: boolean) {
  const config = unitDeath[unit.kind]
  const hitDuration = unit.hasHitSprite ? config.hitDuration : 0
  const hit = hitDuration > 0 ? clamp(age / hitDuration) : 0
  const fly = 1 - (1 - clamp((age - hitDuration) / config.flyDuration)) ** 2
  const fade = clamp((age - hitDuration - config.flyDuration - config.holdDuration) / config.fadeDuration)
  const travel = motion ? config.hitDistance * hit ** 3 + config.flyDistance * fly : 0
  return {
    x: unit.x + unit.direction.x * travel,
    y: unit.y + unit.direction.y * travel,
    frame: age < hitDuration ? 2 : 3,
    alpha: age < hitDuration ? 1 : config.alpha * (1 - fade),
    turn: motion ? rotation * config.rotationDegrees * Math.PI / 180 * fly : 0
  }
}
