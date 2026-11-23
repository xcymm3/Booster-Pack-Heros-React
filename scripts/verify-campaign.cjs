const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

// Load the same TypeScript rules that ship in H5 without invoking an interface.
require.extensions['.ts'] = (module, filename) => {
  const input = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  })
  module._compile(outputText, filename)
}

const rules = require('../src/game/rules.ts')
const save = require('../src/game/save.ts')
const combat = require('../src/game/combat.ts')
const { cursorPopScale, tomeOpeningPose, tomeSparkDuration, tomeSparkPose } = require('../src/game/tome-presentation.ts')
const { binderAwards, claimBinderCard } = require('../src/game/binder.ts')
const { boxOpening, highestPackRarity, ordinaryOpening, packDissolveNoise, packDissolveThresholds, packOpeningLifetime, packRipPose, packShineStartColor } = require('../src/game/pack-opening.ts')
const { packThrowPose } = require('../src/game/pack-throw.ts')
const { advanceDamageNumbers, createDamageNumbers, damageNumberLook, questPopupLook, showDamageNumber, showQuestPopup } = require('../src/game/damage-numbers.ts')
const { discoveryAuraLook, discoveryBurstLook, discoveryExitDuration, discoveryMusicGain, discoveryPackCharge, discoveryPose, discoveryTimeline } = require('../src/game/discovery.ts')
const { createPackChargeMask, packChargeTexel } = require('../src/game/pack-charge.ts')
const { createPackAuraMask, packAuraRays } = require('../src/game/pack-aura.ts')
const { advanceQuestFlights, createQuestMotion, questFlightDuration, questFlightPosition,
  questPanel, questRowScale, queueQuestFlights } = require('../src/game/quest-flight.ts')
const { createChapterAudio } = require('../src/pages/arena/chapter-audio.ts')
const { defeatSummaryTiming, defeatWorldAge, defeatZoomProgress } = require('../src/game/defeat.ts')
const { actSummary } = require('../src/game/act-summary.ts')
const { campaignGatePose, campaignGateView, gateBlinkTimes, gateDissolveAt, gateTransitionDuration } =
  require('../src/game/campaign-gate.ts')
const { initialUpgradeView, upgradeBackgroundOpacity, upgradeSkyLayerPose, upgradeSkyLayers, upgradeTreeOrigin } = require('../src/game/upgrade-camera.ts')
const { fallenLifetime, fallenUnitPose, heroEntryDuration, heroEntryPose, portalCastScale, portalExpireScale, portalIdleSprite } = require('../src/game/unit-motion.ts')
const upgrades = require('../src/game/upgrades.ts')
const { battleCrtLook, crtDisplayPoint, crtSamplePoint } = require('../src/pages/arena/crt.ts')

function replay(seed) {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let campaign = save.newCampaign()
  let defeatedAcrossAct = 0
  const victories = []
  const totalAttempts = 360

  for (let attempt = 1; attempt <= totalAttempts && !campaign.completed; attempt++) {
    const day = campaign.dayNumber
    if (attempt > 1) {
      campaign = purchaseUpgrades(campaign)
      const offers = save.shopOffers(campaign).map((offer, slot) => ({ ...offer, slot }))
      offers.sort((a, b) => b.cost - a.cost)
      for (const offer of offers) campaign = save.buyPack(campaign, offer.id, offer.slot, offer.box)
    }

    campaign = save.beginChapter(campaign, random)
    const modifiers = upgrades.upgradeModifiers(campaign.upgradeLevels)
    const battle = combat.createBattle(campaign.roster, false, random, day, modifiers, campaign.equippedRelics, {
      collection: campaign.collection, rosterTraits: campaign.rosterTraits, trackQuestProgress: true
    })
    battle.elapsed = -campaign.waveStartDelay
    const witchForms = new Set()
    let witchTransitionFrames = 0

    for (let tick = 0; tick < 4500; tick++) {
      if (battle.summary) break

      for (const enemy of battle.enemies) {
        if (enemy.id === 'Boss3_Witch' || enemy.id === 'Boss3_Witch2') witchForms.add(enemy.id)
      }
      for (const drop of battle.droppedPacks.splice(0)) {
        if (!rules.isPackId(drop.id)) continue
        campaign = drop.transform ? save.transformPack(campaign, drop.id, random())
          : save.grantDroppedPack(campaign, drop.id, drop.position, drop.traits)
      }

      const index = campaign.activePacks.findIndex(pack => save.packCanBeHit(pack, battle.clock))
      const pack = campaign.activePacks[index]
      const target = pack ? save.packLocation(pack, index, battle.clock) :
        battle.fieldTomes.find(tome => combat.canSlashTome(battle, tome)) ?? combat.nearestEnemy(battle)
      const aim = target ? { ...target, radius: rules.rules.cursor.baseRadius } : null
      if (combat.pulse(battle, aim, Boolean(pack)) && pack) {
        campaign = upgrades.resolveBattleQuests(campaign, battle.questProgress).campaign
        const previous = upgrades.withBattleQuestCounters(campaign, battle.questProgress)
        const struck = save.hitPack(previous, index, random, combat.masteryIncomeMultiplier(battle), battle.clock)
        if (struck !== previous) {
          campaign = struck
          upgrades.recordBattleQuestCounters(battle.questProgress)
        }
        if (campaign.totalPacksOpened > previous.totalPacksOpened) {
          battle.packsOpened++
          battle.packOpenTimes.push(battle.clock)
          combat.queuePackCards(battle, campaign.roster.slice(previous.roster.length), target,
            campaign.rosterTraits.slice(previous.roster.length))
        }
      }
      const duringTransition = Boolean(battle.respawn)
      const previousElapsed = battle.elapsed
      if (duringTransition) {
        assert.equal(battle.summary, null)
        assert.equal(combat.pulse(battle, aim, Boolean(pack)), false)
        witchTransitionFrames++
      }
      combat.advanceBattle(battle, .05)
      campaign = upgrades.resolveBattleQuests(campaign, battle.questProgress).campaign
      if (duringTransition) assert.equal(battle.elapsed, previousElapsed)
      battle.sounds.length = 0
    }

    const summary = battle.summary
    assert.ok(summary, 'Battle reached its simulation time limit')
    summary.packsOpened = battle.packsOpened
    const totalPacksOpened = campaign.totalPacksOpened
    campaign = reload(save.settleChapter(campaign, summary, battle.questProgress.recorded))
    assert.equal(campaign.totalPacksOpened, totalPacksOpened)
    defeatedAcrossAct += summary.defeated
    assert.equal(campaign.actBattle.monsters, defeatedAcrossAct)
    if (summary.result === 'victory') {
      assert.equal(summary.rewardId, rules.chapterInfo(day).rewardPack)
      assert.ok(campaign.unlockedPacks.includes(summary.rewardId))
      assert.equal(campaign.pendingUnlock, summary.rewardId)
      assert.ok(battle.bossDefeat)
      victories.push({
        chapter: day, attempt, elapsed: +summary.elapsed.toFixed(2), kills: summary.defeated,
        reward: summary.rewardId, witchForms: [...witchForms], witchTransitionFrames
      })
    }
    campaign = reload(save.continueChapter(campaign))
    if (campaign.pendingUnlock) {
      assert.equal(save.beginChapter(campaign), campaign)
      // The reveal dismissal persists independently of the chapter checkpoint.
      campaign = reload({ ...campaign, pendingUnlock: null })
    }
  }

  assert.ok(campaign.completed, 'Campaign could not be cleared')
  assert.deepEqual(victories.map(result => result.chapter), [1, 2, 3])
  assert.deepEqual(victories[2].witchForms, ['Boss3_Witch', 'Boss3_Witch2'])
  assert.ok(victories[2].witchTransitionFrames > 0)
  assert.ok(campaign.upgradeLevels[upgrades.mainUpgrade])
  assert.ok(campaign.upgradeLevels['Q_PackBasic@23,19'])
  assert.ok(campaign.upgradeLevels['Q_DefeatOgre@23,23'])
  assert.ok(campaign.upgradeLevels['Q_DefeatBeast@23,36'])
  assert.ok(campaign.upgradeLevels['Q_DefeatWitch@23,49'])
  assert.ok(rules.ending.layers.length === 3)
  const report = actSummary(reload({ ...campaign, actSummaryStage: 'summary' }))
  assert.ok(report.mvp?.damage > 0 && report.mvp.share > 0 && report.mvp.share <= 1)
  assert.equal(report.attempts, campaign.attempts)
  assert.equal(report.panels[0].rows[2].value, 3)
  assert.ok(report.continueAt > report.triesAt)

  return { victories, cards: campaign.collection.length, upgrades: Object.keys(campaign.upgradeLevels).length }
}

function verifyCampaignGate() {
  const camera = { view: { x: 2, y: 3, zoom: 1.2 }, offset: { x: 0, y: -46.53 }, centerDelta: { x: 1, y: -2 } }
  assert.deepEqual(campaignGateView(camera, campaignGatePose(0), true), camera.view)
  assert.equal(gateBlinkTimes.length, 15)
  assert.equal(campaignGatePose(gateBlinkTimes[0] + .02).key, 0)
  assert.equal(campaignGatePose(gateDissolveAt - .05).dissolve, 0)
  const focused = campaignGateView(camera, campaignGatePose(1), true)
  const dived = campaignGateView(camera, campaignGatePose(6.25), true)
  assert.ok(dived.zoom > focused.zoom * 10)
  assert.ok(Math.abs(dived.y + camera.offset.y * dived.zoom - focused.y - camera.offset.y * focused.zoom) < 1e-6)
  assert.equal(campaignGatePose(gateTransitionDuration).opacity, 0)
  assert.deepEqual(campaignGateView(camera, campaignGatePose(6.25, false), false), camera.view)
}

function verifyEpicPackCharge() {
  const timeline = discoveryTimeline(highestPackRarity(['Hero3_Illusionist']), false)
  assert.equal(timeline.buildUp, 2.1)
  const chargeAt = age => {
    const { hits, hitAge } = discoveryPose(timeline, age)
    return discoveryPackCharge(timeline, age, hits, hitAge)
  }
  const first = chargeAt(.25)
  const second = chargeAt(timeline.hitTimes[1] + .25)
  const fullyCharged = chargeAt(timeline.buildUp + .05)
  assert.equal(chargeAt(0).white, 1)
  assert.equal(first.white, 0)
  assert.ok(first.charge > 0 && second.charge > first.charge)
  assert.equal(fullyCharged.charge, 1)
  const texture = new Uint8ClampedArray(34 * 48 * 4).fill(255)
  const mask = createPackChargeMask(texture, 34, 48, [17, 58], 28.2)
  let white = 0
  for (let pixel = 0; pixel < mask.radius.length; pixel++) {
    assert.equal(packChargeTexel(mask, pixel, 0, 0, 0), 0)
    if (packChargeTexel(mask, pixel, fullyCharged.charge, 0, timeline.buildUp) === 2) white++
  }
  assert.ok(white > 0 && white < mask.radius.length / 3)

  const { auraRayAngles, auraRayLengths } = rules.packPresentation
  const aura = createPackAuraMask(texture, 34, 48, [17, 58], 17, 24, auraRayAngles, 28.2)
  const beforeSecondHit = packAuraRays(auraRayLengths, timeline, .5, 28.2)
  const fullyLit = packAuraRays(auraRayLengths, timeline, timeline.buildUp, 28.2)
  assert.equal(beforeSecondHit.filter(ray => ray.reach > 0).length, rules.packPresentation.auraRaysPerHit)
  assert.deepEqual(fullyLit.map(ray => ray.reach), auraRayLengths)
  assert.ok(aura.reach.every(value => value > 0 && Number.isFinite(value)))
  assert.ok(aura.ray.every(slot => slot < auraRayAngles.length))

  const epic = [152, 40, 154]
  assert.deepEqual(packShineStartColor(0, epic, false), { rgb: [148, 40, 113], alpha: 179 / 255 })
  assert.deepEqual(packShineStartColor(1, epic, false), { rgb: epic, alpha: 188 / 255 })
  assert.deepEqual(packShineStartColor(.5, epic, true), { rgb: [51, 255, 255], alpha: 188 / 255 })
  assert.deepEqual(packShineStartColor(1, epic, true), packShineStartColor(0, epic, true))

  const initialGlow = discoveryAuraLook(0)
  assert.equal(timeline.glowAlpha, 1)
  assert.equal(initialGlow.glowScale, 1.5)
  assert.equal(initialGlow.glowDissolve, 1)
  assert.equal(discoveryAuraLook(.25).glowDissolve, 0)
  assert.ok(Math.abs(discoveryAuraLook(.5).alpha - .675) < 1e-6)
  assert.ok(Math.abs(discoveryAuraLook(.6).extraTurn + 87 * Math.PI / 180) < 1e-6)
  assert.equal(discoveryAuraLook(.6).extraTurn, discoveryAuraLook(1).extraTurn)

  const burst = discoveryBurstLook(.05, 25)
  assert.ok(Math.abs(burst.reach - .875) < 1e-7)
  assert.ok(Math.abs(burst.turn + 94 * Math.PI / 180) < 1e-7)
  assert.ok(Math.abs(discoveryBurstLook(.35, 25).dissolve - .5) < 1e-6)
  assert.equal(discoveryBurstLook(.401, 25), null)
}

