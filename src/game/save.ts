import { packThrowInReach, packThrowPose, planBoxContents, planPackThrow, purchaseThrowSpread, type PackThrow } from './pack-throw'
import {
  applyMasteryIncome, basicPack, chapterInfo, drawPack, frenzyDrop, frenzyTome, heroes, illusionistCloneCount, isCardId, isHero, isPackId, isRelic, packs, rules,
  packPosition, type CardId, type ChapterId, type HeroId, type PackId, type Point, type RelicId
} from './rules'
import { completeUpgradeQuests, upgradeModifiers } from './upgrades'
import { purchasedOffer, rollShop, type ShopOffer } from './shop'
import { appendActBattle, type ActBattleStats } from './act-summary'
import { binderDiscoveries, type BinderPending } from './binder'

export const saveKey = 'booster-pack-heroes:h5:v1'

function activeSaveKey() {
  const query = new URLSearchParams(window.location.search)
  return query.get('slot') === 'reference' ? saveKey + ':reference' : saveKey
}

export type UnitStat = { id: CardId; count: number; damage: number; defense: number }

export type Summary = {
  result: 'victory' | 'defeat'
  elapsed: number
  defeated: number
  mastery: number
  coins: number
  rewardPack: boolean
  rewardId?: PackId
  cursorDamage?: number
  totalDamage?: number
  foilDefeated?: number
  packsOpened?: number
  unitStats?: UnitStat[]
  counters?: Record<string, number>
}

export type Pack = {
  id: PackId; hp: number; box?: boolean; reward?: boolean; position?: Point; cards?: CardId[]; foil?: boolean; giant?: boolean
  purchase?: { slot: number; roll: number; cost: number }
  launch?: PackThrow
}
export function packLocation(pack: Pack, index: number, elapsed = Infinity): Point {
  if (pack.launch) return packThrowPose(pack.launch, elapsed, pack.box)
  return pack.position ?? { x: packPosition.x + (index % 5) * .51, y: packPosition.y - Math.floor(index / 5) * .37 }
}

export function packCanBeHit(pack: Pack, elapsed: number) {
  return pack.launch ? packThrowInReach(pack.launch, elapsed, pack.box) : elapsed >= .46
}

export type CardTraits = { foil?: boolean; giant?: boolean }

export type Campaign = {
  version: 1
  introComplete: boolean
  dayNumber: ChapterId
  lastSavedUtcMillis: number
  playedTimeMillis: number
  resumePhase: 'prepare' | 'beginning' | 'summary'
  coins: number
  mastery: number
  totalPacksOpened: number
  attempts: number
  chapterAttempts: number
  waveStartDelay: number
  packHp: number | null
  activePacks: Pack[]
  roster: CardId[]
  rosterTraits: CardTraits[]
  foilCollection: CardId[]
  collection: CardId[]
  binderPending: BinderPending
  equippedRelics: RelicId[]
  unlockedPacks: PackId[]
  openedByPack: Partial<Record<PackId, number>>
  frenzyMisses: number
  frenzyDropsThisAttempt: number
  boughtSlots: number[]
  shop: ShopOffer[] | null
  shopSeed: number
  rerolls: number
  rewardPacks: number
  pendingVictory: Summary | null
  pendingUnlock: PackId | null
  summary: Summary | null
  completed: boolean
  endingSeen: boolean
  actSummaryStage: 'summary' | 'ending' | null
  actBattle?: ActBattleStats
  actCoinsSpent?: number
  actPlayTimeMillis?: number
  upgradeLevels: Record<string, number>
  upgradeCounters: Record<string, number>
}

