import source from '../data/upgrades-1-3.json'
import { isPackId, rules, type PackId, type Point } from './rules'
import type { BattleQuestProgress } from './combat'
import type { Campaign } from './save'

export type UpgradeCosts = Partial<Record<
  'cost' | 'skullCost' | 'coinIncomeCost' | 'zenithCost' | 'inkCost' | 'fruitCost' |
  'foiliumCost' | 'shardCost' | 'runeACost' | 'runeBCost' | 'runeCCost' | 'prestigePointCost' | 'relicCost',
  number
>>

type UpgradeEffect = readonly [type: number, value: number, power: number, powerScale: number, cap: number, countStep: number]

type Quest = {
  metric: string
  otherMetric?: string | null
  target: string
  targetIcon?: number | null
  description: string
  quantity: number
  stages: number[]
}

type UpgradeDefinition = {
  key: string
  name?: string
  description?: string
  kind: number
  connections: number
  prestige?: number
  golden?: boolean
  special?: boolean
  bigIcon?: boolean
  upgradeTowerVisual?: boolean
  color?: [number, number, number, number]
  icon: number | null
  secondaryIcon?: number
  incompleteIcon?: number
  completeIcon?: number
  costs?: UpgradeCosts
  rewards?: Record<string, number>
  quest?: Quest
  requiredAdjacentPurchased?: number
  effects?: UpgradeEffect[]
  targetHero?: string
  targetTome?: string
  targetPack?: string
  targetBuilding?: string
  targetSpell?: string
  requiredHero?: string
  requiredTome?: string
  requiredPack?: string
  questDisplayRewardPack?: string
  questUnlockPackReward?: string
  questRelicPackReward?: string
  targetSkillTreeGrid?: string
}

export type UpgradeCell = {
  id: string
  x: number
  y: number
  start: boolean
  startPrestigeLock: number
  startPrestigeIgnore: number
  definition: UpgradeDefinition
}

type UpgradeState = 'purchased' | 'available' | 'quest' | 'locked' | 'connector'

const definitions = source.nodes as unknown as Record<number, UpgradeDefinition>
export const upgradeCells: UpgradeCell[] = source.grid.map(([x, y, serialId, start, startPrestigeLock, startPrestigeIgnore]) => ({
  id: definitions[serialId].key + '@' + x + ',' + y,
  x,
  y,
  start: !!start,
  startPrestigeLock,
  startPrestigeIgnore,
  definition: definitions[serialId]
}))

export const upgradeFrames = source.frames
export const upgradeAtlas = source.atlas
export const binderCards = source.binder
export const mainUpgrade = 'SN_TowerHP@23,15'

const positions = new Map(upgradeCells.map(cell => [cell.x + ',' + cell.y, cell]))
const byId = new Map(upgradeCells.map(cell => [cell.id, cell]))
const questCells = upgradeCells.filter(cell => cell.definition.quest)
const questCellsByMetric = new Map<string, UpgradeCell[]>()
for (const cell of questCells) {
  const { metric, otherMetric } = cell.definition.quest!
  for (const key of otherMetric && otherMetric !== metric ? [metric, otherMetric] : [metric]) {
    const cells = questCellsByMetric.get(key)
    if (cells) cells.push(cell)
    else questCellsByMetric.set(key, [cell])
  }
}
const questStates = new WeakMap<Campaign, ReadonlyMap<string, UpgradeState>>()
const directions = [
  { dx: -1, dy: 0, bit: 1, inverse: 2 },
  { dx: 1, dy: 0, bit: 2, inverse: 1 },
  { dx: 0, dy: 1, bit: 4, inverse: 8 },
  { dx: 0, dy: -1, bit: 8, inverse: 4 }
]
const neighbors = new Map(upgradeCells.map(cell => [cell.id, directions.flatMap(({ dx, dy, bit, inverse }) => {
  const neighbor = positions.get((cell.x + dx) + ',' + (cell.y + dy))
  if (neighbor && cell.definition.connections & bit && neighbor.definition.connections & inverse) return [neighbor]
  return []
})]))

function adjacent(cell: UpgradeCell): readonly UpgradeCell[] {
  return neighbors.get(cell.id) ?? []
}

function isMainPathRift(cell: UpgradeCell, prestige: number) {
  return prestige < 2 && (cell.definition.key === 'Rift_Graveyard' || cell.definition.key === 'Rift_Frozen')
}