function verifyOpeningUpgradeBoard() {
  const first = { ...save.newCampaign(), introComplete: true, attempts: 1, mastery: 9, openedByPack: { Pack1_Basic: 1 } }
  const liveTree = upgrades.upgradeBoard(first)
  const renderedTree = upgrades.upgradeBoard(first, true)
  assert.equal(liveTree.states.size, 1)
  assert.equal(renderedTree.states.get(upgrades.mainUpgrade), 'available')
  assert.equal(renderedTree.states.get('SN_RangerRange@19,14'), 'locked')
  assert.equal(renderedTree.states.get('SN_TomeThunderstormDuration@19,16'), 'locked')
  const firstQuestId = 'Q_PackBasic@23,19'
  assert.equal(renderedTree.states.get(firstQuestId), 'quest')
  const quest = upgrades.upgradeCells.find(cell => cell.id === firstQuestId)
  assert.equal(upgrades.questLabel(first, quest).progress, 1)
  assert.equal(upgrades.purchaseUpgrade(first, 'SN_RangerRange@19,14'), first)
  assert.ok(renderedTree.links.has(upgrades.linkId(quest, upgrades.upgradeCells.find(cell => cell.x === 23 && cell.y === 18))))
  assert.equal(upgradeBackgroundOpacity(initialUpgradeView, upgradeTreeOrigin(false, false)), .15)
  assert.equal(upgradeBackgroundOpacity(initialUpgradeView, upgradeTreeOrigin(true, true)), 1)
  const pose = upgradeSkyLayerPose({ x: 10, y: 10, zoom: 1 }, upgradeSkyLayers[0])
  assert.ok(Math.abs(pose.x - 1) < 1e-10 && Math.abs(pose.y - 1) < 1e-10)
  assert.ok(upgradeSkyLayerPose({ x: 10, y: 10, zoom: 1 }, upgradeSkyLayers[2]).x > pose.x)
}

function verifyChapterAudio() {
  const players = []
  function createPlayer() {
    const player = {
      paused: true, plays: 0, sources: [], volume: 1, playbackRate: 1,
      set src(value) { this.sources.push(value) },
      get src() { return this.sources.at(-1) },
      removeAttribute() { this.sources.push(undefined) },
      load() {},
      pause() { this.paused = true },
      play() {
        this.plays++
        if (this.rejectPlay) return Promise.reject(new Error('Autoplay blocked'))
        this.paused = false
        return Promise.resolve()
      }
    }
    players.push(player)
    return player
  }
  let sample = .99
  const soundtrack = createChapterAudio(name => {
    assert.equal(fs.readFileSync(require('node:path').join(__dirname, '../src/assets', name), { flag: 'r' }).subarray(0, 4).toString(), 'RIFF')
    return name
  }, () => sample, createPlayer)
  const frame = {
    phase: 'battle', attempt: 1, volume: .8, muted: false,
    hidden: false, menu: true, cinematicPause: false, surge: false, discoveryGain: 1
  }
  soundtrack.update(frame, .05)
  assert.equal(players.length, 0)
  frame.menu = false
  soundtrack.update(frame, .05)
  const [ambient, music] = players
  assert.equal(music.src, 'soundtrack/310.wav')
  assert.equal(ambient.src, 'soundtrack/268.wav')
  assert.equal(music.loop, true)
  assert.equal(music.preservesPitch, false)
  assert.equal(ambient.volume, .173 * .8)
  assert.equal(music.volume, .449 * .8)
  const common = discoveryTimeline(0, false)
  assert.equal(discoveryMusicGain(common, 0), 1)
  assert.equal(discoveryMusicGain(common, 1), .7)
  assert.equal(discoveryMusicGain(common, 1, discoveryExitDuration), 1)
  assert.equal(discoveryMusicGain(discoveryTimeline(0, true), 1), .25)
  frame.discoveryGain = discoveryMusicGain(common, .2)
  frame.surge = true
  soundtrack.update(frame, .05)
  assert.ok(Math.abs(music.volume - .449 * .8 * .85) < 1e-8)
  assert.equal(music.playbackRate, 1.06)
  frame.cinematicPause = true
  soundtrack.update(frame, .05)
  assert.equal(music.paused, true)
  assert.equal(ambient.paused, false)
  frame.cinematicPause = false
  frame.discoveryGain = 1
  frame.surge = false
  soundtrack.update(frame, .05)
  assert.equal(music.volume, .449 * .8)
  assert.equal(music.sources.length, 1)

  frame.phase = 'summary'
  soundtrack.update(frame, 0)
  soundtrack.update(frame, .625)
  assert.equal(music.volume, .449 * .8 / 2)
  frame.hidden = true
  soundtrack.update(frame, 20)
  assert.ok(music.paused && ambient.paused)
  assert.equal(music.volume, .449 * .8 / 2)
  frame.hidden = false
  soundtrack.update(frame, .625)
  assert.equal(music.src, undefined)
  assert.equal(ambient.paused, false)

  frame.phase = 'improvements'
  sample = 0
  music.rejectPlay = true
  soundtrack.update(frame, .05)
  assert.equal(music.src, 'soundtrack/380.wav')
  assert.equal(music.volume, .426 * .8)
  const plays = music.plays
  soundtrack.update(frame, .05)
  assert.equal(music.plays, plays)
  music.rejectPlay = false
  soundtrack.update(frame, 0, true)
  assert.equal(music.plays, plays + 1)
  assert.equal(music.paused, false)
  frame.muted = true
  soundtrack.update(frame, .05)
  assert.equal(music.volume, 0)
  assert.equal(ambient.volume, 0)
  assert.equal(music.paused, false)
  frame.muted = false
  frame.phase = 'battle'
  frame.attempt = 2
  sample = .99
  soundtrack.update(frame, .05)
  frame.attempt = 3
  soundtrack.update(frame, .05)
  assert.deepEqual(music.sources.slice(-2), ['soundtrack/310.wav', 'soundtrack/310.wav'])
  soundtrack.dispose()
  assert.ok(music.paused && ambient.paused)
  console.log('Chapter audio passed: original tracks, chapter transitions, duck, fade, pause and autoplay retry')
}

function reload(campaign) {
  const encoded = JSON.stringify(campaign)
  const restored = save.parseCampaign(encoded)
  assert.deepEqual(restored, JSON.parse(encoded))
  return restored
}

function verifyPackSlashes() {
  const start = save.beginChapter({ ...save.newCampaign(), introComplete: true })
  for (const id of ['Pack1_Basic', 'Pack2_Advanced', 'Pack3_Magic', 'Pack4_Royal']) {
    const withPack = save.grantDroppedPack(start, id, { x: 0, y: 0 })
    const first = reload(save.hitPack(withPack, 0, () => .5))
    assert.equal(first.activePacks[0].hp, rules.packs[id].maxHP / 2)
    assert.equal(save.hitPack(first, 0, () => .5).totalPacksOpened, 1)
  }
  const withReduction = save.grantDroppedPack({
    ...start, upgradeLevels: { 'SN_Pack_Basic_HitToOpenPack@21,18': 1 }
  }, 'Pack1_Basic', { x: 0, y: 0 })
  assert.equal(save.hitPack(withReduction, 0, () => .5).totalPacksOpened, 1)
  const definition = rules.packs.Pack3_Magic
  const box = { ...start, packHp: definition.boosterBoxMaxHP, activePacks: [
    { id: 'Pack3_Magic', hp: definition.boosterBoxMaxHP, box: true }
  ] }
  const hitBox = save.hitPack(box, 0, () => .5)
  assert.equal(hitBox.activePacks[0].hp, definition.boosterBoxMaxHP / 2)
  const openedBox = save.hitPack(hitBox, 0, () => .5)
  assert.equal(openedBox.activePacks.length, definition.boosterBoxPackCount)
  assert.ok(openedBox.activePacks.every(pack => !pack.box && pack.id === 'Pack3_Magic'))
}

function verifyPackOpening() {
  assert.equal(highestPackRarity(['Hero1_Squire']), 0)
  assert.equal(highestPackRarity(['Hero1_Squire', 'Hero1_Barbarian']), 1)
  assert.equal(highestPackRarity(['Hero1_Archer', 'Tome_Thunderstorm']), 3)
  const start = packRipPose(0)
  assert.equal(start.scale, 1)
  assert.equal(start.white, 1)
  assert.equal(start.dissolve, 0)
  const delayedDissolve = ordinaryOpening.ripDuration * ordinaryOpening.dissolveDelay
  assert.equal(packRipPose(delayedDissolve - .001).dissolve, 0)
  assert.ok(packRipPose(delayedDissolve + .001).dissolve > 0)
  assert.equal(packRipPose(ordinaryOpening.flashDuration).white, 0)
  assert.equal(packRipPose(boxOpening.ripDuration, true).dissolve, 1)
  assert.ok(Math.abs(packOpeningLifetime(true) - packOpeningLifetime(false) - boxOpening.wobbleDuration) < 1e-5)
  assert.deepEqual(packDissolveThresholds(0), { cut: -.12, edge: 0 })
  assert.ok(Math.abs(packDissolveThresholds(1).cut - 1) < 1e-12)
  const noise = packDissolveNoise(48, 41, 24.8)
  assert.ok(noise >= 0 && noise < 1)
  assert.equal(packDissolveNoise(48.9, 41.4, 24.8), noise)
  assert.notEqual(packDissolveNoise(48, 41, 24.8 + 37), noise)

  const battle = combat.createBattle([], false, () => .5)
  const cards = ['Hero1_Squire', 'Tome_Thunderstorm', 'Hero1_Barbarian']
  const at = { x: 1, y: -1 }
  combat.queuePackCards(battle, cards, at, [{}, { foil: true }, {}])
  assert.deepEqual(battle.allies.map(unit => unit.id), ['Hero1_Squire'])
  assert.equal(battle.fieldTomes.length, 0)
  combat.advanceBattle(battle, .19)
  assert.equal(battle.fieldTomes.length, 0)
  combat.advanceBattle(battle, .01)
  assert.equal(battle.fieldTomes[0].id, 'Tome_Thunderstorm')
  assert.equal(battle.fieldTomes[0].foil, true)
  combat.advanceBattle(battle, .2)
  assert.deepEqual(battle.allies.map(unit => unit.id), ['Hero1_Squire', 'Hero1_Barbarian'])
  assert.equal(battle.pendingPackCards.length, 0)

  const training = combat.createBattle([], true, () => .5)
  training.tutorial = 'fight'
  Object.assign(training.enemies[0], { x: at.x, y: at.y })
  combat.queuePackCards(training, ['Hero1_Squire'], at, [{}])
  const [hero] = training.allies
  assert.deepEqual(heroEntryPose(hero.entry, 0), { ...at, scale: 0 })
  const landing = hero.entry.target
  assert.ok(Math.abs(landing.x - at.x) <= rules.packPresentation.cardSpawnSpreadRadius)
  combat.advanceBattle(training, .19)
  assert.ok(Math.abs(hero.x - (at.x + landing.x) / 2) < 1e-9)
  assert.ok(heroEntryPose(hero.entry, .19).scale > 1)
  assert.equal(hero.attackedUntil, 0)
  assert.equal(training.effects.some(item => item.art === 'heroLand'), false)
  combat.advanceBattle(training, .19)
  assert.equal(hero.x, landing.x)
  assert.equal(training.effects.filter(item => item.art === 'heroLand').length, 1)
  combat.advanceBattle(training, .07)
  assert.equal(heroEntryPose(hero.entry, .45).scale, 1.12)
  assert.equal(hero.attackedUntil, 0)
  combat.advanceBattle(training, heroEntryDuration - .45)
  assert.equal(hero.entry, null)
  assert.ok(hero.attackedUntil > training.clock)
  assert.equal(training.effects.filter(item => item.art === 'heroLand').length, 1)

  const discovery = combat.createBattle([], false, () => .5)
  combat.queuePackCards(discovery, ['Hero1_Squire', 'Hero1_Archer'], at, [{}, {}], 'Hero1_Archer')
  combat.advanceBattle(discovery, .2)
  assert.equal(discovery.allies[0].entry.fromReveal, false)
  assert.equal(discovery.allies[1].entry.fromReveal, true)
  assert.equal(heroEntryPose(discovery.allies[1].entry, 0).scale, 1)
}