export function newCampaign(): Campaign {
  return {
    version: 1, introComplete: false, dayNumber: 1, lastSavedUtcMillis: 0, playedTimeMillis: 0,
    resumePhase: 'prepare', coins: 0, mastery: 0, totalPacksOpened: 0, attempts: 0, chapterAttempts: 0, waveStartDelay: 0,
    packHp: null, activePacks: [], roster: [], rosterTraits: [], foilCollection: [],
    collection: [], binderPending: { cards: [], foils: [] }, equippedRelics: [], unlockedPacks: [basicPack],
    openedByPack: {}, frenzyMisses: 0, frenzyDropsThisAttempt: 0,
    boughtSlots: [], shop: null, shopSeed: 0, rerolls: 0, rewardPacks: 0,
    pendingVictory: null, pendingUnlock: null, summary: null, completed: false, endingSeen: false, actSummaryStage: null,
    actBattle: { monsters: 0, foils: 0, damage: 0, heroDamage: {}, heroSpawns: {} },
    actCoinsSpent: 0, actPlayTimeMillis: 0, upgradeLevels: {}, upgradeCounters: {}
  }
}

const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function validSummary(value: unknown): value is Summary {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<Summary>
  return (result.result === 'victory' || result.result === 'defeat') &&
    finite(result.elapsed) && integer(result.defeated) && finite(result.mastery) && finite(result.coins) &&
    (result.cursorDamage === undefined || finite(result.cursorDamage)) &&
    (result.totalDamage === undefined || finite(result.totalDamage)) &&
    (result.foilDefeated === undefined || integer(result.foilDefeated)) &&
    (result.packsOpened === undefined || integer(result.packsOpened)) &&
    result.rewardPack === (result.result === 'victory') &&
    (result.rewardId === undefined || isPackId(result.rewardId)) &&
    (result.counters === undefined || numericRecord(result.counters)) &&
    (result.unitStats === undefined || (Array.isArray(result.unitStats) && result.unitStats.every(unit =>
      unit && isCardId(unit.id) && integer(unit.count) && finite(unit.damage) && finite(unit.defense))))
}

function validPack(value: unknown): value is Pack {
  if (!value || typeof value !== 'object') return false
  const pack = value as Partial<Pack>
  return isPackId(pack.id) && finite(pack.hp) && pack.hp > 0 &&
    pack.hp <= (pack.box ? packs[pack.id].boosterBoxMaxHP : packs[pack.id].maxHP) &&
    (pack.cards === undefined || (Array.isArray(pack.cards) && pack.cards.every(isCardId))) &&
    (pack.position === undefined || finitePoint(pack.position)) &&
    (pack.launch === undefined || (!!pack.launch &&
      finitePoint(pack.launch.from) && finitePoint(pack.launch.target) &&
      Number.isFinite(pack.launch.turn) && Number.isFinite(pack.launch.spin) &&
      (pack.launch.startsAt === undefined || finite(pack.launch.startsAt)) &&
      (pack.launch.fromOpenedBox === undefined || pack.launch.fromOpenedBox === true))) &&
    (pack.purchase === undefined || (pack.purchase && integer(pack.purchase.slot) &&
      integer(pack.purchase.roll) && integer(pack.purchase.cost)))
}

function finitePoint(point: Point | null) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function numericRecord(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(finite)
}

function validShopOffer(value: unknown): value is ShopOffer {
  if (!value || typeof value !== 'object') return false
  const offer = value as Partial<ShopOffer>
  return isPackId(offer.id) && typeof offer.box === 'boolean' && integer(offer.cost) && offer.cost > 0 &&
    (offer.listPrice === undefined || (integer(offer.listPrice) && offer.listPrice > offer.cost)) &&
    (offer.id === 'DeliveryBox'
      ? !offer.box && isCardId(offer.card) && integer(offer.copies) && offer.copies >= 1
      : offer.card === undefined && offer.copies === undefined)
}

