import source from '../data/binder-collection.json'
import { heroes, heroPack, isHero, type CardId } from './rules'
import type { Campaign } from './save'
import { completeUpgradeQuests, upgradeModifiers } from './upgrades'

type Language = 'en' | 'zh-CN'
type BinderCard = (typeof source.cards)[keyof typeof source.cards]
export const binderCardsData: Partial<Record<string, BinderCard>> = source.cards
export const binderLabels: Record<string, Record<Language, string>> = source.labels
export const binderRarities = ['common', 'rare', 'epic', 'legendary'] as const
export const binderClasses = ['','warrior','warrior','hunter','arcanist','mystic','outcast','animal'] as const
export const binderResourceCosts = ['','fruitCost','skullCost','shardCost','zenithCost','foiliumCost'] as const

export type BinderPending = { cards: CardId[]; foils: CardId[] }

export function binderDiscoveries(campaign: Campaign, cards: readonly CardId[], foils: readonly CardId[]): BinderPending {
  return {
    cards: [...new Set([...campaign.binderPending.cards,
      ...cards.filter(id => binderCardsData[id] && !campaign.collection.includes(id))])],
    foils: [...new Set([...campaign.binderPending.foils,
      ...foils.filter(id => binderCardsData[id] && !campaign.foilCollection.includes(id))])]
  }
}

export function binderAwards(campaign: Campaign, id: CardId) {
  const { binderPending } = campaign
  const card = binderCardsData[id]
  if (!card) return []
  const awards: { resource: number; value: number }[] = []
  if (binderPending.cards.includes(id) && card.binderDiscoveryBonus > 0) {
    awards.push({ resource: card.binderDiscoveryResource, value: card.binderDiscoveryBonus })
  }
  if (binderPending.foils.includes(id) && card.binderFoiliumDiscoveryBonus > 0) {
    awards.push({ resource: 5, value: card.binderFoiliumDiscoveryBonus })
  }
  return awards
}

export function claimBinderCard(campaign: Campaign, id: CardId): Campaign {
  const { cards, foils } = campaign.binderPending
  if (campaign.resumePhase !== 'prepare' || !campaign.collection.includes(id) ||
      (!cards.includes(id) && !foils.includes(id))) return campaign
  const upgradeCounters = { ...campaign.upgradeCounters }
  let mastery = campaign.mastery
  for (const { resource, value } of binderAwards(campaign, id)) {
    const cost = binderResourceCosts[resource]
    if (resource === 0) mastery += value
    else if (cost) {
      const key = 'resource:' + cost
      upgradeCounters[key] = (upgradeCounters[key] ?? 0) + value
    }
  }
  return completeUpgradeQuests({
    ...campaign, mastery, upgradeCounters, binderPending: {
      cards: cards.filter(card => card !== id),
      foils: foils.filter(card => card !== id)
    }
  })
}

export function binderUnitStats(id: CardId, foil: boolean, modifiers: ReturnType<typeof upgradeModifiers>) {
  if (!isHero(id)) return []
  const definition = heroes[id]
  const mod = modifiers.modifiersFor(id)
  const pack = heroPack.get(id)
  const packHP = pack ? modifiers.effect(199, undefined, pack) : 0
  const packDamage = pack ? modifiers.effect(200, undefined, pack) : 0
  const foilSpeed = foil && (id === 'Hero1_Archer' || id === 'Hero2_Monk' || id === 'Hero3_Portal') ? 2 : 1
  const foilDamage = foil && id === 'Hero1_Squire' ? 1.5 : 1
  const foilMove = foil && id === 'Hero2_Monk' ? 1.5 : 1
  const rounded = (n: number) => String(Number(n.toFixed(2)))
  const result = [
    { key: 'hp', value: Math.round(10 * definition.maxHP * (mod.hp + packHP) * (foil ? 2 : 1)).toString() },
    { key: 'damage', value: Math.round(10 * definition.attackDamage * (mod.attackDamage + packDamage) * foilDamage).toString() },
    { key: 'cooldown', value: rounded(definition.attackCooldown / (mod.attackSpeed * foilSpeed)) + 's' },
    { key: 'move', value: rounded(definition.moveSpeed * mod.moveSpeed * foilMove) },
    { key: 'range', value: rounded(definition.attackRange * mod.attackRange) }
  ]
  if ('critChance' in definition && definition.critChance > 0) {
    result.push({ key: 'critical', value: Math.round(100 * (definition.critChance + mod.critChance)) + '%' })
  }
  if ('blockChance' in definition && definition.blockChance > 0) {
    result.push({ key: 'block', value: Math.round(100 * (definition.blockChance + mod.block)) + '%' })
  }
  return result
}
