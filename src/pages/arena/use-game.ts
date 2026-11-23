import { useEffect, useReducer, useState } from 'react'
import {
  advanceBattle, advanceBattleVisuals, advanceDefeatVisuals, battleCueVolumes, canSlashTome, createBattle, cursorProfile, masteryIncomeMultiplier, nearestEnemy, pulse, queuePackCards,
  type Aim, type Battle
} from '../../game/combat'
import { highestPackRarity, packOpeningLifetime } from '../../game/pack-opening'
import { packHitRadius, packThrowPose, type PackThrow } from '../../game/pack-throw'
import { showQuestPopup, type DamageNumberMode } from '../../game/damage-numbers'
import { discoveryExitDuration, discoveryMusicGain, discoveryTimeline, type DiscoveryTimeline } from '../../game/discovery'
import { daySummaryDelay, defeatSummaryTiming, defeatWorldAge } from '../../game/defeat'
import { actSummary, actSummaryOpeningSound } from '../../game/act-summary'
import { claimBinderCard } from '../../game/binder'
import { gateBlinkTimes, gateDissolveAt, gateTransitionDuration, type GateCamera } from '../../game/campaign-gate'
import { advanceQuestFlights, createQuestMotion, queueQuestFlights, type QuestMotion } from '../../game/quest-flight'
import {
  beginChapter, buyPack, continueChapter, grantDroppedPack, hitPack, loadCampaign, newCampaign,
  packCanBeHit, packLocation, refundShopOffer, rerollShop, settleChapter, shopOffers, transformPack, writeCampaign,
  type Campaign, type CardTraits, type Pack
} from '../../game/save'
import {
  bonfire, buildings, campaignDoor, cardDiscovery, chapterIntro, ending, isPackId, packs, rules,
  type BuildingId, type CardId, type Point
} from '../../game/rules'
import { progressedQuest, purchaseUpgrade, recordBattleQuestCounters, resolveBattleQuests, updateBattleQuestHud, upgradeModifiers, withBattleQuestCounters, type BattleQuestHud } from '../../game/upgrades'
import scene from '../../data/scene-canvas.json'
import { MENU_PREFERENCES_CHANGED, readMenuPreferences, type MenuPreferences } from './main-menu'
import { createChapterAudio, type ChapterAudioFrame } from './chapter-audio'
import { asset, createDragonAudio, createFireballAudio, createTomeAudio, playSound, silenceSounds, stopSound } from './media'

const crate = scene.crate
export const introDuration = crate.openDuration + scene.logo.pop + scene.logo.hold + scene.logo.fade
export const chapterIntroDuration = chapterIntro.fadeInDuration + chapterIntro.holdDuration + chapterIntro.fadeOutDuration
const unlock = scene.unlock
const discoveryRiser = (foil: boolean) => foil ? cardDiscovery.foilDiscoveryRiserSfx : cardDiscovery.discoveryRiserSfx
export const unlockFlashAt = unlock.dropDuration + unlock.chargeDuration + unlock.windupDuration
export const unlockContinueAt = unlockFlashAt + unlock.tapPromptDelay

export type Reveal = {
  card: CardId; age: number; exitAge?: number; pack: Pack; position: Point; pending: CardId[]; traits: CardTraits[]
  turn: number; rarity: number; foil: boolean; seed: number; timeline: DiscoveryTimeline
}
export type Story = {
  step: number
  age: number
  ending?: 'gate' | 'summary' | 'cutscene'
  tower?: TowerAppearance
  gateCamera?: GateCamera
}
type TowerAppearance = { towerVisual: number; buildings: { id: BuildingId }[] }
type Arrival = TowerAppearance & { age: number }
type OpenEffect = { pack: Pack; position: Point; age: number; turn?: number; rarity: number; foil: boolean; seed: number }

