import { cardArt, heroes, isPackId, monsters, packArt, packs, tomes, unitName, type CardId, type MonsterId } from '../../game/rules'
import type { BattleQuestRow } from '../../game/upgrades'
import { questFlightPosition, questPanel, questRowScale, type QuestMotion } from '../../game/quest-flight'
import scene from '../../data/scene-canvas.json'
import { crtDisplayPoint } from './crt'
import { AtlasIcon } from './atlas-icon'
import { asset } from './media'
import type { MenuPreferences } from './main-menu'

function questVignette(x: number, y: number, distortion: number) {
  const vignette = distortion ? 1 - ((x - .5) ** 2 + (y - .5) ** 2) * scene.crt.vignette * 2.5 : 1
  return Math.max(0, vignette) ** (1 / 2.2)
}

export function questHudLayout(distortion: number) {
  const { left, bottom, width: rowWidth, rowHeight, gap: rowGap } = questPanel
  const origin = crtDisplayPoint(left, bottom, distortion)
  const end = crtDisplayPoint(left + rowWidth, bottom, distortion)
  const rowTop = crtDisplayPoint(left, bottom - rowHeight, distortion)
  const nextRow = crtDisplayPoint(left, bottom - rowHeight - rowGap, distortion)
  const centerX = (origin.x + end.x) / 2
  const centerY = (origin.y + rowTop.y) / 2
  return {
    left: origin.x * 100 + '%', bottom: (1 - origin.y) * 100 + '%', width: (end.x - origin.x) * 100 + '%',
    rowHeight: (origin.y - rowTop.y) * 100 + 'cqh', gap: (rowTop.y - nextRow.y) * 100 + 'cqh',
    brightness: questVignette(centerX, centerY, distortion)
  }
}

function questPortrait(target: string) {
  if (isPackId(target)) return packArt(target)
  if (target in heroes || target in monsters || target in tomes) return cardArt(target as CardId | MonsterId)
  return undefined
}

function englishDescription(row: BattleQuestRow, kind: string, target: string) {
  const amount = row.required
  if (isPackId(target)) return `Open ${amount} ${packs[target].name.toLowerCase()}${amount === 1 ? '' : 's'}`
  if (target in monsters) {
    const name = unitName(target as MonsterId, 'en')
    return target.startsWith('Boss') ? `Defeat ${name}` : `Defeat ${amount} ${name}${amount === 1 ? '' : 's'}`
  }
  if (target in heroes) return `Find ${amount} ${unitName(target as CardId, 'en')}${amount === 1 ? '' : 's'}`
  if (target in tomes) return `Find ${amount} ${tomes[target as keyof typeof tomes].name}`
  if (kind === 'cursorDamage') return `Deal ${amount} damage with the cursor`
  if (target === 'Spell_Thunderbolt') return `Cast Thunderbolt ${amount} times`
  return row.description
}

function QuestPortrait({ row, flying = false }: { row: BattleQuestRow; flying?: boolean }) {
  const target = row.metric.split(':', 2)[1] ?? ''
  const portrait = questPortrait(target)
  const slot = row.targetIcon ?? row.cell.definition.incompleteIcon ?? row.cell.definition.icon
  if (portrait || (flying && slot == null)) {
    return <img className="quest-hud-portrait" src={asset(portrait ?? 'quest-fly-default.png')} alt="" draggable={false} />
  }
  return slot == null ? <span aria-hidden="true" /> : <AtlasIcon className="quest-hud-portrait" slot={slot} />
}

export function QuestHud({ rows, language, distortion, motion, now = 0, expanded = false, onExpandedChange }: {
  rows: readonly BattleQuestRow[]
  language: MenuPreferences['language']
  distortion: number
  motion?: QuestMotion
  now?: number
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const effects = reducedMotion ? undefined : motion
  if (!rows.length && !effects?.flights.length) return null
  const layout = questHudLayout(distortion)
  const shown = expanded ? rows : rows.slice(0, questPanel.collapsedRows)
  const height = (parseFloat(layout.rowHeight) + parseFloat(layout.gap)) * shown.length
  return <>
    {shown.length > 0 && <ol className={'quest-hud' + (height > 88 ? ' quest-hud-scroll' : '')} data-ui=""
      tabIndex={rows.length > questPanel.collapsedRows ? 0 : undefined}
      aria-label={language === 'en' ? 'Active quests' : '进行中的任务'}
      onPointerEnter={() => onExpandedChange?.(true)}
      onPointerLeave={event => { if (!event.currentTarget.matches(':focus-within')) onExpandedChange?.(false) }}
      onFocus={() => onExpandedChange?.(true)}
      onBlur={event => { if (!event.currentTarget.matches(':hover')) onExpandedChange?.(false) }}
      style={{ left: layout.left, bottom: layout.bottom, width: layout.width, rowGap: layout.gap,
        filter: layout.brightness < 1 ? `brightness(${layout.brightness})` : undefined }}>
      {shown.map(row => {
        const [kind, target = ''] = row.metric.split(':', 2)
        const description = language === 'en' ? englishDescription(row, kind, target) : row.description
        const poppedAt = effects?.popped.get(row.cell.id)
        const progress = motion?.waiting.get(row.cell.id) ?? row.progress
        return <li key={row.cell.id} className="quest-hud-row" style={{ height: layout.rowHeight,
          scale: poppedAt === undefined ? '1' : String(questRowScale(now - poppedAt)) }}>
          <QuestPortrait row={row} />
          <span className="quest-hud-label" title={description}>{description}</span>
          <span className="quest-hud-count">{progress}/{row.required}</span>
        </li>
      })}
    </ol>}
    {effects?.flights.map(flight => {
      const at = questFlightPosition(flight, now)
      const position = crtDisplayPoint(at.x, at.y, distortion)
      return <span key={flight.id} className="quest-hud-flight" aria-hidden="true" style={{
        left: position.x * 100 + '%', top: position.y * 100 + '%', width: questPanel.flySize * 100 + 'cqh',
        opacity: questPanel.flyAlpha,
        filter: `brightness(${questVignette(position.x, position.y, distortion)})`
      }}><QuestPortrait row={flight.row} flying /></span>
    })}
  </>
}
