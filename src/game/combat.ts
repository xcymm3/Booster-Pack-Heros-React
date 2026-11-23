import scene from '../data/scene-canvas.json'
import projectileConfig from '../data/projectiles.json'
import { advanceDamageNumbers, createDamageNumbers, showDamageNumber, type DamageNumberKind, type DamageNumberMode, type DamageNumbers } from './damage-numbers'
import { fallenLifetime, heroEntryDuration, heroEntryPose, lungeOffset, unitDirection, type FallenUnit, type HeroEntry, type Lunge } from './unit-motion'
import { advanceFlight, castDirections, createFlight, type Flight } from './projectiles'
import { tomeSparkDuration, type TomeSpark } from './tome-presentation'
import {
  applyMasteryIncome, bonfire, buildings, cardArt, chapterInfo, chapterSchedule, formation, frenzyTome, heroPack, heroes,
  illusionistCloneCount, isHero, isRelic, isPackId, monsters, packPresentation, relics, rules, spells, tomes,
  towerArt, tutorialMonster, witchTransition, world, type BuildingId, type CardId, type ChapterId, type HeroId, type MonsterId,
  type ParticleId, type Point, type RelicId, type TomeId, type UnitId
} from './rules'
import type { CardTraits, Pack, Summary, UnitStat } from './save'

const { combatFeel, heroPackEntry, monkDash, monsterKnockback } = scene
const portal = heroes.Hero3_Portal
const portalRarityWeights = [8, 6, 4, 2]
const illusionist = heroes.Hero3_Illusionist
const energyExplosion = spells.Spell_AoeCircle

type Fighter<Id extends UnitId> = Point & {
  uid: number
  id: Id
  hp: number
  maxHp: number
  attackAt: number
  attackPeriod: number
  chargeIntensity: number
  spellAt: number
  spellPeriod: number
  castUntil: number
  attackedUntil: number
  lunge: Lunge | null
  knockback: Point | null
  dash: MonkDash | null
  extraDashes: number
  hitUntil: number
  flashUntil: number
  hitSpriteReadyAt: number
  invulnerableUntil: number
  lastDamageAt: number
  stunnedUntil: number
  flip: boolean
  training: boolean
  summonDamageMultiplier: number
  shield: number
  maxShield: number
  summoned: number
  portalIdleAge: number
  entry: HeroEntry | null
  illusionistPrincipal: number | null
  pendingShadows: number
  born: number
  kills: number
  original: Id
  infection: Infection | null
  foil: boolean
  giant: boolean
}

type ExpiringPortal = Pick<Fighter<'Hero3_Portal'>, 'x' | 'y' | 'id' | 'giant' | 'foil' | 'flip' | 'portalIdleAge'> & {
  portalExpiredAt: number
}

type IllusionistBlast = Point & { uid: number; at: number }

export type FieldTome = Point & {
  id: TomeId
  uid: number
  foil: boolean
  origin: Point
  droppedAt: number
  turn: number
  hits: number
  hitAt: number
  openedAt: number | null
}

type TomeBuff = Point & { id: TomeId; uid: number; foil: boolean; startedAt: number; next: number; until: number; lastCast: number }

export type DragonFlight = {
  uid: number
  start: Point
  exit: Point
  startedAt: number
  exitAt: number
  nextTrailTick: number
  lastTrailTick: number
  radius: number
  damage: number
  nextPassHit: Map<number, number>
}

export type Effect = Point & {
  uid: number
  kind: 'hit' | 'spell' | 'thunderbolt' | 'tomeSpark'
  amount: number
  unit?: UnitId
  flipped?: boolean
  art?: ParticleId
  start: number
  until: number
  cone?: { axis: Point; length: number }
}

type Zone = Point & {
  radius: number
  damage: number
  tick: number
  next: number
  until: number
  owner: HeroId
  spell: keyof typeof spells
}

type Infection = {
  until: number
  next: number
  stacks: number
  damage: number
  slow: number
  vulnerability: number
  source: Fighter<HeroId>
}

type Projectile = Flight & {
  uid: number
  source: Fighter<HeroId>
  target: Fighter<MonsterId>
  damage: number
  bounces: number
  retargetAt: number
}

type DashTrail = (Point & { at: number })[]
type DashTableContact = (position: Point, touched: Set<Pack>) => void
type MonkDash = {
  legs: number
  nextAt: number
  hit: Set<number>
  leg: { target: Fighter<MonsterId>; direction: Point; remaining: number; touched: Set<Pack> } | null
  trail: DashTrail
}

type ProjectileEffect = Point & {
  uid: number
  kind: 'flame' | 'fireBurst' | 'fireGround' | 'infectionGround'
  start: number
  until: number
  radius: number
}

export type WitchRespawn = {
  point: Point
  flip: boolean
  age: number
  revealed: boolean
}

const witchZoomIn = .65
const witchTwitchStart = witchZoomIn + witchTransition.fakeOutHold
const witchTwitchTimes = Array.from({ length: witchTransition.twitchCount }, (_, i) => {
  const interval = i / Math.max(1, witchTransition.twitchCount - 1)
  return witchTransition.twitchIntervalStart + (witchTransition.twitchIntervalEnd - witchTransition.twitchIntervalStart) * interval
})
const witchTwitchEnd = witchTwitchStart + witchTwitchTimes.reduce((total, interval) => total + interval, 0)
const witchFloodStart = witchTwitchEnd + witchTransition.phaseStormRounds *
  ((witchTransition.phaseStormHoldStart + witchTransition.phaseStormHoldEnd) * .5 + witchTransition.phaseStormGap)
const witchReveal = witchFloodStart + witchTransition.phaseFloodIn + witchTransition.phaseFloodHold
const witchEnd = witchReveal + Math.max(witchTransition.newFormGlitchDuration, witchTransition.newFormHold + witchTransition.phaseFloodOut)

export function witchShot(phase: WitchRespawn) {
  const enter = Math.min(1, phase.age / witchZoomIn)
  const leave = Math.max(0, 1 - (witchEnd - phase.age) / witchZoomIn)
  let twitch = witchTwitchStart
  const twitching = witchTwitchTimes.some(interval => {
    const active = phase.age >= twitch && phase.age < twitch + witchTransition.twitchDuration
    twitch += interval
    return active
  })
  const flood = Math.max(0, Math.min(1, (phase.age - witchFloodStart) / witchTransition.phaseFloodIn,
    (witchReveal + witchTransition.phaseFloodOut - phase.age) / witchTransition.phaseFloodOut))
  return {
    focus: Math.max(0, (1 - (1 - enter) ** 2) * (1 - leave ** 2)),
    glitch: twitching || (phase.age >= witchTwitchEnd && phase.age < witchReveal) ||
      (phase.revealed && phase.age < witchReveal + witchTransition.newFormGlitchDuration),
    flood
  }
}

export const battleCueVolumes: Record<string, number> = {
  [witchTransition.glitchSfx]: witchTransition.glitchSfxVolume,
  [witchTransition.riserSfx]: witchTransition.riserVolume,
  [witchTransition.climaxSfx]: witchTransition.climaxSfxVolume,
  [witchTransition.revealSfx]: witchTransition.revealSfxVolume,
  [rules.thunderstorm.castSound]: 1,
  [scene.dragon.castSound]: 1
}

export type Aim = Point & { radius: number }
export type BattleQuestProgress = {
  events: { metric: string; amount: number; position: Point }[]
  pending: Record<string, number>
  recorded: Record<string, number>
}

type MonsterHit = {
  origin?: Point
  stun?: number
  popup?: DamageNumberKind
  infectionTick?: boolean
}

export type CombatModifiers = {
  towerHp: number
  cursorDamage: number
  cursorRadius: number
  cursorSpeed: number
  masteryPerKill: number
  modifiersFor?: (id: string) => Record<string, number>
  effect?: (type: number, target?: string, pack?: string) => number
  unlockedBuildings?: string[]
  towerVisual?: number
}

const defaults: CombatModifiers = {
  towerHp: 1, cursorDamage: 1, cursorRadius: 1, cursorSpeed: 1, masteryPerKill: 0
}

export type Battle = {
  chapter: ChapterId
  clock: number
  elapsed: number
  spawnIndex: number
  towerHp: number
  towerMaxHp: number
  towerPopupTarget: Point & { readonly hp: number }
  towerHits: { id: number; at: number; fatal: boolean }[]
  towerCamera: { at: number; heatAt: number; heat: number; amplitude: number; duration: number }
  allies: Fighter<HeroId>[]
  expiringPortals: ExpiringPortal[]
  illusionistBlasts: IllusionistBlast[]
  enemies: Fighter<MonsterId>[]
  effects: Effect[]
  projectiles: Projectile[]
  projectileEffects: ProjectileEffect[]
  dashTrails: DashTrail[]
  nextProjectileUid: number
  animationClock: number
  fallen: FallenUnit[]
  damageNumbers: DamageNumbers
  zones: Zone[]
  nextUid: number
  nextPulse: number
  cursorPulseAt: number
  cursorDamagePerTick: number
  pulseInterval: number
  cursorRadiusMultiplier: number
  fieldTomes: FieldTome[]
  tomes: TomeBuff[]
  dragons: DragonFlight[]
  mastery: number
  coins: number
  cursorDamage: number
  packsOpened: number
  random: () => number
  defeated: number
  modifiers: CombatModifiers
  defeatedIds: Partial<Record<MonsterId, number>>
  foilDefeated: number
  totalDamage: number
  unitStats: Partial<Record<CardId, UnitStat>>
  questProgress: BattleQuestProgress | null
  cursorKills: number
  tutorial: 'wait' | 'fight' | 'done'
  summary: Summary | null
  respawn: WitchRespawn | null
  bossDefeat: (Point & { id: MonsterId; flip: boolean; at: number; direction: Point; rotation: number }) | null
  droppedPacks: { id: string; position: Point; transform?: boolean; sound?: string; traits?: CardTraits }[]
  equippedRelics: RelicId[]
  cursorAttacks: number
  packOpenTimes: number[]
  pendingPackCards: { id: CardId; position: Point; traits?: CardTraits; fromReveal: boolean; releaseAt: number }[]
  spellCounts: Record<string, number>
  heroModifiers: Map<CardId, Record<string, number>>
  buildings: { id: BuildingId; next: number; cooldown: number }[]
  discoveredHeroes: HeroId[]
  sounds: string[]
}

export function dayProgress(battle: Battle) {
  const schedule = chapterSchedule(battle.chapter)
  const spawned = battle.spawnIndex / schedule.length
  if (spawned < .999) return { phase: 'spawn' as const, fill: spawned }

  const boss = battle.enemies.find(enemy => enemy.id.startsWith('Boss') && enemy.hp > 0)
  if (boss?.id === 'Boss3_Witch' || boss?.id === 'Boss3_Witch2' || battle.respawn) {
    // SurviveHUD.TryGetCombinedBossHp01 includes future forms and retains defeated forms in the total.
    const firstHp = monsters.Boss3_Witch.maxHP
    const secondHp = monsters.Boss3_Witch2.maxHP
    const remaining = boss?.id === 'Boss3_Witch' ? boss.hp + secondHp : boss?.hp ?? secondHp
    return { phase: 'boss' as const, fill: remaining / (firstHp + secondHp) }
  }

  return { phase: 'boss' as const, fill: boss ? boss.hp / boss.maxHp : 1 }
}

