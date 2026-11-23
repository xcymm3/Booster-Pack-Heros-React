import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { binderAwards, binderCardsData, binderClasses, binderLabels, binderRarities, binderUnitStats } from '../../game/binder'
import { cardArt, isCardId, isPackId, isRelic, packArt, relics, unitName, type CardId } from '../../game/rules'
import type { Campaign } from '../../game/save'
import { binderCards, upgradeModifiers } from '../../game/upgrades'
import { asset } from './media'
import { AtlasIcon } from './atlas-icon'
import './collection-binder.css'

type Language = 'en' | 'zh-CN'
type Entry = { id: string; icon?: number }
type Selection = { id: string; left: number; top: number; above: boolean; awards: ReturnType<typeof binderAwards> }
const statNames = {
  hp: ['Hit points', '生命值'], damage: ['Damage', '伤害'], cooldown: ['Cooldown', '攻击间隔'],
  move: ['Move speed', '移动速度'], range: ['Range', '射程'], critical: ['Critical chance', '暴击率'],
  block: ['Block chance', '格挡率']
} as const
const foilTerms: Record<string, string> = {
  'HP': '生命值', 'damage': '伤害', 'area attack': '范围攻击', 'attack speed': '攻击速度',
  'duration': '持续时间', 'move speed': '移动速度', 'block chance': '格挡率',
  'extra fireballs': '额外火球', 'summon damage': '召唤物伤害', 'spell cast': '次施法',
  'crit chance & damage': '暴击率与暴击伤害', 'mastery per Illusionist': '精通获取倍率／每个幻术师',
  'attack & spell speed': '攻击与施法速度', 'leap range': '跳跃距离', 'tornado casts': '次龙卷风施法',
  'extra dragon per cast': '条巨龙／每次施法', 'arrow': '支箭矢', 'charge damage': '冲锋伤害',
  'push force': '击退强度', 'stun duration': '眩晕时间', 'enemy frozen per tick': '个冻结目标／每次生效',
  'extra mine': '个额外地雷', 'extra quasars': '道额外类星体激光', 'cursor area': '光标范围'
}

function foilText(value: string, language: Language) {
  if (language === 'en') return value
  return value.split(', ').map(part => {
    const split = part.indexOf(' ')
    const name = foilTerms[part.slice(split + 1)]
    return name ? part.slice(0, split).replace('x', '×') + ' ' + name : part
  }).join('，')
}

function art(name?: string, className?: string) {
  const src = name && asset(name)
  return src ? <img src={src} alt="" draggable={false} className={className} /> : null
}

function binderPortrait(id: string) {
  return binderCardsData[id] ? 'binder/portraits/' + id + '.png' : isCardId(id) ? cardArt(id) : undefined
}