export function parseCampaign(raw: string): Campaign | null {
  try {
    const data = JSON.parse(raw) as Partial<Campaign> | null
    if (!data || data.version !== 1 || ![1, 2, 3].includes(data.dayNumber ?? 0)) return null
    const phase = data.resumePhase
    if (phase !== 'prepare' && phase !== 'beginning' && phase !== 'summary') return null
    if (![data.lastSavedUtcMillis, data.playedTimeMillis, data.totalPacksOpened, data.attempts, data.rewardPacks].every(integer) ||
        !finite(data.coins) || !finite(data.mastery) ||
        !Array.isArray(data.roster) || !data.roster.every(isCardId)) return null
    if (phase === 'summary' ? !validSummary(data.summary) : data.summary !== null) return null
    if (data.pendingVictory != null && (phase !== 'beginning' || !validSummary(data.pendingVictory) ||
        data.pendingVictory.result !== 'victory')) return null
    if (data.pendingUnlock != null && (phase === 'beginning' || !isPackId(data.pendingUnlock))) return null
    if (data.introComplete !== undefined && typeof data.introComplete !== 'boolean') return null
    const act = data.actBattle
    if (act !== undefined && (!act || !integer(act.monsters) || !integer(act.foils) ||
        !finite(act.damage) || !numericRecord(act.heroDamage) || !numericRecord(act.heroSpawns))) return null
    if ([data.actCoinsSpent, data.actPlayTimeMillis].some(value => value !== undefined && !integer(value))) return null
    const legacyPack = {
      id: basicPack, hp: data.packHp ?? 0
    }
    const storedPacks = data.activePacks ?? (validPack(legacyPack) ? [legacyPack] : [])
    if (!Array.isArray(storedPacks)) return null
    const activePacks = storedPacks.map((pack: Pack & { delivery?: PackThrow }) => {
      if (pack?.id !== 'DeliveryBox' || !Object.hasOwn(pack, 'delivery')) return pack
      const { delivery, ...rest } = pack
      return { ...rest, launch: rest.launch ?? delivery }
    })
    const collection = data.collection ?? [...new Set(data.roster)]
    const unlockedPacks = data.unlockedPacks ?? [basicPack]
    if (!activePacks.every(validPack) ||
        !Array.isArray(collection) || !collection.every(isCardId) ||
        !Array.isArray(unlockedPacks) || !unlockedPacks.every(isPackId)) return null
    const base = newCampaign()
    const campaign = {
      ...base, ...data, activePacks, packHp: activePacks[0]?.hp ?? null, collection, unlockedPacks,
      actBattle: data.actBattle, actCoinsSpent: data.actCoinsSpent,
      actPlayTimeMillis: data.actPlayTimeMillis,
      actSummaryStage: data.completed && !data.endingSeen && (data.actSummaryStage === 'summary' || data.actSummaryStage === 'ending')
        ? data.actSummaryStage : null,
      waveStartDelay: finite(data.waveStartDelay) ? data.waveStartDelay : 0,
      rosterTraits: data.roster.map((_, index) => ({
        foil: data.rosterTraits?.[index]?.foil === true, giant: data.rosterTraits?.[index]?.giant === true
      })),
      foilCollection: Array.isArray(data.foilCollection) ? data.foilCollection.filter(isCardId) : [],
      binderPending: {
        cards: Array.isArray(data.binderPending?.cards) ? data.binderPending.cards.filter(isCardId) : [],
        foils: Array.isArray(data.binderPending?.foils) ? data.binderPending.foils.filter(isCardId) : []
      },
      equippedRelics: Array.isArray(data.equippedRelics) ? data.equippedRelics.filter(isRelic) : collection.filter(isRelic),
      introComplete: data.introComplete ?? true, chapterAttempts: data.chapterAttempts ?? data.attempts ?? 0,
      openedByPack: numericRecord(data.openedByPack) ? data.openedByPack : { [basicPack]: data.totalPacksOpened },
      frenzyMisses: integer(data.frenzyMisses) ? data.frenzyMisses : 0,
      frenzyDropsThisAttempt: integer(data.frenzyDropsThisAttempt) ? data.frenzyDropsThisAttempt : 0,
      upgradeLevels: numericRecord(data.upgradeLevels) ? data.upgradeLevels : {},
      upgradeCounters: numericRecord(data.upgradeCounters) ? data.upgradeCounters : {},
      boughtSlots: Array.isArray(data.boughtSlots) ? data.boughtSlots.filter(integer) : [],
      shopSeed: integer(data.shopSeed) ? data.shopSeed : 0,
      rerolls: integer(data.rerolls) ? data.rerolls : 0,
      shop: Array.isArray(data.shop) && data.shop.every(validShopOffer) ? data.shop : null
    }
    // Old web checkpoints paused victory until a chapter pack was physically opened.
    return campaign.pendingVictory ? settleChapter(campaign, campaign.pendingVictory) : campaign
  } catch {
    return null
  }
}