function fighter<Id extends UnitId>(uid: number, id: Id, at: Point, hp: number, clock: number, shield: number): Fighter<Id> {
  return {
    ...at, uid, id, hp, maxHp: hp, attackAt: clock, attackPeriod: 0, chargeIntensity: 0,
    spellAt: clock, spellPeriod: 0, castUntil: 0, attackedUntil: 0, lunge: null, knockback: null, dash: null, extraDashes: 0,
    hitUntil: 0, flashUntil: 0, hitSpriteReadyAt: 0, invulnerableUntil: 0, lastDamageAt: -1,
    stunnedUntil: 0, flip: false, training: false, summonDamageMultiplier: 1, shield, maxShield: shield,
    summoned: 0, portalIdleAge: 0, entry: null, illusionistPrincipal: null, pendingShadows: 0, born: clock, kills: 0,
    original: id, infection: null, foil: false, giant: false
  }
}

export function createBattle(
  roster: readonly CardId[], tutorial: boolean, random = Math.random, chapter: ChapterId = 1,
  modifiers: CombatModifiers = defaults, equippedRelics: RelicId[] = [],
  options: { rosterTraits?: CardTraits[]; collection?: CardId[]; damageNumberMode?: DamageNumberMode; trackQuestProgress?: boolean } = {}
): Battle {
  const towerMaxHp = rules.tower.maxHP * modifiers.towerHp
  const pulseInterval = rules.cursor.baseTickInterval / Math.max(.05, modifiers.cursorSpeed)
  const battle: Battle = {
    chapter, clock: 0, elapsed: 0, spawnIndex: 0, towerHp: towerMaxHp, towerMaxHp,
    towerPopupTarget: { ...bonfire, get hp() { return battle.towerHp } },
    towerHits: [], towerCamera: { at: -Infinity, heatAt: 0, heat: 0, amplitude: 0, duration: 1 },
    allies: [], expiringPortals: [], illusionistBlasts: [], enemies: [], effects: [], projectiles: [], projectileEffects: [], dashTrails: [],
    nextProjectileUid: 0, animationClock: 0, fallen: [],
    damageNumbers: createDamageNumbers(options.damageNumberMode),
    zones: [], nextUid: 0, nextPulse: pulseInterval, cursorPulseAt: -Infinity,
    cursorDamagePerTick: rules.cursor.baseDamagePerTick * modifiers.cursorDamage,
    pulseInterval, cursorRadiusMultiplier: modifiers.cursorRadius, fieldTomes: [], tomes: [], dragons: [],
    mastery: 0, coins: 0, cursorDamage: 0, packsOpened: 0, random, defeated: 0, modifiers,
    defeatedIds: {}, foilDefeated: 0, totalDamage: 0, unitStats: {},
    cursorKills: 0, tutorial: tutorial ? 'wait' : 'done', summary: null,
    questProgress: options.trackQuestProgress ? { events: [], pending: {}, recorded: {} } : null,
    respawn: null, bossDefeat: null, droppedPacks: [], equippedRelics: [...equippedRelics], cursorAttacks: 0, packOpenTimes: [],
    pendingPackCards: [],
    spellCounts: {}, heroModifiers: new Map(), sounds: [],
    discoveredHeroes: [...new Set((options.collection ?? roster).filter(isHero))],
    buildings: (modifiers.unlockedBuildings ?? []).filter((id): id is BuildingId => Object.hasOwn(buildings, id))
      .map(id => {
        const cooldown = Math.max(1, buildings[id].cooldown - (modifiers.effect?.(326, id) ?? 0))
        return { id, next: cooldown, cooldown }
      })
  }
  roster.forEach((id, index) => deployCard(battle, id, formation(battle.allies.length), true, options.rosterTraits?.[index]))
  if (tutorial) {
    spawn(battle, tutorialMonster, { x: 1.82, y: 0.3 }).training = true
  }
  return battle
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const halfBattlefieldWidth = world.width / 2
const halfBattlefieldHeight = world.height / 2

function nearest<T extends Point & { hp: number }>(point: Point, choices: readonly T[]) {
  let closest: T | undefined
  let best = Infinity
  for (const choice of choices) {
    if (choice.hp <= 0) continue
    const gap = distance(point, choice)
    if (gap < best) {
      closest = choice
      best = gap
    }
  }
  return closest
}

export function nearestEnemy(battle: Battle) {
  return nearest(bonfire, battle.enemies)
}

function tracked(battle: Battle, id: CardId): UnitStat {
  return battle.unitStats[id] ??= { id, count: 0, damage: 0, defense: 0 }
}

function statsModifiers(battle: Battle, id: CardId): Record<string, number> {
  const existing = battle.heroModifiers.get(id)
  if (existing) return existing
  const pack = heroPack.get(id)
  const unit = battle.modifiers.modifiersFor?.(id)
  const effect = (type: number) => battle.modifiers.effect?.(type, id) ?? 0
  const stats = {
    ...unit,
    hp: (unit?.hp ?? 1) + (pack ? battle.modifiers.effect?.(199, undefined, pack) ?? 0 : 0),
    attackDamage: (unit?.attackDamage ?? 1) + (pack ? battle.modifiers.effect?.(200, undefined, pack) ?? 0 : 0),
    frenzy: effect(55),
    healOnKill: effect(56),
    deathSummon: effect(106),
    promotions: effect(133),
    extraTomeCasts: effect(96),
    extraClones: effect(129),
    mirrorBonus: effect(659),
    explosionDamage: effect(140),
    explosionRadius: effect(141),
    infectionSlow: Math.min(.75, effect(124)),
    infectionVulnerability: effect(125),
    infectionSpread: effect(126),
    infectionSkeletons: effect(127),
    dashCount: effect(46),
    dashOnKill: effect(132),
    bladeRainOnKill: effect(117),
    spellSpeed: 1 + effect(2)
  }
  battle.heroModifiers.set(id, stats)
  return stats
}

export function deployCard(battle: Battle, id: CardId, position: Point, fromPack = true, traits: CardTraits = {}, entry?: HeroEntry) {
  if (isRelic(id)) {
    if (!battle.equippedRelics.includes(id)) battle.equippedRelics.push(id)
    return
  }
  if (!isHero(id)) {
    tracked(battle, id).count++
    const [min, max] = scene.tomeField.tossDistance
    const radius = min + (max - min) * battle.random()
    const angle = 2 * Math.PI * battle.random()
    const turn = (2 * battle.random() - 1) * scene.tomeField.maxAngularVelocity * Math.PI / 180 * scene.tomeField.slideDuration
    battle.fieldTomes.push({
      x: position.x + radius * Math.cos(angle), y: position.y + radius * Math.sin(angle), id, uid: battle.nextUid++,
      origin: position, foil: !!traits.foil, droppedAt: battle.clock, turn, hits: 0, hitAt: battle.clock, openedAt: null
    })
    playBattleCue(battle, tomes[id].spawnSFX)
    return
  }

  const ally = deployHero(battle, id, position, traits, null, entry)
  if (id !== 'Hero3_Illusionist' || !fromPack) return
  const modifiers = statsModifiers(battle, id)
  const copies = illusionistCloneCount(modifiers.extraClones, ally.foil, modifiers.mirrorBonus)
  for (let copy = 0; copy < copies; copy++) {
    const angle = 2 * Math.PI * battle.random()
    const radius = .4 * Math.sqrt(battle.random())
    const target = { x: position.x + radius * Math.cos(angle), y: position.y + radius * Math.sin(angle) }
    deployHero(battle, id, target, traits, ally.uid, entry && { ...entry, target })
  }
}

function releasePackCard(battle: Battle, id: CardId, position: Point, traits: CardTraits | undefined, fromReveal: boolean) {
  if (!isHero(id)) {
    deployCard(battle, id, position, true, traits)
    return
  }
  const angle = 2 * Math.PI * battle.random()
  const radius = packPresentation.cardSpawnSpreadRadius * Math.sqrt(battle.random())
  const target = { x: position.x + radius * Math.cos(angle), y: position.y + radius * Math.sin(angle) }
  deployCard(battle, id, target, true, traits, { origin: position, target, fromReveal })
}

export function queuePackCards(battle: Battle, cards: readonly CardId[], position: Point, traits: readonly CardTraits[], revealedCard?: CardId) {
  if (!cards.length) return
  const revealedIndex = revealedCard === undefined ? -1 : cards.indexOf(revealedCard)
  releasePackCard(battle, cards[0], position, traits[0], revealedIndex === 0)
  for (const [index, id] of cards.slice(1).entries()) {
    battle.pendingPackCards.push({
      id, position, traits: traits[index + 1], fromReveal: revealedIndex === index + 1,
      releaseAt: battle.clock + (index + 1) * packPresentation.cardSpawnInterval
    })
  }
  battle.pendingPackCards.sort((first, second) => first.releaseAt - second.releaseAt)
}

function deployHero(battle: Battle, id: HeroId, position: Point, traits: CardTraits, illusionistPrincipal: number | null = null, entry?: HeroEntry) {
  tracked(battle, id).count++
  const stats = heroes[id]
  const modifiers = statsModifiers(battle, id)
  const hp = stats.maxHP * modifiers.hp * (traits.foil ? 2 : 1) * (traits.giant ? 2 : 1)
  const ally = fighter(battle.nextUid++, id, entry?.origin ?? position, hp, battle.clock, 'shield' in stats ? stats.shield : 0)
  ally.entry = entry ?? null
  ally.invulnerableUntil = battle.clock + combatFeel.heroSpawnInvulnerabilityDuration
  ally.foil = !!traits.foil
  ally.giant = !!traits.giant
  ally.illusionistPrincipal = illusionistPrincipal
  if ('spellCastInterval' in stats && stats.spellCastInterval > 0 && !stats.spellOnAttack) {
    ally.spellPeriod = stats.spellCastInterval / spellSpeed(ally, modifiers)
    ally.spellAt += ally.spellPeriod
  }
  if (!battle.discoveredHeroes.includes(id) && id !== 'Hero_Skeleton') battle.discoveredHeroes.push(id)
  battle.allies.push(ally)
  if (id === 'Hero_Skeleton' && !entry) {
    const skeleton = scene.raiseDead.spawn
    effect(battle, 'spell', position, 0, skeleton.emissionDelay + skeleton.lifetime, undefined, 'skeleton')
  } else if (!entry?.fromReveal) {
    const { emissionDelay, duration } = heroPackEntry.burst
    effect(battle, 'spell', ally, 0, emissionDelay + duration, ally, 'spawn')
  }
  playUnitSound(battle, stats, 'spawnSFX')
  return ally
}

function constrainHeroPosition(unit: Fighter<UnitId>) {
  if (!isHero(unit.id)) return
  unit.x = Math.max(-halfBattlefieldWidth, Math.min(halfBattlefieldWidth, unit.x))
  unit.y = Math.max(-halfBattlefieldHeight, Math.min(halfBattlefieldHeight, unit.y))
}

function move(unit: Fighter<UnitId>, target: Point, speed: number, step: number, stop: number) {
  if (speed <= 0) return
  const gap = distance(unit, target)
  if (gap <= stop || gap === 0) return
  const ratio = Math.min(speed * step, gap - stop) / gap
  unit.x += (target.x - unit.x) * ratio
  unit.y += (target.y - unit.y) * ratio
  constrainHeroPosition(unit)
}

function turn(unit: Fighter<HeroId>, target: Point) {
  const horizontal = target.x - unit.x
  // Hero.UpdateSpriteFacingFromHorizontal mirrors the native left-facing art on rightward movement.
  if (Math.abs(horizontal) >= .00001) unit.flip = horizontal > 0
}

function faceMonster(unit: Fighter<MonsterId>, target: Point) {
  const horizontal = target.x - unit.x
  if (Math.abs(horizontal) >= .00001) unit.flip = horizontal > 0
}

function beginAttackPose(unit: Fighter<UnitId>, target: Point, clock: number, ranged: boolean) {
  if (ranged) {
    unit.attackedUntil = clock + combatFeel.rangedAttackSpriteDuration
    return
  }
  unit.lunge = { origin: { x: unit.x, y: unit.y }, direction: unitDirection(unit, target, .01), at: clock }
  unit.attackedUntil = clock + combatFeel.lungeOutDuration + combatFeel.lungeReturnDuration
}

function updateLunge(unit: Fighter<UnitId>, clock: number) {
  const lunge = unit.lunge
  if (!lunge) return
  const age = clock - lunge.at
  const offset = lungeOffset(age)
  unit.x = lunge.origin.x + lunge.direction.x * offset
  unit.y = lunge.origin.y + lunge.direction.y * offset
  constrainHeroPosition(unit)
  if (clock >= unit.attackedUntil) unit.lunge = null
}

function fallUnit(battle: Battle, unit: Fighter<UnitId>, kind: FallenUnit['kind'], origin?: Point) {
  const { x, y, id, flip, giant } = unit
  battle.fallen.push({
    x, y, id, flip, giant, kind, uid: battle.nextUid++, at: battle.animationClock,
    direction: origin ? unitDirection(origin, unit, .1) : { x: 0, y: 1 },
    hasHitSprite: cardArt(id, 2) !== cardArt(id)
  })
}

function effect(
  battle: Battle, kind: Effect['kind'], at: Point, amount: number, duration: number,
  unit?: Fighter<UnitId>, art?: ParticleId
) {
  battle.effects.push({
    x: at.x, y: at.y, uid: battle.nextUid++, kind, amount, until: battle.clock + duration,
    unit: unit?.id, flipped: unit?.flip, art, start: battle.clock
  })
}

function playBattleCue(battle: Battle, sound: string | null) {
  if (sound && !battle.sounds.includes(sound)) battle.sounds.push(sound)
}

function reportQuestProgress(battle: Battle, metric: string, amount: number, { x, y }: Point) {
  if (amount > 0 && !metric.startsWith('monster:Boss')) battle.questProgress?.events.push({ metric, amount, position: { x, y } })
}

function recordSpellCast(battle: Battle, id: keyof typeof spells | 'Spell_Thunderbolt', position: Point, count = 1) {
  battle.spellCounts[id] = (battle.spellCounts[id] ?? 0) + count
  reportQuestProgress(battle, 'spell:' + id, count, position)
}

function playUnitSound(battle: Battle, stats: object, key: string) {
  if (!('sounds' in stats) || !stats.sounds || typeof stats.sounds !== 'object') return
  const sound = (stats.sounds as Record<string, unknown>)[key]
  if (typeof sound === 'string') playBattleCue(battle, sound)
}

function markDamage(unit: Fighter<UnitId>, clock: number) {
  unit.lastDamageAt = clock
  unit.flashUntil = clock + combatFeel.whiteHitFlashDuration
  if (clock < unit.hitSpriteReadyAt) return
  unit.hitUntil = clock + combatFeel.hitSpriteDuration
  if (unit.id.startsWith('Boss')) unit.hitSpriteReadyAt = clock + combatFeel.bossHitSpriteCooldown
}

export function masteryIncomeMultiplier(battle: Battle) {
  const effect = battle.modifiers.effect
  const illusionistBonus = illusionist.native.masteryMultiplier + (effect?.(131, 'Hero3_Illusionist', 'Pack3_Magic') ?? 0)
  const foilBonus = effect?.(542) ?? 0
  let bonus = spellSurgeActive(battle) ? scene.hud.masterySurge.coreBonus + (effect?.(98) ?? 0) : 0
  for (const unit of battle.allies) {
    if (unit.hp <= 0) continue
    if (unit.id === 'Hero3_Illusionist') bonus += illusionistBonus + (unit.foil ? .02 : 0)
    if (unit.foil) bonus += foilBonus
  }
  return 1 + bonus
}

function spellSurgeActive(battle: Battle) {
  return battle.tomes.some(tome => battle.clock < tome.until)
}

export function masterySurgePercent(battle: Battle) {
  if (battle.summary) return null
  const percent = applyMasteryIncome(100, masteryIncomeMultiplier(battle))
  return percent > 100 || spellSurgeActive(battle) ? percent : null
}

function hurtEnemy(
  battle: Battle, target: Fighter<MonsterId>, amount: number, source?: CardId | 'cursor',
  { origin, stun = 0, popup = 'damage', infectionTick = false }: MonsterHit = {}
) {
  if (target.hp <= 0 || amount <= 0) return
  const stats = monsters[target.id]
  const theme = chapterInfo(battle.chapter)
  const stages = (hp: number) => Math.floor((1 - hp / target.maxHp) * 10 + 1e-7)
  const previous = target.hp
  const vulnerability = !infectionTick && target.infection && target.infection.until > battle.clock ? target.infection.vulnerability : 0
  const damage = amount * (1 + vulnerability)
  const applied = Math.min(previous, damage)
  target.hp = Math.max(0, previous - damage)
  markDamage(target, battle.clock)
  showDamageNumber(battle.damageNumbers, target, damage, popup, target)
  if (stun > 0) target.stunnedUntil = battle.clock + stun * ('stunDurationMultiplier' in stats ? stats.stunDurationMultiplier : 1)
  effect(battle, 'hit', target, applied, 0.6)
  if (!target.training) battle.totalDamage += applied
  if (source === 'cursor') {
    battle.cursorDamage += applied
    reportQuestProgress(battle, 'cursorDamage', applied, target)
  }
  else if (source) tracked(battle, source).damage += applied
  if (stats.masteryRewardPer10PercentDamage > 0) {
    const reward = (stages(target.hp) - stages(previous)) * stats.masteryRewardPer10PercentDamage
    battle.mastery += applyMasteryIncome(reward * theme.enemyKillMasteryMultiplier, masteryIncomeMultiplier(battle))
  }
  if (target.hp > 0) return

  if (!target.training) {
    battle.defeated++
    if (target.foil) battle.foilDefeated++
    battle.defeatedIds[target.id] = (battle.defeatedIds[target.id] ?? 0) + 1
    reportQuestProgress(battle, 'monster:' + target.id, 1, target)
    if (source === 'cursor') {
      battle.cursorKills++
      reportQuestProgress(battle, 'cursorKills', 1, target)
    }
  }
  const masteryMultiplier = masteryIncomeMultiplier(battle)
  if (stats.masteryRewardPer10PercentDamage === 0) {
    battle.mastery += applyMasteryIncome(stats.masteryReward * theme.enemyKillMasteryMultiplier, masteryMultiplier)
  }
  battle.mastery += applyMasteryIncome(battle.modifiers.masteryPerKill, masteryMultiplier)
  if (target.infection && target.infection.until > battle.clock) {
    const stats = statsModifiers(battle, 'Hero3_WitchDoctor')
    const spread = battle.enemies.filter(enemy => enemy.hp > 0 && distance(target, enemy) <= 1.2)
    for (const enemy of spread.slice(0, stats.infectionSpread)) enemy.infection = { ...target.infection }
    if (stats.infectionSkeletons > 0 && battle.random() < stats.infectionSkeletons) {
      deployCard(battle, 'Hero_Skeleton', target, false)
    }
  }
  const coins = stats.coinReward * theme.enemyKillCoinMultiplier
  battle.coins += coins
  reportQuestProgress(battle, 'combatCoins', coins, target)
  if (target.id === 'Boss1_Apogre' || target.id === 'Boss2_Beast' || target.id === 'Boss3_Witch2') {
    const { id, x, y, flip } = target
    const dx = x - (origin?.x ?? x)
    const dy = y - (origin?.y ?? y)
    const length = Math.hypot(dx, dy)
    battle.bossDefeat = {
      id, x, y, flip, at: battle.clock,
      direction: length > .1 ? { x: dx / length, y: dy / length } : { x: 0, y: 1 },
      rotation: battle.random() * 2 - 1
    }
  } else if (target.id !== 'Boss3_Witch') fallUnit(battle, target, 'monster', origin)
  playUnitSound(battle, stats, 'defeatSFX')
  if ('native' in stats && stats.dropChance > 0 && battle.random() < stats.dropChance &&
      stats.PackDrop && typeof stats.PackDrop === 'object' && 'name' in stats.PackDrop && typeof stats.PackDrop.name === 'string') {
    battle.droppedPacks.push({ id: stats.PackDrop.name, position: { x: target.x, y: target.y } })
  }

  if (target.id === 'Boss3_Witch') {
    battle.respawn = { point: { x: target.x, y: target.y }, flip: target.flip, age: 0, revealed: false }
  }
}

function relicEffect(battle: Battle, effect: number) {
  return battle.equippedRelics.reduce((total, id) => total +
    relics[id].effectValues.filter(entry => entry.effectType === effect).reduce((sum, entry) => sum + entry.value, 0), 0)
}

export function cursorProfile(battle: Battle, clock = battle.clock) {
  const config = tomes[frenzyTome].native
  const purchased = (type: number) => Math.max(0, battle.modifiers.effect?.(type, frenzyTome) ?? 0)
  const boostWindow = relicEffect(battle, 525)
  let stacks = 0, damage = 0, area = 0, speed = 0, crit = 0
  for (const tome of battle.tomes) {
    if (tome.id !== frenzyTome || tome.until <= clock) continue
    const weight = config.cursorDpsCumulativePercentage ** stacks++
    const power = 1 + purchased(658) + (tome.foil ? config.foilPower : 0)
    area += (config.cursorDpsAreaBonusPercent + purchased(100)) * power * weight
    damage += config.cursorDpsDamageBonusPercent * weight
    speed += (config.cursorDpsAttackSpeedBonusPercent + purchased(99)) * weight
    crit += purchased(116) * weight
  }
  const boosted = battle.packOpenTimes.filter(at => clock - at <= boostWindow).length
  const relicSpeed = relicEffect(battle, 524) * Math.min(boosted, relicEffect(battle, 538))
  const speedRatio = 1 + relicSpeed + speed / Math.max(.05, battle.modifiers.cursorSpeed)
  return {
    stacks, crit, interval: stacks ? Math.max(.05, battle.pulseInterval / speedRatio) : battle.pulseInterval / speedRatio,
    radius: battle.cursorRadiusMultiplier + relicEffect(battle, 34) + area,
    damage: battle.cursorDamagePerTick + rules.cursor.baseDamagePerTick * damage
  }
}

export function pulse(battle: Battle, aim: Aim | null, strikePack = false) {
  if (battle.respawn || (battle.summary && !strikePack) || battle.clock + 1e-6 < battle.nextPulse) return false
  // The native cursor spends its cooldown even when the overlap check finds nothing.
  const { interval, radius, damage, crit } = cursorProfile(battle)
  battle.nextPulse += interval * (Math.floor(Math.max(0, battle.clock - battle.nextPulse) / interval) + 1)
  if (!aim) return false
  battle.cursorPulseAt = battle.clock
  const cursorRadius = aim.radius * radius
  const targets = battle.enemies.filter(unit => {
    const radius = cursorRadius + monsters[unit.id].interactionRadius
    return unit.hp > 0 && distance(aim, unit) <= radius
  })
  const fieldTomes = battle.summary ? [] : battle.fieldTomes.filter(tome =>
    canSlashTome(battle, tome) && distance(aim, tome) <= cursorRadius + scene.tomeField.hitRadius)
  if (!targets.length && !fieldTomes.length && !strikePack) return false
  if (battle.tutorial === 'wait') battle.tutorial = 'fight'
  const club = ++battle.cursorAttacks % 3 === 0 && battle.equippedRelics.includes('Relic1_Club')
  for (const unit of targets) {
    const critical = crit > 0 && battle.random() < crit
    hurtEnemy(battle, unit, damage * (club ? 2 : 1) * (critical ? 2 : 1), 'cursor', {
      origin: aim, stun: club ? .8 : 0, popup: critical ? 'crit' : 'damage'
    })
  }
  for (const tome of fieldTomes) slashTome(battle, tome)
  return true
}

export function canSlashTome(battle: Battle, tome: FieldTome) {
  return tome.openedAt === null && battle.clock - tome.droppedAt >= scene.tomeField.slideDuration - 1e-6
}

function emitTomeSparks(battle: Battle, at: Point, art: TomeSpark, start = battle.clock) {
  const until = start + tomeSparkDuration(art)
  if (until > battle.clock) {
    battle.effects.push({ x: at.x, y: at.y, uid: battle.nextUid++, kind: 'tomeSpark', art, start, until, amount: 0 })
  }
}

function slashTome(battle: Battle, tome: FieldTome) {
  const config = scene.tomeField
  const decayTime = Math.max(0, battle.clock - tome.hitAt - config.firstHitDecayDelay)
  tome.hits = Math.min(config.hitCount, 1 + Math.max(0, tome.hits - decayTime * config.hitCount / config.firstHitDecayDuration))
  tome.hitAt = battle.clock
  if (tome.hits >= config.hitCount - 1e-6) {
    tome.openedAt = battle.clock
    playBattleCue(battle, tomes[tome.id].openSFX)
  } else {
    const definition = tomes[tome.id]
    const sound = 'hitSFX' in definition ? definition.hitSFX : undefined
    if (sound) playBattleCue(battle, sound)
    emitTomeSparks(battle, tome, 'packHit')
  }
}

function activateFieldTomes(battle: Battle, dt: number) {
  const config = scene.tomeField
  battle.fieldTomes = battle.fieldTomes.filter(tome => {
    if (tome.openedAt === null) return true
    const age = battle.clock - tome.openedAt
    const sinceBurst = age - config.anticipation + 1e-6
    if (sinceBurst >= 0 && sinceBurst < dt) emitTomeSparks(battle, tome, 'packOpen', tome.openedAt + config.anticipation)
    if (age < config.anticipation + config.openDuration - 1e-6) return true
    const foilDuration = tome.foil && tome.id === 'Tome_Thunderstorm' ? .5 : 0
    const duration = tomes[tome.id].buffDuration * ((statsModifiers(battle, tome.id).tomeDuration ?? 1) + relicEffect(battle, 95) + foilDuration)
    battle.tomes.push({ id: tome.id, uid: tome.uid, x: tome.x, y: tome.y, foil: tome.foil, startedAt: battle.clock, next: battle.clock,
      until: battle.clock + duration, lastCast: tome.id === frenzyTome ? battle.clock : -Infinity })
    return false
  })
}

// WaveSpawner.RandomEdgePosition samples 15% past the camera, biased toward the side edges.
export function spawnPosition(id: MonsterId, random: () => number): Point {
  const halfWidth = world.width * .575
  const halfHeight = world.height * .575
  if (id.startsWith('Boss')) {
    return { x: (random() < .5 ? -1 : 1) * halfWidth, y: (2 * random() - 1) * halfHeight }
  }
  const edge = Math.floor(random() * 10)
  const offset = 2 * random() - 1
  if (edge < 2) return { x: offset * halfWidth, y: (edge === 0 ? 1 : -1) * halfHeight }
  return { x: (edge < 6 ? -1 : 1) * halfWidth, y: offset * halfHeight }
}

function spawn(battle: Battle, id: MonsterId, at = spawnPosition(id, battle.random)) {
  const stats = monsters[id]
  const unit = fighter(battle.nextUid++, id, at, stats.maxHP, battle.clock, 'shield' in stats ? stats.shield : 0)
  if (id === 'Boss3_Witch') {
    unit.spellPeriod = monsters.Boss3_Witch.native.necromancerSummonInterval
    unit.spellAt += unit.spellPeriod
  }
  faceMonster(unit, bonfire)
  battle.enemies.push(unit)
  playUnitSound(battle, stats, 'spawnSFX')
  return unit
}

function castSpell(battle: Battle, name: keyof typeof spells, owner: HeroId, target: Point, multiplier: number) {
  const spell = spells[name]
  const mods = statsModifiers(battle, owner)
  recordSpellCast(battle, name, target)

  const range = Math.max(.1, spell.aoeRadius * (mods.area ?? 1) * (1 + mods.explosionRadius))
  const art = name === 'Spell_Tornado' ? 'boneHit' : 'blast'
  effect(battle, 'spell', target, 0, .5, undefined, art)
  for (const enemy of battle.enemies) {
    if (distance(enemy, target) > range) continue
    if (name === 'Spell_Stun') enemy.stunnedUntil = Math.max(enemy.stunnedUntil, battle.clock + spell.duration)
    else hurtEnemy(battle, enemy, spell.damage * multiplier, owner)
  }
  if (name === 'Spell_Tornado') {
    battle.zones.push({
      x: target.x, y: target.y, radius: range, damage: spell.damage * multiplier, spell: name,
      tick: spell.tickRate, next: battle.clock + spell.tickRate, until: battle.clock + spell.duration, owner
    })
  }
}

function shotEffect(battle: Battle, kind: ProjectileEffect['kind'], at: Point, lifetime: number, radius = 0, start = battle.clock) {
  battle.projectileEffects.push({ x: at.x, y: at.y, kind, uid: battle.nextProjectileUid++, start, until: start + lifetime, radius })
}

function launchProjectile(battle: Battle, flight: Flight, source: Fighter<HeroId>, target: Fighter<MonsterId>, damage: number, bounces = 0) {
  battle.projectiles.push({
    ...flight, uid: battle.nextProjectileUid++, source, target, damage, bounces,
    retargetAt: battle.clock
  })
}

function spellProjectileCasts(battle: Battle, source: Fighter<HeroId>, target: Fighter<MonsterId>, kind: 'fireball' | 'infection', damage: number) {
  const name = kind === 'fireball' ? 'Spell_Fireball' : 'Spell_InfectionBomb'
  const modifiers = statsModifiers(battle, source.original)
  const extra = source.foil ? (kind === 'fireball' ? 2 : 1) : 0
  const count = Math.max(1, 1 + Math.floor(modifiers.casts ?? 0) + extra)
  recordSpellCast(battle, name, source, count)
  if (count === 1) launchProjectile(battle, createFlight(kind, source, target), source, target, damage)
  else {
    const range = heroes[source.id].attackRange * (modifiers.attackRange ?? 1)
    for (const direction of castDirections(source, target, count)) {
      launchProjectile(battle, createFlight(kind, source, target, { direction, range }), source, target, damage)
    }
  }
  if (kind === 'fireball') playBattleCue(battle, projectileConfig.fireball.castSound)
}

function impactCritical(battle: Battle, source: Fighter<HeroId>) {
  const unit = heroes[source.id]
  const mods = statsModifiers(battle, source.original)
  const foil = source.foil && source.id === 'Hero3_DemonSlayer' ? .5 : 0
  const chance = (mods.critChance ?? 0) + ('critChance' in unit ? unit.critChance : 0) + foil
  if (chance <= 0 || battle.random() >= chance) return 1
  return 2 + (mods.critDamage ?? 0) + ('critDamage' in unit ? unit.critDamage : 0) + foil
}

function landArrow(battle: Battle, shot: Projectile) {
  const { source, target } = shot
  if (target.hp > 0) {
    const multiplier = impactCritical(battle, source)
    const crit = multiplier > 1
    const damage = shot.damage * multiplier
    if (crit) {
      effect(battle, 'spell', target, 0, .4, undefined, 'crit')
      playUnitSound(battle, heroes[source.id], 'critSFX')
    }
    const before = battle.defeated
    hurtEnemy(battle, target, damage, source.original, { origin: shot.origin, popup: crit ? 'crit' : 'damage' })
    rewardHeroAttack(battle, source, target, before, crit, damage)
  }
  const next = !battle.respawn && shot.bounces > 0 && nearest(shot, battle.enemies.filter(enemy => enemy !== target))
  if (!next) return false
  Object.assign(shot, createFlight('arrow', shot, next), { target: next, bounces: shot.bounces - 1 })
  return true
}

function spellProjectileRadius(battle: Battle, shot: Projectile, radius: number) {
  return radius * (1 + (battle.modifiers.effect?.(48, shot.source.original) ?? 0))
}

function fireballOverlaps(shot: Projectile, enemy: Fighter<MonsterId>, radius: number) {
  const colliderRadius = projectileConfig.fireball.monsterColliderRadius * monsters[enemy.id].spriteScale
  return enemy.hp > 0 && distance(shot, enemy) <= radius + colliderRadius
}

function landFireball(battle: Battle, shot: Projectile) {
  const radius = spellProjectileRadius(battle, shot, spells.Spell_Fireball.aoeRadius)
  const config = projectileConfig.fireball
  shotEffect(battle, 'fireBurst', shot, config.flameLifetime, radius)
  const spread = Math.max(.1, radius * .75)
  for (let i = 0; i < config.groundCount; i++) {
    const angle = battle.random() * 2 * Math.PI
    const distance = Math.sqrt(battle.random()) * spread
    shotEffect(battle, 'fireGround', { x: shot.x + Math.cos(angle) * distance, y: shot.y + Math.sin(angle) * distance },
      config.groundLifetime)
  }
  playBattleCue(battle, config.impactSound)
  for (const enemy of battle.enemies) {
    if (!fireballOverlaps(shot, enemy, radius)) continue
    const multiplier = impactCritical(battle, shot.source)
    const damage = shot.damage * multiplier
    const before = battle.defeated
    hurtEnemy(battle, enemy, damage, shot.source.original, { origin: shot.origin, popup: multiplier > 1 ? 'crit' : 'fire' })
    rewardHeroAttack(battle, shot.source, enemy, before, multiplier > 1, damage)
    if (battle.respawn) return
  }
}

function landInfectionBomb(battle: Battle, shot: Projectile) {
  const spell = spells.Spell_InfectionBomb
  const config = projectileConfig.infection
  const radius = spellProjectileRadius(battle, shot, spell.aoeRadius)
  const mods = statsModifiers(battle, shot.source.original)
  shotEffect(battle, 'infectionGround', shot.landing, config.groundLifetime, radius)
  playBattleCue(battle, config.impactSound)
  for (const enemy of battle.enemies) {
    if (enemy.hp <= 0 || distance(shot.landing, enemy) > radius) continue
    const previous = enemy.infection && enemy.infection.until > battle.clock ? enemy.infection : null
    enemy.infection = {
      next: battle.clock, until: Math.max(battle.clock + spell.duration, previous?.until ?? 0),
      stacks: Math.min(config.maxStacks, 1 + (previous?.stacks ?? 0)),
      damage: Math.max(shot.damage, previous?.damage ?? 0), slow: mods.infectionSlow, vulnerability: mods.infectionVulnerability,
      source: shot.source
    }
  }
}

function tickInfections(battle: Battle) {
  for (const enemy of battle.enemies) {
    const infection = enemy.infection
    if (!infection || enemy.hp <= 0) continue
    while (infection.next <= battle.clock && infection.next < infection.until && enemy.hp > 0) {
      const multiplier = impactCritical(battle, infection.source)
      const before = battle.defeated
      const damage = infection.damage * infection.stacks * multiplier
      infection.next += spells.Spell_InfectionBomb.tickRate
      hurtEnemy(battle, enemy, damage, infection.source.original, { infectionTick: true, popup: multiplier > 1 ? 'crit' : 'damage' })
      rewardHeroAttack(battle, infection.source, enemy, before, multiplier > 1, damage)
      if (battle.respawn) return
    }
    if (infection.until <= battle.clock) enemy.infection = null
  }
}

function tickProjectiles(battle: Battle, dt: number) {
  const inFlight: Projectile[] = []
  for (const shot of battle.projectiles) {
    if (battle.respawn) {
      inFlight.push(shot)
      continue
    }
    if (shot.kind === 'fireball' && !shot.direction && shot.target.hp <= 0) {
      if (shot.retargetAt <= battle.clock) {
        shot.retargetAt = battle.clock + projectileConfig.fireball.retargetInterval
        for (const enemy of battle.enemies) if (enemy.hp > shot.target.hp) shot.target = enemy
      }
      if (shot.target.hp <= 0) {
        inFlight.push(shot)
        continue
      }
    }
    const before = { x: shot.x, y: shot.y, age: shot.age }
    let arrived = advanceFlight(shot, shot.target, dt)
    if (shot.kind === 'fireball') {
      const { trailPerSecond, flameLifetime, directionalContactRadius } = projectileConfig.fireball
      arrived ||= shot.direction !== null && battle.enemies.some(enemy => fireballOverlaps(shot, enemy, directionalContactRadius))
      for (let i = Math.floor(before.age * trailPerSecond) + 1; i <= Math.floor(shot.age * trailPerSecond); i++) {
        const at = i / trailPerSecond - before.age
        const step = at / dt
        shotEffect(battle, 'flame', { x: before.x + (shot.x - before.x) * step, y: before.y + (shot.y - before.y) * step },
          flameLifetime, 0, battle.clock - dt + at)
      }
    }
    if (!arrived) inFlight.push(shot)
    else if (shot.kind === 'fireball') landFireball(battle, shot)
    else if (shot.kind === 'infection') landInfectionBomb(battle, shot)
    else if (landArrow(battle, shot)) inFlight.push(shot)
  }
  battle.projectiles = inFlight
}

function pickThunderboltTarget(battle: Battle) {
  const { viewportMargin, towerDistanceSquaredBias } = rules.thunderstorm
  const visibleX = world.width * (.5 - viewportMargin)
  const visibleY = world.height * (.5 - viewportMargin)
  const alive = battle.enemies.filter(enemy => enemy.hp > 0)
  const visible = alive.filter(enemy => Math.abs(enemy.x) <= visibleX && Math.abs(enemy.y) <= visibleY)
  const candidates = visible.length ? visible : alive
  if (!candidates.length) return undefined
  const weights = candidates.map(enemy =>
    1 / ((enemy.x - bonfire.x) ** 2 + (enemy.y - bonfire.y) ** 2 + towerDistanceSquaredBias))
  let roll = battle.random() * weights.reduce((sum, weight) => sum + weight, 0)
  for (let index = 0; index < candidates.length - 1; index++) {
    roll -= weights[index]
    if (roll <= 0) return candidates[index]
  }
  return candidates.at(-1)
}

function castThunderbolt(battle: Battle, tome: TomeBuff) {
  const spell = 'Spell_Thunderbolt'
  const config = rules.thunderstorm
  playBattleCue(battle, config.castSound)
  const target = pickThunderboltTarget(battle)
  const [min, max] = config.damageRange
  const damage = min + (max - min) * battle.random()
  let at: Point = target ?? tome
  if (!target) {
    const angle = battle.random() * Math.PI * 2
    const radius = config.castScatterRadius * Math.sqrt(battle.random())
    at = { x: tome.x + Math.cos(angle) * radius, y: tome.y + Math.sin(angle) * radius }
  }
  recordSpellCast(battle, spell, at)
  effect(battle, 'thunderbolt', at, 0, scene.thunderbolt.emissionDelay + scene.thunderbolt.particleLifetime)
  if (target) {
    const bonus = Math.max(0, battle.modifiers.effect?.(105, spell) ?? 0)
    const stun = config.stun * (1 + (battle.modifiers.effect?.(128, spell) ?? 0))
    hurtEnemy(battle, target, damage * (1 + bonus), tome.id, { stun })
  }
}

function summonRaiseDeadSkeleton(battle: Battle, tome: TomeBuff) {
  const { native } = tomes.Tome_RaiseDead
  const angle = 2 * Math.PI * battle.random()
  const radius = native.summonSpawnMinRadius + (native.summonSpawnMaxRadius - native.summonSpawnMinRadius) * battle.random()
  const position = { x: bonfire.x + Math.cos(angle) * radius, y: bonfire.y + Math.sin(angle) * radius }
  const skeleton = deployHero(battle, 'Hero_Skeleton', position, {})
  skeleton.summonDamageMultiplier = Math.max(0, 1 + (battle.modifiers.effect?.(658, tome.id) ?? 0) + (tome.foil ? .5 : 0))
}

export function dragonPosition(dragon: DragonFlight, at: number): Point {
  const progress = Math.max(0, Math.min(1, (at - dragon.startedAt) / (dragon.exitAt - dragon.startedAt)))
  return { x: dragon.start.x + (dragon.exit.x - dragon.start.x) * progress, y: dragon.start.y }
}

function summonDragon(battle: Battle, tome: TomeBuff) {
  const id = 'Tome_DragonsCall'
  const spellId = 'Spell_DragonsCall'
  const spell = spells[spellId]
  const config = scene.dragon
  const targets = battle.enemies.filter(enemy => enemy.hp > 0)
  const emptyLane = Math.max(.1, world.height / 2 - config.emptyLaneMargin)
  const y = targets.length ? targets[Math.floor(battle.random() * targets.length)].y : (2 * battle.random() - 1) * emptyLane
  const side = world.width / 2 + config.edgeMargin
  const x = battle.random() < .5 ? -side : side
  const flightTime = 2 * side / Math.max(.5, spell.projectileSpeed)
  const durationBonus = battle.modifiers.effect?.(128, spellId) ?? 0
  const linger = Math.max(0, Math.max(.1, spell.duration * (1 + durationBonus)) - flightTime)
  const trailTicks = linger > config.minimumLinger ? Math.ceil(linger / spell.tickRate) : 0
  const exitAt = battle.clock + flightTime
  const damageBonus = battle.modifiers.effect?.(140, id) ?? 0
  battle.dragons.push({
    uid: battle.nextUid++, start: { x, y }, exit: { x: -x, y },
    startedAt: battle.clock, exitAt, nextTrailTick: exitAt + spell.tickRate, lastTrailTick: exitAt + trailTicks * spell.tickRate,
    radius: spell.aoeRadius, damage: spell.damage * Math.max(0, 1 + damageBonus), nextPassHit: new Map()
  })
  recordSpellCast(battle, spellId, tome)
  playBattleCue(battle, config.castSound)
}

function tickDragons(battle: Battle, dt: number) {
  const period = spells.Spell_DragonsCall.tickRate
  const samples = scene.dragon.trailSampleCount
  for (const dragon of battle.dragons) {
    const previousAt = Math.max(dragon.startedAt, battle.clock - dt)
    if (previousAt < dragon.exitAt) {
      const from = dragonPosition(dragon, previousAt)
      const to = dragonPosition(dragon, battle.clock)
      const left = Math.min(from.x, to.x)
      const right = Math.max(from.x, to.x)
      for (const enemy of battle.enemies) {
        if (enemy.hp <= 0 || (dragon.nextPassHit.get(enemy.uid) ?? 0) > battle.clock) continue
        const circle = dragon.radius + projectileConfig.fireball.monsterColliderRadius * monsters[enemy.id].spriteScale
        const contact = { x: Math.max(left, Math.min(right, enemy.x)), y: from.y }
        if (distance(contact, enemy) > circle) continue
        hurtEnemy(battle, enemy, dragon.damage, 'Tome_DragonsCall', { origin: contact })
        dragon.nextPassHit.set(enemy.uid, battle.clock + period)
        if (battle.respawn) return
      }
    }

    while (dragon.nextTrailTick <= dragon.lastTrailTick + 1e-6 && dragon.nextTrailTick <= battle.clock + 1e-6) {
      dragon.nextTrailTick += period
      for (const enemy of battle.enemies) {
        if (enemy.hp <= 0) continue
        const circle = dragon.radius + projectileConfig.fireball.monsterColliderRadius * monsters[enemy.id].spriteScale
        if (Math.abs(enemy.y - dragon.start.y) > circle) continue
        const progress = (enemy.x - dragon.start.x) / (dragon.exit.x - dragon.start.x)
        const index = Math.max(0, Math.min(samples - 1, Math.floor(progress * samples)))
        const x = dragon.start.x + (dragon.exit.x - dragon.start.x) * (index + .5) / samples
        const contact = { x, y: dragon.start.y }
        if (distance(contact, enemy) > circle) continue
        hurtEnemy(battle, enemy, dragon.damage, 'Tome_DragonsCall', { origin: contact })
        if (battle.respawn) return
      }
    }
  }
  battle.dragons = battle.dragons.filter(dragon =>
    battle.clock < Math.max(dragon.lastTrailTick, dragon.exitAt + scene.dragon.ground.lifetime[1]))
}

function updateTomes(battle: Battle, dt: number) {
  const before = battle.tomes.length ? cursorProfile(battle, battle.clock - dt) : null
  activateFieldTomes(battle, dt)
  battle.tomes = battle.tomes.filter(tome => tome.until > battle.clock + 1e-6)
  if (before?.stacks || battle.tomes.some(tome => tome.id === frenzyTome)) {
    const after = cursorProfile(battle)
    if (after.stacks !== (before?.stacks ?? 0)) battle.nextPulse += after.interval - (before?.interval ?? battle.pulseInterval)
  }
  for (const tome of battle.tomes) {
    if (battle.clock < tome.next) continue
    const id = tome.id
    if (id === frenzyTome) continue
    const definition = tomes[id]
    const rate = Math.max(.05, 1 - (battle.modifiers.effect?.(97, id) ?? 0))
    const interval = id === 'Tome_RaiseDead' ? definition.tickInterval :
      definition.tickIntervalRandomMin + (definition.tickIntervalRandomMax - definition.tickIntervalRandomMin) * battle.random()
    tome.next = battle.clock + interval * rate
    tome.lastCast = battle.clock
    const foilCasts = tome.foil && id === 'Tome_DragonsCall' ? 1 : 0
    for (let i = 0; i < definition.castsPerTick + statsModifiers(battle, id).extraTomeCasts + foilCasts; i++) {
      if (id === 'Tome_Thunderstorm') {
        castThunderbolt(battle, tome)
      } else if (id === 'Tome_RaiseDead') {
        summonRaiseDeadSkeleton(battle, tome)
      } else summonDragon(battle, tome)
    }
  }
}

function spellSpeed(ally: Fighter<HeroId>, modifiers: Record<string, number>) {
  return modifiers.spellSpeed * (ally.foil && ally.id === 'Hero3_Portal' ? 2 : 1)
}

function tickAttackCharge(unit: Fighter<UnitId>, inRange: boolean, dt: number) {
  unit.chargeIntensity = inRange
    ? Math.min(1, unit.chargeIntensity + dt / combatFeel.chargeFadeIn)
    : Math.max(0, unit.chargeIntensity - dt / combatFeel.chargeFadeOut)
}

function chooseDashTarget(battle: Battle, ally: Fighter<HeroId>, hit: ReadonlySet<number>) {
  let choice: Fighter<MonsterId> | undefined
  let bestTier = -1
  let farthest = -1
  for (const enemy of battle.enemies) {
    if (enemy.hp <= 0 || hit.has(enemy.uid) ||
        Math.abs(enemy.x) > halfBattlefieldWidth || Math.abs(enemy.y) > halfBattlefieldHeight) continue
    const dx = (enemy.x - bonfire.x) / (monkDash.guardRadius * monkDash.guardAspect)
    const dy = (enemy.y - bonfire.y) / monkDash.guardRadius
    const inside = dx * dx + dy * dy <= 1
    const gap = distance(ally, enemy)
    const stats = monsters[enemy.id]
    const defender = nearest(enemy, battle.allies)
    const aggro = enemy.id !== 'Monster1_Raider' && defender && distance(enemy, defender) < stats.aggroRange
      ? defender : undefined
    const threat = enemy.stunnedUntil <= battle.clock && (aggro ? aggro === ally :
      distance(enemy, bonfire) <= stats.attackRange + rules.tower.monsterTowerAttackRangeOffset)
    const preferred = gap >= monkDash.preferredMin && gap <= monkDash.preferredMax
    const tier = (inside ? (preferred ? 4 : 2) : 0) + Number(threat)
    if (tier < bestTier || (tier === bestTier && gap <= farthest)) continue
    choice = enemy
    bestTier = tier
    farthest = gap
  }
  return choice
}

function applyDashKnockback(target: Fighter<MonsterId>, direction: Point) {
  const stats = monsters[target.id]
  const scale = stats.knockbackReceivedMultiplier * (stats.monsterType === 4 ? monsterKnockback.bossMultiplier : 1)
  if (scale <= 0) return
  const force = monsterKnockback.impulseStrength * monkDash.hitKnockbackMultiplier
  const previous = target.knockback ?? { x: 0, y: 0 }
  const x = previous.x + direction.x * force
  const y = previous.y + direction.y * force
  const limit = Math.max(1, Math.hypot(x, y) / monsterKnockback.maxSpeed)
  target.knockback = {
    x: previous.x + (x / limit - previous.x) * scale,
    y: previous.y + (y / limit - previous.y) * scale
  }
}

function advanceMonkDash(
  battle: Battle, ally: Fighter<HeroId>, dash: MonkDash, speed: number, dt: number, tableContact?: DashTableContact
) {
  if (battle.clock < dash.nextAt) return
  if (!dash.leg) {
    const target = dash.legs > 0 ? chooseDashTarget(battle, ally, dash.hit) : undefined
    if (!target) {
      ally.dash = null
      return
    }
    const gap = distance(ally, target)
    turn(ally, target)
    dash.leg = { target, direction: unitDirection(ally, target, .00001), remaining: gap, touched: new Set() }
    dash.legs--
  }
  const { leg } = dash
  const step = Math.min(leg.remaining, dt * speed * monkDash.speedMultiplier)
  ally.x += leg.direction.x * step
  ally.y += leg.direction.y * step
  leg.remaining -= step
  if (distance(dash.trail.at(-1)!, ally) >= monkDash.trail.minVertexDistance) {
    dash.trail.push({ x: ally.x, y: ally.y, at: battle.clock })
  }
  const { target } = leg
  const contact = monkDash.colliderRadius * (monsters[target.id].spriteScale + (ally.giant ? 1.5 : 1)) +
    monkDash.contactTolerance
  const connected = step > 0 && target.hp > 0 && !dash.hit.has(target.uid) && distance(target, ally) <= contact
  if (connected) {
    dash.hit.add(target.uid)
    const modifiers = statsModifiers(battle, ally.original)
    const critical = impactCritical(battle, ally)
    const damage = heroes[ally.id].attackDamage * modifiers.attackDamage * (ally.giant ? 2 : 1) * critical
    const before = battle.defeated
    playBattleCue(battle, monkDash.hitSound)
    hurtEnemy(battle, target, damage, ally.original, { origin: ally, popup: critical > 1 ? 'crit' : 'damage' })
    if (target.hp <= 0) ally.extraDashes += Math.max(0, Math.round(modifiers.dashOnKill))
    else applyDashKnockback(target, leg.direction)
    rewardHeroAttack(battle, ally, target, before, critical > 1, damage)
  }
  if (step > 0) tableContact?.(ally, leg.touched)
  if (connected || leg.remaining <= 0) {
    dash.leg = null
    dash.nextAt = battle.clock + (connected ? spells.Spell_Dash.dashHitHoldDuration : 0) +
      (dash.legs > 0 ? monkDash.legDelay : 0)
  }
}

function summonPortalAlly(battle: Battle, ally: Point) {
  const bonus = 2 * Math.round(battle.modifiers.effect?.(113, 'Hero3_Portal') ?? 0)
  const choices = battle.discoveredHeroes
    .filter(id => id !== 'Hero3_Portal' && id !== 'Hero_Skeleton')
    .map(id => {
      const rarity = heroes[id].rarity
      return { id, weight: (portalRarityWeights[rarity] ?? portalRarityWeights[0]) + (rarity > 0 ? bonus : 0) }
    })
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
  if (total <= 0) return
  let roll = battle.random() * total
  const hero = choices.find(choice => (roll -= choice.weight) <= 0) ?? choices.at(-1)!
  const angle = 2 * Math.PI * battle.random()
  const radius = .35 * Math.sqrt(battle.random())
  deployCard(battle, hero.id, { x: ally.x + Math.cos(angle) * radius, y: ally.y + Math.sin(angle) * radius }, false)
}

function moveTowerOrbit(
  battle: Battle, ally: Fighter<HeroId>, definition: typeof portal | typeof illusionist, dt: number, ordinal: number, count: number
) {
  const native = definition.native
  const angle = battle.clock * native.spawnerTowerOrbitRadiansPerSecond + 2 * Math.PI * ordinal / count
  const target = {
    x: bonfire.x + Math.cos(angle) * native.spawnerTowerOrbitBaseRadius,
    y: bonfire.y + Math.sin(angle) * native.spawnerTowerOrbitBaseRadius
  }
  const modifiers = statsModifiers(battle, ally.original)
  move(ally, target, Math.max(.01, definition.moveSpeed) * (modifiers.moveSpeed ?? 1), dt, 0)
}

function tickPortal(battle: Battle, ally: Fighter<HeroId>, dt: number, ordinal: number, count: number) {
  if (battle.clock < ally.stunnedUntil) {
    ally.spellAt += dt
    return
  }
  const native = portal.native
  moveTowerOrbit(battle, ally, portal, dt, ordinal, count)

  if (battle.clock >= ally.castUntil) {
    ally.portalIdleAge += Math.min(dt, battle.clock - ally.castUntil)
  }
  if (ally.spellAt > battle.clock + 1e-8) return
  recordSpellCast(battle, 'Spell_SpawnerSummon', ally)
  playBattleCue(battle, 'chapter-2-3/588-sfx_movement_portal6.wav')
  summonPortalAlly(battle, ally)
  ally.summoned++
  if (ally.summoned >= native.spawnerMaxSummons) {
    const { x, y, flip, giant, foil, portalIdleAge } = ally
    battle.expiringPortals.push({ x, y, flip, giant, foil, portalIdleAge, id: 'Hero3_Portal', portalExpiredAt: battle.animationClock })
    ally.hp = 0
    return
  }
  ally.spellAt = battle.clock + ally.spellPeriod
  ally.castUntil = battle.clock + native.spawnerCastPopDuration
}

function moveHeroes(battle: Battle, dt: number, tableContact?: DashTableContact) {
  const portalCount = battle.allies.filter(ally => ally.hp > 0 && !ally.entry && ally.id === 'Hero3_Portal').length
  const illusionistCount = battle.allies.filter(ally => ally.hp > 0 && !ally.entry && ally.id === 'Hero3_Illusionist').length
  let portalOrdinal = 0
  let illusionistOrdinal = 0
  for (const ally of battle.allies.slice()) {
    if (battle.respawn) return
    if (ally.hp <= 0 || ally.entry) continue
    if (ally.id === 'Hero3_Portal') {
      tickPortal(battle, ally, dt, portalOrdinal++, portalCount)
      continue
    }
    if (ally.id === 'Hero3_Illusionist') {
      if (battle.clock >= ally.stunnedUntil) {
        const previousX = ally.x
        moveTowerOrbit(battle, ally, illusionist, dt, illusionistOrdinal, illusionistCount)
        const horizontal = ally.x - previousX
        if (horizontal !== 0) ally.flip = horizontal > 0
      }
      illusionistOrdinal++
      continue
    }
    if (battle.clock < ally.stunnedUntil) {
      ally.dash = null
      tickAttackCharge(ally, false, dt)
      continue
    }
    const enemy = nearest(ally, battle.enemies)
    const stats = heroes[ally.id]
    const modifiers = statsModifiers(battle, ally.original)
    const speed = stats.moveSpeed * (modifiers.moveSpeed ?? 1) * (ally.foil && ally.id === 'Hero2_Monk' ? 1.5 : 1)
    if (ally.dash) {
      ally.attackAt += dt
      advanceMonkDash(battle, ally, ally.dash, speed, dt, tableContact)
      continue
    }
    const spell = 'spell' in stats && typeof stats.spell === 'string' && Object.hasOwn(spells, stats.spell)
      ? stats.spell as keyof typeof spells : undefined

    if (spell && enemy && 'spellOnAttack' in stats && !stats.spellOnAttack && ally.spellAt <= battle.clock) {
      castSpell(battle, spell, ally.id, enemy, stats.spellPower)
      ally.spellPeriod = Math.max(.5, stats.spellCastInterval / spellSpeed(ally, modifiers))
      ally.spellAt = battle.clock + ally.spellPeriod
      ally.castUntil = battle.clock + .4
    }

    if (ally.lunge) continue
    if (!enemy) {
      tickAttackCharge(ally, false, dt)
      const position = formation(ally.uid)
      turn(ally, position)
      move(ally, position, speed * 0.55, dt, 0.015)
      continue
    }

    turn(ally, enemy)
    const range = stats.attackRange * (modifiers?.attackRange ?? 1) + monsters[enemy.id].interactionRadius
    move(ally, enemy, speed, dt, range)
    const canAttack = stats.attackDamage > 0 && stats.attackCooldown > 0 && distance(ally, enemy) <= range + .002
    tickAttackCharge(ally, canAttack, dt)
    if (!canAttack || ally.attackAt > battle.clock) continue
    const foilSpeed = ally.foil && ally.id === 'Hero2_Monk' ? 2 : 1
    const attackRate = ((modifiers.attackSpeed ?? 1) + modifiers.frenzy * (1 - ally.hp / ally.maxHp)) * foilSpeed
    ally.attackPeriod = stats.attackCooldown / Math.max(.05, attackRate)
    ally.attackAt = battle.clock + ally.attackPeriod
    ally.chargeIntensity = 0
    if (spell === 'Spell_Dash') {
      const trail = [{ x: ally.x, y: ally.y, at: battle.clock - dt }]
      const legs = Math.max(1, spells.Spell_Dash.dashCount + Math.round(modifiers.dashCount) + ally.extraDashes)
      ally.dash = { legs, nextAt: battle.clock, hit: new Set(), leg: null, trail }
      battle.dashTrails.push(trail)
      recordSpellCast(battle, 'Spell_Dash', ally)
      playBattleCue(battle, monkDash.castSound)
      advanceMonkDash(battle, ally, ally.dash, speed, dt, tableContact)
      continue
    }
    beginAttackPose(ally, enemy, battle.clock, 'attackType' in stats && stats.attackType === 1)
    playUnitSound(battle, stats, 'attackSFX')
    let damage = stats.attackDamage * modifiers.attackDamage * ally.summonDamageMultiplier
    if (ally.foil && ally.original === 'Hero1_Squire') damage *= 1.5
    if (ally.giant) damage *= 2
    if (ally.id === 'Hero1_Archer' || ally.id === 'Hero3_DemonSlayer') {
      const bounces = Math.max(0, Math.floor(modifiers.bounces ?? 0))
      launchProjectile(battle, createFlight('arrow', ally, enemy), ally, enemy, damage, bounces)
      continue
    }
    if (spell === 'Spell_Fireball' || spell === 'Spell_InfectionBomb') {
      spellProjectileCasts(battle, ally, enemy, spell === 'Spell_Fireball' ? 'fireball' : 'infection', damage)
      continue
    }
    const chance = (modifiers.critChance ?? 0) + ('critChance' in stats ? stats.critChance : 0)
    const crit = chance > 0 && battle.random() < chance
    if (crit) {
      damage *= 1 + (modifiers.critDamage ?? 0) + ('critDamage' in stats ? stats.critDamage : 0)
      effect(battle, 'spell', enemy, 0, .4, undefined, 'crit')
      playUnitSound(battle, stats, 'critSFX')
    }
    const defeatedBefore = battle.defeated
    const popup = crit ? 'crit' : 'damage'
    hurtEnemy(battle, enemy, damage, ally.original, { origin: ally, popup })
    if (spell && 'spellOnAttack' in stats && stats.spellOnAttack) {
      const extraCasts = ally.foil && ally.id === 'Hero4_Stormcaller' ? 2 : 0
      for (let cast = 0; cast < 1 + (modifiers.casts ?? 0) + extraCasts; cast++) {
        castSpell(battle, spell, ally.id, enemy, stats.spellPower)
      }
    }
    if (stats.areaAttack > 0) {
      for (const other of battle.enemies) {
        if (other !== enemy && distance(enemy, other) <= stats.areaAttack * (modifiers?.area ?? 1)) {
          hurtEnemy(battle, other, damage, ally.original, { origin: ally, popup })
        }
      }
    }
    let previous = enemy
    const affected = new Set([enemy])
    for (let bounce = 0; bounce < (modifiers.bounces ?? 0); bounce++) {
      const nearby = battle.enemies.filter(unit => !affected.has(unit) && distance(previous, unit) <= 2)
      const next = nearest(previous, nearby)
      if (!next) break
      affected.add(next)
      hurtEnemy(battle, next, damage, ally.original, { origin: ally, popup })
      previous = next
    }
    rewardHeroAttack(battle, ally, enemy, defeatedBefore, crit, damage)
  }
}

function rewardHeroAttack(
  battle: Battle, ally: Fighter<HeroId>, target: Fighter<MonsterId>, defeatedBefore: number, critical: boolean, damage: number
) {
  const stats = heroes[ally.id]
  const mods = statsModifiers(battle, ally.original)
  const kills = battle.defeated - defeatedBefore
  if (kills > 0) {
    ally.kills += kills
    if (ally.hp > 0) {
      const hp = ally.hp
      ally.hp = Math.min(ally.maxHp, hp + ally.maxHp * mods.healOnKill * kills)
      showDamageNumber(battle.damageNumbers, ally, ally.hp - hp, 'heal', ally)
      if (ally.original === 'Hero1_Squire') promoteSquire(battle, ally, mods.promotions)
    }
    if (critical && mods.bladeRainOnKill) {
      const arrows = 8 + (battle.modifiers.effect?.(87, 'Spell_BladeRain') ?? 0)
      const targets = battle.enemies.filter(other => other.hp > 0 && distance(target, other) <= 1.5)
      for (const other of targets.slice(0, arrows)) hurtEnemy(battle, other, damage, ally.original, { origin: ally })
      effect(battle, 'spell', target, 0, .42, undefined, 'crit')
    }
  }
  if (target.hp <= 0 && 'gainCoinOnKillChance' in stats && stats.gainCoinOnKillChance > 0 &&
      battle.random() < stats.gainCoinOnKillChance) battle.coins++
}

function promoteSquire(battle: Battle, ally: Fighter<HeroId>, unlocked: number) {
  const tier = heroes.Hero1_Squire.promotionTiers.slice(0, unlocked).filter(t => ally.kills >= t.kills).at(-1)
  if (!tier || !isHero(tier.hero as CardId) || tier.hero === ally.id) return
  ally.id = tier.hero as HeroId
  const oldMax = ally.maxHp
  const multiplier = statsModifiers(battle, ally.original).hp ?? 1
  ally.maxHp = heroes[ally.id].maxHP * multiplier * (ally.foil ? 2 : 1) * (ally.giant ? 2 : 1)
  ally.hp = Math.min(ally.maxHp, ally.hp + Math.max(0, ally.maxHp - oldMax))
  effect(battle, 'spell', ally, 0, .6, undefined, 'upgrade')
}

function explodeIllusionist(battle: Battle, target: Fighter<HeroId>, modifiers: Record<string, number>) {
  if (target.illusionistPrincipal === null) {
    const survivors = battle.allies.filter(unit => unit.hp > 0 && unit.illusionistPrincipal === target.uid)
    if (survivors.length) {
      const heir = survivors[Math.floor(battle.random() * survivors.length)]
      for (const survivor of survivors) survivor.illusionistPrincipal = heir.uid
      heir.illusionistPrincipal = null
    }
  }

  const radius = energyExplosion.aoeRadius * (1 + modifiers.explosionRadius)
  const critChance = illusionist.critChance + (modifiers.critChance ?? 0)
  const critical = critChance > 0 && battle.random() < critChance
  const damage = illusionist.attackDamage * modifiers.attackDamage * (1 + modifiers.explosionDamage) *
    (critical ? 1 + illusionist.critDamage + (modifiers.critDamage ?? 0) : 1)
  const at = battle.animationClock
  battle.illusionistBlasts.push({ x: target.x, y: target.y, at, uid: battle.nextUid++ })
  playBattleCue(battle, 'chapter-2-3/458-14_wizard_teleport_arrive.wav')
  recordSpellCast(battle, 'Spell_AoeCircle', target)
  for (const enemy of battle.enemies) {
    if (enemy.hp <= 0 || distance(enemy, target) > radius) continue
    battle.illusionistBlasts.push({ x: enemy.x, y: enemy.y, at, uid: battle.nextUid++ })
    hurtEnemy(battle, enemy, damage, target.original, { origin: target, popup: critical ? 'crit' : 'damage' })
  }
}

function hurtHero(battle: Battle, target: Fighter<HeroId>, damage: number, origin: Point) {
  if (target.hp <= 0 || battle.clock < target.invulnerableUntil || target.dash) return
  const stats = heroes[target.id]
  const modifiers = statsModifiers(battle, target.original)
  const blockChance = (modifiers.block ?? 0) + ('blockChance' in stats ? stats.blockChance : 0) +
    (target.foil && target.id === 'Hero2_Knight' ? .5 : 0)
  const block = blockChance > 0 && battle.random() < blockChance
  const reduction = 'baseIncomingDamageReduction' in stats ? stats.baseIncomingDamageReduction : 0
  const adjusted = block ? 0 : Math.max(0, damage * (1 - reduction))
  const shielding = Math.min(target.shield, adjusted)
  target.shield -= shielding
  const amount = Math.min(target.hp, adjusted - shielding)
  tracked(battle, target.original).defense += amount + shielding
  if (amount <= 0) return
  target.hp -= amount
  target.invulnerableUntil = battle.clock + combatFeel.heroHitInvulnerabilityDuration
  markDamage(target, battle.clock)
  showDamageNumber(battle.damageNumbers, target, amount, 'taken', target)
  target.stunnedUntil = battle.clock + stats.hitStunDurationSeconds
  effect(battle, 'hit', target, amount, .55)
  if (target.hp <= 0) {
    fallUnit(battle, target, 'hero', origin)
    if (target.id === 'Hero3_Illusionist') {
      explodeIllusionist(battle, target, modifiers)
      playUnitSound(battle, stats, 'defeatSFX')
    }
    for (let i = 0; i < modifiers.deathSummon; i++) deployCard(battle, 'Hero_Skeleton', target, false)
  }
}

const wraith = monsters.Boss3_Witch

function beginShadowCast(battle: Battle, witch: Fighter<MonsterId>) {
  const stats = wraith.native
  witch.castUntil = witch.attackAt = battle.clock + stats.necromancerCastDuration
  witch.spellAt = witch.castUntil + stats.necromancerSummonInterval
  witch.chargeIntensity = 0
  witch.pendingShadows += stats.necromancerSummonCount
  playUnitSound(battle, wraith, 'necromancerSummonSFX')
}

function tickShadowQueue(battle: Battle, witch: Fighter<MonsterId>) {
  // Monster.TickNecromancerMinionSpawnQueue releases up to two of the queued units per frame.
  const count = Math.min(2, witch.pendingShadows)
  witch.pendingShadows -= count
  for (let i = 0; i < count; i++) {
    const angle = battle.random() * Math.PI * 2
    const radius = Math.sqrt(battle.random()) * wraith.native.necromancerSummonRadius
    spawn(battle, 'Monster3_Shadow', { x: witch.x + Math.cos(angle) * radius, y: witch.y + Math.sin(angle) * radius })
  }
}

const meleeConeSlope = Math.tan(Math.PI / 6)

function hitMeleeCone(battle: Battle, enemy: Fighter<MonsterId>, point: Point, length: number, damage: number) {
  const dx = point.x - enemy.x
  const dy = point.y - enemy.y
  const distance = Math.hypot(dx, dy)
  const axis = distance > .0001 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 }
  battle.effects.push({
    x: enemy.x, y: enemy.y, uid: battle.nextUid++, kind: 'spell', amount: 0,
    start: battle.clock, until: battle.clock + .75, cone: { axis, length }
  })
  for (const hero of battle.allies) {
    const x = hero.x - enemy.x
    const y = hero.y - enemy.y
    const depth = x * axis.x + y * axis.y
    const lateral = y * axis.x - x * axis.y
    // AreaAttackCone.Contains uses depth and side distance in the attack's local coordinates.
    if (hero.hp > 0 && depth > 0 && depth <= length && Math.abs(lateral) <= depth * meleeConeSlope) {
      hurtHero(battle, hero, damage, enemy)
    }
  }
}