function isConnector(cell: UpgradeCell, prestige: number) {
  return (cell.definition.kind >= 1 && cell.definition.kind <= 3) || isMainPathRift(cell, prestige)
}

function isVisibleAtPrestige(cell: UpgradeCell, prestige: number) {
  return isMainPathRift(cell, prestige) || prestige >= (cell.definition.prestige ?? 0)
}

function isStart(cell: UpgradeCell, campaign: Campaign) {
  if (!cell.start) return false
  const prestige = campaign.upgradeCounters.prestige ?? 0
  if (prestige < cell.startPrestigeLock) return false
  if (cell.startPrestigeIgnore !== 0 && prestige >= cell.startPrestigeIgnore) return false
  if (cell.definition.costs?.foiliumCost && campaign.dayNumber < 2 && !campaign.upgradeCounters.foilium) return false
  return true
}

function meetsDiscovery({ definition }: UpgradeCell, campaign: Campaign) {
  const { requiredHero, requiredTome, requiredPack, targetHero, targetTome } = definition
  const card = requiredHero ?? requiredTome ?? targetHero ?? targetTome
  return (!card || campaign.collection.some(id => id === card)) &&
    (!requiredPack || campaign.unlockedPacks.some(id => id === requiredPack))
}

export function upgradeBoard(campaign: Campaign, openingPreview = false) {
  const prestige = campaign.upgradeCounters.prestige ?? 0
  const completed = (cell: UpgradeCell) => (campaign.upgradeLevels[cell.id] ?? 0) > 0
  const states = new Map<string, UpgradeState>()
  const links = new Set<string>()
  const open: UpgradeCell[] = []
  for (const cell of upgradeCells) {
    if (!isVisibleAtPrestige(cell, prestige)) continue
    if (completed(cell)) {
      states.set(cell.id, 'purchased')
      open.push(cell)
    } else if (isStart(cell, campaign) || (campaign.completed && !campaign.endingSeen && cell.id === 'SN_FinishPrestige0@23,4')) {
      states.set(cell.id, cell.definition.quest ? 'quest' : 'available')
    }
  }

  // The opening board shows the starting paths before the player buys the tower node.
  // Only callers rendering the board expose those paths.
  if (openingPreview && states.get(mainUpgrade) === 'available') open.push(byId.get(mainUpgrade)!)
  for (const cell of open) {
    for (const next of adjacent(cell)) {
      if (!isVisibleAtPrestige(next, prestige)) continue
      links.add(linkId(cell, next))
      if (states.has(next.id)) continue
      if (isConnector(next, prestige)) {
        states.set(next.id, 'connector')
        open.push(next)
      } else if (next.definition.quest) {
        states.set(next.id, 'quest')
      } else {
        states.set(next.id, 'available')
      }
    }
  }

  for (const [id, state] of states) {
    if (state !== 'available') continue
    const cell = byId.get(id)!
    const required = cell.definition.requiredAdjacentPurchased ?? 0
    const hasPurchases = required === 0 || adjacent(cell).filter(completed).length >= required
    if (!hasPurchases || !meetsDiscovery(cell, campaign)) states.set(id, 'locked')
  }

  return { states, links }
}

export function linkId(a: UpgradeCell, b: UpgradeCell) {
  return a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id
}

export const upgradeConnections = upgradeCells.flatMap(cell =>
  adjacent(cell).filter(next => cell.id < next.id).map(next => [cell, next] as const)
)

function upgradeBalance(campaign: Campaign, field: string, salary: number) {
  if (field === 'cost') return campaign.mastery
  if (field === 'coinIncomeCost') return salary
  return campaign.upgradeCounters['resource:' + field] ?? 0
}

export function canAffordUpgrade(campaign: Campaign, cell: UpgradeCell) {
  const salary = rules.salary + upgradeModifiers(campaign.upgradeLevels).salaryCoins
  return Object.entries(cell.definition.costs ?? {}).every(([field, cost]) =>
    upgradeBalance(campaign, field, salary) >= cost
  )
}

function counter(campaign: Campaign, metric: string) {
  if (metric === 'quests' || metric === 'purchases') {
    return Object.keys(campaign.upgradeLevels).filter(id => {
      const node = byId.get(id)
      return (campaign.upgradeLevels[id] ?? 0) > 0 && node && (metric === 'quests' ? !!node.definition.quest : node.definition.kind === 0)
    }).length
  }
  if (metric === 'discoverUnits') return campaign.collection.length
  if (metric.startsWith('pack:')) {
    const id = metric.slice(5)
    if (isPackId(id)) return campaign.openedByPack[id] ?? campaign.upgradeCounters[metric] ?? 0
  }
  if (metric.startsWith('tome:')) return campaign.upgradeCounters['hero:' + metric.slice(5)] ?? 0
  return campaign.upgradeCounters[metric] ?? 0
}