function verifyDiscovery() {
  const common = discoveryTimeline(0, false)
  assert.deepEqual(common.hitTimes.map(time => Number(time.toFixed(4))), [0, .7125, 1.425])
  assert.equal(Number(common.cardAt.toFixed(2)), 2.05)
  assert.equal(Number(common.continueAt.toFixed(2)), 4.75)
  const first = discoveryPose(common, .25)
  const pause = discoveryPose(common, .6)
  const second = discoveryPose(common, 1.05)
  assert.equal(first.zoom, pause.zoom)
  assert.ok(first.dim < second.dim)
  assert.ok(first.zoom < second.zoom)
  assert.equal(first.cardScale, 0)
  const card = discoveryPose(common, common.cardAt + 1)
  assert.ok(Math.abs(card.zoom - 3.125) < 1e-6)
  assert.equal(card.cardScale, 1)
  assert.equal(discoveryPose(common, common.continueAt, discoveryExitDuration).zoom, 1)
  assert.equal(discoveryPose(common, common.continueAt, discoveryExitDuration).dim, 0)
  assert.ok(discoveryTimeline(2, false).cardAt > common.cardAt)
  assert.equal(discoveryTimeline(0, true).hold, rules.cardDiscovery.foilRevealHoldDuration)
  assert.equal(rules.cardRevealDescription('Hero1_Squire'), '基础作战单位')
  assert.ok(rules.cardRevealDescription('Hero2_Monk'))
  assert.ok(rules.cardRevealDescription('Hero3_Illusionist'))
}

function verifyBinderDiscovery() {
  const start = save.beginChapter({ ...save.newCampaign(), introComplete: true })
  const pack = save.grantDroppedPack(start, 'Pack1_Basic', rules.bonfire, { foil: true })
  const hit = save.hitPack(pack, pack.activePacks.length - 1, () => .5)
  const opened = save.hitPack(hit, hit.activePacks.length - 1, () => .5)
  const squire = 'Hero1_Squire'
  const skeleton = 'Hero_Skeleton'
  assert.ok(opened.binderPending.cards.includes(squire))
  assert.ok(opened.binderPending.foils.includes(squire))
  assert.equal(claimBinderCard(opened, squire), opened)
  const ready = reload(save.continueChapter(save.settleChapter(opened, {
    result: 'defeat', elapsed: 15, defeated: 0, coins: 0, mastery: 0, rewardPack: false,
    unitStats: [{ id: skeleton, count: 1, damage: 0, defense: 0 }]
  })))
  assert.ok(ready.collection.includes(skeleton))
  assert.ok(ready.binderPending.cards.includes(skeleton))
  assert.deepEqual(binderAwards(ready, squire), [{ resource: 0, value: 10 }, { resource: 5, value: 1 }])
  const claimed = reload(claimBinderCard(ready, squire))
  assert.equal(claimed.mastery, ready.mastery + 10)
  assert.equal(claimed.upgradeCounters['resource:foiliumCost'], ready.upgradeCounters['resource:foiliumCost'] + 1)
  assert.deepEqual(binderAwards(claimed, squire), [])
  assert.equal(claimBinderCard(claimed, squire), claimed)
  assert.ok(claimed.binderPending.cards.includes(skeleton))
  const { binderPending, ...legacy } = claimed
  assert.deepEqual(save.parseCampaign(JSON.stringify(legacy)).binderPending, { cards: [], foils: [] })
}

function verifyBattleQuests() {
  const basicQuest = 'Q_PackBasic@23,19'
  const monsterQuest = 'Q_DefeatGoblin@21,19'
  const start = save.beginChapter({
    ...save.newCampaign(), upgradeLevels: { [upgrades.mainUpgrade]: 1 },
    activePacks: Array.from({ length: 2 }, () => ({ id: 'Pack1_Basic', hp: 1, cards: ['Hero1_Squire'] }))
  })
  const one = save.hitPack(start, 0, () => .5)
  const two = reload(save.hitPack(one, 0, () => .5))
  const initialHud = upgrades.updateBattleQuestHud(start, null)
  const packHud = upgrades.updateBattleQuestHud(one, null, initialHud)
  assert.equal(initialHud.rows.find(row => row.cell.id === basicQuest).progress, 0)
  assert.equal(packHud.rows[0].cell.id, basicQuest)
  assert.equal(packHud.rows[0].progress, 1)
  assert.equal(packHud.rows[0].required, 2)
  const motion = createQuestMotion()
  queueQuestFlights(motion, initialHud, packHud, { x: 0, y: 0 }, 0, false)
  assert.equal(motion.flights.length, 1)
  assert.equal(motion.waiting.get(basicQuest), 0)
  const flight = motion.flights[0]
  const { left, width, bottom, rowHeight } = questPanel
  assert.deepEqual(questFlightPosition(flight, 0), { x: .5, y: .5 })
  const halfway = questFlightPosition(flight, questFlightDuration / 2)
  assert.ok(Math.abs(halfway.x - (.5 + left + width / 2) / 2) < 1e-10)
  assert.ok(Math.abs(halfway.y - (.5 + bottom - rowHeight / 2) / 2) < 1e-10)
  advanceQuestFlights(motion, packHud, .41)
  assert.equal(motion.waiting.get(basicQuest), 0)
  advanceQuestFlights(motion, packHud, questFlightDuration)
  assert.equal(motion.waiting.get(basicQuest), 0)
  advanceQuestFlights(motion, packHud, .44)
  assert.equal(motion.flights.length, 0)
  assert.equal(motion.waiting.has(basicQuest), false)
  assert.equal(motion.popped.get(basicQuest), .44)
  assert.equal(questRowScale(0), 1)
  assert.equal(questRowScale(.11), 1.14)
  assert.ok(Math.abs(questRowScale(.2) - 1) < 1e-10)
  advanceQuestFlights(motion, packHud, .66)
  assert.equal(motion.popped.size, 0)
  const completedPackHud = upgrades.updateBattleQuestHud(two, null, packHud)
  assert.equal(completedPackHud.rows.some(row => row.cell.id === basicQuest), false)
  assert.equal(completedPackHud.recent.includes(basicQuest), false)
  assert.equal(upgrades.progressedQuest(start, one), false)
  assert.equal(upgrades.progressedQuest(one, two), true)
  assert.equal(two.upgradeLevels[basicQuest], 1)
  assert.equal(upgrades.upgradeModifiers(two.upgradeLevels).salaryCoins - upgrades.upgradeModifiers(one.upgradeLevels).salaryCoins, 1)

  const campaign = { ...two, upgradeCounters: { ...two.upgradeCounters, 'monster:Monster1_Caveling': 49 } }
  const killHud = upgrades.updateBattleQuestHud(campaign, null, completedPackHud)
  assert.equal(killHud.rows[0].cell.id, monsterQuest)
  assert.equal(killHud.rows[0].progress, 49)
  const battle = combat.createBattle([], false, () => .5, 1, undefined, [], { trackQuestProgress: true, damageNumberMode: 'off' })
  for (let tick = 0; tick < 180 && !battle.enemies.length; tick++) combat.advanceBattle(battle, .05)
  const enemy = battle.enemies.find(unit => unit.id === 'Monster1_Caveling')
  assert.ok(enemy)
  enemy.hp = .01
  const position = { x: enemy.x, y: enemy.y }
  assert.ok(combat.pulse(battle, { ...position, radius: .38 }))
  const observedProgress = []
  const { campaign: completed, completedAt } = upgrades.resolveBattleQuests(campaign, battle.questProgress,
    (snapshot, at) => observedProgress.push({ snapshot, at }))
  assert.deepEqual(completedAt, [position])
  assert.equal(completed.upgradeLevels[monsterQuest], 1)
  assert.equal(completed.upgradeCounters['monster:Monster1_Caveling'], 50)
  assert.ok(observedProgress.some(event => event.snapshot === completed && event.at.x === position.x && event.at.y === position.y))
  assert.equal(upgrades.updateBattleQuestHud(completed, battle.questProgress, killHud).rows.some(row => row.cell.id === monsterQuest), false)
  assert.equal(upgrades.resolveBattleQuests(completed, battle.questProgress).completedAt.length, 0)
  showQuestPopup(battle.damageNumbers, position)
  advanceDamageNumbers(battle.damageNumbers, .18)
  assert.equal(battle.damageNumbers.quests.length, 1)
  assert.ok(questPopupLook(.18).alpha > 0)
  advanceDamageNumbers(battle.damageNumbers, .33)
  assert.equal(battle.damageNumbers.quests.length, 0)

  const summary = { result: 'defeat', elapsed: 1, defeated: 2, mastery: 0, coins: 0, rewardPack: false,
    counters: { 'monster:Monster1_Caveling': 2 } }
  const saved = reload(save.settleChapter(completed, summary, battle.questProgress.recorded))
  assert.equal(saved.upgradeCounters['monster:Monster1_Caveling'], 51)
  assert.equal(saved.upgradeLevels[monsterQuest], 1)
}

function verifyShop() {
  const early = { ...save.newCampaign(), introComplete: true, coins: 12 }
  const unopened = save.shopOffers({ ...early, openedByPack: { Pack1_Basic: 4 } })
  assert.equal(unopened.length, 3)
  assert.ok(unopened.every(offer => offer.id === 'Pack1_Basic' && !offer.box && offer.cost === 2))
  assert.equal(save.rerollShop(early), early)

  const upgradeLevels = {
    'SN_ShopRerollUnlock@23,8': 1,
    'SN_ShopRoguelikeSlotBonus@24,8': 1,
    'SN_ShopRerollCostReduction@22,8': 1,
    'SN_RoguelikeDiscountChance@23,7': 1
  }
  const prepare = {
    ...early, upgradeLevels, dayNumber: 3,
    unlockedPacks: ['Pack1_Basic', 'Pack2_Advanced', 'Pack3_Magic'],
    openedByPack: { Pack1_Basic: 5 },
    collection: ['Hero1_Squire', 'Tome_Thunderstorm']
  }
  const offers = Array.from({ length: 60 }, (_, shopSeed) => save.shopOffers({ ...prepare, shopSeed })).flat()
  assert.equal(save.shopOffers(prepare).length, 4)
  assert.ok(offers.some(offer => offer.box && offer.id === 'Pack1_Basic'))
  assert.ok(offers.some(offer => !offer.box && offer.id === 'Pack3_Magic'))
  assert.ok(offers.some(offer => offer.listPrice > offer.cost))
  assert.ok(offers.some(offer => offer.card === 'Hero1_Squire'))
  assert.ok(offers.some(offer => offer.card === 'Tome_Thunderstorm'))
  assert.ok(offers.filter(offer => offer.card).every(offer => offer.copies === 1))

  const special = {
    ...prepare, shop: [
      unopened[0], { id: 'DeliveryBox', box: false, cost: 2, listPrice: 3, card: 'Tome_Thunderstorm', copies: 1 },
      unopened[1], unopened[2]
    ]
  }
  const bought = reload(save.buyPack(special, 'DeliveryBox', 1))
  assert.equal(bought.coins, 10)
  assert.deepEqual(save.shopOffers(bought), special.shop)
  assert.deepEqual(bought.activePacks[0].cards, ['Tome_Thunderstorm'])
  assert.equal(save.buyPack(bought, 'DeliveryBox', 1), bought)
  assert.equal(save.getShopRerollCost(bought), 0)
  const rerolled = reload(save.rerollShop(bought))
  assert.equal(rerolled.rerolls, 1)
  assert.deepEqual(save.shopOffers(rerolled)[1], special.shop[1])
  assert.deepEqual(save.refundShopOffer(rerolled, 1).activePacks, [])
  assert.equal(save.refundShopOffer(rerolled, 1).coins, special.coins)
  const fighting = save.beginChapter(rerolled)
  assert.equal(save.refundShopOffer(fighting, 1), fighting)
  const opened = save.hitPack(save.hitPack(fighting, 0, () => .5), 0, () => .5)
  assert.deepEqual(opened.roster, ['Tome_Thunderstorm'])

  const legacy = { ...bought, boughtSlots: [4], activePacks: [
    { ...bought.activePacks[0], purchase: { ...bought.activePacks[0].purchase, slot: 4 } }
  ] }
  delete legacy.shop
  const restored = save.parseCampaign(JSON.stringify(legacy))
  assert.deepEqual(save.shopOffers(restored)[4], { id: 'DeliveryBox', box: false, cost: 2, card: 'Tome_Thunderstorm', copies: 1 })
  assert.equal(save.refundShopOffer(restored, 4).coins, special.coins)
}

