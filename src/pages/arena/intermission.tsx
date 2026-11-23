import { useId, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent, type SetStateAction } from 'react'
import { cardArt, chapterInfo, isCardId, packArt, packName, packs, supporterTowerSkin, text, unitName, type CardId, type PackId } from '../../game/rules'
import { getSalary, getShopRerollCost, shopOffers, type Campaign, type Summary } from '../../game/save'
import scene from '../../data/scene-canvas.json'
import summaryLocale from '../../data/summary-locale.json'
import { defeatSummaryTiming } from '../../game/defeat'
import { campaignGatePose, campaignGateView, type GateCamera } from '../../game/campaign-gate'
import { summaryLayout } from './summary-layout'
import chapterLabels from '../../assets/menu/chapter-labels.json'
import { initialUpgradeView, upgradeBackgroundOpacity, upgradeNodeSpacing, upgradeSkyLayerPose, upgradeSkyLayers,
  upgradeTreeOrigin, type UpgradeView } from '../../game/upgrade-camera'
import {
  canAffordUpgrade, linkId, mainUpgrade, questLabel, upgradeBoard,
  upgradeCells, upgradeConnections, upgradeDescription, upgradeModifiers, type UpgradeCell
} from '../../game/upgrades'
import towerShadow from '../../assets/upgrades/tower-shadow.png'
import { asset } from './media'
import { AtlasIcon } from './atlas-icon'
import { CampaignDoorArt } from './campaign-door-art'
import { CollectionBinder } from './collection-binder'
import { unlockContinueAt, unlockFlashAt } from './use-game'
import './intermission.css'


type UnitStat = {
  name: string
  count: number
  damage: number
  defense: number
  art?: string
}

type SummaryScreenProps = {
  summary: Summary
  continueChapter: () => void
  skipCount?: () => void
  packsOpened?: number
  cursorDamage?: number
  unitStats?: readonly UnitStat[]
  attempts?: number
  entranceAge?: number
  distortion?: number
  language?: 'zh-CN' | 'en'
  chapter: number
}

function ScreenArt({ name }: { name?: string }) {
  const src = name && asset(name)
  return src ? <img src={src} alt="" draggable={false} /> : null
}

function MasteryMark() {
  return asset('mastery-blue.png')
    ? <ScreenArt name="mastery-blue.png" />
    : <span className="intermission-diamond" aria-hidden="true" />
}

function elapsedLabel(elapsed: number, language: 'zh-CN' | 'en') {
  const wholeSeconds = Math.floor(elapsed)
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  if (language === 'en') return (minutes ? minutes + ' min ' : '') + seconds + ' sec'
  return minutes ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒'
}