function rawQuestProgress(campaign: Campaign, quest: Quest) {
  return counter(campaign, quest.metric) + (quest.otherMetric ? counter(campaign, quest.otherMetric) : 0)
}

function usesQuestBaseline(quest: Quest) {
  return !['quests', 'purchases', 'discoverUnits', 'discoverSynergies', 'haveRelics'].includes(quest.metric) &&
    !quest.metric.startsWith('monster:Boss')
}

function questEntry(campaign: Campaign, cell: UpgradeCell) {
  const quest = cell.definition.quest!
  const level = campaign.upgradeLevels[cell.id] ?? 0
  const quantities = [quest.quantity, ...quest.stages].filter(quantity => quantity > 0)
  const required = quantities[Math.min(level, quantities.length - 1)] ?? 0
  const complete = quantities.length > 0 && level >= quantities.length
  const baseline = campaign.upgradeCounters['quest:' + cell.id] ?? 0
  const raw = rawQuestProgress(campaign, quest)
  return { level, required, complete, progress: Math.max(0, Math.min(Math.floor(raw - baseline), required)) }
}

export function questLabel(campaign: Campaign, cell: UpgradeCell) {
  const quest = cell.definition.quest
  if (!quest) return null
  const { progress, required, complete } = questEntry(campaign, cell)
  const description = cell.definition.description || quest.description
  return {
    progress,
    required,
    complete,
    description: description
      .replaceAll('{questQuantity}', String(required))
      .replaceAll('{questTargets}', quest.target)
      .replaceAll('{questTarget}', quest.target),
    targetIcon: quest.targetIcon
  }
}

export type BattleQuestRow = {
  cell: UpgradeCell
  metric: string
  progress: number
  required: number
  description: string
  targetIcon?: number | null
}

export type BattleQuestHud = { rows: BattleQuestRow[]; recent: string[] }

function battleQuestStates(campaign: Campaign) {
  let states = questStates.get(campaign)
  if (!states) {
    states = upgradeBoard(campaign).states
    questStates.set(campaign, states)
  }
  return states
}

export function updateBattleQuestHud(campaign: Campaign, progress: BattleQuestProgress | null,
  previous?: BattleQuestHud): BattleQuestHud {
  const states = battleQuestStates(campaign)
  const snapshot = withBattleQuestCounters(campaign, progress)
  const rows = questCells.flatMap(cell => {
    const state = states.get(cell.id)
    const quest = cell.definition.quest!
    if ((state !== 'quest' && state !== 'purchased') || quest.metric === 'quests' || quest.metric === 'purchases' ||
      cell.definition.kind === 6 || (usesQuestBaseline(quest) && !Object.hasOwn(campaign.upgradeCounters, 'quest:' + cell.id))) return []
    const { progress, required, complete } = questEntry(snapshot, cell)
    if (complete || required <= 0 || progress >= required) return []
    // SkillQuestPresentation.GetQuestProgressDisplay scales accumulated damage for the HUD.
    const multiplier = quest.metric === 'cursorDamage' || quest.metric === 'healHeroes' ? 10 : 1
    const description = (cell.definition.description || quest.description)
      .replaceAll('{questQuantity}', String(required * multiplier))
      .replaceAll('{questTargets}', quest.target)
      .replaceAll('{questTarget}', quest.target)
      .replace(/<[^>]+>/g, '').trim()
    return [{ cell, metric: quest.metric, progress: progress * multiplier, required: required * multiplier,
      description, targetIcon: quest.targetIcon }]
  })
  rows.sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x)
  const past = new Map(previous?.rows.map(row => [row.cell.id, row.progress]))
  const active = new Set(rows.map(row => row.cell.id))
  const bumped = rows.filter(row => row.progress > (past.get(row.cell.id) ?? row.progress))
    .map(row => row.cell.id).reverse()
  const recent = [...new Set([...bumped, ...(previous?.recent ?? []).filter(id => active.has(id))])]
  const ranks = new Map(recent.map((id, index) => [id, index]))
  rows.sort((a, b) => (ranks.get(a.cell.id) ?? recent.length) - (ranks.get(b.cell.id) ?? recent.length))
  return { rows, recent }
}