function verifyShopDelivery() {
  const campaign = {
    ...save.newCampaign(), introComplete: true, coins: 8, shop: [
      { id: 'Pack1_Basic', box: false, cost: 2 },
      { id: 'DeliveryBox', box: false, card: 'Hero1_Squire', copies: 2, cost: 2 },
      { id: 'DeliveryBox', box: false, card: 'Tome_Thunderstorm', copies: 1, cost: 3 }
    ]
  }
  const withBasic = save.buyPack(campaign, 'Pack1_Basic', 0)
  const withHero = save.buyPack(withBasic, 'DeliveryBox', 1)
  const prepared = reload(save.buyPack(withHero, 'DeliveryBox', 2))
  assert.equal(prepared.coins, 1)
  assert.equal(prepared.activePacks.length, 3)
  assert.deepEqual(save.refundShopOffer(prepared, 1).activePacks.map(pack => pack.cards), [undefined, ['Tome_Thunderstorm']])

  const rolls = [.5, .5, .5, .5, .5, .21, .44, .65, .85, .43]
  const launched = reload(save.beginChapter(prepared, () => rolls.shift()))
  const [basic, parcel] = launched.activePacks
  assert.equal(launched.activePacks.length, 2)
  assert.equal(basic.id, 'Pack1_Basic')
  assert.equal(parcel.id, 'DeliveryBox')
  assert.equal(parcel.purchase, undefined)
  assert.deepEqual(parcel.cards, ['Hero1_Squire', 'Hero1_Squire', 'Tome_Thunderstorm'])
  assert.equal(save.packCanBeHit(parcel, 0), false)
  assert.equal(save.packCanBeHit(parcel, .35), true)
  assert.equal(save.packCanBeHit(parcel, 1.5), true)
  const rolling = packThrowPose(parcel.launch, .35)
  const stopped = packThrowPose(parcel.launch, 1.5)
  assert.notEqual(rolling.turn, stopped.turn)
  assert.ok(Math.hypot(stopped.x - parcel.launch.target.x, stopped.y - parcel.launch.target.y) < .05)
  assert.deepEqual(save.packLocation(parcel, 1, .35), rolling)
  assert.deepEqual(packThrowPose(parcel.launch, 5), stopped)
  assert.equal(save.transformPack(launched, 'Pack2_Advanced', .99).activePacks[1], parcel)
  const slashed = reload(save.hitPack(launched, 1, () => .5))
  assert.equal(slashed.activePacks[1].hp, 1)
  const opened = save.hitPack(slashed, 1, () => .5)
  assert.deepEqual(opened.roster, parcel.cards)
  assert.equal(opened.activePacks.length, 1)
  assert.equal(opened.coins, 1)
}

function verifyPurchasedThrows() {
  const id = 'Pack1_Basic'
  const offer = { id, box: false, cost: 2 }
  const boxed = { id, box: true, cost: 5 }
  let campaign = { ...save.newCampaign(), introComplete: true, shop: [offer, boxed, offer, boxed], coins: 14 }
  campaign.shop.forEach((slot, i) => { campaign = save.buyPack(campaign, slot.id, i, slot.box) })
  const states = [.25, .55, .15, .85, .42, .45, .8, .33, .1, .53, .05, .5, .55, .85, .32, .75, .9, .4, .3, .16]
  const fighting = reload(save.beginChapter(campaign, () => states.shift()))
  assert.equal(fighting.waveStartDelay, 1)
  assert.deepEqual(fighting.activePacks.map(pack => pack.launch.startsAt), [0, 0, 1, 1])
  assert.ok(fighting.activePacks.every(pack => !save.packCanBeHit(pack, 0)))
  assert.ok(!save.packCanBeHit(fighting.activePacks[2], .99))
  assert.ok(fighting.activePacks.every(pack => save.packCanBeHit(pack, 2.5)))

  const openAt = 2.5
  const location = save.packLocation(fighting.activePacks[1], 1, openAt)
  const damaged = save.hitPack(fighting, 1, () => .5, 1, openAt - .2)
  const opened = reload(save.hitPack(damaged, 1, () => .5, 1, openAt))
  const content = opened.activePacks.slice(1, 4)
  assert.equal(content.length, rules.packs[id].boosterBoxPackCount)
  assert.equal(opened.mastery, rules.packs[id].boosterBoxMasteryOnOpen)
  assert.ok(content.every(pack => !pack.box && pack.id === id))
  assert.ok(content.every(pack => pack.launch.fromOpenedBox && !save.packCanBeHit(pack, openAt)))
  assert.ok(content.every(pack => save.packCanBeHit(pack, 3)))
  assert.equal(new Set(content.map(pack => JSON.stringify(pack.launch.target))).size, content.length)
  for (const pack of content) assert.deepEqual(pack.launch.from, location)

  global.window = { location: { search: '' }, localStorage: { getItem: () => JSON.stringify(opened) } }
  try {
    const restored = save.loadCampaign()
    assert.equal(restored.issue, '')
    assert.deepEqual(restored.campaign.activePacks.slice(1, 4).map(pack => save.packLocation(pack, 0, 0)),
      content.map(pack => save.packLocation(pack, 0)))
  } finally {
    delete global.window
  }
}

function verifyDayProgress() {
  for (const [chapter, bossId] of [[1, 'Boss1_Apogre'], [2, 'Boss2_Beast'], [3, 'Boss3_Witch']]) {
    const battle = combat.createBattle([], false, () => .5, chapter)
    const schedule = rules.chapterSchedule(chapter)
    const bossHp = rules.monsters[bossId].maxHP
    const boss = { id: bossId, hp: bossHp / 2, maxHp: bossHp }
    battle.enemies = [boss]
    battle.spawnIndex = schedule.length - 1
    assert.deepEqual(combat.dayProgress(battle), { phase: 'spawn', fill: (schedule.length - 1) / schedule.length })
    battle.spawnIndex++
    const nextHp = chapter === 3 ? rules.monsters.Boss3_Witch2.maxHP : 0
    assert.deepEqual(combat.dayProgress(battle), { phase: 'boss', fill: (bossHp / 2 + nextHp) / (bossHp + nextHp) })
    if (chapter === 3) {
      battle.enemies = []
      battle.respawn = { point: { x: 0, y: 0 }, age: 0, flip: false, revealed: false }
      assert.equal(combat.dayProgress(battle).fill, nextHp / (bossHp + nextHp))
      battle.enemies = [{ id: 'Boss3_Witch2', hp: nextHp * .5, maxHp: nextHp }]
      assert.equal(combat.dayProgress(battle).fill, nextHp * .5 / (bossHp + nextHp))
    }
  }
}

function verifyLegacyVictorySave() {
  const campaign = save.beginChapter(save.newCampaign())
  const rewardId = rules.chapterInfo(1).rewardPack
  const legacy = {
    ...campaign, rewardPacks: 1, packHp: 1,
    activePacks: [{ id: rewardId, hp: 1, reward: true }],
    pendingVictory: { result: 'victory', elapsed: 45, defeated: 76, mastery: 20, coins: 2, rewardPack: true, rewardId }
  }
  delete legacy.pendingUnlock
  const restored = save.parseCampaign(JSON.stringify(legacy))
  assert.equal(restored.resumePhase, 'summary')
  assert.equal(restored.pendingUnlock, rewardId)
  assert.deepEqual(restored.activePacks, [])
  assert.equal(restored.mastery, 20)
  assert.equal(restored.rewardPacks, 1)
  assert.equal(save.settleChapter(restored, restored.summary), restored)
  reload(restored)
}

function verifyCrtLook() {
  const config = require('../src/data/scene-canvas.json')
  const view = {
    preferences: { brightness: 1.1, contrast: .9 },
    battle: { summary: { result: 'victory' } },
    victoryAge: 0
  }
  assert.equal(battleCrtLook(view).distortion, config.crt.distortion)
  view.victoryAge = config.victory.stingerDelay + .1
  const peak = battleCrtLook(view)
  assert.equal(peak.distortion, config.victory.crtDistortion)
  assert.ok(Math.abs(peak.vignette - config.victory.crtVignette) < 1e-9)
  assert.equal(peak.brightness, 1.1 * config.victory.crtBrightness)
  assert.equal(peak.contrast, .9)
  view.victoryAge = config.victory.stingerDelay + config.victory.crtHold + config.victory.crtFadeOut + .01
  assert.equal(battleCrtLook(view).brightness, 1.1)
  assert.deepEqual(crtSamplePoint(.5, .5, peak.distortion), { x: .5, y: .5 })
  assert.ok(crtSamplePoint(.9, .9, config.crt.distortion).x > .9)
  assert.ok(crtSamplePoint(.1, .1, config.crt.distortion).y < .1)
  const corner = crtDisplayPoint(16.44482421875 / 1920, 1 - 13.781982421875 / 1080, config.crt.distortion)
  const source = crtSamplePoint(corner.x, corner.y, config.crt.distortion)
  assert.ok(Math.abs(source.x - 16.44482421875 / 1920) < 1e-6)
  assert.ok(Math.abs(source.y - (1 - 13.781982421875 / 1080)) < 1e-6)
}

function bossFixture(chapter, id) {
  const battle = combat.createBattle([], false, () => .5, chapter)
  const schedule = rules.chapterSchedule(chapter)
  battle.spawnIndex = schedule.findIndex(entry => entry.id === id)
  assert.ok(battle.spawnIndex >= 0)
  battle.elapsed = schedule[battle.spawnIndex].at
  combat.advanceBattle(battle, .001)
  const boss = battle.enemies.find(enemy => enemy.id === id)
  assert.ok(boss)
  battle.enemies = [boss]
  Object.assign(boss, { x: 0, y: 0, attackAt: 0, lunge: null })
  return { battle, boss }
}

function verifyBossMeleeCones() {
  for (const [chapter, id] of [[1, 'Boss1_Apogre'], [2, 'Boss2_Beast'], [3, 'Boss3_Witch']]) {
    const { battle, boss } = bossFixture(chapter, id)
    const length = rules.monsters[id].areaAttack
    const direction = chapter === 2 ? -1 : 1
    const points = [
      { x: .3, y: 0 }, { x: length * .75, y: length * .42 },
      { x: length * .75, y: length * .45 }, { x: -.34, y: 0 }, { x: length + .05, y: 0 }
    ]
    for (const point of points) combat.deployCard(battle, 'Hero1_Squire', { x: point.x * direction, y: point.y }, false)
    const allies = [...battle.allies]
    for (const ally of allies) Object.assign(ally, { stunnedUntil: 1, hp: 100, shield: 0, invulnerableUntil: 0 })
    combat.advanceBattle(battle, .01)
    const damage = rules.monsters[id].attackDamage
    assert.deepEqual(allies.map(ally => ally.hp), [100 - damage, 100 - damage, 100, 100, 100])
    const cone = battle.effects.find(effect => effect.cone)
    assert.deepEqual(cone?.cone, { axis: { x: direction, y: 0 }, length })
    assert.equal(boss.flip, direction > 0)
    if (chapter === 1) assert.ok(battle.sounds.includes('apogre-attack.wav'))
  }
}

function verifyHitTiming() {
  const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
  const damage = rules.monsters.Boss1_Apogre.attackDamage
  combat.deployCard(battle, 'Hero1_Squire', { x: .3, y: 0 }, false)
  const [hero] = battle.allies
  Object.assign(hero, { stunnedUntil: 10, hp: 100, maxHp: 100 })
  const attack = elapsed => {
    Object.assign(boss, { x: 0, y: 0, attackAt: 0, lunge: null })
    combat.advanceBattle(battle, elapsed)
  }
  assert.equal(hero.invulnerableUntil, battle.clock + 1)
  attack(.5)
  assert.equal(hero.hp, 100)
  assert.equal(hero.lastDamageAt, -1)

  attack(.501)
  assert.equal(hero.hp, 100 - damage)
  assert.equal(battle.damageNumbers.entries.find(number => number.target === hero)?.kind, 'taken')
  assert.equal(hero.lastDamageAt, battle.clock)
  assert.equal(hero.invulnerableUntil, battle.clock + .1)
  assert.equal(hero.flashUntil, battle.clock + .06)
  assert.equal(hero.hitUntil, battle.clock + .2)
  attack(.05)
  assert.equal(hero.hp, 100 - damage)
  assert.ok(hero.flashUntil > battle.clock)
  attack(.051)
  assert.equal(hero.hp, 100 - 2 * damage)

  const hitBoss = () => {
    battle.nextPulse = battle.clock
    assert.equal(combat.pulse(battle, { x: boss.x, y: boss.y, radius: .1 }), true)
  }
  hitBoss()
  const firstDamage = boss.lastDamageAt
  const number = battle.damageNumbers.entries.find(number => number.target === boss)
  assert.ok(number)
  assert.equal(boss.hitUntil, firstDamage + .2)
  combat.advanceBattle(battle, .25)
  hitBoss()
  assert.ok(boss.lastDamageAt > firstDamage)
  assert.equal(number.amount, 2 * battle.cursorDamagePerTick)
  assert.equal(boss.flashUntil, battle.clock + .06)
  assert.equal(boss.hitUntil, firstDamage + .2)
  combat.advanceBattle(battle, .251)
  hitBoss()
  assert.equal(boss.hitUntil, battle.clock + .2)
}

function verifyDamageNumbers() {
  const target = { x: 1, y: 1, hp: 100 }
  const state = createDamageNumbers()
  showDamageNumber(state, target, .65, 'damage', target)
  const [first] = state.entries
  assert.equal(damageNumberLook(first, state.clock).text, '6')
  assert.equal(damageNumberLook(first, state.clock).alpha, 0)
  target.x = 3
  advanceDamageNumbers(state, .2)
  assert.equal(first.anchor.x, 3)
  showDamageNumber(state, target, .55, 'crit', target)
  showDamageNumber(state, target, 1, 'taken', target)
  assert.equal(state.entries.length, 2)
  assert.equal(damageNumberLook(first, state.clock).text, '12')
  assert.equal(first.critical, true)
  assert.ok(damageNumberLook(first, state.clock).alpha > 0)
  advanceDamageNumbers(state, .501)
  assert.ok(state.entries.every(number => number.fall !== null))
  advanceDamageNumbers(state, .101)
  assert.equal(state.entries.length, 0)

  const bigOnly = createDamageNumbers('big')
  showDamageNumber(bigOnly, target, 1, 'damage', target)
  assert.equal(bigOnly.entries[0].shown, null)
  showDamageNumber(bigOnly, target, 1, 'damage', target)
  assert.equal(bigOnly.entries[0].shown, 0)
  bigOnly.mode = 'off'
  advanceDamageNumbers(bigOnly, .001)
  showDamageNumber(bigOnly, target, 100, 'damage', target)
  assert.equal(bigOnly.entries.length, 0)
}