function navigateCards(event: KeyboardEvent<HTMLDivElement>) {
  const axes: Record<string, [boolean, number]> = {
    ArrowLeft: [true, -1], ArrowRight: [true, 1], ArrowUp: [false, -1], ArrowDown: [false, 1]
  }
  const axis = axes[event.key]
  const current = event.target
  if (!axis || !(current instanceof HTMLButtonElement) || !current.dataset.binderId ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
  const [horizontal, side] = axis
  const box = current.getBoundingClientRect()
  const along = (r: DOMRect) => horizontal ? [r.left, r.right] : [r.top, r.bottom]
  const across = (r: DOMRect) => horizontal ? [r.top, r.bottom] : [r.left, r.right]
  const [from, to] = along(box)
  const [low, high] = across(box)
  const found = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-binder-id]')].flatMap(button => {
    if (button === current || button.getClientRects().length === 0) return []
    const r = button.getBoundingClientRect()
    const [begin, end] = along(r)
    const gap = side > 0 ? begin - to : from - end
    if (gap < -1) return []
    const [nextLow, nextHigh] = across(r)
    const overlaps = nextHigh > low && nextLow < high
    const offset = Math.abs(nextLow + nextHigh - low - high) / 2
    return [{ button, overlaps, score: gap + offset * (overlaps ? .001 : 2) }]
  }).sort((a, b) => Number(b.overlaps) - Number(a.overlaps) || a.score - b.score)[0]
  if (!found) return
  event.preventDefault()
  found.button.focus({ preventScroll: true })
  found.button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function CollectionBinder({ campaign, collapsed, language, claim }: {
  campaign: Campaign; collapsed: boolean; language: Language; claim?: (id: CardId) => void
}) {
  const [relicMode, setRelicMode] = useState(false)
  const [focused, setFocused] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const detailId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modifiers = useMemo(() => upgradeModifiers(campaign.upgradeLevels), [campaign.upgradeLevels])
  const entries: readonly Entry[] = relicMode ? Object.keys(relics).map(id => ({ id })) : binderCards
  const columns = collapsed ? 12 : 8
  const tabStop = entries.some(entry => entry.id === focused) ? focused : entries[0]?.id
  const active = selection?.id
  const data = active ? binderCardsData[active] : undefined
  const validActive = isCardId(active) && campaign.collection.includes(active) ? active : undefined
  const relic = isRelic(validActive) ? relics[validActive] : undefined
  const equipped = isRelic(validActive) && campaign.equippedRelics.includes(validActive)
  const description = data?.description[language] || data?.description.en ||
    (language === 'en' ? relic?.description : relic?.descriptionZh || relic?.description) || ''
  const newTag = binderLabels['ui.tag.new'][language]
  const foil = validActive ? campaign.foilCollection.includes(validActive) : false
  const stats = validActive ? binderUnitStats(validActive, foil, modifiers) : []
  const awards = selection?.awards ?? []
  const rank = data ? binderRarities[data.rarity] ?? 'common' : 'common'
  const typeTag = data?.heroClass == null ? 'tome' : binderClasses[data.heroClass]
  const tag = data && [
    binderLabels['ui.binder.filter.' + rank]?.[language],
    binderLabels['ui.binder.filter.' + typeTag]?.[language],
    data.heroClass == null ? '' : language === 'en' ? 'hero' : '英雄'
  ].filter(Boolean).join(language === 'en' ? ' ' : '')

  function keepDetail() {
    if (pendingClose.current !== null) {
      clearTimeout(pendingClose.current)
      pendingClose.current = null
    }
  }
  useEffect(() => () => { if (pendingClose.current !== null) clearTimeout(pendingClose.current) }, [])

  function show(button: HTMLButtonElement, id: string) {
    keepDetail()
    if (!isCardId(id) || !campaign.collection.includes(id) || !wrap.current) {
      setSelection(null)
      return
    }
    const scene = wrap.current.closest('.improvements-screen')?.getBoundingClientRect()
    const board = wrap.current.getBoundingClientRect()
    if (!scene?.width || !board.width || !board.height) return
    const rect = button.getBoundingClientRect()
    const width = scene.width * .216
    const left = Math.max(board.left + 4, Math.min(rect.left + (rect.width - width) / 2, board.right - width - 4))
    const above = board.bottom - rect.bottom < scene.height * .255
    const y = above ? rect.top - 4 : rect.bottom + 4
    const pending = binderAwards(campaign, id)
    setSelection(previous => ({
      id, left: (left - board.left) / board.width * 100, top: (y - board.top) / board.height * 100, above,
      awards: pending.length || previous?.id !== id ? pending : previous.awards
    }))
    if (campaign.binderPending.cards.includes(id) || campaign.binderPending.foils.includes(id)) claim?.(id)
  }
  function closeSoon() {
    keepDetail()
    pendingClose.current = setTimeout(() => setSelection(null), 110)
  }

  return <div className="binder-sheet" ref={wrap} onKeyDown={event => {
    if (event.key === 'Escape' && selection) {
      keepDetail()
      setSelection(null)
      event.stopPropagation()
    }
  }}>
    {!!campaign.equippedRelics.length && <div className="binder-tabs" aria-label={language === 'en' ? 'Collection categories' : '收藏分类'}>
      <button type="button" aria-pressed={!relicMode} onClick={() => { setSelection(null); setRelicMode(false) }}>
        {language === 'en' ? 'Units' : '单位'}
      </button>
      <button type="button" aria-pressed={relicMode} onClick={() => { setSelection(null); setRelicMode(true) }}>
        {language === 'en' ? 'Relics' : '圣物'}
      </button>
    </div>}
    <div className="collection-grid" role="grid" aria-label={language === 'en' ? 'Collection' : '收藏'}
      onKeyDown={navigateCards} onScroll={() => setSelection(null)}>
      {Array.from({ length: Math.ceil(entries.length / columns) }, (_, index) =>
        <div className="binder-row" role="row" key={index}>
          {entries.slice(index * columns, (index + 1) * columns).map(entry => {
            const id = entry.id
            const meta = binderCardsData[id]
            const discovered = isCardId(id) && campaign.collection.includes(id)
            const foil = discovered && campaign.foilCollection.includes(id)
            const fresh = discovered && (campaign.binderPending.cards.includes(id) || campaign.binderPending.foils.includes(id))
            const frame = discovered ? binderRarities[meta?.rarity ?? 0] ?? 'common' : 'unknown'
            const name = discovered ? unitName(id, language) : language === 'en' ? 'Undiscovered' : '未发现'
            const portrait = binderPortrait(id)
            const sourcePack = meta?.sourcePack
            return <div role="gridcell" key={id}>
              <button className={'collection-card binder-' + frame + (discovered ? '' : ' binder-silhouette') +
                (id === active ? ' binder-active' : '')} type="button" data-binder-id={id}
                aria-label={fresh ? name + (language === 'en' ? ', ' : '，') + newTag : name}
                aria-describedby={id === validActive ? detailId : undefined} tabIndex={id === tabStop ? 0 : -1}
                onPointerEnter={event => show(event.currentTarget, id)} onPointerLeave={closeSoon}
                onFocus={event => { setFocused(id); show(event.currentTarget, id) }} onBlur={closeSoon}
                onClick={event => show(event.currentTarget, id)}>
                <span className={'binder-art' + (foil ? ' binder-foil-art' : '')}
                  style={portrait ? { '--binder-portrait': 'url("' + asset(portrait) + '")' } as CSSProperties : undefined}>
                  {art(portrait) ?? <AtlasIcon slot={entry.icon} />}
                </span>
                {discovered && isPackId(sourcePack) && art(packArt(sourcePack), 'binder-source-pack')}
                {fresh && <span className="binder-new">{newTag}</span>}
              </button>
            </div>
          })}
        </div>)}
    </div>
    {selection && validActive && <aside id={detailId} role="tooltip"
      className={'binder-detail' + (selection.above ? ' binder-detail-above' : '')}
      style={{ left: selection.left + '%', top: selection.top + '%' }} onPointerEnter={keepDetail} onPointerLeave={closeSoon}>
      <div className="binder-detail-panel">
        <h2>{unitName(validActive, language)}{tag && ' · ' + tag}
          {equipped && (language === 'en' ? ' · Equipped' : ' · 已装备')}
        </h2>
        <div className="binder-description">
          {art(binderPortrait(validActive))}
          <p>{description.replace(/\[\/?\w+\]/g, '')}</p>
        </div>
        {!!stats.length && <div className="binder-stats">{stats.map(({ key, value }) => {
          const stat = statNames[key as keyof typeof statNames]?.[language === 'en' ? 0 : 1]
          return <span key={key} aria-label={stat + ' ' + value} title={stat}>{art(key === 'damage' ? 'summary/damage.png' :
            'binder/stat-' + key + '.png')}{value}</span>
        })}</div>}
        {!!awards.length && <div className="binder-award">{awards.map(({ resource, value }, index) =>
          <span key={index}>+{value}{art(resource === 0 ? 'mastery-blue.png' : resource === 5 ? 'binder/foilium.png' : undefined)}</span>)}</div>}
      </div>
      {foil && data?.foil && <div className="binder-detail-panel binder-foil-detail">
        <h2>{binderLabels['term.foil.name'][language]}</h2>
        <p>{foilText(data.foil, language)}</p>
      </div>}
    </aside>}
  </div>
}