export function SummaryScreen({
  summary, continueChapter, skipCount, packsOpened, cursorDamage, chapter, unitStats = [], attempts, entranceAge, distortion = 0, language = 'zh-CN'
}: SummaryScreenProps) {
  const won = summary.result === 'victory'
  const layout = summaryLayout(distortion, Boolean(attempts))
  const label = (key: keyof typeof summaryLocale) => summaryLocale[key][language]
  const chapterLabel = chapterLabels['WaveChapter.title'][language].replace('{0}', String(chapter))
  const [mode, setMode] = useState<'average' | 'total'>('average')
  const cursor = {
    name: label('term.cursor'), count: 1, damage: cursorDamage, defense: 0,
    art: 'summary/cursor.png'
  }
  const value = (amount: number | undefined, count: number) =>
    amount === undefined ? '—' : Math.round(amount / (mode === 'average' ? Math.max(count, 1) : 1))
  const stats = [cursor, ...unitStats].sort((a, b) => Number(value(b.damage ?? 0, b.count)) - Number(value(a.damage ?? 0, a.count)))
  const tableOverflows = 56 + stats.length * 61 > layout.statsHeight
  const { titlePopDuration, summaryRowPopDuration, summaryRowStagger, summaryCountDuration } = scene.defeat
  const timing = defeatSummaryTiming(summary)
  const age = entranceAge ?? Infinity
  const progress = (at: number, duration: number) => Math.max(0, Math.min(1, (age - at) / duration))
  const count = (index: number) => Math.round(timing.rows[index].value * progress(timing.rows[index].at, summaryCountDuration))
  const titleTime = Math.min(1, age / titlePopDuration)
  const titleScale = 1 + .4 * (1 - titleTime * titleTime * (3 - 2 * titleTime))

  return <section className={'intermission result-screen' + (won ? ' result-victory' : '')} data-ui=""
    aria-labelledby="result-title" onClick={age < timing.continueAt ? skipCount : undefined}>
    <header className="result-title">
      <span className="result-separator" style={layout.topRule} aria-hidden="true" />
      <span className="result-separator" style={layout.bottomRule} aria-hidden="true" />
      <h1 id="result-title" style={{ ...layout.title, '--result-title-scale': titleScale } as CSSProperties}>
        {won ? label('ui.daysummary.chapter_complete').replace('{0}', chapterLabel) : label('ui.daysummary.defeat_phrase')}
      </h1>
      {Boolean(attempts) && <p style={layout.tries}>
        {label(attempts === 1 ? 'ui.daysummary.completed_in_tries' : 'ui.daysummary.completed_in_tries.plural').replace('{0}', String(attempts))}
      </p>}
    </header>
    <div className="result-grid" style={layout.panels}>
      {age >= timing.tableAt && <section className="result-panel damage-panel" aria-label="单位数据"
        style={{ opacity: progress(timing.tableAt, summaryRowPopDuration) }}>
        <div className="damage-modes" aria-label="统计方式">
          <button className="damage-mode" type="button" aria-pressed={mode === 'average'}
            onClick={() => setMode('average')}>{label('ui.daysummary.stats_mode_avg')}</button>
          <button className="damage-mode" type="button" aria-pressed={mode === 'total'}
            onClick={() => setMode('total')}>{label('ui.daysummary.stats_mode_total')}</button>
        </div>
        <div className="combat-results-scroll" role="region" aria-label="单位伤害与防御"
          style={{ maxHeight: layout.statsHeight / 1080 * 100 + 'cqh' }} tabIndex={tableOverflows ? 0 : undefined}>
          <table className="combat-results">
            <colgroup><col /><col /><col /></colgroup>
            <thead><tr>
              <th scope="col">{label('ui.daysummary.col_unit')}</th>
              <th scope="col"><ScreenArt name="summary/damage.png" />{label('ui.daysummary.col_dmg')}</th>
              <th scope="col"><ScreenArt name="summary/defense.png" />{label('ui.daysummary.col_def')}</th>
            </tr></thead>
            <tbody>{stats.map((stat, index) => {
              const rowAt = timing.rowsAt + index * summaryRowStagger
              if (age < rowAt) return null
              return <tr key={stat.name} style={{ opacity: progress(rowAt, summaryRowPopDuration) }}>
                <th scope="row">
                  <span className="result-unit-icon" data-cursor={stat === cursor || undefined}><ScreenArt name={stat.art} /></span>
                  <span className="result-unit-name" title={stat.name}>{stat.name} ({stat.count})</span>
                </th>
                <td>{value(stat.damage, stat.count)}</td>
                <td>{value(stat.defense, stat.count)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </section>}
      {age >= timing.resourcesAt && <section className="result-panel reward-panel" aria-label="战斗结算"
        style={{ opacity: progress(timing.resourcesAt, summaryRowPopDuration) }}>
        <dl>
          {age >= timing.rows[0].at && <div className="reward-row">
            <dt><ScreenArt name="summary/time.png" />{label('ui.daysummary.time_survived_label')}</dt>
            <dd>{elapsedLabel(count(0), language)}</dd>
          </div>}
          {age >= timing.rows[1].at && <div className="reward-row">
            <dt><ScreenArt name="summary/packs.png" />{label('ui.daysummary.packs_opened_label')}</dt>
            <dd>{packsOpened === undefined ? '—' : count(1)}</dd>
          </div>}
        </dl>
        {age >= timing.rows[2].at && <>
          <p className="result-subtitle">{label('ui.daysummary.resources_earned_label')}</p>
          <dl className="reward-resources">
            {summary.mastery > 0 && <div className="reward-row mastery-row">
              <dt><MasteryMark />{label('term.resource.mastery')}</dt><dd>+{count(2)}</dd>
            </div>}
            {summary.coins > 0 && age >= timing.rows[3].at && <div className="reward-row coin-row">
              <dt><ScreenArt name="coin.png" />{label('term.resource.coins')}</dt><dd>+{count(3)}</dd>
            </div>}
          </dl>
        </>}
      </section>}
    </div>
    {age >= timing.continueAt && <button className="result-continue" style={layout.next} type="button" onClick={continueChapter}>
      {label('ui.button.continue')}
    </button>}
  </section>
}

export function UnlockScreen({ pack, age, exitAge, continueUnlock }: {
  pack: PackId; age: number; exitAge: number | null; continueUnlock: () => void
}) {
  const config = scene.unlock
  const revealed = age >= unlockFlashAt
  const elapsed = Math.max(0, age - unlockFlashAt)
  const flash = revealed ? Math.max(0, 1 - elapsed / config.flashDuration) : 0
  const drop = Math.min(1, age / config.dropDuration)
  const charge = Math.max(0, Math.min(1, (age - config.dropDuration) / config.chargeDuration))
  const windup = Math.max(0, Math.min(1, (age - unlockFlashAt + config.windupDuration) / config.windupDuration))
  const sway = age * Math.PI * 2 * config.idleSwaySpeed
  const turn = revealed ? Math.sin(sway) * config.idleSwayAngle :
    Math.sin(age * (40 + charge * 150)) * config.chargeShakeAngle * charge * (1 - windup)
  const scale = revealed ? 1 + (config.flashPopScale - 1) * flash : 1 -
    (1 - config.windupScale) * windup + Math.sin(age * Math.PI * 2 * config.chargeBreathFrequency) *
    config.chargeBreathAmount * charge * (1 - windup)
  const tilt = revealed ? Math.cos(sway) * config.idleBobOffset * 100 : -60 * (1 - drop) ** 2
  const fade = exitAge === null ? Math.min(1, age / config.backgroundFadeDuration) : 1 - exitAge / config.exitDuration
  const titleProgress = Math.min(1, elapsed / config.titlePunchDuration)

  return <section className="intermission unlock-screen" style={{ opacity: fade }}
    data-ui="" aria-label={'已解锁' + packName(pack)}>
    <div className="unlock-art">
      <div className="unlock-rays" style={{
        width: (config.raysSizeOfPack * config.packSizeOfShortSide * 100) + 'cqh',
        opacity: revealed ? .57 + .3 * flash : config.raysChargeAlpha * charge,
        rotate: age * config.raysRotationSpeed + 'deg'
      }}>
        <ScreenArt name="logo-rays.png" />
        <ScreenArt name="chapter-2-3/900-pack_rays_large.png" />
      </div>
      <img className="unlock-pack" alt="" draggable={false} src={asset(packArt(pack) ?? '')} style={{
        height: config.packSizeOfShortSide * 100 + 'cqh',
        filter: revealed ? 'none' : 'brightness(.08)',
        transform: 'translate(-50%, -50%) translateY(' + tilt + 'cqh) rotate(' + turn + 'deg) scale(' + scale + ')'
      }} />
    </div>
    {revealed && <div className="unlock-label" style={{ opacity: titleProgress }}>
      <strong>已解锁</strong>
      <span>{packName(pack)}</span>
    </div>}
    {age >= unlockContinueAt && <button className="unlock-continue" type="button" aria-label="继续"
      disabled={exitAge !== null} onClick={continueUnlock}>›</button>}
    {flash > 0 && <div className="unlock-flash" aria-hidden="true" style={{ opacity: flash }} />}
  </section>
}

type ImprovementsScreenProps = {
  campaign: Campaign
  buy: (slot: number) => void
  begin: () => void
  purchaseUpgrade?: (id: string) => void
  enterDoor?: (camera: GateCamera) => void
  gate?: { age: number; camera?: GateCamera }
  motion?: boolean
  reroll?: () => void
  goToMenu?: () => void
  canBegin?: boolean
  canBuy?: boolean
  unavailableSlots?: readonly number[]
  claimBinder?: (id: CardId) => void
  language: 'zh-CN' | 'en'
}

const costLabels: Record<string, string> = {
  cost: '精通', coinIncomeCost: '金币收益', foiliumCost: '闪质', skullCost: '骷髅',
  zenithCost: '天顶', inkCost: '墨水', fruitCost: '果实', shardCost: '碎片',
  runeACost: '符文', runeBCost: '符文', runeCCost: '符文', prestigePointCost: '威望', relicCost: '圣物'
}

function UpgradeCost({ field, value }: { field: string; value: number }) {
  return <span className="upgrade-cost" aria-label={value + ' ' + costLabels[field]}>
    {value}
    {field === 'cost' ? <MasteryMark /> : field === 'coinIncomeCost'
      ? <ScreenArt name="coin.png" />
      : <span>{costLabels[field]}</span>}
  </span>
}

function cellPosition(cell: UpgradeCell) {
  return {
    left: 'calc(var(--tree-x) + ' + (cell.x - 23) * upgradeNodeSpacing + 'cqw)',
    top: 'calc(var(--tree-y) + ' + (cell.y - 15) * upgradeNodeSpacing + 'cqw)'
  }
}

function UpgradeTooltip({ campaign, cell, below = false }: { campaign: Campaign; cell: UpgradeCell; below?: boolean }) {
  const { definition } = cell
  const quest = questLabel(campaign, cell)
  const costs = Object.entries(definition.costs ?? {})
  const income = definition.rewards?.questIncomeFlatBonus
  const rewardId = definition.questUnlockPackReward ?? definition.questDisplayRewardPack
  const isQuest = !!quest

  return <aside role="tooltip" className={'upgrade-objective' + (below ? ' tooltip-below' : '')} style={cellPosition(cell)}>
    <h2>{isQuest ? (quest.complete ? '任务完成' : '任务') : definition.name}</h2>
    <div className="upgrade-objective-content">
      <p>{quest?.description ?? upgradeDescription(cell)}</p>
      {isQuest && income ? <p className="quest-reward">奖励：+{income}<ScreenArt name="coin.png" /> 金币收益</p> : null}
      {isQuest && rewardId && Object.hasOwn(packs, rewardId) && <p className="quest-reward">
        奖励：<ScreenArt name={packArt(rewardId as keyof typeof packs)} />{packName(rewardId as keyof typeof packs)}
      </p>}
    </div>
    {isQuest && quest.required > 0 && <b>{quest.progress}/{quest.required}</b>}
    {!isQuest && costs.length > 0 && <div className="upgrade-tooltip-costs">
      {costs.map(([field, value]) => <UpgradeCost key={field} field={field} value={value} />)}
    </div>}
  </aside>
}

function UpgradeGrid({ campaign, purchase, enterDoor, origin, view, setView, gatePose }: {
  campaign: Campaign
  purchase?: (id: string) => void
  enterDoor?: (camera: GateCamera) => void
  origin: ReturnType<typeof upgradeTreeOrigin>
  view: UpgradeView
  setView: Dispatch<SetStateAction<UpgradeView>>
  gatePose: ReturnType<typeof campaignGatePose> | null
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; scrollX: number; scrollY: number; toStage: number } | null>(null)
  const { states, links } = upgradeBoard(campaign, true)
  const rootBought = (campaign.upgradeLevels[mainUpgrade] ?? 0) > 0
  const showDoor = campaign.completed && !campaign.endingSeen
  const active = upgradeCells.find(cell => cell.id === (hovered ?? selected) && states.has(cell.id))

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    setSelected(null)
    const stage = event.currentTarget.closest('.improvements-screen')
    const width = stage?.getBoundingClientRect().width ?? 0
    if (!width) return
    drag.current = { x: event.clientX, y: event.clientY, scrollX: view.x, scrollY: view.y, toStage: 100 / width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    const x = start.scrollX + (event.clientX - start.x) * start.toStage
    const y = start.scrollY + (event.clientY - start.y) * start.toStage
    setView(previous => ({ ...previous, x, y }))
  }

  const endPan = () => { drag.current = null }

  const zoomBy = (step: number) => setView(previous => ({
    ...previous, zoom: Math.max(.32, Math.min(1.8, previous.zoom + step))
  }))
  const transitionStyle = {
    '--tree-y': `calc(${origin.y}% + ${origin.shift}cqw)`,
    '--tree-x': `${origin.x}%`,
    '--node-spacing': `${upgradeNodeSpacing}cqw`,
    transform: `translate(${view.x}cqw, ${view.y}cqw) scale(${view.zoom})`
  } as CSSProperties

  return <div className="upgrade-grid" aria-label="升级树" onPointerDown={startPan} onPointerMove={movePan}
    onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
    onWheel={event => { if (event.deltaY) zoomBy(Math.sign(event.deltaY) * -.08) }}>
    <div className="upgrade-tree-layer" style={transitionStyle}>
      {upgradeConnections.map(([from, to]) => {
        const link = linkId(from, to)
        if (!links.has(link)) return null
        const vertical = from.x === to.x
        const start = (vertical ? from.y < to.y : from.x < to.x) ? from : to
        const highlighted = [from, to].every(cell => cell.id === mainUpgrade ||
          ['quest', 'purchased', 'connector'].includes(states.get(cell.id) ?? '')) &&
          [from, to].every(cell => cell.x === 23) && Math.min(from.y, to.y) >= 15
        return <span aria-hidden="true" key={link} className={'upgrade-connection' +
          (vertical ? ' connection-vertical' : '') + (highlighted ? ' connection-highlight' : '')}
          style={cellPosition(start)} />
      })}
      {upgradeCells.map(cell => {
        const state = states.get(cell.id)
        if (!state || state === 'connector') return null
        const { definition } = cell
        const quest = questLabel(campaign, cell)
        const door = definition.kind === 9 && cell.id === 'SN_FinishPrestige0@23,4' && showDoor
        const actionable = door || (state === 'available' && definition.kind === 0 &&
          (rootBought || cell.id === mainUpgrade) && canAffordUpgrade(campaign, cell))
        const name = door ? '进入大门' : quest ? '任务，' + quest.description : definition.name ?? definition.key
        return <button key={cell.id} type="button" data-node-id={cell.id} aria-label={name}
          aria-haspopup={door ? 'dialog' : undefined}
          aria-disabled={state === 'locked' || (state === 'available' && !actionable)}
          className={'upgrade-node node-' + state + (quest ? ' node-quest-type' : '') +
            (door ? ' node-door' : '') + (definition.bigIcon ? ' node-full-art' : '') + (cell.id === mainUpgrade ? ' node-origin' : '') +
            (active?.id === cell.id ? ' node-selected' : '')}
          style={cellPosition(cell)}
          onPointerEnter={() => setHovered(cell.id)}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => setHovered(cell.id)}
          onBlur={() => setHovered(null)}
          onClick={event => {
            setSelected(cell.id)
            if (door) {
              const node = event.currentTarget.getBoundingClientRect()
              const grid = event.currentTarget.closest('.upgrade-grid')?.getBoundingClientRect()
              const scene = event.currentTarget.closest('.improvements-screen')?.getBoundingClientRect()
              if (grid && scene?.width) {
                enterDoor?.({
                  view,
                  offset: { x: (cell.x - 23) * upgradeNodeSpacing, y: (cell.y - 15) * upgradeNodeSpacing },
                  centerDelta: {
                    x: (grid.left + grid.width / 2 - (node.left + node.width / 2)) / scene.width * 100,
                    y: (grid.top + grid.height * .524 - (node.top + node.height / 2)) / scene.width * 100
                  }
                })
              }
            } else if (actionable) purchase?.(cell.id)
          }}>
          {door ? <CampaignDoorArt pose={gatePose} /> : <AtlasIcon slot={quest?.complete ? definition.completeIcon ?? definition.icon
            : quest ? definition.incompleteIcon ?? quest.targetIcon ?? definition.icon : definition.icon} />}
          {quest && !quest.complete && quest.targetIcon != null && <AtlasIcon slot={definition.icon} className="node-reward-icon" />}
          {!quest && definition.secondaryIcon !== undefined && <AtlasIcon slot={definition.secondaryIcon} className="node-secondary-icon" />}
          {quest && !quest.complete && quest.required > 0 && <span className="upgrade-progress">{quest.progress}/{quest.required}</span>}
        </button>
      })}
      {active && !gatePose && <UpgradeTooltip campaign={campaign} cell={active} below={rootBought && !showDoor && active.y <= 16} />}
    </div>
    {rootBought && <div className="upgrade-zoom">
      <button type="button" aria-label="放大升级树" onClick={() => zoomBy(.15)}>▴</button>
      <button type="button" aria-label="缩小升级树" onClick={() => zoomBy(-.15)}>▾</button>
    </div>}
  </div>
}

function UpgradeSky({ view, origin }: { view: UpgradeView; origin: ReturnType<typeof upgradeTreeOrigin> }) {
  return <div className="upgrade-sky" aria-hidden="true" style={{ opacity: upgradeBackgroundOpacity(view, origin) }}>
    {upgradeSkyLayers.map(layer => {
      const pose = upgradeSkyLayerPose(view, layer)
      return <div key={layer.art} className={'upgrade-sky-layer' + (layer.art === 'twinkle-0' ? ' sky-twinkle' : '')} style={{
        backgroundImage: `url("${asset('upgrades/' + layer.art + '.png')}")`,
        backgroundPosition: `calc(50% + ${pose.x}cqw) calc(50% + ${pose.y}cqw)`,
        backgroundSize: `${pose.width}cqw ${pose.height}cqw`,
        opacity: layer.alpha
      }} />
    })}
  </div>
}

export function ImprovementsScreen({
  campaign, buy, begin, purchaseUpgrade, enterDoor, reroll, goToMenu, canBegin = true, canBuy = true, unavailableSlots = [],
  language, gate, motion = true, claimBinder
}: ImprovementsScreenProps) {
  const [showShop, setShowShop] = useState(true)
  const [activeSlot, setActiveSlot] = useState<number | null>(null)
  const [tab, setTab] = useState<'improvements' | 'collection'>('improvements')
  const [view, setView] = useState(initialUpgradeView)
  const confirmGate = useRef<HTMLDialogElement>(null)
  const pendingGate = useRef<GateCamera | null>(null)
  const confirmationDescription = useId()
  const gatePose = gate ? campaignGatePose(gate.age, motion) : null
  const cameraView = gate?.camera && gatePose ? campaignGateView(gate.camera, gatePose, motion) : view
  const offers = shopOffers(campaign)
  const activeOffer = activeSlot === null ? null : offers[activeSlot]
  const activePack = activeOffer && packs[activeOffer.id]
  const modifiers = upgradeModifiers(campaign.upgradeLevels)
  const salary = getSalary(campaign)
  const rerollCost = getShopRerollCost(campaign)
  // The reference's first Improvements view already shows the spired supporter tower.
  const towerLook = Math.max(1, Math.min(modifiers.towerVisual, supporterTowerSkin.bodies.length - 1))
  const towerStage = asset(supporterTowerSkin.bodies[towerLook])
  const isBought = (slot: number) => campaign.boughtSlots.includes(slot) || unavailableSlots.includes(slot)
  const chapter = chapterInfo(campaign.dayNumber)
  const chapterTitle = chapterLabels['WaveChapter.title'][language].replace('{0}', String(campaign.dayNumber))
  const chapterDescription = language === 'en' ? chapter.name : chapter.nameZh
  const origin = upgradeTreeOrigin((campaign.upgradeLevels[mainUpgrade] ?? 0) > 0, campaign.completed && !campaign.endingSeen)
  // The native blur and size-matched darkener retain the color of the chapter behind the tabs.
  const shade = chapter.background.slice(0, 3).map((channel: number) => Math.round(channel * 255 * (1 - .3607843) * (1 - .2980392)))

  function requestGate(camera: GateCamera) {
    const dialog = confirmGate.current
    if (!dialog || dialog.open) return
    pendingGate.current = camera
    dialog.showModal()
  }

  return <section className={'intermission improvements-screen' + (showShop ? '' : ' shop-collapsed')} data-ui=""
    aria-label="战斗整备" {...(gate ? { inert: '' } : {})}
    style={{ backgroundColor: `rgb(${shade.join(', ')})`, opacity: gatePose?.opacity }}>
    <UpgradeSky view={cameraView} origin={origin} />
    <div className="improvements-chapter">
      <span>{chapterTitle}</span>
      <strong>{chapterDescription}</strong>
    </div>
    <aside className="improvement-shop" aria-label="商店" hidden={!showShop}>
      <div className="shop-heading">
        <h1>{text('ui.shop.title')}</h1>
        <span className="shop-balance">{campaign.coins}/{salary}<ScreenArt name="coin.png" /></span>
      </div>
      <div className="shop-cards">
        {offers.map(({ id, box, cost, card, copies, listPrice }, slot) => {
          const bought = isBought(slot)
          const allowed = canBuy && (bought || cost <= campaign.coins)
          const name = card ? unitName(card) : packName(id) + (box ? '盒' : '')
          return <button key={slot} type="button" className={'shop-card' + (bought ? ' shop-bought' : '')}
            aria-label={(bought ? '退回' : '购买') + name + '，' + cost + ' 金币'}
            aria-disabled={!allowed}
            onPointerEnter={() => setActiveSlot(slot)} onPointerLeave={() => setActiveSlot(null)}
            onFocus={() => setActiveSlot(slot)} onBlur={() => setActiveSlot(null)}
            onClick={() => { if (allowed) buy(slot) }}>
            <span className="shop-price">
              {!bought && listPrice !== undefined && <del>{listPrice}</del>}
              {bought ? '退回' : cost}<ScreenArt name="coin.png" />
            </span>
            <ScreenArt name={card ? cardArt(card) : packArt(id, false, box)} />
            {(copies ?? 1) > 1 && <span className="shop-copies">×{copies}</span>}
          </button>
        })}
      </div>
      {activeSlot !== null && !isBought(activeSlot) && activeOffer && activePack && <aside role="tooltip" className="shop-tooltip"
        style={{ '--offer-index': activeSlot % 3, '--offer-row': Math.floor(activeSlot / 3) } as CSSProperties}>
        <h2>{activeOffer.card ? unitName(activeOffer.card) : packName(activeOffer.id)}{activeOffer.box ? '盒' : ''}</h2>
        <div className="shop-description">
          {activeOffer.card ? <p>投递 {activeOffer.copies ?? 1} 张{unitName(activeOffer.card)}。</p> :
          activeOffer.box ? <p>包含 {activePack.boosterBoxPackCount} 个{packName(activeOffer.id)}和 {activePack.boosterBoxMasteryOnOpen}<MasteryMark />。</p> :
            <>
              <p>包含 {activePack.cardCount} 张卡牌和 {activePack.masteryOnOpen}<MasteryMark />。</p>
              <small>{activePack.pool.map((entry, _, all) => {
                const weight = all.reduce((total, card) => total + card.weight, 0)
                return Math.round(100 * entry.weight / weight) + '% ' +
                  (isCardId(entry.id) && campaign.collection.includes(entry.id) ? unitName(entry.id) : '???')
              }).join(', ')}</small>
            </>}
        </div>
        <span>{activeOffer.cost}<ScreenArt name="coin.png" /></span>
      </aside>}
      {modifiers.shopRerollUnlocked && <button type="button" className="shop-reroll"
        disabled={!reroll || campaign.coins < rerollCost || offers.every((_, slot) => isBought(slot))}
        onClick={reroll}>
        刷新 {rerollCost}<ScreenArt name="coin.png" />
      </button>}
    </aside>
    <button className="shop-fold" type="button" aria-expanded={showShop}
      aria-label={showShop ? '收起商店' : '展开商店'} onClick={() => setShowShop(value => !value)}>
      {showShop ? '‹' : '›'}
    </button>
    <nav className="improvement-tabs" aria-label="整备页面">
      <button className="improvement-tab" type="button" aria-pressed={tab === 'improvements'} onClick={() => setTab('improvements')}>升级</button>
      <button className="improvement-tab" type="button" aria-pressed={tab === 'collection'} onClick={() => setTab('collection')}>
        {language === 'en' ? 'Collection' : '收藏'}
        {!!(campaign.binderPending.cards.length || campaign.binderPending.foils.length) &&
          <span className="binder-tab-new"><ScreenArt name="binder/new-dot.png" /></span>}
      </button>
    </nav>
    {goToMenu && <button className="improvements-menu" type="button" aria-label="主菜单" onClick={goToMenu}>
      <ScreenArt name="hud-menu.png" />
    </button>}
    <section className={'improvement-board' + (campaign.completed ? ' campaign-end-board' : '')}
      aria-label={tab === 'improvements' ? '升级' : '收藏'}>
      <div className="upgrade-tower" aria-hidden="true">
        <img className="upgrade-tower-shadow" src={towerShadow} alt="" draggable={false} />
        <img src={towerStage} alt="" draggable={false} />
      </div>
      <span className="improvement-mastery">{campaign.mastery}<MasteryMark /></span>
      {tab === 'improvements' ? <UpgradeGrid campaign={campaign} purchase={purchaseUpgrade} enterDoor={requestGate}
        origin={origin} view={cameraView} setView={setView} gatePose={gatePose} /> :
        <CollectionBinder campaign={campaign} collapsed={!showShop} language={language} claim={claimBinder} />}
      <button className="intermission-button improvement-start" type="button" disabled={!canBegin} onClick={begin}>
        {text('ui.button.tobattle')}
        {asset('hud-battle.png') && <ScreenArt name="hud-battle.png" />}
      </button>
    </section>
    {campaign.completed && !campaign.endingSeen && <dialog ref={confirmGate} className="gate-confirm"
      aria-label={language === 'en' ? 'Enter the Gate' : '进入大门'} aria-describedby={confirmationDescription}
      onClose={event => {
        const dialog = event.currentTarget
        const confirmed = dialog.returnValue === 'enter'
        const camera = pendingGate.current
        dialog.returnValue = ''
        pendingGate.current = null
        if (!confirmed || !camera) return
        dialog.closest('main')?.focus({ preventScroll: true })
        enterDoor?.(camera)
      }}>
      <p id={confirmationDescription}>{summaryLocale['ui.door.prestige_confirm.p0'][language]}</p>
      <form method="dialog">
        <button className="gate-confirm-next" value="enter">{summaryLocale['ui.button.continue'][language]}</button>
        <button className="gate-confirm-close" value="cancel" autoFocus
          aria-label={language === 'en' ? 'Close' : '关闭'}><ScreenArt name="upgrades/gate-dialog-close.png" /></button>
      </form>
    </dialog>}
  </section>
}