function verifyTowerFeedback() {
  const { battle, boss: attacker } = bossFixture(1, 'Monster1_Caveling')
  const config = rules.towerArt.native
  const damage = rules.monsters.Monster1_Caveling.attackDamageToTower
  const attack = (elapsed) => {
    Object.assign(attacker, { ...rules.bonfire, lunge: null, attackAt: battle.clock })
    combat.advanceBattle(battle, elapsed)
  }

  attack(.001)
  assert.equal(battle.towerHp, battle.towerMaxHp - damage)
  const [hit] = battle.towerHits
  const [popup] = battle.damageNumbers.entries
  assert.equal(hit.at, battle.animationClock)
  assert.equal(hit.fatal, false)
  assert.equal(popup.amount, damage)
  assert.equal(popup.target, battle.towerPopupTarget)
  assert.equal(popup.kind, 'taken')
  assert.equal(battle.towerCamera.at, hit.at)
  assert.equal(battle.towerCamera.amplitude, config.towerHitCameraShakeAmplitude)

  attack(.15)
  assert.equal(battle.towerCamera.at, hit.at)
  assert.equal(popup.amount, 2 * damage)
  assert.equal(battle.damageNumbers.entries.length, 1)
  attack(.11)
  assert.equal(battle.towerCamera.at, battle.animationClock)
  assert.ok(battle.towerCamera.amplitude < config.towerHitCameraShakeAmplitude)
  combat.advanceBattleVisuals(battle, .601)
  assert.equal(battle.towerHits.length, 0)

  battle.towerHp = damage / 2
  attack(.001)
  assert.equal(battle.towerHp, 0)
  assert.equal(battle.summary.result, 'defeat')
  assert.equal(battle.towerHits.at(-1).fatal, true)
  assert.equal(battle.towerCamera.amplitude, config.towerDestroyedCameraShakeAmplitude)
  assert.equal(battle.damageNumbers.entries.at(-1).amount, damage)
  combat.advanceBattleVisuals(battle, .001)
  assert.equal(battle.damageNumbers.entries.at(-1).target, null)
  const summary = battle.summary
  const elapsed = battle.elapsed
  const clock = battle.clock
  combat.advanceDefeatVisuals(battle, defeatWorldAge(1.2))
  assert.ok(Math.abs(battle.clock - clock - .18) < 1e-9)
  assert.equal(battle.elapsed, elapsed)
  assert.equal(battle.summary, summary)
  assert.equal(defeatZoomProgress(.6), .5)
  assert.equal(defeatZoomProgress(1.2), 1)
  assert.ok(Math.abs(defeatWorldAge(1.4) - .38) < 1e-9)
  const timing = defeatSummaryTiming({ ...summary, elapsed: 15, packsOpened: 0, mastery: 10, coins: 0, unitStats: [] })
  assert.equal(timing.rows[1].at, timing.rows[2].at)
  assert.ok(Math.abs(timing.continueAt - 1.95) < 1e-9)
}

function verifyUnitMotion() {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
    `expected ${actual} to be near ${expected}`)
  const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
  Object.assign(boss, { x: .4, y: 0, stunnedUntil: 5 })
  combat.deployCard(battle, 'Hero1_Squire', { x: 0, y: 0 }, false)
  combat.deployCard(battle, 'Hero1_Archer', { x: 0, y: .4 }, false)
  combat.advanceBattle(battle, .001)
  const [squire, archer] = battle.allies
  assert.ok(squire.lunge)
  assert.equal(archer.lunge, null)
  near(archer.attackedUntil - battle.clock, .24)
  combat.advanceBattle(battle, .06)
  near(squire.x, .09)
  near(archer.x, 0)
  combat.advanceBattle(battle, .06)
  near(squire.x, .18)
  combat.advanceBattle(battle, .08)
  near(squire.x, .09)
  combat.advanceBattle(battle, .08001)
  near(squire.x, 0)
  assert.equal(squire.lunge, null)

  Object.assign(boss, { attackAt: 0, stunnedUntil: 0 })
  Object.assign(squire, { hp: .01, invulnerableUntil: 0, stunnedUntil: 2 })
  Object.assign(archer, { x: -2, y: 0, stunnedUntil: 2 })
  combat.advanceBattle(battle, .01)
  const hero = battle.fallen[0]
  assert.equal(hero.id, 'Hero1_Squire')
  assert.equal(hero.kind, 'hero')
  assert.deepEqual(hero.direction, { x: -1, y: 0 })
  assert.equal(fallenUnitPose(hero, .15, .5, true).frame, 2)
  near(fallenUnitPose(hero, .15, .5, true).x, -.0125)
  assert.equal(fallenUnitPose(hero, .3, .5, true).frame, 3)
  const held = fallenUnitPose(hero, 2, .5, true)
  near(held.x, -.3)
  near(held.alpha, 61 / 255)
  near(fallenUnitPose(hero, 4.3, .5, true).alpha, held.alpha / 2)
  const time = battle.clock
  combat.advanceBattleVisuals(battle, fallenLifetime(hero) + .001)
  assert.equal(battle.fallen.length, 0)
  assert.equal(battle.clock, time)

  const waves = combat.createBattle([], false, () => .5)
  const schedule = rules.chapterSchedule(1)
  waves.spawnIndex = schedule.findIndex(entry => entry.id === 'Monster1_Caveling')
  waves.elapsed = schedule[waves.spawnIndex].at
  combat.advanceBattle(waves, .001)
  const enemy = waves.enemies.find(unit => unit.id === 'Monster1_Caveling')
  Object.assign(enemy, { x: 2, y: 1, hp: .01 })
  waves.nextPulse = waves.clock
  assert.equal(combat.pulse(waves, { x: 1.8, y: 1, radius: .25 }), true)
  const monster = waves.fallen[0]
  assert.deepEqual(monster.direction, { x: 1, y: 0 })
  assert.equal(fallenUnitPose(monster, .05, 0, true).frame, 2)
  assert.equal(fallenUnitPose(monster, .1, 0, true).frame, 3)
  const monsterHeld = fallenUnitPose(monster, 1.5, 0, true)
  near(monsterHeld.x, 2.3)
  near(monsterHeld.alpha, 60 / 255)
  near(fallenLifetime(monster), 2.9)
}

const groundCombatHeroes = Object.keys(rules.heroes).filter(id => id !== 'Hero3_Portal' && id !== 'Hero3_Illusionist')

function verifyHeroFacing() {
  for (const id of groundCombatHeroes) {
    for (const direction of [-1, 1]) {
      const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
      battle.spawnIndex = rules.chapterSchedule(1).length
      Object.assign(boss, { x: (rules.heroes[id].attackRange + 1) * direction, y: 0, stunnedUntil: battle.clock + 5 })
      combat.deployCard(battle, id, { x: 0, y: 0 }, false)
      const [unit] = battle.allies
      combat.advanceBattle(battle, .05)
      assert.ok(unit.x * direction > 0, `${id} should move toward the enemy`)
      assert.equal(unit.flip, direction > 0, `${id} should face the enemy`)

      battle.enemies.length = 0
      const position = rules.formation(unit.uid)
      const farX = position.x + direction
      Object.assign(unit, { x: farX, y: position.y })
      combat.advanceBattle(battle, .05)
      assert.ok((unit.x - farX) * direction < 0, `${id} should return to formation`)
      assert.equal(unit.flip, direction < 0, `${id} should face its formation slot`)
    }
  }
}

function verifyHeroBattlefieldBounds() {
  const { width, height } = rules.world
  for (const id of groundCombatHeroes) {
    const far = rules.heroes[id].attackRange + 1.4
    for (const [axis, edge] of [['x', width / 2], ['y', height / 2]]) {
      for (const direction of [-1, 1]) {
        const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
        battle.spawnIndex = rules.chapterSchedule(1).length
        Object.assign(boss, { x: 0, y: 0, [axis]: direction * (edge + far), stunnedUntil: battle.clock + 10 })
        combat.deployCard(battle, id, { x: 0, y: 0, [axis]: direction * (edge - .4) }, false)
        const [unit] = battle.allies
        unit.spellAt = battle.clock + 10
        for (let step = 0; step < 60; step++) {
          combat.advanceBattle(battle, .05)
          assert.ok(Math.abs(unit[axis]) <= edge, `${id} should stay onscreen while chasing on ${axis}`)
        }
        assert.equal(unit[axis] * direction, edge)
        assert.equal(boss.hp, boss.maxHp)

        Object.assign(unit, { x: 0, y: 0, [axis]: direction * (edge - .1) })
        boss[axis] = direction * (edge + (id === 'Hero2_Monk' ? -.05 : .05))
        combat.advanceBattle(battle, .01)
        assert.ok(unit.attackAt > battle.clock, `${id} should attack enemies in reach at the edge on ${axis}`)
        for (let step = 0; step < 6; step++) {
          combat.advanceBattle(battle, .05)
          assert.ok(Math.abs(unit[axis]) <= edge, `${id} should stay onscreen during its attack on ${axis}`)
        }
      }
    }
  }
}