function moveKnockback(enemy: Fighter<MonsterId>, dt: number) {
  const velocity = enemy.knockback
  if (!velocity) return
  const decay = Math.exp(-monsterKnockback.decayPerSecond * dt)
  velocity.x *= decay
  velocity.y *= decay
  const dx = velocity.x * dt
  const dy = velocity.y * dt
  enemy.x += dx
  enemy.y += dy
  if (enemy.lunge) {
    enemy.lunge.origin.x += dx
    enemy.lunge.origin.y += dy
  }
  if (Math.hypot(velocity.x, velocity.y) <= 1e-5) enemy.knockback = null
}

function damageTower(battle: Battle, damage: number) {
  if (damage <= 0) return
  battle.towerHp = Math.max(0, battle.towerHp - damage)
  const at = battle.animationClock
  const fatal = battle.towerHp <= 1e-6
  battle.towerHits.push({ id: battle.nextUid++, at, fatal })
  showDamageNumber(battle.damageNumbers, bonfire, damage, 'taken', battle.towerPopupTarget)

  const config = towerArt.native
  const camera = battle.towerCamera
  if (fatal) {
    camera.at = at
    camera.amplitude = config.towerDestroyedCameraShakeAmplitude
    camera.duration = config.towerDestroyedCameraShakeDuration
  } else {
    const cooledHeat = Math.max(0, camera.heat - (at - camera.heatAt) * config.towerHitCameraShakeHeatDecay)
    if (at - camera.at >= config.towerHitCameraShakeMinInterval) {
      const heatFraction = Math.min(1, cooledHeat / config.towerHitCameraShakeHeatForMinScale)
      camera.at = at
      camera.amplitude = config.towerHitCameraShakeAmplitude * (1 - (1 - config.towerHitCameraShakeMinScale) * heatFraction)
      camera.duration = config.towerHitCameraShakeDuration
    }
    camera.heat = cooledHeat + 1
    camera.heatAt = at
  }
}