export function loadCampaign(): { campaign: Campaign; issue: string } {
  try {
    const raw = window.localStorage.getItem(activeSaveKey())
    if (raw === null) return { campaign: newCampaign(), issue: '' }
    const restored = parseCampaign(raw)
    if (!restored) return { campaign: newCampaign(), issue: '存档无法读取。开始操作后会建立新的本机存档。' }
    const activePacks = restored.activePacks.map(pack => {
      if (!pack.launch?.fromOpenedBox) return pack
      // An in-progress save reconstructs the battle clock. Previously opened box contents are already on the table.
      const { x, y, turn } = packThrowPose(pack.launch, Infinity)
      const position = { x, y }
      return { ...pack, launch: { from: position, target: position, turn, spin: 0, fromOpenedBox: true as const } }
    })
    return { campaign: withPacks(restored, activePacks), issue: '' }
  } catch {
    return { campaign: newCampaign(), issue: '浏览器未开放本机存档。' }
  }
}

export function writeCampaign(campaign: Campaign): boolean {
  try {
    window.localStorage.setItem(activeSaveKey(), JSON.stringify(campaign))
    return true
  } catch {
    return false
  }
}

export function shopOffers(campaign: Campaign): ShopOffer[] {
  const locked: (ShopOffer | undefined)[] = campaign.shop?.slice() ?? []
  let budget = campaign.coins
  // Older saves could add a daily deal after the ordinary grid.
  const slotCount = Math.max(locked.length, 4 + Math.round(upgradeModifiers(campaign.upgradeLevels).shopSlots))
  for (const pack of campaign.activePacks) {
    const purchase = pack.purchase
    if (!purchase || purchase.slot >= slotCount || purchase.roll !== campaign.shopSeed ||
        !campaign.boughtSlots.includes(purchase.slot)) continue
    budget += purchase.cost
    // Older web saves only retained the receipt and package contents.
    locked[purchase.slot] ??= purchasedOffer(pack)
  }
  return rollShop({ ...campaign, coins: budget }, locked)
}

export const getSalary = (campaign: Campaign) => rules.salary + upgradeModifiers(campaign.upgradeLevels).salaryCoins
export const getShopRerollCost = (campaign: Campaign) =>
  Math.max(0, 1 + campaign.rerolls - Math.round(upgradeModifiers(campaign.upgradeLevels).shopRerollCostReduction))

export function rerollShop(campaign: Campaign): Campaign {
  if (!campaign.introComplete || campaign.resumePhase !== 'prepare' || campaign.completed) return campaign
  const cost = getShopRerollCost(campaign)
  if (!upgradeModifiers(campaign.upgradeLevels).shopRerollUnlocked || campaign.coins < cost) return campaign
  const offers = shopOffers(campaign)
  const locked = offers.map((offer, slot) => campaign.boughtSlots.includes(slot) ? offer : undefined)
  if (locked.every(Boolean)) return campaign
  const rerolled = {
    ...campaign, shopSeed: campaign.shopSeed + 1,
    rerolls: campaign.rerolls + 1, coins: campaign.coins - cost,
    actCoinsSpent: (campaign.actCoinsSpent ?? 0) + cost
  }
  return {
    ...rerolled,
    shop: rollShop(rerolled, locked),
    activePacks: campaign.activePacks.map(pack => pack.purchase?.roll === campaign.shopSeed &&
      campaign.boughtSlots.includes(pack.purchase.slot)
      ? { ...pack, purchase: { ...pack.purchase, roll: rerolled.shopSeed } }
      : pack)
  }
}

function withPacks(campaign: Campaign, activePacks: Pack[]): Campaign {
  return { ...campaign, activePacks, packHp: activePacks[0]?.hp ?? null }
}

function newPack(id: PackId, box = false, reward = false, cards?: CardId[]): Pack {
  return { id, hp: box ? packs[id].boosterBoxMaxHP : packs[id].maxHP, box, reward, ...(cards && { cards }) }
}

