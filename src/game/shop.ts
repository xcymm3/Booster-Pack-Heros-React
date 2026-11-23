import { basicPack, heroes, isHero, isRelic, packs, tomes, type CardId, type PackId } from './rules'
import type { Campaign, Pack } from './save'
import { upgradeModifiers } from './upgrades'

export type ShopOffer = { id: PackId; box: boolean; cost: number; card?: CardId; copies?: number; listPrice?: number }

const shopPacks: readonly PackId[] = [basicPack, 'Pack2_Advanced', 'Pack3_Magic']
const rarityWeights = [4, 3, 2, 1]

type Deal = { rarity: number; specialShopCoinCost: number; specialOfferBanned?: boolean; specialOfferNotMultiplicable?: boolean; shopRequiresUpgrade?: boolean }
const earlyDeals: Partial<Record<CardId, Deal>> = {
  Hero1_Squire: { rarity: 0, specialShopCoinCost: 1 },
  Hero1_Barbarian: { rarity: 1, specialShopCoinCost: 1 },
  Hero1_Archer: { rarity: 2, specialShopCoinCost: 2 },
  Tome_Thunderstorm: { rarity: 3, specialShopCoinCost: 3 }
}

function dealFor(card: CardId): Deal | undefined {
  if (isRelic(card)) return
  const early = earlyDeals[card]
  if (early) return early
  const definition = isHero(card) ? heroes[card] : tomes[card]
  const native = 'native' in definition ? definition.native : undefined
  if (native && 'specialShopCoinCost' in native && 'rarity' in native &&
      typeof native.specialShopCoinCost === 'number' && typeof native.rarity === 'number') {
    return { ...native, specialShopCoinCost: native.specialShopCoinCost, rarity: native.rarity }
  }
}

function randomForShop(campaign: Campaign) {
  let state = Math.imul(campaign.shopSeed + 1, 0x9e3779b9) ^ Math.imul(campaign.attempts + 1, 0x85ebca6b)
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function weighted<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T {
  let selection = random() * items.reduce((sum, item) => sum + weight(item), 0)
  for (const item of items) {
    selection -= weight(item)
    if (selection < 0) return item
  }
  return items[items.length - 1]
}

export function purchasedOffer(pack: Pack): ShopOffer {
  const card = pack.id === 'DeliveryBox' ? pack.cards?.[0] : undefined
  return {
    id: pack.id, box: !!pack.box, cost: pack.purchase!.cost,
    ...(card && { card, copies: pack.cards!.length })
  }
}

export function rollShop(campaign: Campaign, locked: readonly (ShopOffer | undefined)[] = []): ShopOffer[] {
  const { effect, shopSlots } = upgradeModifiers(campaign.upgradeLevels)
  const available = shopPacks.filter(id => campaign.unlockedPacks.includes(id))
  if (!available.length) available.push(basicPack)
  const boxes = available.filter(id => (campaign.openedByPack[id] ?? 0) >= packs[id].packsToUnlockBoosterBox)
  const deals = [...new Set(campaign.collection)].flatMap<Deal & { card: CardId }>(card => {
    const deal = dealFor(card)
    return deal && !deal.specialOfferBanned && !deal.shopRequiresUpgrade && deal.specialShopCoinCost > 0
      ? [{ card, ...deal }] : []
  })
  const heroCount = deals.filter(({ card }) => isHero(card)).length
  const dailyWeight = Math.max(0, effect(508)) + heroCount * Math.max(0, effect(475))
  const random = randomForShop(campaign)
  const slotCount = Math.max(locked.length, 3 + Math.round(shopSlots))

  const categories = [
    { kind: 'pack', weight: 35 },
    { kind: 'box', weight: boxes.length ? 20 : 0 },
    { kind: 'deal', weight: deals.length ? dailyWeight : 0 }
  ]
  const discount = (offer: ShopOffer) => {
    const chance = effect(472) + effect(offer.card ? 604 : offer.box ? 606 : 602) +
      effect(offer.card ? 501 : 503) + campaign.rerolls * Math.max(0, effect(509))
    if (offer.cost <= 1 || chance <= 0 || random() * 100 >= chance) return offer
    const discountAmount = Math.max(0, Math.min(100, 30 + effect(473) +
      effect(offer.card ? 605 : offer.box ? 607 : 603) + (offer.card ? 100 * effect(500) : 0)))
    const cost = Math.max(1, Math.min(offer.cost - 1, Math.round(offer.cost * (1 - discountAmount / 100))))
    return { ...offer, cost, listPrice: offer.cost }
  }

  const roll = () => {
    const { kind } = weighted(categories, item => item.weight, random)
    if (kind === 'deal') {
      const deal = weighted(deals, item => rarityWeights[item.rarity] ?? 1, random)
      const multiples = isHero(deal.card) && !deal.specialOfferNotMultiplicable
      const doubleWeight = multiples && effect(547) > 0 ? 29 : 0
      const tripleWeight = multiples && effect(548) > 0 ? 12 : 0
      const copyRoll = random() * (59 + doubleWeight + tripleWeight)
      const copies = copyRoll < 59 ? 1 : copyRoll < 59 + doubleWeight ? 2 : 3
      return discount({ id: 'DeliveryBox', box: false, card: deal.card, copies, cost: deal.specialShopCoinCost * copies })
    }
    const box = kind === 'box'
    const pool = box ? boxes : available
    const id = pool[Math.floor(random() * pool.length)]
    return discount({ id, box, cost: box ? packs[id].boosterBoxShopCost : packs[id].shopCost })
  }

  const offers = Array.from({ length: slotCount }, (_, slot) => locked[slot] ?? roll())
  const cheapestPack = available.reduce((cheapest, id) => packs[id].shopCost < packs[cheapest].shopCost ? id : cheapest)
  if (campaign.coins >= packs[cheapestPack].shopCost &&
      !offers.some((offer, slot) => !locked[slot] && offer.cost <= campaign.coins)) {
    const slot = offers.findIndex((_, index) => !locked[index])
    if (slot !== -1) offers[slot] = { id: cheapestPack, box: false, cost: packs[cheapestPack].shopCost }
  }
  return offers
}