function moveMonsters(battle: Battle, dt: number) {
  for (const enemy of battle.enemies.slice()) {
    if (enemy.hp <= 0) continue
    if (enemy.pendingShadows > 0) tickShadowQueue(battle, enemy)
    if (battle.clock < enemy.stunnedUntil) {
      moveKnockback(enemy, dt)
      tickAttackCharge(enemy, false, dt)
      if (enemy.id === 'Boss3_Witch') {
        enemy.spellAt += dt
        if (enemy.castUntil > battle.clock - dt) enemy.castUntil += dt
      }
      continue
    }
    if (battle.clock < enemy.castUntil || enemy.lunge) {
      moveKnockback(enemy, dt)
      continue
    }
    if (enemy.id === 'Boss3_Witch' && enemy.spellAt <= battle.clock) {
      moveKnockback(enemy, dt)
      beginShadowCast(battle, enemy)
      continue
    }
    const stats = monsters[enemy.id]
    const hero = enemy.id !== 'Monster1_Raider' ? nearest(enemy, battle.allies) : undefined
    const target = hero && distance(enemy, hero) < stats.aggroRange ? hero : null
    const position = target ?? bonfire
    const range = stats.attackRange + (target ? 0 : rules.tower.monsterTowerAttackRangeOffset)
    faceMonster(enemy, position)
    const slow = enemy.infection && enemy.infection.until > battle.clock ? enemy.infection.slow : 0
    move(enemy, position, stats.moveSpeed * (1 - slow), dt, range)
    moveKnockback(enemy, dt)
    const inRange = distance(enemy, position) <= range + .002
    tickAttackCharge(enemy, inRange, dt)
    if (!inRange || enemy.attackAt > battle.clock) continue

    enemy.attackPeriod = 1 / stats.attackSpeed
    enemy.attackAt = battle.clock + enemy.attackPeriod
    enemy.chargeIntensity = 0
    beginAttackPose(enemy, position, battle.clock, false)
    playUnitSound(battle, stats, 'attackSFX')
    if ('areaAttack' in stats && stats.areaAttack > 0) {
      hitMeleeCone(battle, enemy, position, stats.areaAttack, stats.attackDamage)
    } else if (target) hurtHero(battle, target, stats.attackDamage, enemy)
    if (!target) {
      damageTower(battle, stats.attackDamageToTower)
      if (battle.towerHp <= 1e-6) return
    }
  }
}