function verifyProjectiles() {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7)
  function prepare(chapter, bossId, heroId, targetX, {
    targetY = 0, origin = { x: 0, y: 0 }, foil = false, casts = 0
  } = {}) {
    const { battle, boss } = bossFixture(chapter, bossId)
    Object.assign(boss, { x: targetX, y: targetY, stunnedUntil: 10 })
    battle.spawnIndex = rules.chapterSchedule(chapter).length
    if (casts) battle.modifiers = { ...battle.modifiers, modifiersFor: () => ({ casts }) }
    combat.deployCard(battle, heroId, origin, false, { foil })
    combat.advanceBattle(battle, .001)
    return { battle, boss, shot: battle.projectiles[0] }
  }

  const archer = prepare(1, 'Boss1_Apogre', 'Hero1_Archer', 1)
  const arrow = archer.shot
  assert.equal(arrow.kind, 'arrow')
  near(arrow.duration, .125)
  const arrowHp = archer.boss.hp
  archer.boss.x = 1.4
  combat.advanceBattle(archer.battle, .05)
  near(arrow.x, .56)
  assert.equal(archer.boss.hp, arrowHp)
  combat.advanceBattle(archer.battle, .07)
  assert.equal(archer.battle.projectiles.length, 0)
  near(archer.boss.hp, arrowHp - rules.heroes.Hero1_Archer.attackDamage)

  const rebound = prepare(1, 'Boss1_Apogre', 'Hero1_Archer', 1)
  rebound.shot.bounces = 1
  const second = { ...rebound.boss, uid: 1003, x: 1.65, hp: 20, maxHp: 20 }
  rebound.battle.enemies.push(second)
  combat.advanceBattle(rebound.battle, .125)
  assert.equal(rebound.shot.target, second)
  assert.equal(rebound.shot.bounces, 0)
  assert.equal(second.hp, 20)
  combat.advanceBattle(rebound.battle, .085)
  near(second.hp, 20 - rules.heroes.Hero1_Archer.attackDamage)
  assert.equal(rebound.battle.projectiles.length, 0)

  const wizard = prepare(2, 'Boss2_Beast', 'Hero2_Pyromancer', 1.5)
  const fireball = wizard.shot
  const originalHp = wizard.boss.hp
  assert.equal(fireball.kind, 'fireball')
  combat.advanceBattle(wizard.battle, .1)
  near(fireball.x, .6)
  assert.equal(wizard.boss.hp, originalHp)
  wizard.boss.hp = 0
  const best = { ...wizard.boss, uid: 1000, x: 1.5, y: .3, hp: 30, maxHp: 30 }
  const weaker = { ...wizard.boss, uid: 1001, x: 2.5, y: 0, hp: 20, maxHp: 20 }
  wizard.battle.enemies.push(weaker, best)
  combat.advanceBattle(wizard.battle, .08)
  assert.equal(fireball.target, best)
  assert.equal(best.hp, 30)
  combat.advanceBattle(wizard.battle, .09)
  near(best.hp, 30 - rules.heroes.Hero2_Pyromancer.attackDamage)
  assert.equal(weaker.hp, 20)
  assert.equal(wizard.battle.projectileEffects.filter(event => event.kind === 'fireGround').length, 7)
  assert.ok(wizard.battle.sounds.includes('chapter-2-3/618-11_wizard_fireball_explosion.wav'))

  const double = prepare(2, 'Boss2_Beast', 'Hero2_Pyromancer', 1.5, { casts: 1 })
  assert.equal(double.battle.spellCounts.Spell_Fireball, 2)
  const [forward, backward] = double.battle.projectiles
  near(forward.direction.x, 1)
  near(backward.direction.x, -1)
  near(backward.direction.y, 0)
  near(backward.duration, .5)
  const doubleHp = double.boss.hp
  combat.advanceBattle(double.battle, .1)
  assert.equal(double.boss.hp, doubleHp)
  combat.advanceBattle(double.battle, .1)
  near(forward.x, 1.2)
  near(double.boss.hp, doubleHp - rules.heroes.Hero2_Pyromancer.attackDamage)
  assert.deepEqual(double.battle.projectiles, [backward])
  double.boss.y = .6
  for (let i = 0; i < 3; i++) combat.advanceBattle(double.battle, .1)
  near(backward.x, -3)
  near(backward.y, 0)
  assert.equal(double.battle.projectiles.length, 0)
  assert.equal(double.battle.projectileEffects.filter(event => event.kind === 'fireBurst').length, 2)

  for (const casts of [0, 1]) {
    const foil = prepare(2, 'Boss2_Beast', 'Hero2_Pyromancer', 1.5, { foil: true, casts })
    const count = 3 + casts
    assert.equal(foil.battle.spellCounts.Spell_Fireball, count)
    assert.equal(foil.battle.projectiles.length, count)
    foil.battle.projectiles.forEach((shot, index) => {
      const angle = index * 2 * Math.PI / count
      near(shot.direction.x, Math.cos(angle))
      near(shot.direction.y, Math.sin(angle))
    })
  }

  const doctor = prepare(3, 'Boss3_Witch', 'Hero3_WitchDoctor', 1.25)
  const bomb = doctor.shot
  assert.equal(bomb.kind, 'infection')
  doctor.boss.x = 2.4
  combat.advanceBattle(doctor.battle, .45)
  near(bomb.x, .625)
  near(bomb.y, .625)
  assert.equal(doctor.boss.infection, null)
  const landing = { ...doctor.boss, uid: 1002, x: 1.25, y: 0, hp: 50, maxHp: 50 }
  doctor.battle.enemies.push(landing)
  combat.advanceBattle(doctor.battle, .45)
  assert.equal(doctor.boss.infection, null)
  assert.equal(landing.infection.stacks, 1)
  assert.equal(landing.hp, 50)
  combat.advanceBattle(doctor.battle, .01)
  near(landing.hp, 50 - rules.heroes.Hero3_WitchDoctor.attackDamage)
  assert.ok(doctor.battle.sounds.includes('chapter-2-3/582-05_alchemy_glass_break.wav'))

  const volley = prepare(3, 'Boss3_Witch', 'Hero3_WitchDoctor', 0, {
    targetY: 2.45, origin: { x: 0, y: 1.8 }, foil: true
  })
  const [north, south] = volley.battle.projectiles
  assert.equal(volley.battle.spellCounts.Spell_InfectionBomb, 2)
  near(north.landing.x, 0)
  near(south.landing.x, 0)
  near(north.landing.y, 2)
  near(south.landing.y, 1.8 - rules.heroes.Hero3_WitchDoctor.attackRange)
  const targets = [north, south].map((shot, index) => ({
    ...volley.boss, ...shot.landing, uid: 1004 + index, hp: 50, maxHp: 50
  }))
  volley.boss.x = 2.4
  volley.battle.enemies.push(...targets)
  combat.advanceBattle(volley.battle, .45)
  assert.ok(targets.every(target => target.infection === null))
  combat.advanceBattle(volley.battle, .45)
  assert.deepEqual(targets.map(target => target.infection?.stacks), [1, 1])
  assert.equal(volley.boss.infection, null)
  assert.equal(volley.battle.projectiles.length, 0)
  combat.advanceBattle(volley.battle, .01)
  for (const target of targets) near(target.hp, 50 - rules.heroes.Hero3_WitchDoctor.attackDamage)
}

function verifyMonkDash() {
  const { battle, boss } = bossFixture(2, 'Boss2_Beast')
  battle.spawnIndex = rules.chapterSchedule(2).length
  battle.modifiers = { ...battle.modifiers, effect: (id, hero) => hero === 'Hero2_Monk' && (id === 46 || id === 132) ? 1 : 0 }
  const makeTarget = (uid, x, hp) => ({
    ...boss, uid, x, y: 0, hp, maxHp: hp, stunnedUntil: 100, id: 'Monster2_Overseer'
  })
  const targets = [
    makeTarget(801, .58, 50), makeTarget(802, 1.8, 1),
    makeTarget(803, -.5, 50), makeTarget(804, -1.46, 50),
    makeTarget(805, 3.6, 50), makeTarget(806, 5, 50)
  ]
  battle.enemies = targets.slice()
  combat.deployCard(battle, 'Hero2_Monk', { x: 0, y: 0 }, false)
  const monk = battle.allies[0]
  combat.advanceBattle(battle, .001)
  assert.equal(battle.spellCounts.Spell_Dash, 1)
  assert.ok(battle.sounds.includes('chapter-2-3/465-rogue_throw_toss.wav'))
  assert.equal(monk.dash.leg.target, targets[1])
  assert.equal(monk.dash.legs, 3)
  assert.ok(Math.abs(monk.x - .0072) < 1e-7)
  assert.deepEqual(targets.map(target => target.hp), [50, 1, 50, 50, 50, 50])
  combat.advanceBattle(battle, .1)
  assert.equal(targets[1].hp, 1)
  assert.ok(battle.dashTrails[0].length > 1)

  const damage = rules.heroes.Hero2_Monk.attackDamage
  for (let i = 0; i < 500 && monk.dash; i++) combat.advanceBattle(battle, .01)
  assert.equal(monk.dash, null)
  assert.ok(battle.sounds.includes('chapter-2-3/451-40_block_04.wav'))
  assert.equal(targets[1].hp, 0)
  assert.equal(monk.extraDashes, 1)
  assert.equal(monk.kills, 1)
  assert.equal(targets.filter(target => target.hp === 50 - damage).length, 3)
  assert.equal(targets[5].hp, 50)
  assert.equal(battle.spellCounts.Spell_Dash, 1)
  assert.ok(Math.abs(monk.attackAt - battle.clock - rules.heroes.Hero2_Monk.attackCooldown) < .002)
  combat.advanceBattle(battle, .15)
  assert.equal(battle.dashTrails.length, 0)
  monk.attackAt = battle.clock
  combat.advanceBattle(battle, .001)
  assert.equal(battle.spellCounts.Spell_Dash, 2)
  assert.equal(monk.dash.legs, 4)

  const foil = bossFixture(2, 'Boss2_Beast')
  foil.battle.spawnIndex = rules.chapterSchedule(2).length
  foil.boss.x = .48
  combat.deployCard(foil.battle, 'Hero2_Monk', { x: 0, y: 0 }, false, { foil: true })
  const foilMonk = foil.battle.allies[0]
  foilMonk.invulnerableUntil = 0
  combat.advanceBattle(foil.battle, .001)
  assert.ok(Math.abs(foilMonk.x - .0108) < 1e-7)
  assert.equal(foilMonk.attackPeriod, rules.heroes.Hero2_Monk.attackCooldown / 2)
  assert.ok(foil.boss.attackedUntil > foil.battle.clock)
  assert.equal(foilMonk.hp, foilMonk.maxHp)
}

function verifyMonkKnockback() {
  const { battle, boss } = bossFixture(2, 'Boss2_Beast')
  const point = { x: 1.2, y: .5 }
  const enemy = { ...boss, ...point, id: 'Monster2_Overseer', hp: 50, maxHp: 50, stunnedUntil: 100 }
  battle.enemies = [enemy]
  battle.spawnIndex = rules.chapterSchedule(2).length
  combat.deployCard(battle, 'Hero2_Monk', { x: .1, y: .5 }, false)
  const dt = .01
  for (let i = 0; i < 100 && enemy.hp === 50; i++) combat.advanceBattle(battle, dt)
  assert.equal(enemy.hp, 50 - rules.heroes.Hero2_Monk.attackDamage)
  const impulse = 1.5 * 1.65 * rules.monsters.Monster2_Overseer.knockbackReceivedMultiplier
  const decay = Math.exp(-10 * dt)
  assert.ok(Math.abs(enemy.x - point.x - impulse * decay * dt) < 1e-7)
  assert.equal(enemy.y, point.y)
  assert.ok(Math.abs(enemy.knockback.x - impulse * decay) < 1e-7)
  combat.advanceBattle(battle, dt)
  assert.ok(Math.abs(enemy.knockback.x - impulse * decay ** 2) < 1e-7)
  assert.ok(Math.abs(enemy.x - point.x - impulse * (decay + decay ** 2) * dt) < 1e-7)

  for (const [chapter, id] of [[1, 'Boss1_Apogre'], [2, 'Boss2_Beast'], [3, 'Boss3_Witch']]) {
    const fixture = bossFixture(chapter, id)
    const hp = fixture.boss.hp
    Object.assign(fixture.boss, { x: 1.15, y: .4, stunnedUntil: 100 })
    fixture.battle.spawnIndex = rules.chapterSchedule(chapter).length
    combat.deployCard(fixture.battle, 'Hero2_Monk', { x: 0, y: .4 }, false)
    for (let i = 0; i < 100 && fixture.boss.hp === hp; i++) combat.advanceBattle(fixture.battle, dt)
    assert.ok(fixture.boss.hp < hp)
    assert.equal(fixture.boss.knockback, null)
    assert.equal(fixture.boss.x, 1.15)
    assert.equal(fixture.boss.y, .4)
  }
}

function verifyWitchSummons() {
  const { battle, boss } = bossFixture(3, 'Boss3_Witch')
  const stats = rules.monsters.Boss3_Witch.native
  boss.spellAt = battle.clock + .01
  combat.advanceBattle(battle, .015)
  const start = battle.clock
  assert.equal(boss.castUntil, start + stats.necromancerCastDuration)
  assert.equal(boss.spellAt, start + stats.necromancerCastDuration + stats.necromancerSummonInterval)
  assert.equal(boss.pendingShadows, 9)
  assert.ok(battle.sounds.includes(rules.monsters.Boss3_Witch.sounds.necromancerSummonSFX))
  const shadowCount = () => battle.enemies.filter(enemy => enemy.id === 'Monster3_Shadow').length
  assert.equal(shadowCount(), 0)
  const before = shadowCount()
  for (const spawned of [2, 4, 6, 8, 9]) {
    combat.advanceBattle(battle, .016)
    assert.equal(shadowCount() - before, spawned)
    assert.equal(boss.pendingShadows, 9 - spawned)
    assert.deepEqual({ x: boss.x, y: boss.y }, { x: 0, y: 0 })
  }
}

function verifyPortalSummons() {
  const portalId = 'Hero3_Portal'
  const definition = rules.heroes[portalId]
  const native = definition.native
  const roster = ['Hero1_Squire', 'Hero1_Squire', 'Hero1_Archer', portalId, 'Hero_Skeleton']
  const create = (modifier = 0, foil = false) => {
    const battle = combat.createBattle([], false, () => .6, 3, undefined, [], { collection: roster })
    battle.elapsed = -100
    battle.modifiers = { ...battle.modifiers, effect: (id, hero) =>
      hero === portalId ? (id === 113 ? modifier : id === 2 ? .25 * modifier : 0) : 0 }
    combat.deployCard(battle, portalId, rules.bonfire, false, { foil })
    return battle
  }

  const battle = create()
  const portal = battle.allies[0]
  assert.equal(portal.spellAt, 10)
  assert.equal(create(1).allies[0].spellAt, 8)
  assert.equal(create(1, true).allies[0].spellAt, 4)
  const orbit = create()
  combat.deployCard(orbit, portalId, rules.bonfire, false)
  combat.advanceBattle(orbit, .1)
  assert.ok(orbit.allies[0].x > rules.bonfire.x)
  assert.ok(orbit.allies[1].x < rules.bonfire.x)
  for (const actor of orbit.allies) {
    assert.ok(Math.abs(Math.hypot(actor.x - rules.bonfire.x, actor.y - rules.bonfire.y) - .05) < 1e-7)
  }

  combat.advanceBattle(battle, 9.99)
  assert.equal(battle.allies.length, 1)
  combat.advanceBattle(battle, .01)
  assert.equal(battle.spellCounts.Spell_SpawnerSummon, 1)
  assert.equal(battle.enemies.length, 0)
  assert.equal(battle.allies[1].id, 'Hero1_Squire')
  assert.ok(Math.abs(Math.hypot(battle.allies[1].x - portal.x, battle.allies[1].y - portal.y) - .35 * Math.sqrt(.6)) < 1e-7)
  assert.ok(battle.sounds.includes('chapter-2-3/588-sfx_movement_portal6.wav'))
  const idleAge = portal.portalIdleAge
  combat.advanceBattle(battle, .06)
  assert.equal(portal.portalIdleAge, idleAge)
  combat.advanceBattle(battle, 9.94)
  assert.equal(battle.spellCounts.Spell_SpawnerSummon, 2)
  for (let count = 2; count < native.spawnerMaxSummons; count++) combat.advanceBattle(battle, 10)
  assert.equal(battle.spellCounts.Spell_SpawnerSummon, native.spawnerMaxSummons)
  assert.equal(battle.allies.length, native.spawnerMaxSummons)
  assert.equal(battle.allies.some(unit => unit.id === portalId), false)
  assert.equal(battle.expiringPortals.length, 1)
  assert.equal(battle.fallen.length, 0)
  combat.advanceBattleVisuals(battle, .99)
  assert.equal(battle.expiringPortals.length, 1)
  combat.advanceBattleVisuals(battle, .02)
  assert.equal(battle.expiringPortals.length, 0)
  combat.advanceBattle(battle, 10)
  assert.equal(battle.spellCounts.Spell_SpawnerSummon, native.spawnerMaxSummons)

  const upgraded = create(1)
  combat.advanceBattle(upgraded, 8)
  assert.equal(upgraded.allies[1].id, 'Hero1_Archer')
  assert.deepEqual([0, .125, .25, .375].map(portalIdleSprite), [
    'chapter-2-3/710-special_portal_0.png',
    'chapter-2-3/677-special_portal_1.png',
    'chapter-2-3/702-special_portal_2.png',
    'chapter-2-3/710-special_portal_0.png'
  ])
  assert.equal(portalCastScale(native.spawnerCastPopDuration * .3), native.spawnerCastPopScale)
  assert.equal(portalCastScale(native.spawnerCastPopDuration), 1)
  assert.equal(portalExpireScale(.2), native.spawnerCastPopScale)
  assert.equal(portalExpireScale(native.spawnerExpireDuration), 0)
}

