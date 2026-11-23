import source from '../data/chapter-one.json'
import later from '../data/chapters-2-3.json'
import locale from '../data/locale.json'

export const rules = source
export type ChapterId = 1 | 2 | 3
export type HeroId = keyof typeof rules.heroes | keyof typeof later.heroes
export type MonsterId = keyof typeof rules.monsters | keyof typeof later.monsters
export type TomeId = keyof typeof tomes
export type RelicId = keyof typeof later.relics
export type CardId = HeroId | TomeId | RelicId
export type UnitId = HeroId | MonsterId
export type Point = { x: number; y: number }

export const world = { width: 80 / 9, height: 5 }
export const bonfire = { x: 0.002, y: -0.154 }
export const packPosition = { x: -1.20, y: -.97 }
export const tutorialMonster = 'Monster1_Caveling'

export const heroes = { ...rules.heroes, ...later.heroes }

export function illusionistCloneCount(extraClones: number, foil: boolean, mirrorBonus = 0) {
  // FOIL_Illusionist effect 659 multiplies the extra copies supplied by the tree.
  return Math.ceil(Math.max(0, extraClones) * (1 + Math.max(0, mirrorBonus + (foil ? .5 : 0))))
}

export function applyMasteryIncome(amount: number, multiplier: number) {
  if (multiplier <= 1.0005 || amount <= 0) return amount
  const payout = Math.fround(amount * Math.fround(multiplier))
  const whole = Math.floor(payout)
  return payout - whole === .5 ? whole + whole % 2 : Math.round(payout)
}

export const monsters = { ...rules.monsters, ...later.monsters }
export const frenzyTome = 'Tome_CursorDPS'
export const frenzyDrop = { missBonus: .05, attemptPenalty: .15 }
export const tomes = {
  Tome_Thunderstorm: {
    name: 'Thunderstorm',
    nameZh: '雷暴',
    hudSprite: 'thunderstorm.png',
    buffDuration: rules.thunderstorm.duration,
    tickInterval: rules.thunderstorm.tick,
    tickIntervalRandomMin: 0.8,
    tickIntervalRandomMax: 1,
    castsPerTick: rules.thunderstorm.casts,
    spawnSFX: 'chapter-2-3/481-19_thunder_03.wav',
    openSFX: 'chapter-2-3/499-20_thunder_04.wav',
    buffAmbientLoopSFX: 'chapter-2-3/393-02_electric_aura_loop.wav',
    native: { rarity: 3, openExpandScale: 3, hudAccentColor: [1, 1, 1, 1], hudPulseAmplitude: .09, buffAmbientVolume: 1 }
  },
  [frenzyTome]: {
    name: 'Frenzy', nameZh: '狂暴',
    worldSprite: 'binder/portraits/Tome_CursorDPS.png', hudSprite: 'binder/portraits/Tome_CursorDPS.png',
    buffDuration: 9,
    spawnSFX: null, openSFX: null, buffAmbientLoopSFX: null,
    native: {
      rarity: 2, openExpandScale: 5, specialShopCoinCost: 5, hudAccentColor: [.660377, .660377, .660377, 1], hudPulseAmplitude: .1,
      buffAmbientVolume: .55, cursorDpsCumulativePercentage: .65, cursorDpsAttackSpeedBonusPercent: .23,
      cursorDpsAreaBonusPercent: .6, cursorDpsDamageBonusPercent: 3.2, foilPower: .5,
      cursorDpsRangeRingColor: [102, 57, 49, .65], cursorDpsRadialFillColor: [255, 146, 3, 43 / 255]
    }
  },
  ...later.tomes
}
export const relics = later.relics
export const spells = later.effects.SpellDefinition
export const chapterIntro = later.chapterIntro
export const ending = later.cutscenes.Cutscene4
export const campaignDoor = later.door
export const buildings = later.buildings
export type BuildingId = keyof typeof buildings
export const towerArt = later.tower
export const supporterTowerSkin = later.supporterTowerSkin
export const particleArt = later.particleArt
export const witchTransition = later.witchTransition
export const packPresentation = later.packPresentation
export const cardDiscovery = later.cardDiscovery
export type ParticleId = keyof typeof particleArt
export const unitSprites: Partial<Record<CardId | MonsterId, string>> = {
  Hero1_Squire: 'squire',
  Hero1_Barbarian: 'barbarian',
  Hero1_Archer: 'ranger',
  Tome_Thunderstorm: 'thunderstorm',
  Monster1_Caveling: 'caveling',
  Monster1_Raider: 'raider',
  Boss1_Apogre: 'apogre'
}