function finish(battle: Battle, win: boolean) {
  const counters: Record<string, number> = {
    cursorKills: battle.cursorKills, cursorDamage: battle.cursorDamage, combatCoins: battle.coins
  }
  for (const [id, count] of Object.entries(battle.defeatedIds)) counters['monster:' + id] = count
  for (const [id, count] of Object.entries(battle.spellCounts)) counters['spell:' + id] = count
  battle.summary = {
    result: win ? 'victory' : 'defeat',
    elapsed: battle.elapsed, defeated: battle.defeated, mastery: battle.mastery, coins: battle.coins,
    rewardPack: win, rewardId: win ? chapterInfo(battle.chapter).rewardPack : undefined,
    cursorDamage: battle.cursorDamage, packsOpened: battle.packsOpened,
    totalDamage: battle.totalDamage, foilDefeated: battle.foilDefeated,
    unitStats: Object.values(battle.unitStats), counters
  }
}

function activateBuildings(battle: Battle) {
  for (const building of battle.buildings) {
    if (building.next > battle.elapsed) continue
    building.next += building.cooldown
    const data = buildings[building.id]
    if (!isPackId(data.targetPack)) continue
    const double = battle.random() < (battle.modifiers.effect?.(328, building.id) ?? 0)
    for (let i = 0; i < data.count * (double ? 2 : 1); i++) {
      const angle = battle.random() * 2 * Math.PI
      battle.droppedPacks.push({
        id: data.targetPack, position: { x: bonfire.x + 1.05 * Math.cos(angle), y: bonfire.y + .8 * Math.sin(angle) },
        transform: data.activationEffect === 9, sound: data.sounds.activationSFX,
        traits: {
          foil: battle.random() < (battle.modifiers.effect?.(467, building.id) ?? 0),
          giant: battle.random() < (battle.modifiers.effect?.(468, building.id) ?? 0)
        }
      })
    }
  }
}