function verifyIllusionistMirrors() {
  const id = 'Hero3_Illusionist'
  const definition = rules.heroes[id]
  const { battle, boss } = bossFixture(3, 'Boss3_Witch')
  battle.random = () => .6
  battle.modifiers = {
    ...battle.modifiers,
    effect: (effect, hero, pack) => {
      if (hero !== id) return 0
      if (effect === 129) return 2
      if (effect === 131 && pack === 'Pack3_Magic') return .02
      return effect === 140 || effect === 141 ? .4 : 0
    },
    modifiersFor: hero => hero === id ? { attackDamage: 1.25 } : {}
  }
  const position = { x: .2, y: .5 }
  combat.deployCard(battle, id, position, true, { foil: true })
  const [principal, first, middle, last] = battle.allies
  assert.equal(battle.allies.length, 4)
  assert.equal(principal.hp, 2 * definition.maxHP)
  for (const mirror of [first, middle, last]) {
    assert.equal(mirror.illusionistPrincipal, principal.uid)
    assert.equal(mirror.foil, true)
    assert.ok(Math.hypot(mirror.x - position.x, mirror.y - position.y) <= .4)
  }
  assert.ok(Math.abs(combat.masteryIncomeMultiplier(battle) - 1.36) < 1e-7)
  combat.deployCard(battle, id, position, false)
  const otherPrincipal = battle.allies.at(-1)
  assert.equal(battle.allies.length, 5)
  assert.equal(otherPrincipal.illusionistPrincipal, null)

  const orbit = bossFixture(3, 'Boss3_Witch')
  orbit.boss.stunnedUntil = 100
  const side = { x: rules.bonfire.x - 1, y: rules.bonfire.y }
  Object.assign(orbit.boss, { x: side.x - 1, y: side.y })
  combat.deployCard(orbit.battle, id, side, false)
  const orbiting = orbit.battle.allies[0]
  combat.advanceBattle(orbit.battle, .1)
  assert.ok(orbiting.x > side.x)
  assert.ok(Math.abs(Math.hypot(orbiting.x - side.x, orbiting.y - side.y) - definition.moveSpeed * .1) < 1e-7)
  assert.equal(boss.hp, rules.monsters.Boss3_Witch.maxHP)

  for (const unit of [first, middle, last, otherPrincipal]) Object.assign(unit, { x: 3.5, y: -1.5, stunnedUntil: 10 })
  Object.assign(principal, { hp: 1, invulnerableUntil: 0, stunnedUntil: 10 })
  Object.assign(boss, { x: position.x - .2, y: position.y, spellAt: 99, hp: 500, maxHp: 500 })
  const inside = { ...boss, id: 'Monster3_Shadow', uid: 998, x: position.x + .69, stunnedUntil: 10 }
  const outside = { ...inside, uid: 999, x: position.x + .71 }
  battle.enemies.push(inside, outside)
  combat.advanceBattle(battle, .01)
  const damage = definition.attackDamage * 1.25 * 1.4
  assert.equal(principal.hp, 0)
  assert.equal(middle.illusionistPrincipal, null)
  assert.equal(first.illusionistPrincipal, middle.uid)
  assert.equal(last.illusionistPrincipal, middle.uid)
  assert.equal(otherPrincipal.illusionistPrincipal, null)
  assert.equal(boss.hp, 500 - damage)
  assert.equal(inside.hp, 500 - damage)
  assert.equal(outside.hp, 500)
  assert.equal(battle.illusionistBlasts.length, 3)
  assert.equal(battle.spellCounts.Spell_AoeCircle, 1)
  assert.ok(battle.sounds.includes('chapter-2-3/458-14_wizard_teleport_arrive.wav'))
  assert.ok(battle.sounds.includes(definition.sounds.defeatSFX))
  assert.ok(Math.abs(combat.masteryIncomeMultiplier(battle) - 1.34) < 1e-7)

  Object.assign(first, { x: position.x, y: position.y, hp: 1, invulnerableUntil: 0 })
  Object.assign(boss, { x: position.x - .2, y: position.y, attackAt: 0, lunge: null })
  combat.advanceBattle(battle, .01)
  assert.equal(first.hp, 0)
  assert.equal(middle.illusionistPrincipal, null)
  assert.equal(last.illusionistPrincipal, middle.uid)
  assert.equal(battle.spellCounts.Spell_AoeCircle, 2)
  combat.advanceBattleVisuals(battle, 1.21)
  assert.equal(battle.illusionistBlasts.length, 0)

  const nodes = ['SN_IllusionistPackClones', 'SN_IllusionistPackClones2'].map(key =>
    upgrades.upgradeCells.find(cell => cell.definition.key === key))
  const campaign = {
    ...save.beginChapter({ ...save.newCampaign(), dayNumber: 3, introComplete: true }),
    upgradeLevels: Object.fromEntries(nodes.map(node => [node.id, 1])),
    activePacks: [{ id: 'Pack3_Magic', hp: 1, box: false, cards: [id], foil: true }]
  }
  const base = save.hitPack(campaign, 0, () => 0)
  const boosted = reload(save.hitPack(campaign, 0, () => 0, 1.36))
  assert.equal(boosted.mastery, Math.round(base.mastery * 1.36))
  assert.equal(boosted.upgradeCounters['hero:' + id], 4)
  assert.deepEqual(boosted.roster, [id])
}

function verifyMasterySurge() {
  const id = 'Hero3_Illusionist'
  const battle = combat.createBattle([], false, () => .5, 3)
  battle.modifiers = {
    ...battle.modifiers,
    effect: (effect, target, pack) => {
      if (effect === 98) return 1
      if (effect === 129 && target === id) return 6
      if (effect === 131 && target === id && pack === 'Pack3_Magic') return .04
      if (effect === 542) return .25
      return 0
    }
  }
  assert.equal(combat.masterySurgePercent(battle), null)
  battle.elapsed = -100
  combat.deployCard(battle, id, rules.bonfire)
  assert.equal(combat.masterySurgePercent(battle), 163)
  const first = openFieldTome(battle, 'Tome_Thunderstorm')
  assert.equal(combat.masterySurgePercent(battle), 313)
  assert.equal(rules.applyMasteryIncome(100, combat.masteryIncomeMultiplier(battle)), 313)
  battle.clock = first.startedAt + 6
  const second = openFieldTome(battle, 'Tome_RaiseDead')
  assert.equal(combat.masterySurgePercent(battle), 313)
  battle.clock = first.until
  assert.equal(combat.masterySurgePercent(battle), 313)
  combat.advanceBattleVisuals(battle, 2)
  assert.equal(combat.masterySurgePercent(battle), 313)
  battle.clock = second.until
  assert.equal(combat.masterySurgePercent(battle), 163)
  combat.deployCard(battle, 'Hero1_Squire', rules.bonfire, false, { foil: true })
  assert.equal(combat.masterySurgePercent(battle), 188)
  battle.allies.at(-1).hp = 0
  assert.equal(combat.masterySurgePercent(battle), 163)
  battle.allies.length = 0
  assert.equal(combat.masterySurgePercent(battle), null)

  const { battle: kill, boss } = bossFixture(1, 'Boss1_Apogre')
  const around = { x: boss.x, y: boss.y, radius: .3 }
  boss.stunnedUntil = 10
  openFieldTome(kill, 'Tome_Thunderstorm')
  assert.equal(combat.masterySurgePercent(kill), 150)
  const reward = rules.monsters[boss.id].masteryRewardPer10PercentDamage * rules.chapterInfo(1).enemyKillMasteryMultiplier
  kill.nextPulse = kill.clock
  kill.cursorDamagePerTick = boss.maxHp * .101
  const previous = kill.mastery
  combat.pulse(kill, around)
  assert.equal(kill.mastery - previous, rules.applyMasteryIncome(reward, 1.5))
}

function openFieldTome(battle, id, traits) {
  combat.deployCard(battle, id, { x: -2, y: -1 }, true, traits)
  const tome = battle.fieldTomes.at(-1)
  const target = { x: tome.x, y: tome.y, radius: .15 }
  combat.advanceBattle(battle, .38)
  battle.nextPulse = battle.clock
  assert.equal(combat.pulse(battle, target), true)
  combat.advanceBattle(battle, battle.pulseInterval)
  assert.equal(combat.pulse(battle, target), true)
  combat.advanceBattle(battle, .55)
  return battle.tomes.find(active => active.uid === tome.uid)
}

function verifyCursorFrenzy() {
  const id = rules.frenzyTome
  assert.equal(rules.cardArt(id), rules.tomes[id].hudSprite)
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '../src/assets', rules.cardArt(id))))
  const levels = { 'SN_TomeBonusChance@27,34': 1, 'SN_TomeCursorAttackDamage@27,35': 1,
    'SN_TomeCursorAttackSpeed@27,33': 1, 'SN_TomeCursorAttackSpeed 1@30,34': 1 }
  const prepare = { ...save.newCampaign(), introComplete: true, dayNumber: 2, upgradeLevels: levels }
  const start = save.beginChapter(prepare, () => .5)
  const openPack = (campaign, packId, roll, traits) => {
    const withPack = save.grantDroppedPack(campaign, packId, rules.bonfire, traits)
    const index = withPack.activePacks.length - 1
    return save.hitPack(save.hitPack(withPack, index, () => roll), index, () => roll)
  }
  const locked = openPack({ ...start, upgradeLevels: {} }, 'Pack1_Basic', 0)
  assert.ok(!locked.collection.includes(id))
  assert.equal(locked.frenzyMisses, 0)
  const miss = reload(openPack(start, 'Pack1_Basic', .03))
  assert.ok(!miss.collection.includes(id))
  assert.equal(miss.frenzyMisses, 1)
  const drop = reload(openPack(miss, 'Pack1_Basic', .074, { foil: true }))
  assert.ok(drop.roster.includes(id))
  assert.ok(drop.rosterTraits[drop.roster.indexOf(id)].foil)
  assert.deepEqual(binderAwards(drop, id), [{ resource: 0, value: 1000 }, { resource: 5, value: 2 }])
  assert.equal(drop.frenzyMisses, 0)
  assert.equal(drop.frenzyDropsThisAttempt, 1)
  assert.equal(openPack(drop, 'Pack3_Magic', 0).frenzyMisses, 1)
  assert.equal(openPack(start, 'Pack2_Advanced', .039).frenzyDropsThisAttempt, 1)
  assert.equal(openPack(start, 'Pack2_Advanced', .041).frenzyDropsThisAttempt, 0)
  assert.equal(save.beginChapter({ ...drop, resumePhase: 'prepare' }).frenzyDropsThisAttempt, 0)

  const { battle, boss } = bossFixture(2, 'Boss2_Beast')
  battle.elapsed = -100
  boss.stunnedUntil = 100
  battle.modifiers = upgrades.upgradeModifiers(levels)
  const check = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-7, value + ' vs ' + expected)
  assert.equal(combat.cursorProfile(battle).stacks, 0)
  const opened = openFieldTome(battle, id)
  assert.ok(opened)
  check(opened.until - opened.startedAt, 9)
  assert.equal(battle.dragons.length, 0)
  const active = combat.cursorProfile(battle)
  check(active.radius, 2.1)
  check(active.interval, 1 / 1.43)
  check(active.damage, 4.2)
  check(active.crit, .05)
  assert.ok(battle.nextPulse <= battle.clock + active.interval)
  battle.nextPulse = battle.clock
  battle.random = () => .01
  boss.x = 0; boss.y = 0
  const startHP = boss.hp
  assert.equal(combat.pulse(battle, { x: .45 + rules.monsters[boss.id].interactionRadius, y: 0, radius: .25 }), true)
  check(startHP - boss.hp, 8.4)
  assert.ok(battle.damageNumbers.entries.some(number => number.kind === 'crit'))

  const foil = openFieldTome(battle, id, { foil: true })
  assert.ok(foil)
  const stacked = combat.cursorProfile(battle)
  check(stacked.radius, 2.1 + 1.1 * 1.5 * .65)
  check(stacked.damage, 4.2 + 3.2 * .65)
  check(stacked.interval, 1 / (1 + .43 * 1.65))
  check(stacked.crit, .05 * 1.65)
  combat.advanceBattle(battle, opened.until - battle.clock + .01)
  assert.equal(combat.cursorProfile(battle).stacks, 1)
  check(combat.cursorProfile(battle).radius, 1 + 1.1 * 1.5)
  combat.advanceBattle(battle, foil.until - battle.clock + .01)
  assert.equal(combat.cursorProfile(battle).stacks, 0)
  check(combat.cursorProfile(battle).interval, 1)
}

