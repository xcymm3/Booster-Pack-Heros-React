import { heroes, isHero, isRelic, packPresentation, particleArt, relics, tomes, type CardId } from './rules'

export const packOpeningColors = ['#686f6f', '#5ea2b0', '#98289a', '#dbce2d']
const earlyRarity: Partial<Record<CardId, number>> = {
  Hero1_Squire: 0, Hero1_Barbarian: 1, Hero1_Archer: 2, Tome_Thunderstorm: 3
}

export function highestPackRarity(cards: readonly CardId[]) {
  return cards.reduce((rarity, id) => {
    const entry = isHero(id) ? heroes[id] : isRelic(id) ? relics[id] : tomes[id]
    const native = 'native' in entry && entry.native
    const value = native && 'rarity' in native && typeof native.rarity === 'number' ? native.rarity : earlyRarity[id] ?? 0
    return Math.max(rarity, value)
  }, 0)
}

export const ordinaryOpening = {
  wobbleDuration: 0,
  ripDuration: packPresentation.packOpenDuration,
  expandScale: packPresentation.packExpandScale,
  slideDistance: packPresentation.packRipSlideDistance,
  openTurn: -packPresentation.packRipOpenEndRotationZ * Math.PI / 180,
  tearTurn: -packPresentation.packRipTearEndRotationZ * Math.PI / 180,
  flashDuration: packPresentation.ripFlashDuration,
  dissolveDelay: packPresentation.ripDissolveDelay,
  ringDuration: packPresentation.ripRingDuration,
  scrapCount: packPresentation.ripScrapCount,
  scrapSpeed: packPresentation.ripScrapSpeed,
  scrapGravity: packPresentation.ripScrapGravity,
  scrapSize: packPresentation.ripScrapSize,
  scrapLifetime: packPresentation.ripScrapLifetime
}

// BoosterBox prefab on sharedassets1.assets:3331.
export const boxOpening = {
  wobbleDuration: .1,
  ripDuration: .5,
  expandScale: 1.7,
  slideDistance: .14,
  openTurn: 14 * Math.PI / 180,
  tearTurn: -16 * Math.PI / 180,
  flashDuration: .08,
  dissolveDelay: .15,
  ringDuration: .28,
  scrapCount: 14,
  scrapSpeed: 3.5,
  scrapGravity: 9,
  scrapSize: .02,
  scrapLifetime: .5
}

// The opening ParticleSystem at resources.assets:1336 also emits the original shine atlas.
export const packOpeningShine = {
  lifetime: particleArt.packOpen.duration,
  burstCount: 3,
  burstInterval: .2,
  particlesPerBurst: 10,
  speedRange: [.8, 1.3],
  sizeRange: [.05, .08],
  radius: .18
}

export function packOpeningLifetime(box?: boolean) {
  return (box ? boxOpening.wobbleDuration : 0) + packOpeningShine.lifetime +
    (packOpeningShine.burstCount - 1) * packOpeningShine.burstInterval
}

export function packRipPose(age: number, box?: boolean) {
  const config = box ? boxOpening : ordinaryOpening
  const ratio = Math.max(0, Math.min(1, age / config.ripDuration))
  const ease = 1 - (1 - ratio) ** 3
  return {
    slide: config.slideDistance * ease,
    scale: 1 + (config.expandScale - 1) * ease,
    openTurn: config.openTurn * ease,
    tearTurn: config.tearTurn * ease,
    dissolve: Math.max(0, (ratio - config.dissolveDelay) / (1 - config.dissolveDelay)),
    white: Math.max(0, 1 - age / config.flashDuration)
  }
}

const fraction = (value: number) => value - Math.floor(value)
const blend = (a: number, b: number, weight: number) => a + (b - a) * weight

const rainbowColors = [
  [1, .2, .2], [1, 1, .2], [.2, 1, .2], [.2, 1, 1], [.2, .2, 1], [1, .2, 1], [1, .2, .2]
]

// PackOpenJuice.RainbowColor uses HSV saturation 0.8 and value 1.
export function packRainbowColor(hue: number) {
  const phase = fraction(hue) * (rainbowColors.length - 1)
  const index = Math.floor(phase)
  return rainbowColors[index].map((value, channel) =>
    Math.round(255 * blend(value, rainbowColors[index + 1][channel], phase - index)))
}

export function packShineStartColor(sample: number, tint: readonly number[], foil: boolean) {
  if (foil) return { rgb: packRainbowColor(sample), alpha: 188 / 255 }
  const warm = [.9723109006881714, 1, .7311320900917053]
  const rgb = tint.map((value, channel) => Math.round(value * blend(warm[channel], 1, sample)))
  return { rgb, alpha: blend(179, 188, sample) / 255 }
}

function dissolveHash(x: number, y: number) {
  const px = fraction(Math.fround(x * 123.339996))
  const py = fraction(Math.fround(y * 456.209991))
  const dot = Math.fround(px * (px + 45.32) + py * (py + 45.32))
  return fraction(Math.fround((px + dot) * (py + dot)))
}

function dissolveValueNoise(x: number, y: number) {
  const i = Math.floor(x)
  const j = Math.floor(y)
  const u = fraction(x)
  const v = fraction(y)
  const sx = u * u * (3 - 2 * u)
  const sy = v * v * (3 - 2 * v)
  return blend(
    blend(dissolveHash(i, j), dissolveHash(i + 1, j), sx),
    blend(dissolveHash(i, j + 1), dissolveHash(i + 1, j + 1), sx), sy
  )
}

// BlackBox/SpriteDissolve samples two bands of value noise in atlas texel coordinates.
export function packDissolveNoise(texelX: number, texelY: number, seed: number) {
  const x = Math.floor(texelX) * .18 + seed
  const y = Math.floor(texelY) * .18 + seed
  return .7 * dissolveValueNoise(x, y) + .3 * dissolveValueNoise(x * 2.7 + 17, y * 2.7 + 17)
}

export function packDissolveThresholds(progress: number) {
  const edge = progress * 1.12
  return { cut: edge - .12, edge }
}