function advanceWitchRespawn(battle: Battle, respawn: WitchRespawn, dt: number) {
  const previous = respawn.age
  respawn.age += dt
  if (previous < witchTwitchStart && respawn.age >= witchTwitchStart) battle.sounds.push(witchTransition.riserSfx)
  if (previous < witchTwitchEnd && respawn.age >= witchTwitchEnd) battle.sounds.push(witchTransition.glitchSfx)
  if (!respawn.revealed && respawn.age >= witchReveal) {
    respawn.revealed = true
    spawn(battle, 'Boss3_Witch2', respawn.point)
    battle.sounds.push(witchTransition.climaxSfx, witchTransition.revealSfx)
  }
  if (respawn.age >= witchEnd) battle.respawn = null
}

export function advanceBattleVisuals(battle: Battle, dt: number) {
  battle.animationClock += dt
  if (battle.towerHits.length) battle.towerHits = battle.towerHits.filter(hit =>
    hit.fatal || battle.animationClock - hit.at < scene.towerFeedback.hitParticles.duration)
  advanceDamageNumbers(battle.damageNumbers, dt)
  battle.fallen = battle.fallen.filter(unit => battle.animationClock - unit.at < fallenLifetime(unit))
  battle.expiringPortals = battle.expiringPortals.filter(unit => battle.animationClock - unit.portalExpiredAt < portal.native.spawnerExpireDuration)
  battle.illusionistBlasts = battle.illusionistBlasts.filter(burst => battle.animationClock - burst.at < scene.illusionistExplosion.lifetime[1])
}