export type Presentation = {
  campaign: Campaign
  battle: Battle | null
  questHud: BattleQuestHud
  questMotion: QuestMotion
  questHudExpanded: boolean
  crateHp: number
  crateHitAge: number
  introAge: number | null
  arrival: Arrival | null
  reveal: Reveal | null
  story: Story | null
  summaryAge: number
  victoryAge: number
  unlockAge: number
  unlockExitAge: number | null
  packHits: WeakMap<Pack, number>
  openedPacks: OpenEffect[]
  chapterAge: number
  time: number
  paused: boolean
  menu: boolean
  muted: boolean
  preferences: MenuPreferences
}

function createCampaignBattle(campaign: Campaign, damageNumberMode: DamageNumberMode) {
  const battle = createBattle(
    campaign.roster, false, Math.random, campaign.dayNumber, upgradeModifiers(campaign.upgradeLevels),
    campaign.equippedRelics, { rosterTraits: campaign.rosterTraits, collection: campaign.collection, damageNumberMode, trackQuestProgress: true }
  )
  battle.elapsed = -campaign.waveStartDelay
  return battle
}

function towerAppearance(campaign: Campaign): TowerAppearance {
  const { towerVisual, unlockedBuildings } = upgradeModifiers(campaign.upgradeLevels)
  return {
    towerVisual,
    buildings: unlockedBuildings.filter((id): id is BuildingId => Object.hasOwn(buildings, id)).map(id => ({ id }))
  }
}