export function buyPack(campaign: Campaign, id: PackId, slot: number, box = false): Campaign {
  if (!campaign.introComplete || campaign.resumePhase !== 'prepare' || campaign.completed ||
      campaign.boughtSlots.includes(slot)) return campaign
  const offers = shopOffers(campaign)
  const offer = offers[slot]
  if (!offer || offer.id !== id || offer.box !== box || campaign.coins < offer.cost) return campaign
  const card = offer.card
  const cards = card ? Array.from({ length: offer.copies ?? 1 }, () => card) : undefined
  const purchase = { slot, roll: campaign.shopSeed, cost: offer.cost }
  return withPacks({
    ...campaign, shop: offers, coins: campaign.coins - offer.cost, boughtSlots: [...campaign.boughtSlots, slot],
    actCoinsSpent: (campaign.actCoinsSpent ?? 0) + offer.cost
  }, [...campaign.activePacks, { ...newPack(id, box, false, cards), purchase }])
}

export function refundShopOffer(campaign: Campaign, slot: number): Campaign {
  if (campaign.resumePhase !== 'prepare' || !campaign.boughtSlots.includes(slot)) return campaign
  const index = campaign.activePacks.findIndex(pack =>
    pack.purchase?.slot === slot && pack.purchase.roll === campaign.shopSeed)
  if (index < 0) return campaign
  const cost = campaign.activePacks[index].purchase!.cost
  return withPacks({
    ...campaign, shop: shopOffers(campaign), coins: campaign.coins + cost,
    actCoinsSpent: Math.max(0, (campaign.actCoinsSpent ?? 0) - cost),
    boughtSlots: campaign.boughtSlots.filter(value => value !== slot)
  }, campaign.activePacks.filter((_, i) => i !== index))
}