export function upgradeDescription(cell: UpgradeCell) {
  const { description, effects } = cell.definition
  return (description ?? '').replace(/\{(value|chance|power)(\d+)(%?)\}/g, (placeholder, field, index, percent) => {
    const effect = effects?.[Number(index)]
    if (!effect) return placeholder
    const value = field === 'power' ? effect[2] : effect[1]
    const amount = percent && (field === 'power' || Math.abs(value) <= 1) ? value * 100 : value
    return Number(amount.toFixed(2)) + percent
  }).replaceAll('{charge}', '充能').replaceAll('{resourcesurge}', '资源涌动')
    .replaceAll('{thunderbolt}', '闪电').replaceAll('{rainofarrows}', '箭雨')
    .replaceAll('{giant}', '巨化').replace(/<[^>]+>/g, '')
}

export function completeUpgradeQuests(campaign: Campaign): Campaign {
  let result = campaign
  let changed = false
  do {
    changed = false
    const { states } = upgradeBoard(result)
    for (const cell of upgradeCells) {
      const state = states.get(cell.id)
      const quest = cell.definition.quest
      if (!quest || (state !== 'quest' && state !== 'purchased')) continue
      const key = 'quest:' + cell.id
      if (usesQuestBaseline(quest) && !Object.hasOwn(result.upgradeCounters, key)) {
        result = { ...result, upgradeCounters: { ...result.upgradeCounters, [key]: rawQuestProgress(result, quest) } }
      }
      const { progress, required, complete, level } = questEntry(result, cell)
      if (complete || required <= 0 || progress < required) continue
      const { rewards, questUnlockPackReward } = cell.definition
      const unlocked = isPackId(questUnlockPackReward) ? questUnlockPackReward : null
      result = {
        ...result,
        mastery: result.mastery + (rewards?.questMasteryReward ?? 0),
        upgradeLevels: { ...result.upgradeLevels, [cell.id]: level + 1 },
        unlockedPacks: unlocked && !result.unlockedPacks.includes(unlocked)
          ? [...result.unlockedPacks, unlocked]
          : result.unlockedPacks
      }
      changed = true
    }
  } while (changed)
  return result
}

export function progressedQuest(previous: Campaign, next: Campaign) {
  return previous.upgradeLevels !== next.upgradeLevels && questCells.some(cell =>
    (next.upgradeLevels[cell.id] ?? 0) > (previous.upgradeLevels[cell.id] ?? 0))
}

export function withBattleQuestCounters(campaign: Campaign, progress: BattleQuestProgress | null): Campaign {
  if (!progress || !Object.keys(progress.pending).length) return campaign
  const upgradeCounters = { ...campaign.upgradeCounters }
  for (const [key, amount] of Object.entries(progress.pending)) upgradeCounters[key] = (upgradeCounters[key] ?? 0) + amount
  return { ...campaign, upgradeCounters }
}

export function recordBattleQuestCounters(progress: BattleQuestProgress | null) {
  if (!progress) return
  for (const [key, accrued] of Object.entries(progress.pending)) {
    progress.recorded[key] = (progress.recorded[key] ?? 0) + accrued
  }
  progress.pending = {}
}

export function resolveBattleQuests(campaign: Campaign, progress: BattleQuestProgress,
  observeProgress?: (campaign: Campaign, position: Point) => void) {
  const completedAt: Point[] = []
  for (const { metric, amount, position } of progress.events.splice(0)) {
    progress.pending[metric] = (progress.pending[metric] ?? 0) + amount
    const cells = questCellsByMetric.get(metric)
    if (!cells) continue
    let affectsQuest = false
    let canComplete = false
    const states = battleQuestStates(campaign)
    for (const cell of cells) {
      const state = states.get(cell.id)
      if (state !== 'quest' && state !== 'purchased') continue
      const quest = cell.definition.quest!
      const baseline = 'quest:' + cell.id
      if (usesQuestBaseline(quest) && !Object.hasOwn(campaign.upgradeCounters, baseline)) continue
      const { complete, required } = questEntry(campaign, cell)
      if (complete || required <= 0) continue
      affectsQuest = true
      const prior = rawQuestProgress(campaign, quest) - (campaign.upgradeCounters[baseline] ?? 0)
      const accrued = (progress.pending[quest.metric] ?? 0) + (quest.otherMetric ? progress.pending[quest.otherMetric] ?? 0 : 0)
      if (prior + accrued >= required) {
        canComplete = true
        break
      }
    }
    if (canComplete) {
      const next = completeUpgradeQuests(withBattleQuestCounters(campaign, progress))
      if (progressedQuest(campaign, next)) {
        recordBattleQuestCounters(progress)
        campaign = next
        completedAt.push(position)
      }
    }
    if (affectsQuest) observeProgress?.(campaign, position)
  }
  return { campaign, completedAt }
}