const spriteFrames = ['sprite', 'attackSprite', 'hitSprite', 'deathSprite', 'necromancerCastSprite', 'rangedSprite'] as const
const nativeUnits = { ...later.heroes, ...later.monsters, ...tomes, ...relics }

export function cardArt(id: CardId | MonsterId, frame = 0): string | undefined {
  const supporterFrame = id === 'Hero1_Squire3' ? supporterTowerSkin.units.Hero1_Squire3 : undefined
  if (supporterFrame) {
    const sprites = supporterFrame as Partial<Record<typeof spriteFrames[number], string>>
    return sprites[spriteFrames[frame]] ?? sprites.sprite
  }
  const prefix = unitSprites[id]
  if (prefix) return prefix + (id === 'Tome_Thunderstorm' ? '.png' : '-' + (frame === 5 ? 1 : frame) + '.png')
  const entry = nativeUnits[id as keyof typeof nativeUnits]
  if (entry && 'frames' in entry) {
    const frames = entry.frames as Partial<Record<typeof spriteFrames[number], string>>
    if (frame === 5) return frames.rangedSprite ?? frames.attackSprite ?? frames.sprite
    return frames[spriteFrames[frame]] ?? frames.sprite
  }
  if (entry && 'worldSprite' in entry) return entry.worldSprite
  return undefined
}

export const text = (key: keyof typeof locale) => locale[key]?.['zh-CN'] ?? key

export function cardRevealDescription(id: CardId) {
  return locale[(id + '.revealDescription') as keyof typeof locale]?.['zh-CN'] ?? ''
}

export function unitName(id: CardId | MonsterId, language: 'en' | 'zh-CN' = 'zh-CN') {
  const key = (id + (id.startsWith('Tome_') ? '.displayName' : '.unitName')) as keyof typeof locale
  const native = nativeUnits[id as keyof typeof nativeUnits]
  return locale[key]?.[language] ?? (language === 'en' ? native?.name : native?.nameZh) ?? id
}

export function isHero(id: CardId | UnitId): id is HeroId {
  return Object.hasOwn(heroes, id)
}

export function isRelic(id: unknown): id is RelicId {
  return typeof id === 'string' && Object.hasOwn(relics, id)
}

export function isCardId(id: unknown): id is CardId {
  return typeof id === 'string' &&
    (Object.hasOwn(heroes, id) || Object.hasOwn(tomes, id) || isRelic(id))
}

export const packs = {
  Pack1_Basic: {
    ...rules.basicPack, name: 'Basic Pack', nameZh: text('Pack1_Basic.packName'),
    maxPackShopPurchasesPerSession: 4, maxBoosterBoxShopPurchasesPerSession: 2,
    packsToUnlockBoosterBox: 5, boosterBoxShopCost: 5, boosterBoxPackCount: 3,
    boosterBoxMaxHP: 2, boosterBoxMasteryOnOpen: 3,
    packSprite: 'pack-closed.png', packOpenSprite: 'pack-open.png', packTearSprite: 'pack-tear.png',
    ...later.basicBox,
    spawnSFX: 'pack-spawn.wav', hitSFX: 'pack-hit.wav', openSFX: 'pack-open.wav'
  },
  DeliveryBox: {
    ...later.deliveryAsset, name: 'Delivery Package', nameZh: '投递包裹', shopCost: 0, cardCount: 1,
    masteryOnOpen: 0, frenzyChance: 0, resourceVariance: 0, newUnitPityMinPacks: 0, newUnitPityMaxPacks: 0,
    newFoilPityMinPacks: 0, newFoilPityMaxPacks: 0,
    maxPackShopPurchasesPerSession: 1000, maxBoosterBoxShopPurchasesPerSession: 0, fixedDrops: [],
    packsToUnlockBoosterBox: Infinity, boosterBoxShopCost: 25, boosterBoxPackCount: 3,
    boosterBoxMaxHP: 5, boosterBoxMasteryOnOpen: 10, pool: [], packTearSprite: null,
    spawnSFX: 'pack-spawn.wav', hitSFX: 'pack-hit.wav', openSFX: 'pack-open.wav'
  },
  ...later.packs
}