export function hitPack(campaign: Campaign, index: number, random = Math.random, masteryMultiplier = 1, elapsed = Infinity): Campaign {
  if (campaign.resumePhase !== 'beginning') return campaign
  const active = campaign.activePacks[index]
  if (!active) return campaign
  const pack = packs[active.id]
  const modifiers = upgradeModifiers(campaign.upgradeLevels)
  // Native campaign packs and boxes start at two cursor slashes. Effects 504 and 505 reduce the count.
  const hits = Math.max(1, 2 - Math.round(modifiers.packHitsFor(active.id, active.box)))
  const maxHp = active.box ? pack.boosterBoxMaxHP : pack.maxHP
  const queue = [...campaign.activePacks]
  const hp = active.hp - maxHp / hits
  if (hp > 1e-7) {
    queue[index] = { ...active, hp }
    return withPacks(campaign, queue)
  }

  if (active.box) {
    const position = packLocation(active, index, elapsed)
    const launched = planBoxContents(position, pack.boosterBoxPackCount, Number.isFinite(elapsed) ? elapsed : 0, random)
    queue.splice(index, 1, ...launched.map(launch => ({
      ...newPack(active.id), launch, ...(active.foil && { foil: true }), ...(active.giant && { giant: true })
    })))
    return withPacks({ ...campaign, mastery: campaign.mastery + applyMasteryIncome(pack.boosterBoxMasteryOnOpen, masteryMultiplier) }, queue)
  }

  queue.splice(index, 1)
  const opened = campaign.openedByPack[active.id] ?? 0
  const cards = active.cards?.slice() ?? drawPack(active.id, opened, campaign.collection, random)
  for (const effect of modifiers.effects) {
    if (effect.type === 52 && effect.pack === active.id && isCardId(effect.target) && random() < effect.value) {
      cards.push(effect.target)
    }
  }
  let { frenzyMisses, frenzyDropsThisAttempt } = campaign
  const frenzyUnlock = modifiers.effect(203, frenzyTome, active.id)
  if (frenzyUnlock > 0 && pack.frenzyChance > 0) {
    const baseChance = Math.min(1, frenzyUnlock * pack.frenzyChance)
    const chance = Math.min(1, Math.max(0, baseChance + frenzyMisses * frenzyDrop.missBonus -
      frenzyDropsThisAttempt * frenzyDrop.attemptPenalty))
    if (chance > 0 && random() < chance) {
      cards.push(frenzyTome)
      frenzyMisses = 0
      frenzyDropsThisAttempt++
    } else frenzyMisses++
  }
  const mastery = applyMasteryIncome(pack.masteryOnOpen + Math.floor(random() * (pack.resourceVariance + 1)), masteryMultiplier)
  const key = 'pack:' + active.id
  const upgradeCounters = {
    ...campaign.upgradeCounters, [key]: (campaign.upgradeCounters[key] ?? 0) + 1
  }
  const equippedRelics = [...new Set([...campaign.equippedRelics, ...cards.filter(isRelic)])]
  upgradeCounters.haveRelics = equippedRelics.length
  const foilCollection = [...campaign.foilCollection]
  const traits = cards.map(card => {
    const foil = isHero(card) ? active.foil === true ||
      (opened >= pack.newFoilPityMinPacks && !foilCollection.includes(card) && pack.newFoilPityMaxPacks > 0 &&
        (opened === pack.newFoilPityMaxPacks || random() < .05)) : card === frenzyTome && active.foil === true
    if (foil) {
      if (isHero(card)) {
        const stats = heroes[card]
        upgradeCounters['resource:foiliumCost'] = (upgradeCounters['resource:foiliumCost'] ?? 0) +
          ('native' in stats ? stats.native.foilOpenFoilium : 1)
      }
      if (!foilCollection.includes(card)) foilCollection.push(card)
    }
    const extra = card === 'Hero3_Illusionist'
      ? illusionistCloneCount(modifiers.effect(129, card), foil, modifiers.effect(659, card))
      : 0
    const cardKey = 'hero:' + card
    upgradeCounters[cardKey] = (upgradeCounters[cardKey] ?? 0) + 1 + extra
    return { foil, giant: active.giant === true }
  })
  return completeUpgradeQuests(withPacks({
    ...campaign,
    totalPacksOpened: campaign.totalPacksOpened + 1,
    mastery: campaign.mastery + mastery,
    roster: [...campaign.roster, ...cards],
    rosterTraits: [...campaign.rosterTraits, ...traits], foilCollection, frenzyMisses, frenzyDropsThisAttempt,
    collection: [...new Set([...campaign.collection, ...cards])],
    binderPending: binderDiscoveries(campaign, cards, foilCollection),
    equippedRelics,
    unlockedPacks: [...new Set([...campaign.unlockedPacks, ...(active.reward ? [active.id] : [])])],
    openedByPack: { ...campaign.openedByPack, [active.id]: opened + 1 },
    pendingVictory: campaign.pendingVictory
      ? { ...campaign.pendingVictory, packsOpened: (campaign.pendingVictory.packsOpened ?? 0) + 1 }
      : null,
    upgradeCounters
  }, queue))
}

export function beginChapter(campaign: Campaign, random = Math.random): Campaign {
  if (campaign.resumePhase !== 'prepare' || campaign.pendingUnlock || campaign.completed) return campaign
  const activePacks: Pack[] = []
  const deliveredCards: CardId[] = []
  const purchased = campaign.activePacks.filter(pack => pack.purchase && pack.id !== 'DeliveryBox')
  const ordinaryCount = purchased.filter(pack => !pack.box).length
  const boxCount = purchased.length - ordinaryCount
  let ordinaryIndex = 0
  let boxIndex = 0
  for (const pack of campaign.activePacks) {
    if (pack.id === 'DeliveryBox' && pack.purchase && pack.cards?.length) deliveredCards.push(...pack.cards)
    else if (pack.purchase && pack.id !== 'DeliveryBox') {
      const count = pack.box ? boxCount : ordinaryCount
      const index = pack.box ? boxIndex++ : ordinaryIndex++
      const startsAt = count > 1 ? purchaseThrowSpread * index / (count - 1) : 0
      activePacks.push({ ...pack, launch: planPackThrow(random, !!pack.box, startsAt) })
    } else activePacks.push(pack)
  }
  if (deliveredCards.length) activePacks.push({
    ...newPack('DeliveryBox', false, false, deliveredCards), launch: planPackThrow(random)
  })
  return completeUpgradeQuests(withPacks({
    ...campaign, introComplete: true, resumePhase: 'beginning',
    waveStartDelay: ordinaryCount > 1 ? purchaseThrowSpread : 0,
    attempts: campaign.attempts + 1, chapterAttempts: campaign.chapterAttempts + 1, frenzyDropsThisAttempt: 0
  }, activePacks))
}