export function useGame() {
  const [initial] = useState(loadCampaign)
  const [saveIssue, setSaveIssue] = useState(initial.issue)
  const [, refresh] = useReducer((version: number) => version + 1, 0)
  const [preferences] = useState(readMenuPreferences)
  const [chapterAudio] = useState(() => createChapterAudio(asset))
  const [packIdentity] = useState(() => new WeakMap<Pack, Pack>())
  const [playedLaunches] = useState(() => new WeakSet<PackThrow>())
  const [live] = useState(() => ({
    campaign: initial.campaign,
    battle: initial.campaign.resumePhase === 'beginning' ? createCampaignBattle(initial.campaign, preferences.damageNumberMode) : null,
    questHud: updateBattleQuestHud(initial.campaign, null),
    questMotion: createQuestMotion(),
    questHudExpanded: false,
    crateHp: crate.hp,
    crateHitAge: 5,
    introAge: null as number | null,
    arrival: null as Arrival | null,
    nextCrateHit: rules.cursor.baseTickInterval,
    reveal: null as Reveal | null,
    story: (initial.campaign.actSummaryStage === 'summary'
      ? { step: 0, age: actSummary(initial.campaign).continueAt, ending: 'summary', tower: towerAppearance(initial.campaign) }
      : initial.campaign.actSummaryStage === 'ending' ? { step: 0, age: 0, ending: 'cutscene' } : null) as Story | null,
    summaryAge: initial.campaign.summary ? 4 : 0,
    victoryAge: 0,
    unlockAge: 0,
    unlockExitAge: null as number | null,
    packHits: new WeakMap<Pack, number>(),
    openedPacks: [] as OpenEffect[],
    chapterAge: 5,
    aim: null as Aim | null,
    keyboard: false,
    time: 0,
    lastActSaveAt: 0,
    paused: false,
    menu: initial.campaign.introComplete,
    muted: false,
    preferences
  }))

  function sound(name: string | undefined, volume = 0.32) {
    if (name && !live.muted) playSound(name, volume * live.preferences.sfx)
  }

  function updateChapterAudio(dt: number, retry = false) {
    const { battle, campaign, reveal } = live
    let phase: ChapterAudioFrame['phase'] = 'quiet'
    if ((!live.story || live.story.ending === 'gate') && !live.arrival) {
      if (campaign.resumePhase === 'summary') phase = 'summary'
      else if (battle && campaign.resumePhase === 'beginning' && live.chapterAge >= chapterIntroDuration) phase = 'battle'
      else if (campaign.resumePhase === 'prepare' && campaign.introComplete && !campaign.pendingUnlock) phase = 'improvements'
    }
    chapterAudio.update({
      phase, attempt: campaign.attempts, volume: live.preferences.music, muted: live.muted,
      hidden: document.hidden, menu: live.menu, cinematicPause: Boolean(battle?.respawn),
      surge: battle?.tomes.some(tome => battle.clock < tome.until) ?? false,
      discoveryGain: reveal ? discoveryMusicGain(reveal.timeline, reveal.age, reveal.exitAge) : 1
    }, dt, retry)
  }

  function syncQuestHud(campaign: Campaign, at?: Point) {
    const previous = live.questHud
    live.questHud = updateBattleQuestHud(campaign, live.battle?.questProgress ?? null, previous)
    if (at) queueQuestFlights(live.questMotion, previous, live.questHud, at, live.time, live.questHudExpanded)
  }

  function commit(next: Campaign, at?: Point) {
    if (next === live.campaign) return
    const activeMillis = Math.round((live.time - live.lastActSaveAt) * 1000)
    live.lastActSaveAt = live.time
    const actPlayTimeMillis = next.introComplete && !live.campaign.actSummaryStage && !live.campaign.endingSeen
      ? (next.actPlayTimeMillis ?? live.campaign.playedTimeMillis) + activeMillis
      : next.actPlayTimeMillis
    const snapshot = { ...next, actPlayTimeMillis, lastSavedUtcMillis: Date.now() }
    live.campaign = snapshot
    syncQuestHud(snapshot, at)
    if (snapshot.resumePhase !== 'beginning') {
      live.questMotion = createQuestMotion()
      live.questHudExpanded = false
    }
    setSaveIssue(writeCampaign(snapshot) ? '' : '存档写入失败。本次进度暂存在此页面。')
    refresh()
  }

  function showQuestCompletions(battle: Battle, positions: readonly Point[]) {
    if (!positions.length) return
    for (const position of positions) showQuestPopup(battle.damageNumbers, position)
    sound(scene.damageNumbers.questText.sound, 1)
  }

  function updateBattleQuests(battle: Battle) {
    if (!battle.questProgress?.events.length) return
    const { campaign, completedAt } = resolveBattleQuests(live.campaign, battle.questProgress, syncQuestHud)
    showQuestCompletions(battle, completedAt)
    commit(campaign)
  }

  function beginBattle() {
    const next = beginChapter(live.campaign)
    if (next === live.campaign) return
    live.battle = createCampaignBattle(next, live.preferences.damageNumberMode)
    live.questHud = updateBattleQuestHud(next, null)
    live.questMotion = createQuestMotion()
    live.questHudExpanded = false
    releaseInput()
    live.introAge = null
    live.story = null
    live.openedPacks = []
    live.chapterAge = next.chapterAttempts === 1 && next.dayNumber > 1 ? 0 : 5
    live.paused = false
    commit(next)
    updateChapterAudio(0)
  }

  function begin() {
    if (live.arrival || live.story || !live.campaign.introComplete || live.campaign.pendingUnlock || live.campaign.completed ||
        live.campaign.resumePhase !== 'prepare') return
    releaseInput()
    live.arrival = { age: 0, ...towerAppearance(live.campaign) }
    updateChapterAudio(0)
    refresh()
  }

  function finishArrival() {
    live.arrival = null
    // Cutscene1 is configured at prestige zero, try number two.
    if (live.campaign.attempts === 1) {
      live.story = { step: 0, age: 0 }
      refresh()
    } else {
      beginBattle()
    }
  }

  function nextStory() {
    if (!live.story) return
    if (live.story.ending === 'summary') {
      if (live.story.age < actSummary(live.campaign).continueAt) {
        skipStory()
        return
      }
      live.story = { step: 0, age: 0, ending: 'cutscene' }
      sound(ending.layers[0].sfx, ending.layers[0].sfxVolume)
      commit({ ...live.campaign, actSummaryStage: 'ending' })
      return
    }
    if (live.story.ending === 'cutscene') {
      const layer = ending.layers[live.story.step]
      if (live.story.age < layer.duration) return
      const next = ending.layers[live.story.step + 1]
      if (!next) {
        finishEnding()
        return
      }
      live.story = { step: live.story.step + 1, age: 0, ending: 'cutscene' }
      sound(next.sfx, next.sfxVolume)
      refresh()
      return
    }
    if (live.story.ending) return
    const { step, age } = live.story
    if (age < (step === 3 ? 3.6 : 1)) return
    if (step === 3) {
      beginBattle()
    } else {
      if (step === 2) sound('cutscene-portal-open', .45)
      live.story = { step: step + 1, age: 0 }
      refresh()
    }
  }

  function strikeCrate(point: Aim | null) {
    if (live.introAge !== null || live.time + 1e-7 < live.nextCrateHit) return
    live.nextCrateHit += rules.cursor.baseTickInterval
    if (!point || Math.abs(point.x - crate.x) > crate.hitWidth / 2 + point.radius ||
        Math.abs(point.y - crate.y) > crate.hitHeight / 2 + point.radius) return
    live.crateHitAge = 0
    live.crateHp = Math.max(0, live.crateHp - rules.cursor.baseDamagePerTick)
    if (live.crateHp > 0) {
      sound('pack-hit')
    } else {
      live.introAge = 0
      releaseInput()
      sound('intro-special-item', 0.45)
    }
  }

  function strikeTarget(point: Aim | null) {
    if (!live.campaign.introComplete) {
      strikeCrate(point)
      return
    }
    const battle = live.battle
    if (!battle || live.paused || live.menu || live.reveal) return
    const queue = live.campaign.activePacks
    const cursorRange = point ? point.radius * cursorProfile(battle).radius : 0
    const index = point ? queue.findIndex((pack, i) => {
      if (!packCanBeHit(pack, battle.clock)) return false
      const pos = packLocation(pack, i, battle.clock)
      const radius = packHitRadius(pack.box)
      return Math.hypot(point.x - pos.x, point.y - pos.y) <= cursorRange + radius
    }) : -1
    const damageBefore = battle.cursorDamage
    if (!pulse(battle, point, index >= 0)) return

    if (index < 0) {
      if (battle.cursorDamage > damageBefore) sound('caveling-hit', 0.22)
      return
    }
    strikeTablePack(battle, index)
  }

  function strikeTablePack(battle: Battle, index: number) {
    updateBattleQuests(battle)
    const previous = withBattleQuestCounters(live.campaign, battle.questProgress)
    const queue = previous.activePacks
    const pack = queue[index]
    if (!pack) return
    const position = packLocation(pack, index, battle.clock)
    const next = hitPack(previous, index, battle.random, masteryIncomeMultiplier(battle), battle.clock)
    if (next === previous) return
    recordBattleQuestCounters(battle.questProgress)
    const current = next.activePacks[index]
    if (current?.id === pack.id && current.hp < pack.hp &&
        next.totalPacksOpened === previous.totalPacksOpened && next.activePacks.length === queue.length) {
      packIdentity.set(current, packIdentity.get(pack) ?? pack)
      live.packHits.set(current, live.time)
      sound(packs[pack.id].hitSFX)
    } else {
      const cards = next.roster.slice(previous.roster.length)
      const traits = next.rosterTraits.slice(previous.roster.length)
      const opening = {
        pack, position, age: 0, turn: pack.launch && packThrowPose(pack.launch, battle.clock, pack.box).turn,
        rarity: highestPackRarity(cards), foil: traits.some(trait => trait.foil), seed: Math.random() * 100
      }
      if (!pack.box) {
        battle.packsOpened++
        battle.packOpenTimes.push(battle.clock)
        if (battle.summary) battle.summary.packsOpened = battle.packsOpened
        const firstNew = cards.findIndex(card => !previous.collection.includes(card))
        const firstFoil = cards.findIndex((card, index) => traits[index]?.foil && !previous.foilCollection.includes(card))
        const discovery = firstNew >= 0 ? firstNew : firstFoil
        if (discovery >= 0) {
          releaseInput()
          const card = cards[discovery]
          const rarity = highestPackRarity([card])
          const foil = !!traits[discovery]?.foil
          live.reveal = { card, age: 0, pack, position, pending: cards, traits, rarity, foil,
            turn: opening.turn ?? (-1.11 + index * .27), seed: opening.seed,
            timeline: discoveryTimeline(rarity, foil) }
          sound(discoveryRiser(foil), .45)
        } else {
          sound(packs[pack.id].openSFX, .42)
          live.openedPacks.push(opening)
          queuePackCards(battle, cards, position, traits)
        }
      } else {
        sound(packs[pack.id].openSFX, .42)
        live.openedPacks.push(opening)
      }
    }
    if (progressedQuest(previous, next)) showQuestCompletions(battle, [position])
    commit(next, position)
  }

  function strikePacksDuringDash(battle: Battle, at: Point, touched: Set<Pack>) {
    if (live.reveal) return
    const { tableHitRadius, boxColliderRadius, packColliderRadius } = scene.monkDash
    const overlapped = live.campaign.activePacks.filter((pack, index) => {
      if (!packCanBeHit(pack, battle.clock)) return false
      const pos = packLocation(pack, index, battle.clock)
      const radius = tableHitRadius + (pack.box ? boxColliderRadius : packColliderRadius)
      return Math.hypot(at.x - pos.x, at.y - pos.y) <= radius
    })
    for (const pack of overlapped) {
      if (live.reveal) break
      const identity = packIdentity.get(pack) ?? pack
      if (touched.has(identity)) continue
      const index = live.campaign.activePacks.indexOf(pack)
      if (index < 0) continue
      touched.add(identity)
      strikeTablePack(battle, index)
    }
  }

  function strikeFocused() {
    if (!live.campaign.introComplete) {
      strikeTarget({ x: crate.x, y: crate.y, radius: rules.cursor.baseRadius })
      return
    }
    const battle = live.battle
    if (!battle) return

    const queue = live.campaign.activePacks
    const reward = queue.findIndex(pack => pack.reward && packCanBeHit(pack, battle.clock))
    const index = reward >= 0 ? reward : queue.findIndex(pack => packCanBeHit(pack, battle.clock))
    const target = index >= 0 ? packLocation(queue[index], index, battle.clock) :
      battle.fieldTomes.find(tome => canSlashTome(battle, tome)) ?? nearestEnemy(battle)
    strikeTarget(target ? { ...target, radius: rules.cursor.baseRadius } : null)
  }

  function releaseInput() {
    live.aim = null
    live.keyboard = false
  }

  function settle(summary: NonNullable<Battle['summary']>) {
    live.summaryAge = 0
    live.victoryAge = 0
    releaseInput()
    const previous = live.campaign
    const battle = live.battle
    const next = settleChapter(previous, summary, battle?.questProgress?.recorded)
    if (battle && progressedQuest(previous, next)) showQuestCompletions(battle, [battle.bossDefeat ?? bonfire])
    commit(next)
    if (summary.result === 'defeat') sound('tower-destroyed', .4)
  }

  useEffect(() => {
    let previous = performance.now()
    let frame = 0
    let lastDraw = 0
    const updateFireballAudio = createFireballAudio()
    const updateTomeAudio = createTomeAudio()
    const updateDragonAudio = createDragonAudio()
    const updateBattleAudio = (battle: Battle | null, volume: number) => {
      const active = battle?.summary ? null : battle
      updateFireballAudio(active?.projectiles, volume)
      updateTomeAudio(active?.tomes, volume)
      updateDragonAudio(active?.dragons.filter(dragon => active.clock < dragon.exitAt), volume)
    }
    const visibilityChanged = () => {
      cancelAnimationFrame(frame)
      releaseInput()
      previous = performance.now()
      if (document.hidden) {
        updateBattleAudio(live.battle, 0)
        silenceSounds()
      } else frame = requestAnimationFrame(tick)
      updateChapterAudio(0)
    }
    const trustedAudioInput = (event: Event) => {
      if (event.isTrusted) updateChapterAudio(0, true)
    }
    const preferencesChanged = (event: Event) => {
      live.preferences = (event as CustomEvent<MenuPreferences>).detail
      if (live.battle) live.battle.damageNumbers.mode = live.preferences.damageNumberMode
      refresh()
    }
    const tick = (now: number) => {
      if (document.hidden) return
      const elapsed = Math.min(Math.max((now - previous) / 1000, 0), 0.15)
      previous = now
      let steppedBattle = false
      const previousDefeatAge = live.campaign.summary?.result === 'defeat' ? live.summaryAge : null
      if (!live.paused && !live.menu) {
        live.time += elapsed
        if (live.questMotion.flights.length || live.questMotion.popped.size) advanceQuestFlights(live.questMotion, live.questHud, live.time)
        live.crateHitAge += elapsed
        if (!live.reveal && live.openedPacks.length) {
          for (const open of live.openedPacks) open.age += elapsed
          live.openedPacks = live.openedPacks.filter(open => open.age < packOpeningLifetime(open.pack.box))
        }

        if (live.introAge !== null) {
          live.introAge += elapsed
          if (live.introAge >= introDuration) beginBattle()
        } else if (live.arrival) {
          live.arrival.age += elapsed
          if (live.arrival.age >= scene.arrivalCamera.duration) finishArrival()
        } else if (live.story) {
          const previous = live.story.age
          live.story.age += elapsed
          if (live.story.ending === 'gate') {
            const age = live.story.age
            if (gateBlinkTimes.some(at => previous < at && age >= at)) sound(campaignDoor.sounds.keyBlinkSfx, .4)
            if (previous < gateDissolveAt && age >= gateDissolveAt) sound(campaignDoor.sounds.doorOpenSfx, .5)
            if (age >= gateTransitionDuration) showActSummary()
          }
        } else if (live.reveal) {
          const reveal = live.reveal
          if (reveal.exitAge !== undefined) {
            reveal.exitAge += elapsed
            if (reveal.exitAge >= discoveryExitDuration) finishReveal()
          } else {
            const before = reveal.age
            reveal.age += elapsed
            const { buildUp, cardAt, continueAt, burstVolume } = reveal.timeline
            if (before < buildUp && reveal.age >= buildUp) stopSound(discoveryRiser(reveal.foil))
            if (before < cardAt && reveal.age >= cardAt) {
              sound(reveal.foil ? cardDiscovery.foilDiscoveryBurstSfx : cardDiscovery.discoveryBurstSfx, burstVolume)
              sound(packs[reveal.pack.id].openSFX, 1)
            }
            const stinger = cardAt + cardDiscovery.discoveryCardSoundDelay
            if (before < stinger && reveal.age >= stinger) sound(cardDiscovery.unitRevealSFX, .4)
            if (reveal.age >= continueAt + cardDiscovery.discoveryReadTimeout) continueReveal()
          }
        } else if (live.battle?.summary?.result === 'victory' && live.victoryAge < scene.victory.leadIn) {
          const previous = live.victoryAge
          live.victoryAge = Math.min(scene.victory.leadIn, live.victoryAge + elapsed)
          if (previous < scene.victory.stingerDelay && live.victoryAge >= scene.victory.stingerDelay) {
            sound('boss-final-blow.wav', .4)
          }
          if (previous < scene.victory.victorySoundDelay && live.victoryAge >= scene.victory.victorySoundDelay) {
            sound('wave-victory', .4)
          }
        } else if (live.campaign.summary) {
          live.summaryAge += elapsed
        } else if (live.campaign.pendingUnlock) {
          live.unlockAge += elapsed
          if (live.unlockExitAge !== null) {
            live.unlockExitAge += elapsed
            if (live.unlockExitAge >= unlock.exitDuration) finishUnlock()
          } else if (live.unlockAge >= unlockContinueAt + unlock.autoAdvanceDelay) {
            live.unlockExitAge = 0
          }
        } else if (live.chapterAge < chapterIntroDuration) {
          live.chapterAge += elapsed
        } else {
          if (live.keyboard) strikeFocused()
          else strikeTarget(live.aim)
          const battle = live.battle
          if (battle && !live.reveal) {
            const previousHp = battle.towerHp
            advanceBattle(battle, elapsed, undefined, (at, touched) => strikePacksDuringDash(battle, at, touched))
            updateBattleQuests(battle)
            steppedBattle = true
            for (const pack of live.campaign.activePacks) {
              const launch = pack.launch
              if (!launch || playedLaunches.has(launch) || battle.clock < (launch.startsAt ?? 0)) continue
              playedLaunches.add(launch)
              sound(packs[pack.id].spawnSFX)
            }
            for (const cue of battle.sounds.splice(0).slice(0, 6)) sound(cue, battleCueVolumes[cue] ?? .16)
            for (const drop of battle.droppedPacks.splice(0)) {
              if (!isPackId(drop.id)) continue
              const next = drop.transform ? transformPack(live.campaign, drop.id, battle.random())
                : grantDroppedPack(live.campaign, drop.id, drop.position, drop.traits)
              if (next !== live.campaign) {
                commit(next)
                sound(drop.sound ?? packs[drop.id].spawnSFX, .25)
              }
            }

            if (battle.summary) {
              settle(battle.summary)
            } else if (battle.towerHp < previousHp) {
              sound('tower-hit', 0.22)
            }
          }
        }
        const frameRate = live.preferences.frameRate || 60
        const summary = live.campaign.summary
        const summaryDuration = summary && live.battle
          ? daySummaryDelay(summary.result) + defeatSummaryTiming(summary).continueAt + .15 : 2
        const animating = !live.campaign.introComplete || live.campaign.resumePhase === 'beginning' ||
          live.story !== null || (live.campaign.resumePhase === 'summary' && live.summaryAge < summaryDuration) ||
          live.campaign.pendingUnlock !== null
        if (animating && now - lastDraw >= 1000 / frameRate) {
          refresh()
          lastDraw = now
        }
      }
      if (!steppedBattle && live.battle && !live.paused && !live.menu) {
        if (previousDefeatAge === null) advanceBattleVisuals(live.battle, elapsed)
        else if (live.summaryAge > previousDefeatAge) {
          advanceDefeatVisuals(live.battle, defeatWorldAge(live.summaryAge) - defeatWorldAge(previousDefeatAge))
        }
      }
      const battle = live.battle
      const running = steppedBattle && !battle?.summary && !battle?.respawn && !live.muted
      updateBattleAudio(battle, running ? live.preferences.sfx : 0)
      updateChapterAudio(live.paused ? 0 : elapsed)
      frame = requestAnimationFrame(tick)
    }
    if (!document.hidden) frame = requestAnimationFrame(tick)
    window.addEventListener('blur', releaseInput)
    window.addEventListener(MENU_PREFERENCES_CHANGED, preferencesChanged)
    window.addEventListener('pointerup', trustedAudioInput, true)
    window.addEventListener('keydown', trustedAudioInput, true)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      cancelAnimationFrame(frame)
      updateBattleAudio(null, 0)
      silenceSounds()
      chapterAudio.dispose()
      window.removeEventListener('blur', releaseInput)
      window.removeEventListener(MENU_PREFERENCES_CHANGED, preferencesChanged)
      window.removeEventListener('pointerup', trustedAudioInput, true)
      window.removeEventListener('keydown', trustedAudioInput, true)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [live, chapterAudio])

  function buy(slot: number) {
    if (live.campaign.boughtSlots.includes(slot)) {
      commit(refundShopOffer(live.campaign, slot))
      return
    }
    const offer = shopOffers(live.campaign)[slot]
    if (offer) commit(buyPack(live.campaign, offer.id, slot, offer.box))
  }

  function advanceChapter() {
    const next = continueChapter(live.campaign)
    if (next === live.campaign) return
    if (!next.pendingUnlock) live.battle = null
    live.summaryAge = 0
    live.unlockAge = 0
    live.unlockExitAge = null
    live.paused = false
    releaseInput()
    commit(next)
  }

  function skipDaySummary() {
    const summary = live.campaign.summary
    if (!summary || !live.battle) return
    const start = daySummaryDelay(summary.result)
    const end = start + defeatSummaryTiming(summary).continueAt + 1 / 60
    if (live.summaryAge < start || live.summaryAge >= end) return
    live.summaryAge = end
    refresh()
  }

  function continueUnlock() {
    if (live.campaign.resumePhase !== 'prepare' || !live.campaign.pendingUnlock ||
        live.unlockAge < unlockContinueAt || live.unlockExitAge !== null) return
    live.unlockExitAge = 0
    refresh()
  }

  function finishUnlock() {
    live.battle = null
    live.unlockAge = 0
    live.unlockExitAge = null
    commit({ ...live.campaign, pendingUnlock: null })
  }

  function setAim(point: Aim | null) {
    live.aim = point
  }

  function setKeyboard(pressed: boolean) {
    live.keyboard = pressed
  }

  function continueReveal() {
    const { reveal } = live
    if (reveal && reveal.age >= reveal.timeline.continueAt && reveal.exitAge === undefined) {
      reveal.exitAge = 0
      refresh()
    }
  }

  function finishReveal() {
    const { battle, reveal } = live
    if (!battle || !reveal) return
    stopSound(discoveryRiser(reveal.foil))
    queuePackCards(battle, reveal.pending, reveal.position, reveal.traits, reveal.card)
    live.reveal = null
    refresh()
  }

  function togglePause() {
    if (!live.campaign.introComplete || live.reveal || live.menu ||
        (live.campaign.resumePhase === 'prepare' && live.campaign.pendingUnlock)) return
    releaseInput()
    live.paused = !live.paused
    live.questHudExpanded = false
    if (live.paused) live.questMotion = createQuestMotion()
    refresh()
  }

  function openMenu() {
    releaseInput()
    live.paused = false
    live.menu = true
    live.questHudExpanded = false
    live.questMotion = createQuestMotion()
    refresh()
  }

  function play() {
    live.menu = false
    live.paused = false
    updateChapterAudio(0, true)
    refresh()
  }

  function reset() {
    releaseInput()
    live.battle = null
    live.crateHp = crate.hp
    live.crateHitAge = 5
    live.introAge = null
    live.arrival = null
    live.story = null
    live.reveal = null
    live.openedPacks = []
    live.unlockAge = 0
    live.unlockExitAge = null
    live.nextCrateHit = live.time + rules.cursor.baseTickInterval
    commit(newCampaign())
  }

  function openEnding(gateCamera?: GateCamera) {
    const { campaign } = live
    if (!campaign.completed || campaign.endingSeen || campaign.resumePhase !== 'prepare' || campaign.pendingUnlock || live.story) return
    live.story = { step: 0, age: 0, ending: 'gate', gateCamera, tower: towerAppearance(campaign) }
    refresh()
  }

  function showActSummary() {
    live.story = { step: 0, age: 0, ending: 'summary', tower: live.story?.tower ?? towerAppearance(live.campaign) }
    sound(actSummaryOpeningSound, .6)
    commit({ ...live.campaign, actSummaryStage: 'summary' })
  }

  function finishEnding() {
    live.story = null
    commit({ ...live.campaign, actSummaryStage: null, endingSeen: true })
    openMenu()
  }

  function skipStory() {
    if (live.story?.ending === 'summary') {
      const readyAt = actSummary(live.campaign).continueAt
      if (live.story.age >= readyAt) return
      live.story.age = readyAt
      refresh()
    } else if (live.story?.ending === 'gate') showActSummary()
    else if (live.story?.ending === 'cutscene') finishEnding()
    else beginBattle()
  }

  function toggleSound() {
    live.muted = !live.muted
    if (live.muted) silenceSounds()
    refresh()
  }

  function setQuestHudExpanded(expanded: boolean) {
    if (live.questHudExpanded === expanded) return
    live.questHudExpanded = expanded
    refresh()
  }

  return {
    presentation: live as Presentation, saveIssue, setAim, setKeyboard, begin, buy, advanceChapter, skipDaySummary, continueReveal,
    continueUnlock,
    skipReveal: finishReveal,
    togglePause, toggleSound, nextStory, skipStory, openMenu, play, reset, openEnding, setQuestHudExpanded,
    buyUpgrade: (id: string) => commit(purchaseUpgrade(live.campaign, id)),
    claimCollectionCard: (id: CardId) => commit(claimBinderCard(live.campaign, id)),
    reroll: () => commit(rerollShop(live.campaign))
  }
}
