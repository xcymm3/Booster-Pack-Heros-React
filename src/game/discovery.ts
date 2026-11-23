import { cardDiscovery, packPresentation, world, type Point } from './rules'
import { evaluateCurve } from './unity-curve'

// The four PackOpenTier values from RarityManager in level1:36464.
const tiers = [
  { buildUp: 1.9, hits: 3, shake: 1, whitePeak: .45, hold: 2, glowAlpha: .4, raysAlpha: .1, burstVolume: .7, musicDuck: .7 },
  { buildUp: 2, hits: 3, shake: 1.25, whitePeak: .65, hold: 2, glowAlpha: 1, raysAlpha: .2, burstVolume: .8, musicDuck: .55 },
  { buildUp: 2.1, hits: 3, shake: 1.6, whitePeak: .85, hold: 2, glowAlpha: 1, raysAlpha: .3, burstVolume: .9, musicDuck: .4 },
  { buildUp: 2.2, hits: 3, shake: 2, whitePeak: 1, hold: 2, glowAlpha: 1, raysAlpha: .4, burstVolume: 1, musicDuck: .25 }
]

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const lerp = (start: number, end: number, progress: number) => start + (end - start) * progress
const easeOut = (value: number) => 1 - (1 - clamp(value)) ** 3

export function discoveryTimeline(rarity: number, foil: boolean) {
  const base = tiers[Math.min(tiers.length - 1, Math.max(0, rarity))]
  const style = foil ? { ...base,
    buildUp: cardDiscovery.foilZoomInDuration, hits: cardDiscovery.foilDiscoveryHits,
    shake: cardDiscovery.foilPreludeShakeAmpMultiplier, whitePeak: 1,
    hold: cardDiscovery.foilRevealHoldDuration, glowAlpha: packPresentation.auraFoilGlowAlpha,
    raysAlpha: packPresentation.auraFoilDiscoveryRaysAlpha,
    burstVolume: 1, musicDuck: cardDiscovery.foilDiscoveryMusicDuck
  } : base
  const hits = Array.from({ length: style.hits }, (_, index) => (1 -
    (1 - index / Math.max(1, style.hits - 1)) ** packPresentation.discoveryHitAcceleration) *
    style.buildUp * packPresentation.discoveryHitLast)
  const cardAt = style.buildUp + cardDiscovery.discoveryFlashClearDuration
  return { ...style, hitTimes: hits, cardAt, continueAt: cardAt + cardDiscovery.discoveryPopDuration + style.hold }
}

export type DiscoveryTimeline = ReturnType<typeof discoveryTimeline>
export const discoveryExitDuration = cardDiscovery.discoveryOutroDuration + cardDiscovery.zoomOutDuration

export function discoveryMusicGain(timeline: DiscoveryTimeline, age: number, exitAge?: number) {
  if (exitAge !== undefined) {
    return lerp(timeline.musicDuck, 1, clamp(exitAge / cardDiscovery.discoveryOutroDuration))
  }
  return lerp(1, timeline.musicDuck, clamp(age / cardDiscovery.discoveryMusicDuckIn))
}

export function discoveryPackCharge(timeline: DiscoveryTimeline, age: number, hits: number, hitAge: number) {
  const maximum = packPresentation.discoveryHitMaxCharge
  const curve = packPresentation.chargeBuildCurve
  const progress = (hit: number) => maximum * (hit / timeline.hits) ** curve
  const impact = easeOut(hitAge / packPresentation.chargeStepDuration)
  const stepped = hits ? lerp(progress(hits - 1), progress(hits), impact) : 0
  const tail = timeline.buildUp - (timeline.hitTimes.at(-1) ?? 0)
  const finish = hits === timeline.hits ? clamp(hitAge / Math.max(.001, tail)) ** 2 : 0
  const firstFlashDuration = Math.max(.01, Math.min(.1, .4 * (timeline.hitTimes[1] ?? .25)))
  const white = 1 - clamp(age / firstFlashDuration)
  return { charge: lerp(stepped, 1, finish), flash: white, white }
}