export type PackId = keyof typeof packs
export const basicPack: PackId = 'Pack1_Basic'
export const isPackId = (value: unknown): value is PackId => typeof value === 'string' && Object.hasOwn(packs, value)
export const heroPack = new Map<CardId, PackId>()
for (const [id, definition] of Object.entries(packs)) {
  for (const entry of definition.pool) if (isCardId(entry.id) && isHero(entry.id)) heroPack.set(entry.id, id as PackId)
}
export const packName = (id: PackId) => packs[id].nameZh
export const packArt = (id: PackId, opened = false, box = false) => {
  const pack = packs[id]
  return box && 'boosterBoxOpenSprite' in pack ? (opened ? pack.boosterBoxOpenSprite : pack.boosterBoxSprite)
    : opened ? pack.packOpenSprite : pack.packSprite
}

export function drawPack(id: PackId, opened: number, collected: readonly CardId[], random = Math.random): CardId[] {
  const pack = packs[id]
  const fixed = (pack.fixedDrops as string[][])[opened]
  if (fixed) return fixed.filter(isCardId)

  let pool = (pack.pool as { id: string; weight: number }[]).filter((entry): entry is { id: CardId; weight: number } => (
    isCardId(entry.id) && entry.weight > 0
  ))
  const undiscovered = pool.filter(entry => !collected.includes(entry.id))
  if (pack.newUnitPityMaxPacks > 0 && undiscovered.length && opened >= pack.newUnitPityMaxPacks) pool = undiscovered
  const weight = pool.reduce((sum, entry) => sum + entry.weight, 0)
  if (!weight) return []
  return Array.from({ length: pack.cardCount }, () => {
    let roll = random() * weight
    for (const item of pool) {
      roll -= item.weight
      if (roll < 0) return item.id
    }
    return pool[pool.length - 1].id
  })
}

export function drawBasicPack(opened: number, random = Math.random): CardId[] {
  return drawPack(basicPack, opened, [], random)
}

export type Chapter = {
  id: ChapterId
  name: string
  nameZh: string
  rewardPack: PackId
  spawnBursts: { id: string; start: number; duration: number; count: number }[]
  background: number[]
  lightColor: number[]
  ground: string
  rim: string[]
  decor: string[]
  waveThemeDetailCount: number
  waveThemeDetailMinDistanceFromTower: number
  waveThemeDetailMinSeparation: number
  enemyKillCoinMultiplier: number
  enemyKillMasteryMultiplier: number
}
export const chapters = [{
  ...rules.chapter, id: 1, nameZh: '黑暗中的鼓声',
  background: [12 / 255, 29 / 255, 26 / 255, 1], ground: 'ground-chapter1.png',
  lightColor: [101 / 255, 109 / 255, 109 / 255, 1],
  rim: ['terrain-rim-0.png', 'terrain-rim-1.png', 'terrain-rim-2.png'],
  decor: ['terrain-debris-18.png', 'terrain-debris-18.png', 'terrain-debris-14.png', 'terrain-debris-13.png'],
  waveThemeDetailCount: 10, waveThemeDetailMinDistanceFromTower: 1.2, waveThemeDetailMinSeparation: .15,
  enemyKillCoinMultiplier: 1, enemyKillMasteryMultiplier: 1
}, ...later.chapters] as Chapter[]

export function chapterInfo(id: ChapterId) {
  return chapters[id - 1]
}

export function formation(index: number): Point {
  const lane = index % 12
  const ring = Math.floor(index / 12)
  const angle = (lane - 2) * Math.PI / 6
  const radius = 0.57 + Math.min(ring, 5) * 0.24
  return { x: Math.cos(angle) * radius, y: bonfire.y + Math.sin(angle) * radius * 0.74 }
}

// RunSingleBurst.MoveNext waits duration / count after its immediate first spawn.
const schedules = chapters.map(chapter => chapter.spawnBursts.flatMap(burst =>
  Array.from({ length: burst.count }, (_, index) => ({
    id: burst.id as MonsterId,
    at: burst.start + index * burst.duration / burst.count
  }))
).sort((a, b) => a.at - b.at))

export const chapterSchedule = (id: ChapterId) => schedules[id - 1]
export const spawnSchedule = chapterSchedule(1)