export function grantDroppedPack(campaign: Campaign, id: PackId, position: Point, traits: CardTraits = {}): Campaign {
  return withPacks(campaign, [...campaign.activePacks, { ...newPack(id), position, ...traits }])
}

export function transformPack(campaign: Campaign, id: PackId, roll: number): Campaign {
  const eligible = campaign.activePacks.flatMap((pack, index) =>
    !pack.reward && !pack.box && pack.id !== 'DeliveryBox' && pack.id !== id ? [index] : [])
  if (!eligible.length) return campaign
  const index = eligible[Math.min(eligible.length - 1, Math.floor(roll * eligible.length))]
  return withPacks(campaign, campaign.activePacks.map((pack, i) => i === index
    ? { ...newPack(id), position: pack.position, launch: pack.launch } : pack))
}

export function settleChapter(campaign: Campaign, summary: Summary, recordedCounters: Record<string, number> = {}): Campaign {
  if (campaign.resumePhase !== 'beginning') return campaign
  const reward = summary.result === 'victory' ? chapterInfo(campaign.dayNumber).rewardPack : null
  const pendingUnlock = reward && !campaign.unlockedPacks.includes(reward) ? reward : null
  const upgradeCounters = { ...campaign.upgradeCounters }
  for (const [key, value] of Object.entries(summary.counters ?? {})) {
    if (summary.result === 'defeat' && key.startsWith('monster:Boss')) continue
    upgradeCounters[key] = (upgradeCounters[key] ?? 0) + Math.max(0, value - (recordedCounters[key] ?? 0))
  }
  const summonDiscovered = !campaign.collection.includes('Hero_Skeleton') && summary.unitStats?.some(unit =>
    unit.id === 'Hero_Skeleton' && unit.count > 0)
  const gained: CardId[] = summonDiscovered ? ['Hero_Skeleton'] : []
  return completeUpgradeQuests(withPacks({
    ...campaign, resumePhase: 'summary', summary, pendingVictory: null, pendingUnlock,
    unlockedPacks: pendingUnlock ? [...campaign.unlockedPacks, pendingUnlock] : campaign.unlockedPacks,
    rewardPacks: campaign.rewardPacks + Number(Boolean(pendingUnlock && !campaign.pendingVictory)),
    playedTimeMillis: campaign.playedTimeMillis + Math.round(summary.elapsed * 1000),
    actBattle: appendActBattle(campaign, summary, recordedCounters),
    collection: [...campaign.collection, ...gained],
    binderPending: binderDiscoveries(campaign, gained, []),
    coins: campaign.coins + summary.coins, mastery: campaign.mastery + summary.mastery,
    completed: summary.result === 'victory' && campaign.dayNumber === 3, upgradeCounters
  }, []))
}

export function continueChapter(campaign: Campaign): Campaign {
  if (!campaign.summary) return campaign
  if (campaign.completed) return { ...campaign, resumePhase: 'prepare', summary: null, roster: [], rosterTraits: [] }
  const won = campaign.summary.result === 'victory'
  const reward = won ? chapterInfo(campaign.dayNumber).rewardPack : null
  const next: Campaign = {
    ...campaign, dayNumber: (campaign.dayNumber + Number(won)) as ChapterId,
    chapterAttempts: won ? 0 : campaign.chapterAttempts, resumePhase: 'prepare', summary: null, roster: [], rosterTraits: [],
    unlockedPacks: reward ? [...new Set([...campaign.unlockedPacks, reward])] : campaign.unlockedPacks,
    boughtSlots: [], shop: null, rerolls: 0, shopSeed: campaign.shopSeed + 1, waveStartDelay: 0,
    coins: getSalary(campaign) + campaign.summary.coins
  }
  return { ...next, shop: rollShop(next) }
}