export function discoveryBurstLook(age: number, seed: number) {
  const { revealBurstRaysGrow: grow, revealBurstRaysHold: hold, revealBurstRaysFade: fade,
    auraRayFlashDuration: flashDuration } = packPresentation
  if (age < 0 || age >= grow + hold + fade) return null
  // BoosterPack.StepRevealBurstRays (GameAssembly.dll:9395d0).
  return { reach: easeOut(age / grow), flash: 1 - clamp((age - grow) / flashDuration),
    turn: -(360 * seed / 100 + age * packPresentation.revealBurstRaysSpin) * Math.PI / 180,
    dissolve: clamp((age - grow - hold) / fade) }
}

export function discoveryAuraLook(age: number) {
  const { revealGlowPunch, revealGlowPunchDuration, revealAuraRecedeDelay, revealAuraRecedeDuration,
    revealAuraHoldAlpha, auraRaysSpinSpeed, auraBurstSpinBoost, auraBurstSpinSettle } = packPresentation
  const progress = clamp(age / revealGlowPunchDuration)
  const recede = clamp((age - revealAuraRecedeDelay) / revealAuraRecedeDuration)
  const spin = clamp(age / auraBurstSpinSettle)
  // StepRevealGlowPunch and StepRevealAuraRecede share the original glow layer.
  return {
    glowScale: 1 + revealGlowPunch * (1 - progress) ** 3,
    glowDissolve: (1 - clamp(2 * progress)) ** 3,
    alpha: lerp(1, revealAuraHoldAlpha, recede * recede * (3 - 2 * recede)),
    extraTurn: -auraRaysSpinSpeed * (auraBurstSpinBoost - 1) * auraBurstSpinSettle *
      (1 - (1 - spin) ** 4) / 4 * Math.PI / 180
  }
}

export function discoveryLabels(position: Point, bounds: { top: number; bottom: number },
  pose: ReturnType<typeof discoveryPose>, motion: boolean) {
  const focus = motion ? pose.focus : 0
  const zoom = motion ? pose.zoom : 1
  const x = .5 + position.x * (1 - focus) * zoom / world.width
  const y = .5 - position.y * (1 - focus) * zoom / world.height
  const above = bounds.top * pose.cardScale + cardDiscovery.nameWorldOffsetAboveBounds
  const below = bounds.bottom * pose.cardScale + cardDiscovery.discoveryContinueOffsetBelow
  return { x, title: y - above * zoom / world.height, prompt: y + below * zoom / world.height }
}

export function discoveryPose(timeline: DiscoveryTimeline, age: number, exitAge?: number) {
  const hits = timeline.hitTimes.filter(time => time <= age).length
  const hitAge = age - (timeline.hitTimes[hits - 1] ?? age)
  const step = hits / timeline.hits
  const previous = Math.max(0, hits - 1) / timeline.hits
  const curve = cardDiscovery.discoveryZoomInCurve.keys
  const zoomIn = lerp(evaluateCurve(curve, previous), evaluateCurve(curve, step), easeOut(hitAge / cardDiscovery.discoveryHitZoomStep))
  const dimIn = lerp(previous, step, easeOut(hitAge / cardDiscovery.discoveryHitDimStep))
  const cardAge = age - timeline.cardAt
  const showing = cardAge >= 0
  const outro = exitAge === undefined ? 0 : clamp(exitAge / cardDiscovery.discoveryOutroDuration)
  const cameraReturn = exitAge === undefined ? 0 : clamp((exitAge - cardDiscovery.discoveryOutroDuration) / cardDiscovery.zoomOutDuration)
  const wide = world.height / 2
  const target = Math.max(.35, Math.min(wide * cardDiscovery.minOrthoFactor, cardDiscovery.zoomInOrthoSize, wide - .02))
  const focus = (showing ? 1 : zoomIn) * (1 - cameraReturn) ** 2
  const zoom = wide / lerp(wide, target, focus)
  const white = timeline.whitePeak * (age < timeline.buildUp ?
    clamp(1 + (age - timeline.buildUp) / cardDiscovery.discoveryWhiteBuildDuration) :
    1 - clamp((age - timeline.buildUp) / cardDiscovery.discoveryFlashClearDuration))
  const pop = clamp(cardAge / cardDiscovery.discoveryPopDuration)
  const back = pop - 1
  const cardScale = pop * (1 - back + 2.70158 * back ** 2) * (1 - easeOut(outro))
  return { hits, hitAge, cardAge, focus, zoom, white, cardScale,
    dim: (showing ? 1 : dimIn) * cardDiscovery.darkenAlpha * (1 - easeOut(outro)),
    titleAlpha: easeOut(pop) * (1 - easeOut(outro)) }
}
