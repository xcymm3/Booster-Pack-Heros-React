import { isCardId, isHero, tomes, type HeroId } from './rules'
import { upgradeCells } from './upgrades'
import type { Campaign, Summary } from './save'

export type ActBattleStats = {
  monsters: number
  foils: number
  damage: number
  heroDamage: Partial<Record<HeroId, number>>
  heroSpawns: Partial<Record<HeroId, number>>
}

function clearedMonsters(campaign: Campaign, recorded: Record<string, number> = {}) {
  return Object.entries(campaign.upgradeCounters).reduce((count, [key, value]) =>
    count + (key.startsWith('monster:') ? Math.max(0, value - (recorded[key] ?? 0)) : 0), 0)
}

export function appendActBattle(campaign: Campaign, summary: Summary, recorded: Record<string, number>): ActBattleStats {
  const previous = campaign.actBattle ?? {
    monsters: clearedMonsters(campaign, recorded), foils: 0, damage: 0, heroDamage: {}, heroSpawns: {}
  }
  const units = summary.unitStats ?? []
  const heroDamage = { ...previous.heroDamage }
  const heroSpawns = { ...previous.heroSpawns }
  for (const unit of units) {
    if (!isHero(unit.id)) continue
    heroDamage[unit.id] = (heroDamage[unit.id] ?? 0) + unit.damage
    heroSpawns[unit.id] = (heroSpawns[unit.id] ?? 0) + unit.count
  }
  return {
    monsters: previous.monsters + summary.defeated,
    foils: previous.foils + (summary.foilDefeated ?? 0),
    damage: previous.damage + (summary.totalDamage ?? units.reduce((sum, unit) => sum + unit.damage, summary.cursorDamage ?? 0)),
    heroDamage, heroSpawns
  }
}

// PrestigeStats in the release, prestige zero.
export const actMedals = [
  { id: 'gold', tries: 36 },
  { id: 'silver', tries: 40 },
  { id: 'bronze', tries: 44 }
] as const

export const actSummaryOpeningSound = 'summary/act-open.wav'

export function actSummary(campaign: Campaign) {
  const { actBattle, upgradeLevels, attempts } = campaign
  const leaders = Object.entries(actBattle?.heroDamage ?? {})
    .filter((entry): entry is [HeroId, number] => isCardId(entry[0]) && isHero(entry[0]) && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
  const best = leaders[0]
  const mvp = best && actBattle ? {
    hero: best[0], damage: best[1] * 10, count: actBattle.heroSpawns[best[0]] ?? 0,
    share: Math.min(1, best[1] / Math.max(best[1], actBattle.damage))
  } : null
  const groups = [
    { title: 'section_combat', rows: [
      { icon: 'monsters', key: 'monsters', value: actBattle?.monsters ?? clearedMonsters(campaign) },
      { icon: 'foil-monsters', key: 'foil_monsters', value: actBattle?.foils ?? 0 },
      { icon: 'bosses', key: 'bosses', value: campaign.completed ? 3 : campaign.dayNumber - 1 }
    ] },
    { title: 'section_economy', rows: [
      { icon: 'gold-spent', key: 'gold_spent', value: campaign.actCoinsSpent },
      { icon: 'packs', key: 'packs', value: campaign.totalPacksOpened },
      { icon: 'upgrades', key: 'upgrades', value: upgradeCells.filter(cell => cell.definition.kind === 0 &&
        (upgradeLevels[cell.id] ?? 0) > 0).length },
      { icon: 'quests', key: 'quests', value: upgradeCells.filter(cell => !!cell.definition.quest &&
        (upgradeLevels[cell.id] ?? 0) > 0).length }
    ] },
    { title: 'section_collection', rows: [
      { icon: 'heroes', key: 'heroes', value: campaign.collection.filter(isHero).length },
      { icon: 'tomes', key: 'tomes', value: campaign.collection.filter(id => Object.hasOwn(tomes, id)).length },
      { icon: 'foils', key: 'foils', value: campaign.foilCollection.length }
    ] }
  ]
  // PrestigeSummaryScreen serialized fade, count-up, and pause durations.
  let at = .4 + .5
  const panels = groups.map(group => {
    const openAt = at
    const rows = group.rows.map(row => {
      const start = at
      const duration = (row.value ?? 0) > 0 ? .5 : 0
      at += duration
      return { ...row, at: start, duration }
    })
    return { ...group, at: openAt, rows }
  })
  const mvpAt = at + .15
  const triesAt = mvpAt + (mvp ? 2.25 : 0)
  const medal = actMedals.find(mark => attempts <= mark.tries)?.id
  return {
    panels, mvp, mvpAt, triesAt, attempts, medal, continueAt: triesAt + .25 + 2.5 + .15 + (medal ? .45 : 0),
    playedTimeMillis: Math.max(campaign.actPlayTimeMillis ?? 0, campaign.playedTimeMillis)
  }
}
