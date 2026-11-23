import { View } from '@tarojs/components'
import { useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'
import scene from '../../data/scene-canvas.json'
import chapterLabels from '../../assets/menu/chapter-labels.json'
import {
  cardArt, cardDiscovery, cardRevealDescription, chapterInfo, chapterIntro, ending, frenzyTome,
  packName, rules, text, tomes, unitName, world
} from '../../game/rules'
import { canSlashTome, dayProgress, masterySurgePercent } from '../../game/combat'
import { daySummaryDelay } from '../../game/defeat'
import { discoveryLabels, discoveryPose } from '../../game/discovery'
import { packOpeningColors } from '../../game/pack-opening'
import { packCanBeHit, packLocation } from '../../game/save'
import { ArenaCanvas, discoverySpriteBounds, viewport, type Cursor } from './arena-canvas'
import { crtSamplePoint } from './crt'
import { ImprovementsScreen, SummaryScreen, UnlockScreen } from './intermission'
import { ActSummaryScreen } from './act-summary-screen'
import { asset } from './media'
import { MainMenu } from './main-menu'
import { QuestHud } from './quest-hud'
import { chapterIntroDuration, useGame, type Story } from './use-game'
import './index.css'

function picture(name: string) {
  return <img src={asset(name)} alt="" draggable={false} />
}

const viewportHeightUnits = (pixels: number) => pixels / viewport.height * 100 + 'cqh'

function chapterIntroTextStyle(label: typeof chapterIntro.layout.title) {
  const { anchoredPosition: root } = chapterIntro.layout.root
  const [x, y] = label.anchoredPosition
  const [pivotX, pivotY] = label.pivot
  const [width, height] = label.sizeDelta
  // The release's CanvasScaler uses 1920 × 1080. RectTransforms are centered with Y up.
  return {
    left: (50 + (root[0] + x + (.5 - pivotX) * width) / 1920 * 100) + '%',
    top: (50 - (root[1] + y + (.5 - pivotY) * height) / 1080 * 100) + '%',
    fontSize: label.fontSize / 1080 * 100 + 'cqh',
    color: 'rgb(' + label.color.slice(0, 3).map(channel => channel * 255).join(' ') + ')'
  }
}

const chapterIntroTitleStyle = chapterIntroTextStyle(chapterIntro.layout.title)
const chapterIntroDescriptionStyle = chapterIntroTextStyle(chapterIntro.layout.description)

function ChapterStory({ story, next, skip }: { story: Story; next: () => void; skip: () => void }) {
  if (story.ending === 'cutscene') {
    return <section className="chapter-story" data-ui="" aria-label="结局过场">
      {ending.layers.slice(0, story.step + 1).map((layer, index) =>
        <img key={layer.sprite} className="story-background ending-layer"
          src={asset(layer.sprite)} alt="" draggable={false} style={{
            opacity: index === story.step ? Math.min(1, story.age / (layer.duration || ending.fadeInDuration)) : 1
          }} />)}
      {story.age >= ending.layers[story.step].duration &&
        <button type="button" className="card-next" aria-label="继续过场" onClick={next}>›</button>}
      <button type="button" className="card-skip" onClick={skip}>{text('ui.button.skip')}</button>
    </section>
  }
  const portal = story.step === 3
  const actionable = story.age >= (portal ? 3.6 : 1)
  const flash = story.age < .2
  const image = portal ? (flash ? 'd' : 'g') : story.step === 1 && flash
    ? 'b' : story.step === 2 && flash ? 'c' : 'a'

  return <section className="chapter-story" data-ui="" aria-label="章节过场">
    <img className="story-background" src={asset('cutscene-01-' + image + '.png')} alt="" draggable={false}
      style={{ opacity: story.step === 0 ? Math.min(1, story.age) : 1 }} />
    {portal && story.age >= .36 && <img className="story-foreground" src={asset('cutscene-01-f.png')} alt="" draggable={false}
      style={{ opacity: Math.min((story.age - .36) / .85, 1) }} />}
    {actionable && <button type="button" className="card-next" aria-label="继续过场" onClick={next}>›</button>}
    <button type="button" className="card-skip" onClick={skip}>{text('ui.button.skip')}</button>
  </section>
}

export default function ArenaPage() {
  const game = useGame()
  const { campaign, battle, paused, menu, reveal, introAge, summaryAge, unlockAge, unlockExitAge, arrival, story, chapterAge, time, preferences,
    questHud, questMotion, questHudExpanded } =
    game.presentation
  const pointer = useRef<Cursor | null>(null)
  const [crtAvailable, setCrtAvailable] = useState(false)
  const intro = !campaign.introComplete
  const playing = campaign.resumePhase === 'beginning'
  const menuVisible = paused || menu
  const improvements = campaign.introComplete && campaign.resumePhase === 'prepare' && !arrival
  const unlockedPack = improvements ? campaign.pendingUnlock : null
  const chapterTitle = chapterInfo(campaign.dayNumber)
  const chapterOverlay = playing && chapterAge < chapterIntroDuration
  const showCursor = !menuVisible && ((intro && introAge === null) || (playing && !reveal && !battle?.respawn))
  const interactive = showCursor && !chapterOverlay
  const mastery = campaign.mastery + (playing ? battle?.mastery ?? 0 : 0)
  const coins = campaign.coins + (playing ? battle?.coins ?? 0 : 0)
  const progress = battle && !battle.summary ? dayProgress(battle) : null
  const victoryScene = campaign.summary?.result === 'victory' && battle && summaryAge < .32
  const showHud = (playing || victoryScene) && introAge === null && !menuVisible
  const surge = showHud && mastery > 0 && battle ? masterySurgePercent(battle) : null
  const surgeArt = scene.hud.masterySurge
  const activeTomes = showHud && battle && !battle.summary ? battle.tomes.filter(tome => tome.until > battle.clock) : []
  const tomeHud = scene.hud.tomes
  const showSettings = playing && !story && !reveal && !menuVisible
  const summary = campaign.summary
  const defeat = summary?.result === 'defeat'
  const summaryAt = summary ? daySummaryDelay(summary.result) : 0
  const language = preferences.language
  const motion = typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const revealMotion = reveal && motion
  const revealPose = reveal && discoveryPose(reveal.timeline, reveal.age, reveal.exitAge)
  const revealLabels = reveal && revealPose &&
    discoveryLabels(reveal.position, discoverySpriteBounds(reveal.card), revealPose, Boolean(revealMotion))
  const revealBob = reveal && revealMotion ? Math.sin(reveal.age * cardDiscovery.discoveryContinueBobSpeed) *
    cardDiscovery.discoveryContinueBob / 1080 : 0
  const chapterDescription = language === 'en' ? chapterTitle.name : chapterTitle.nameZh

  function pointerPoint(event: PointerEvent<HTMLElement>): Cursor {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const sample = crtAvailable && preferences.crt ? crtSamplePoint(x, y, scene.crt.distortion) : { x, y }
    return {
      x: (sample.x - .5) * world.width,
      y: (.5 - sample.y) * world.height,
      radius: event.pointerType === 'touch' ? rules.cursor.baseRadiusMobile : rules.cursor.baseRadius,
      pressed: event.currentTarget.hasPointerCapture(event.pointerId)
    }
  }

  function press(event: PointerEvent<HTMLElement>) {
    if (!interactive || event.button !== 0 || !event.isPrimary) return
    if ((event.target as Element).closest('[data-ui]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const cursor = pointerPoint(event)
    pointer.current = cursor
    game.setAim(cursor)
  }

  function move(event: PointerEvent<HTMLElement>) {
    if (!showCursor || !event.isPrimary) return
    if ((event.target as Element).closest('[data-ui]')) {
      game.setAim(null)
      pointer.current = null
      return
    }
    const cursor = pointerPoint(event)
    pointer.current = cursor
    if (cursor.pressed || event.pointerType === 'mouse' || event.pointerType === 'pen') game.setAim(cursor)
  }

  function release(event?: PointerEvent<HTMLElement>) {
    const keepHover = event?.pointerType === 'mouse' && showCursor &&
      !(event.target as Element).closest('[data-ui]')
    const cursor = keepHover ? { ...pointerPoint(event), pressed: false } : null
    pointer.current = cursor
    game.setAim(cursor)
  }

  function keyPress(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest('dialog')) return
    if (unlockedPack && !menuVisible) {
      if ((event.code === 'Space' || event.key === 'Enter') && !(event.target as Element).closest('button')) {
        event.preventDefault()
        if (!event.repeat) game.continueUnlock()
      }
      return
    }
    if (!menuVisible && story && (event.code === 'Space' || event.key === 'Escape') && !(event.target as Element).closest('button')) {
      event.preventDefault()
      if (!event.repeat) {
        if (event.key === 'Escape') game.skipStory()
        else game.nextStory()
      }
      return
    }
    if (event.key === 'Escape' && reveal && !event.repeat) {
      game.skipReveal()
      return
    }
    if (!menuVisible && summary && summaryAge >= summaryAt && event.code === 'Space' && event.target === event.currentTarget) {
      event.preventDefault()
      if (!event.repeat) game.skipDaySummary()
      return
    }
    if (event.key === 'Escape' && !intro && !reveal && !event.repeat) {
      if (menu) game.play()
      else game.togglePause()
      return
    }
    if (event.code !== 'Space' || (event.target as Element).closest('[data-ui]')) return
    if (reveal && reveal.age >= reveal.timeline.continueAt) {
      event.preventDefault()
      if (!event.repeat) game.continueReveal()
    } else if (interactive) {
      event.preventDefault()
      if (!event.repeat) game.setKeyboard(true)
    }
  }

  const recorded = game.saveIssue || (campaign.lastSavedUtcMillis ? '已自动保存进度' : '')

  return <View className="game-page">
    <main className="scene" tabIndex={0} aria-label="卡包英雄战场" aria-describedby="scene-controls"
      data-phase={menuVisible ? 'menu' : intro ? (introAge === null ? 'crate' : 'intro') :
        arrival ? 'arrival' : story ? (story.ending === 'summary' ? 'act-summary' : story.ending === 'gate' ? 'gate' : 'story') : unlockedPack ? 'unlock' :
        defeat && summaryAge < summaryAt ? 'defeat' : battle?.respawn ? 'boss-transition' : campaign.resumePhase}
      data-chapter={campaign.dayNumber} lang={language}
      onPointerDown={press} onPointerMove={move} onPointerUp={release} onPointerCancel={release}
      onLostPointerCapture={release}
      onPointerLeave={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          pointer.current = null
          game.setAim(null)
        }
      }}
      onKeyDown={keyPress} onKeyUp={event => { if (event.code === 'Space') game.setKeyboard(false) }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          game.setKeyboard(false)
          release()
        }
      }}>
      <ArenaCanvas model={game.presentation} pointer={pointer}
        crtAvailable={crtAvailable} onCrtChange={setCrtAvailable} />
      <span className="screen-reader" id="scene-controls">
        {intro ? '把光标移到中央核心箱上开箱。触屏可按住，键盘可按住空格。' : '把光标移到目标上攻击。也可按住空格攻击最近的目标。'}
      </span>

      {intro && !menuVisible && introAge === null && <button type="button" className="scene-hitbox crate-hitbox"
        aria-label="用光标打开核心箱" style={{
          left: (50 + scene.crate.x / world.width * 100) + '%',
          top: (50 - scene.crate.y / world.height * 100) + '%'
        }} />}

      {playing && interactive && battle && campaign.activePacks.map((pack, index) => {
        if (!packCanBeHit(pack, battle.clock)) return null
        const position = packLocation(pack, index, battle.clock)
        return <button type="button" key={index} className="scene-hitbox pack-hitbox"
          aria-label={'用光标打开' + packName(pack.id)} style={{
            left: (50 + position.x / world.width * 100) + '%',
            top: (50 - position.y / world.height * 100) + '%'
          }} />
      })}
      {playing && interactive && battle && battle.fieldTomes.filter(tome => canSlashTome(battle, tome)).map(tome =>
        <button type="button" key={tome.uid} className="scene-hitbox tome-hitbox"
          aria-label={(language === 'en' ? 'Slash ' + tomes[tome.id].name : '斩击' + unitName(tome.id) + '魔典')}
          style={{ left: (50 + tome.x / world.width * 100) + '%', top: (50 - tome.y / world.height * 100) + '%' }} />
      )}

      {battle && activeTomes.map(tome => {
        if (tome.id !== frenzyTome) return null
        const age = battle.clock - tome.startedAt
        if (age >= 1.3) return null
        const appear = Math.min(1, age / .24)
        const fade = Math.max(0, (age - .93) / .37)
        return <span key={tome.uid} aria-hidden="true" lang={language} className="frenzy-spell-name" style={{
          left: 50 + tome.x / world.width * 100 + '%', top: 50 - tome.y / world.height * 100 + '%',
          opacity: (1 - fade) * Math.min(1, .55 + appear),
          '--spell-name-scale': .55 + .45 * (1 - (1 - appear) ** 2) - .3 * fade,
          '--spell-name-rise': viewportHeightUnits(12 + 13 * Math.min(1, age / .55))
        } as CSSProperties}>{unitName(frenzyTome, language)}</span>
      })}

      {showHud && <div className="survive-hud">
        {battle && activeTomes.length > 0 && <div className="tome-subscriptions"
          style={{ top: viewportHeightUnits(tomeHud.top), left: viewportHeightUnits(tomeHud.left), gap: viewportHeightUnits(tomeHud.spacing) }}>
          {activeTomes.map(tome => {
            const definition = tomes[tome.id]
            const remaining = Math.max(0, tome.until - battle.clock)
            const duration = tome.until - tome.startedAt
            const phase = Math.max(0, Math.min(1, (battle.clock - tome.lastCast) / tomeHud.pulseDuration))
            const pulse = phase < .42 ? 1 - (1 - phase / .42) ** 2 : ((1 - phase) / .58) ** 2
            const [r, g, b] = definition.native.hudAccentColor
            const outline = 'rgb(' + [r, g, b].map(channel => Math.round(channel * 255)).join(',') + ')'
            const outlineSize = viewportHeightUnits(1.95)
            const shadow = [-1, 1].flatMap(x => [-1, 1].map(y =>
              'drop-shadow(' + (x < 0 ? '-' : '') + outlineSize + ' ' + (y < 0 ? '-' : '') + outlineSize + ' ' + outline + ')')).join(' ')
            return <div className="tome-subscription" key={tome.uid}
              style={{ width: viewportHeightUnits(tomeHud.size), height: viewportHeightUnits(tomeHud.size) }}
              title={language === 'en' ? definition.name : unitName(tome.id)}>
              <progress className="screen-reader" max={duration} value={remaining}
                aria-label={language === 'en' ? definition.name + ' remaining duration' : unitName(tome.id) + '剩余时间'} />
              <img className="tome-subscription-frame" src={asset(tomeHud.frame)} alt="" draggable={false} />
              <span className="tome-subscription-cooldown" aria-hidden="true"
                style={{
                  width: viewportHeightUnits(tomeHud.radialSize),
                  background: 'conic-gradient(from 180deg, ' + tomeHud.radialColor + ' ' + remaining / duration + 'turn, transparent 0)'
                }} />
              <img className="tome-subscription-icon" src={asset(definition.hudSprite)} alt="" draggable={false}
                style={{
                  width: viewportHeightUnits(tomeHud.iconSize),
                  transform: 'scale(' + (1 + definition.native.hudPulseAmplitude * pulse) + ')',
                  filter: shadow
                }} />
            </div>
          })}
        </div>}
        {progress && <>
          <progress className="survive-progress" max={1} value={progress.fill}
            aria-label={progress.phase === 'boss' ? '首领生命值' : '出怪进度'}
            style={{
              height: scene.hud.barHeight / viewport.height * 100 + '%',
              color: progress.phase === 'boss' ? scene.hud.bossBarColor : scene.hud.barColor
            }} />
          {progress.phase === 'boss' && Array.from({ length: Math.min(9, Math.floor(progress.fill * 10)) }, (_, index) =>
            <span key={index} className="survive-progress-tick" aria-hidden="true" style={{
              left: (index + 1) * 10 + '%',
              width: scene.hud.bossTickWidth / viewport.width * 100 + '%',
              height: scene.hud.bossTickHeight / viewport.height * 100 + '%',
              backgroundColor: scene.hud.bossTickColor
            }} />)}
        </>}
        {surge !== null && <>
          <img className="hud-mastery-surge-backdrop" alt="" draggable={false}
            src={asset(surgeArt.frames[Math.floor(time * surgeArt.framesPerSecond) % surgeArt.frames.length])}
            style={{
              left: surgeArt.backdropX / viewport.width * 100 + '%',
              top: surgeArt.backdropY / viewport.height * 100 + '%',
              width: surgeArt.backdropSize / viewport.height * 100 + 'cqh',
              opacity: surgeArt.backdropAlpha * (surgeArt.alphaBase + surgeArt.alphaAmplitude * Math.sin(time * surgeArt.alphaRadiansPerSecond))
            }} />
          <span className="hud-mastery-surge-label" aria-label={(language === 'en' ? 'Mastery income ' : '精通收入 ') + surge + '%'}
            style={{
              left: scene.hud.masteryX / viewport.width * 100 + '%',
              top: surgeArt.labelY / viewport.height * 100 + '%',
              fontSize: surgeArt.labelSize / viewport.height * 100 + 'cqh',
              color: surgeArt.labelColor
            }}>{surge}%</span>
        </>}
        {mastery > 0 && <div className="hud-currency hud-mastery" aria-label={mastery + ' 精通'}
          style={{
            left: scene.hud.masteryX / viewport.width * 100 + '%',
            top: scene.hud.resourceY / viewport.height * 100 + '%',
            fontSize: scene.hud.masterySize / viewport.height * 100 + 'cqh',
            color: scene.hud.masteryColor
          }}>
          <span>{mastery}</span>
          <img src={asset('mastery-blue.png')} alt="" draggable={false}
            style={{ width: scene.hud.masteryIconSize / viewport.height * 100 + 'cqh' }} />
        </div>}
        {coins > 0 && <div className="hud-currency hud-coins" aria-label={coins + ' 金币'}
          style={{ left: (scene.hud.coinsX / viewport.width * 100) + '%', top: (scene.hud.resourceY / viewport.height * 100) + '%' }}>
          {coins}{picture('hud-coin.png')}
        </div>}
        <QuestHud rows={questHud.rows} language={language} distortion={crtAvailable && preferences.crt ? scene.crt.distortion : 0}
          motion={questMotion} now={time} expanded={questHudExpanded} onExpandedChange={game.setQuestHudExpanded} />
      </div>}

      {showSettings && <div className="corner-menu arena-settings" data-ui="">
        <span className="controller-menu" aria-hidden="true">{picture('hud-menu.png')}</span>
        <button type="button" className="gear" aria-label="主菜单" onClick={game.togglePause}>{picture('back.png')}</button>
      </div>}
      {chapterOverlay && !menuVisible && <section className="chapter-intro-overlay" aria-label={chapterDescription}
        style={{ opacity: Math.min(1, chapterAge / chapterIntro.fadeInDuration,
          (chapterIntroDuration - chapterAge) / chapterIntro.fadeOutDuration) }}>
        <strong style={chapterIntroTitleStyle}>{chapterLabels['WaveChapter.title'][language].replace('{0}', String(campaign.dayNumber))}</strong>
        <span style={chapterIntroDescriptionStyle}>{chapterDescription}</span>
      </section>}

      {reveal && revealPose && revealLabels && !menuVisible &&
        <section className="first-card" data-ui="" aria-label={'获得' + unitName(reveal.card)}>
        {reveal.age >= reveal.timeline.cardAt && <div className={'first-card-name' + (reveal.foil ? ' first-card-foil' : '')}
          style={{ left: revealLabels.x * 100 + '%', top: revealLabels.title * 100 + '%', opacity: revealPose.titleAlpha }}>
          <strong style={{ color: packOpeningColors[reveal.rarity] }}>{unitName(reveal.card)}</strong>
          <span>{cardRevealDescription(reveal.card)}</span>
        </div>}
        {reveal.exitAge === undefined && reveal.age >= reveal.timeline.continueAt &&
          <button type="button" className="card-next" aria-label="继续战斗" onClick={game.continueReveal}
            style={{ left: revealLabels.x * 100 + '%', top: (revealLabels.prompt + revealBob) * 100 + '%' }}>
            {picture('discovery-continue.png')}
          </button>}
        {reveal.exitAge === undefined &&
          <button type="button" className="card-skip" onClick={game.skipReveal}>{text('ui.button.skip')}</button>}
      </section>}

      {menuVisible && <MainMenu chapter={campaign.dayNumber} chapterTitle={chapterDescription}
        hasProgress={campaign.introComplete} muted={game.presentation.muted}
        paused={paused}
        onPlay={menu ? game.play : game.togglePause} onToggleMute={game.toggleSound} onResetProgress={game.reset} />}

      {!menuVisible && summary && summaryAge >= summaryAt && <SummaryScreen summary={summary}
        chapter={campaign.dayNumber} language={language}
        entranceAge={battle ? summaryAge - summaryAt : undefined}
        distortion={crtAvailable && preferences.crt ? scene.crt.distortion : 0}
        continueChapter={game.advanceChapter} skipCount={game.skipDaySummary} packsOpened={summary.packsOpened}
        attempts={summary.result === 'victory' && !campaign.completed ? campaign.chapterAttempts : undefined}
        cursorDamage={summary.cursorDamage === undefined ? undefined : summary.cursorDamage * 10}
        unitStats={summary.unitStats?.map(stat => ({ ...stat, name: unitName(stat.id, language),
          art: cardArt(stat.id), damage: stat.damage * 10, defense: stat.defense * 10 }))} />}

      {!menuVisible && unlockedPack && <UnlockScreen pack={unlockedPack} age={unlockAge} exitAge={unlockExitAge}
        continueUnlock={game.continueUnlock} />}
      {!menuVisible && improvements && !unlockedPack && (!story || story.ending === 'gate') && <ImprovementsScreen campaign={campaign} buy={game.buy}
        begin={game.begin} canBegin={!campaign.completed} enterDoor={game.openEnding} language={language} motion={motion}
        gate={story?.ending === 'gate' ? { age: story.age, camera: story.gateCamera } : undefined}
        purchaseUpgrade={game.buyUpgrade} reroll={game.reroll} goToMenu={game.openMenu}
        unavailableSlots={campaign.boughtSlots} claimBinder={game.claimCollectionCard} />}
      {!menuVisible && story && story.ending !== 'gate' && (story.ending === 'summary'
        ? <ActSummaryScreen campaign={campaign} age={story.age} language={language}
          distortion={crtAvailable && preferences.crt ? scene.crt.distortion : 0} next={game.nextStory} skip={game.skipStory} />
        : <ChapterStory story={story} next={game.nextStory} skip={game.skipStory} />)}

      <div className={game.saveIssue ? 'save-warning' : 'screen-reader'} role="status">{recorded}</div>
    </main>
  </View>
}