function verifyTomeOpening() {
  const battle = combat.createBattle([], false, () => .5)
  battle.elapsed = -100
  const id = 'Tome_Thunderstorm'
  const spawn = { x: -1, y: -.6 }
  combat.deployCard(battle, id, spawn)
  const tome = battle.fieldTomes[0]
  const aim = { x: tome.x, y: tome.y, radius: .12 }
  assert.ok(Math.abs(Math.hypot(tome.x - spawn.x, tome.y - spawn.y) - .4) < 1e-8)
  assert.equal(combat.canSlashTome(battle, tome), false)
  assert.equal(battle.tomes.length, 0)
  combat.advanceBattle(battle, .38)
  assert.equal(combat.canSlashTome(battle, tome), true)
  assert.equal(combat.pulse(battle, { x: tome.x + .3, y: tome.y, radius: .12 }), false)
  battle.nextPulse = battle.clock
  assert.equal(combat.pulse(battle, aim), true)
  assert.equal(tome.hits, 1)
  assert.equal(battle.cursorPulseAt, battle.clock)
  assert.ok(battle.effects.some(effect => effect.kind === 'tomeSpark' && effect.art === 'packHit'))
  combat.advanceBattle(battle, 1.6)
  assert.equal(combat.pulse(battle, aim), true)
  assert.ok(tome.hits > 1 && tome.hits < 2)
  assert.equal(tome.openedAt, null)
  combat.advanceBattle(battle, battle.pulseInterval)
  assert.equal(combat.pulse(battle, aim), true)
  assert.equal(tome.hits, 2)
  assert.equal(combat.canSlashTome(battle, tome), false)
  assert.ok(battle.sounds.includes('chapter-2-3/499-20_thunder_04.wav'))
  combat.advanceBattle(battle, .05)
  const burst = battle.effects.find(effect => effect.kind === 'tomeSpark' && effect.art === 'packOpen')
  assert.ok(burst)
  assert.ok(Math.abs(burst.until - burst.start - 1.1) < 1e-7)
  combat.advanceBattle(battle, .49)
  assert.equal(battle.tomes.length, 0)
  combat.advanceBattle(battle, .01)
  const active = battle.tomes[0]
  assert.equal(battle.fieldTomes.length, 0)
  assert.equal(active.until - active.startedAt, 12)
  assert.ok(Math.abs(active.next - active.startedAt - .9) < 1e-7)
  assert.equal(combat.masterySurgePercent(battle), 150)
  assert.equal(battle.spellCounts.Spell_Thunderbolt, 2)
  assert.equal(battle.effects.filter(effect => effect.kind === 'thunderbolt').length, 2)
  assert.ok(battle.sounds.includes(rules.rules.thunderstorm.castSound))
}

function verifyTomePresentation() {
  assert.equal(tomeOpeningPose('Tome_CursorDPS', .05).scale, 1)
  assert.equal(tomeOpeningPose('Tome_CursorDPS', .30).scale, 2)
  assert.equal(tomeOpeningPose('Tome_Thunderstorm', .30).scale, 1.5)
  assert.equal(tomeOpeningPose('Tome_RaiseDead', .55).alpha, 0)
  assert.equal(tomeOpeningPose('Tome_DragonsCall', .55).scale, 5)
  assert.equal(cursorPopScale(0), 1.25)
  assert.equal(cursorPopScale(.04), 1.0625)
  assert.equal(cursorPopScale(.08), 1)

  const visibleCount = (kind, age) => Array.from({ length: 30 }, (_, index) =>
    tomeSparkPose(kind, 17, index, age)).filter(Boolean).length
  assert.equal(tomeSparkDuration('packHit'), .4)
  assert.equal(visibleCount('packHit', .1), 10)
  assert.equal(visibleCount('packHit', .4), 0)
  assert.equal(visibleCount('packOpen', .1), 10)
  assert.equal(visibleCount('packOpen', .21), 20)
  assert.equal(visibleCount('packOpen', .41), 30)
  assert.equal(visibleCount('packOpen', 1.11), 0)
  const first = tomeSparkPose('packOpen', 17, 0, .1)
  const later = tomeSparkPose('packOpen', 17, 0, .5)
  assert.ok(first.size >= .05 && first.size < .08)
  assert.ok(later.alpha < first.alpha)
  assert.ok(Math.hypot(later.x, later.y) > Math.hypot(first.x, first.y))
}

function verifyThunderboltTargets() {
  const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
  const config = require('../src/data/scene-canvas.json').thunderbolt
  const near = Object.assign(boss, { x: 0, y: 0, stunnedUntil: 20 })
  const far = { ...boss, uid: battle.nextUid++, x: 3.6 }
  const outside = { ...boss, uid: battle.nextUid++, y: 2.4 }
  battle.enemies.push(far, outside)
  const active = openFieldTome(battle, 'Tome_Thunderstorm')
  assert.equal(outside.hp, outside.maxHp)
  const beforeNear = near.hp
  const beforeFar = far.hp
  const beforeOutside = outside.hp
  const rolls = [.5, .01, .25, .99, .75]
  battle.random = () => rolls.shift() ?? .5
  active.next = battle.clock
  combat.advanceBattle(battle, .01)
  assert.equal(beforeNear - near.hp, 2.5)
  assert.equal(beforeFar - far.hp, 3.5)
  assert.equal(beforeOutside, outside.hp)
  const bolts = battle.effects.filter(effect => effect.kind === 'thunderbolt' && effect.start === battle.clock)
  assert.deepEqual(bolts.map(effect => [effect.x, effect.y]), [[0, 0], [3.6, 0]])
  assert.ok(bolts.every(effect => Math.abs(effect.until - effect.start - config.emissionDelay - config.particleLifetime) < 1e-7))
  assert.ok(Math.abs(near.stunnedUntil - battle.clock - .4) < 1e-7)
  battle.enemies = [outside]
  active.next = battle.clock
  combat.advanceBattle(battle, .01)
  assert.equal(beforeOutside - outside.hp, 6)
}

function verifyRaiseDead() {
  const id = 'Tome_RaiseDead'
  const spawn = require('../src/data/scene-canvas.json').raiseDead.spawn
  for (const foil of [false, true]) {
    const battle = combat.createBattle([], false, () => .25, 2)
    battle.elapsed = -100
    battle.modifiers = { ...battle.modifiers, effect: (type, target) => type === 96 && target === id ? 1 : 0 }
    const active = openFieldTome(battle, id, { foil })
    assert.equal(active.foil, foil)
    assert.equal(active.until - active.startedAt, 12)
    assert.equal(active.next - active.startedAt, 3)
    assert.equal(battle.allies.length, 4)
    assert.ok(battle.sounds.includes(rules.heroes.Hero_Skeleton.sounds.spawnSFX))
    for (const unit of battle.allies) {
      assert.equal(unit.id, 'Hero_Skeleton')
      assert.equal(unit.summonDamageMultiplier, foil ? 1.5 : 1)
    }
    const particles = battle.effects.filter(effect => effect.art === 'skeleton')
    assert.equal(particles.length, 4)
    for (const effect of particles) {
      assert.ok(Math.abs(effect.x - rules.bonfire.x) < 1e-7)
      assert.ok(Math.abs(effect.y - rules.bonfire.y - 1) < 1e-7)
      assert.ok(Math.abs(effect.until - effect.start - spawn.emissionDelay - spawn.lifetime) < 1e-7)
    }
    for (let tick = 1; tick <= 4; tick++) {
      battle.clock = active.startedAt + 3 * tick - .01
      combat.advanceBattle(battle, .01)
      assert.equal(battle.allies.length, 4 * Math.min(4, tick + 1))
    }
    assert.equal(battle.tomes.length, 0)
  }
  const thunder = combat.createBattle([], false, () => .25)
  thunder.elapsed = -100
  const foilThunder = openFieldTome(thunder, 'Tome_Thunderstorm', { foil: true })
  assert.equal(foilThunder.until - foilThunder.startedAt, 18)
}

function verifyDragonsCall() {
  const id = 'Tome_DragonsCall'
  const config = require('../src/data/scene-canvas.json').dragon
  const spell = rules.spells.Spell_DragonsCall
  const { battle, boss } = bossFixture(1, 'Boss1_Apogre')
  battle.elapsed = -100
  battle.modifiers = { ...battle.modifiers, effect: (type, target) => type === 140 && target === id ? .5 : 0 }
  boss.stunnedUntil = 100
  const outside = { ...boss, uid: battle.nextUid++, y: 1.8 }
  battle.enemies.push(outside)
  const pulls = [.5]
  battle.random = () => pulls.shift() ?? .25
  const startHP = boss.hp
  const active = openFieldTome(battle, id)
  const flight = battle.dragons[0]
  assert.equal(active.startedAt, flight.startedAt)
  assert.equal(battle.spellCounts.Spell_DragonsCall, 1)
  assert.ok(battle.sounds.includes(config.castSound))
  assert.equal(flight.start.x, -rules.world.width / 2 - config.edgeMargin)
  assert.equal(flight.exit.x, -flight.start.x)
  assert.equal(flight.start.y, 0)
  assert.equal(flight.damage, 90)
  assert.equal(boss.hp, startHP)

  while (battle.clock + .025 < flight.exitAt) combat.advanceBattle(battle, .025)
  assert.equal(boss.hp, startHP - 90)
  assert.equal(outside.hp, outside.maxHp)

  outside.x = flight.start.x + (flight.exit.x - flight.start.x) * .55
  outside.y = flight.start.y
  active.next = Infinity
  const firstTrailTick = flight.nextTrailTick
  while (battle.clock + .025 < firstTrailTick) combat.advanceBattle(battle, .025)
  assert.equal(outside.hp, outside.maxHp)
  combat.advanceBattle(battle, .025)
  assert.equal(outside.hp, outside.maxHp - 90)

  while (battle.clock <= flight.lastTrailTick + .05) combat.advanceBattle(battle, .025)
  assert.equal(battle.dragons.length, 0)

  const foil = combat.createBattle([], false, () => .25, 3)
  foil.elapsed = -100
  openFieldTome(foil, id, { foil: true })
  assert.equal(foil.dragons.length, 2)
  assert.equal(foil.spellCounts.Spell_DragonsCall, 2)
}

function purchaseUpgrades(campaign) {
  while (true) {
    const board = upgrades.upgradeBoard(campaign)
    const options = upgrades.upgradeCells.filter(cell =>
      board.states.get(cell.id) === 'available' && upgrades.canAffordUpgrade(campaign, cell) && cell.definition.kind === 0)
    options.sort((a, b) => (a.definition.costs?.cost ?? 0) - (b.definition.costs?.cost ?? 0))
    if (!options.length) return campaign
    const previous = campaign
    campaign = upgrades.purchaseUpgrade(campaign, options[0].id)
    assert.notEqual(campaign, previous)
  }
}

verifyPackSlashes()
verifyPackOpening()
verifyDiscovery()
verifyBinderDiscovery()
verifyEpicPackCharge()
verifyChapterAudio()
verifyOpeningUpgradeBoard()
verifyCampaignGate()
verifyBattleQuests()
verifyShop()
verifyShopDelivery()
verifyPurchasedThrows()
verifyDayProgress()
verifyLegacyVictorySave()
verifyCrtLook()
verifyBossMeleeCones()
verifyHitTiming()
verifyDamageNumbers()
verifyTowerFeedback()
verifyUnitMotion()
verifyHeroFacing()
verifyHeroBattlefieldBounds()
verifyProjectiles()
verifyMonkDash()
verifyMonkKnockback()
verifyWitchSummons()
verifyPortalSummons()
verifyIllusionistMirrors()
verifyMasterySurge()
verifyTomeOpening()
verifyTomePresentation()
verifyCursorFrenzy()
verifyThunderboltTargets()
verifyRaiseDead()
verifyDragonsCall()
console.log(JSON.stringify({ seed: 13, ...replay(13) }, null, 2))