export function purchaseUpgrade(campaign: Campaign, id: string): Campaign {
  if (campaign.resumePhase !== 'prepare' || campaign.completed) return campaign
  const cell = byId.get(id)
  if (!cell || cell.definition.kind !== 0 || upgradeBoard(campaign).states.get(id) !== 'available' ||
      !canAffordUpgrade(campaign, cell)) return campaign

  const costs = cell.definition.costs ?? {}
  const upgradeCounters = { ...campaign.upgradeCounters }
  for (const [field, value] of Object.entries(costs)) {
    if (field === 'cost' || field === 'coinIncomeCost') continue
    const key = 'resource:' + field
    upgradeCounters[key] = (upgradeCounters[key] ?? 0) - value
  }
  return completeUpgradeQuests({
    ...campaign,
    mastery: campaign.mastery - (costs.cost ?? 0),
    upgradeLevels: { ...campaign.upgradeLevels, [id]: 1 },
    upgradeCounters
  })
}

export function upgradeModifiers(levels: Record<string, number> = {}) {
  const effects: { type: number; value: number; power: number; target?: string; pack?: string; upgrade: string }[] = []
  let towerVisual = 0
  let salaryCoins = 0
  let shopSlots = 0
  const unlockedBuildings: string[] = []
  for (const [id, level] of Object.entries(levels)) {
    const data = byId.get(id)?.definition
    if (!data || level <= 0) continue
    const count = data.quest ? Math.min(level, 1 + data.quest.stages.length) : 1
    towerVisual += Number(!!data.upgradeTowerVisual)
    salaryCoins += count * (data.rewards?.questIncomeFlatBonus ?? 0) - (data.costs?.coinIncomeCost ?? 0)
    shopSlots += count * (data.rewards?.questRoguelikeShopSlotReward ?? 0)
    for (const [type, value, power] of data.effects ?? []) {
      if (type === 157 && data.targetBuilding) unlockedBuildings.push(data.targetBuilding)
      effects.push({ type, value: value * count, power, target: data.targetHero ?? data.targetTome ?? data.targetBuilding ?? data.targetSpell, pack: data.targetPack, upgrade: data.key })
    }
  }
  const effect = (type: number, target?: string, pack?: string) => effects.reduce((total, item) =>
    item.type === type && (!item.target || item.target === target) && (!item.pack || item.pack === pack)
      ? total + item.value
      : total, 0)
  return {
    towerHp: 1 + effect(40),
    towerVisual,
    cursorDamage: 1 + effect(33),
    cursorRadius: 1 + effect(34),
    cursorSpeed: 1 + effect(35),
    salaryCoins: salaryCoins + effect(86),
    packHits: effect(504, undefined, 'Pack1_Basic'),
    boxHits: effect(505, undefined, 'Pack1_Basic'),
    packHitsFor: (id: PackId, box = false) => effect(box ? 505 : 504, undefined, id),
    shopSlots: shopSlots + effect(470),
    shopRerollUnlocked: effect(507) > 0,
    shopRerollCostReduction: effect(471),
    masteryPerKill: effect(121),
    masteryInterest: effect(535),
    unlockedBuildings,
    effects,
    effect,
    modifiersFor: (target?: string) => ({
      hp: 1 + effect(1, target),
      attackSpeed: 1 + effect(4, target) + effect(15, target) + effect(18, target),
      attackDamage: 1 + effect(6, target),
      attackRange: 1 + effect(5, target) + effect(14, target),
      area: 1 + effect(54, target) + effect(48, target),
      moveSpeed: 1 + effect(0, target),
      casts: effect(17, target) + effect(46, target),
      bounces: effect(16, target),
      block: effect(80, target),
      critChance: effect(27, target),
      critDamage: effect(28, target),
      tomeDuration: 1 + effect(95, target)
    })
  }
}