export function advanceDefeatVisuals(battle: Battle, dt: number) {
  battle.clock += dt
  advanceBattleVisuals(battle, dt)
  for (const unit of battle.enemies) updateLunge(unit, battle.clock)
  for (const unit of battle.allies) updateLunge(unit, battle.clock)
}

// The loop owns this battle instance. Only checkpoints and the final summary are persisted.
export function advanceBattle(battle: Battle, dt: number, aim?: Aim | null, tableContact?: DashTableContact) {
  advanceBattleVisuals(battle, dt)
  if (battle.respawn) {
    advanceWitchRespawn(battle, battle.respawn, dt)
    return
  }
  battle.clock += dt
  battle.effects = battle.effects.filter(item => item.until > battle.clock).slice(-80)
  battle.projectileEffects = battle.projectileEffects.filter(item => item.until > battle.clock)
  if (battle.summary) return
  while (battle.pendingPackCards[0] && battle.pendingPackCards[0].releaseAt <= battle.clock + 1e-6) {
    const next = battle.pendingPackCards.shift()!
    releasePackCard(battle, next.id, next.position, next.traits, next.fromReveal)
  }
  for (const unit of battle.allies) {
    if (!unit.entry) continue
    const age = battle.clock - unit.born
    const { x, y } = heroEntryPose(unit.entry, age)
    unit.x = x
    unit.y = y
    if (age + 1e-6 >= heroPackEntry.travelDuration && age - dt + 1e-6 < heroPackEntry.travelDuration) {
      const { emissionDelay, duration } = heroPackEntry.smoke
      effect(battle, 'spell', unit, 0, emissionDelay + duration, undefined, 'heroLand')
    }
    if (age + 1e-6 >= heroEntryDuration) unit.entry = null
  }
  for (const unit of battle.allies) updateLunge(unit, battle.clock)
  for (const unit of battle.enemies) updateLunge(unit, battle.clock)
  if (aim !== undefined) pulse(battle, aim)
  if (battle.tutorial === 'wait') return

  const schedule = chapterSchedule(battle.chapter)
  if (battle.tutorial === 'done') {
    battle.elapsed += dt
    activateBuildings(battle)
    while (schedule[battle.spawnIndex]?.at <= battle.elapsed + 1e-6) {
      spawn(battle, schedule[battle.spawnIndex++].id)
    }
    updateTomes(battle, dt)
    battle.zones = battle.zones.filter(zone => zone.until > battle.clock)
    for (const zone of battle.zones) {
      if (zone.next > battle.clock) continue
      zone.next += zone.tick
      for (const enemy of battle.enemies) {
        if (distance(zone, enemy) <= zone.radius) hurtEnemy(battle, enemy, zone.damage, zone.owner, { origin: zone })
      }
    }
  }

  if (!battle.respawn) tickInfections(battle)
  if (!battle.respawn) tickProjectiles(battle, dt)
  if (!battle.respawn) tickDragons(battle, dt)
  if (!battle.respawn) moveHeroes(battle, dt, tableContact)
  if (!battle.respawn) moveMonsters(battle, dt)
  const trailCutoff = battle.clock - monkDash.trail.duration
  battle.dashTrails = battle.dashTrails.filter(trail => trail.at(-1)!.at > trailCutoff)
  for (const trail of battle.dashTrails) {
    const active = trail.findIndex(point => point.at > trailCutoff)
    if (active > 1) trail.splice(0, active - 1)
  }
  battle.allies = battle.allies.filter(unit => unit.hp > 0)
  battle.enemies = battle.enemies.filter(unit => unit.hp > 0)

  if (battle.towerHp <= 1e-6) {
    battle.towerHp = 0
    finish(battle, false)
  } else if (!battle.enemies.length && battle.tutorial === 'fight') {
    battle.tutorial = 'done'
  } else if (!battle.enemies.length && !battle.respawn && battle.spawnIndex === schedule.length) {
    finish(battle, true)
  }
}
