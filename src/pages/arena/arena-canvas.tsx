import { useEffect, useRef, type RefObject } from 'react'
import scene from '../../data/scene-canvas.json'
import source from '../../data/asset-sources.json'
import unitGeometry from '../../data/unit-sprite-geometry.json'
import packGeometry from '../../data/pack-sprites.json'
import projectileConfig from '../../data/projectiles.json'
import {
  bonfire, buildings, cardArt, cardDiscovery, chapters, chapterInfo, frenzyTome, heroes, isHero, monsters, packArt,
  packPresentation, packs, particleArt, relics, rules, supporterTowerSkin, tomes, towerArt, witchTransition, world,
  type CardId, type ChapterId, type MonsterId, type ParticleId, type Point
} from '../../game/rules'
import { boxOpening, ordinaryOpening, packDissolveNoise, packDissolveThresholds, packOpeningColors, packOpeningShine, packRainbowColor, packRipPose, packShineStartColor } from '../../game/pack-opening'
import { boxScale, packThrowPose } from '../../game/pack-throw'
import { packLocation } from '../../game/save'
import {
  cursorProfile, dragonPosition, witchShot, type Aim, type Battle, type Effect, type FieldTome, type WitchRespawn
} from '../../game/combat'
import { damageNumberLook, questPopupLook } from '../../game/damage-numbers'
import { defeatWorldAge, defeatZoomProgress } from '../../game/defeat'
import { actEndingTowerZoom } from '../../game/campaign-gate'
import { discoveryAuraLook, discoveryBurstLook, discoveryPackCharge, discoveryPose } from '../../game/discovery'
import { createPackChargeMask, packChargeTexel, type PackChargeMask } from '../../game/pack-charge'
import { createPackAuraMask, packAuraRays, type PackAuraMask, type PackAuraRay } from '../../game/pack-aura'
import { fallenUnitPose, heroEntryPose, portalCastScale, portalExpireScale, portalIdleSprite, portalSprites } from '../../game/unit-motion'
import { evaluateCurve } from '../../game/unity-curve'
import { cursorPopScale, tomeOpeningPose, tomeSparkPose, type TomeSpark } from '../../game/tome-presentation'
import { randomFromSeed } from '../../game/visual-random'
import { asset } from './media'
import type { Presentation } from './use-game'
import { battleCrtLook, createCrtRenderer } from './crt'

export const viewport = { width: 960, height: 540 }
export type Cursor = Aim & { pressed: boolean }
type Artwork = Map<string, HTMLImageElement>
type SpritePose = { scale?: number; turn?: number; flipX?: boolean; flipY?: boolean; pivotY?: number; alpha?: number }
type Geometry = { pathId: number; rect?: number[]; pivot?: number[]; textureRectOffset?: number[]; textureOrigin?: number[]; pixelsPerUnit?: number }

const geometry: Record<string, Geometry> = {
  ...source, ...unitGeometry, ...packGeometry, ...supporterTowerSkin.geometry,
  ...Object.fromEntries(Object.values(projectileConfig).map(item => [item.asset, item])),
  [projectileConfig.fireball.groundAsset]: projectileConfig.fireball.groundGeometry,
  [projectileConfig.infection.groundAsset]: projectileConfig.infection.groundGeometry
}

export function discoverySpriteBounds(card: CardId) {
  const name = cardArt(card)
  const data = name ? geometry[name] : undefined
  const height = (data?.rect?.[3] ?? 32) / (data?.pixelsPerUnit ?? 100)
  const pivot = data?.pivot?.[1] ?? .5
  return { top: height * (1 - pivot), bottom: height * pivot }
}

const pixelsPerWorld = viewport.height / world.height
const sceneCenter = { x: viewport.width / 2, y: viewport.height / 2 }
const ringColor = 'rgba(237,243,235,0.17)'
const groundTiles = new Map<ChapterId, { image: HTMLImageElement; surface: HTMLCanvasElement }>()

function screen(point: Point): Point {
  return { x: sceneCenter.x + point.x * pixelsPerWorld, y: sceneCenter.y - point.y * pixelsPerWorld }
}

function animationEase(time: number) {
  return 1 - (1 - Math.max(0, Math.min(time, 1))) ** 3
}

function sprite(context: CanvasRenderingContext2D, image: CanvasImageSource | undefined, at: Point, width: number, height: number, pose: SpritePose = {}) {
  if (!image || width <= 0 || height <= 0) return
  context.save()
  context.translate(at.x, at.y)
  if (pose.turn) context.rotate(pose.turn)
  if (pose.flipX || pose.flipY) context.scale(pose.flipX ? -1 : 1, pose.flipY ? -1 : 1)
  context.globalAlpha *= pose.alpha ?? 1
  context.drawImage(image, -width / 2, -height * (pose.pivotY ?? .5), width, height)
  context.restore()
}

function worldSprite(context: CanvasRenderingContext2D, image: HTMLImageElement | undefined, position: Point, pose: SpritePose = {}) {
  if (!image) return
  const scale = (pose.scale ?? 1) * pixelsPerWorld / 100
  sprite(context, image, screen(position), image.width * scale, image.height * scale, pose)
}

function spriteMetrics(name: string, image: HTMLImageElement, position: Point, pose: SpritePose) {
  const data = geometry[name]
  const scale = pixelsPerWorld / (data?.pixelsPerUnit ?? 100) * (pose.scale ?? 1)
  const center = screen(position)
  if (data?.rect && data.pivot && data.textureRectOffset) {
    const dx = (data.textureRectOffset[0] - data.rect[2] * data.pivot[0] + image.width / 2) * scale * (pose.flipX ? -1 : 1)
    const dy = (data.rect[3] * data.pivot[1] - data.textureRectOffset[1] - image.height / 2) * scale * (pose.flipY ? -1 : 1)
    const turn = pose.turn ?? 0
    center.x += dx * Math.cos(turn) - dy * Math.sin(turn)
    center.y += dx * Math.sin(turn) + dy * Math.cos(turn)
  }
  return { center, width: image.width * scale, height: image.height * scale }
}

function drawNativeSprite(context: CanvasRenderingContext2D, artwork: Artwork, name: string, position: Point, pose: SpritePose = {}) {
  const image = artwork.get(name)
  if (!image) return
  const { center, width, height } = spriteMetrics(name, image, position, pose)
  sprite(context, image, center, width, height, pose)
}

function srgbToLinear(channel: number) {
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
}

function linearToSrgb(channel: number) {
  return channel <= .0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - .055
}

function groundTile(chapter: ChapterId, image: HTMLImageElement) {
  const cached = groundTiles.get(chapter)
  if (cached?.image === image) return cached.surface
  const surface = document.createElement('canvas')
  surface.width = image.width
  surface.height = image.height
  const context = surface.getContext('2d')
  if (!context) return
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height)
  // Unity blends the ground sprite over the camera background in linear color.
  const background = chapterInfo(chapter).background.slice(0, 3).map(srgbToLinear)
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const alpha = pixels.data[offset + 3] / 255 * scene.ground.alpha
    for (let channel = 0; channel < 3; channel++) {
      const ink = srgbToLinear(pixels.data[offset + channel] / 255)
      const mixed = background[channel] * (1 - alpha) + ink * alpha
      pixels.data[offset + channel] = 255 * linearToSrgb(mixed)
    }
    pixels.data[offset + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
  groundTiles.set(chapter, { image, surface })
  return surface
}

function paintGround(context: CanvasRenderingContext2D, artwork: Artwork, chapter: ChapterId,
  x: number, y: number, width: number, height: number) {
  const theme = chapterInfo(chapter)
  context.fillStyle = 'rgb(' + theme.background.slice(0, 3).map(channel => Math.round(255 * channel)).join(',') + ')'
  context.fillRect(x, y, width, height)
  const image = artwork.get(theme.ground)
  const surface = image && groundTile(chapter, image)
  const pattern = surface && context.createPattern(surface, 'repeat')
  if (!pattern) return

  const ground = scene.ground
  const at = screen({ x: ground.x - ground.width / 2, y: ground.y + ground.height / 2 })
  const left = Math.max(at.x, x)
  const top = Math.max(at.y, y)
  const right = Math.min(at.x + ground.width * pixelsPerWorld, x + width)
  const bottom = Math.min(at.y + ground.height * pixelsPerWorld, y + height)
  if (left >= right || top >= bottom) return
  pattern.setTransform(new DOMMatrix().translate(at.x, at.y).scale(pixelsPerWorld / 100))
  context.fillStyle = pattern
  context.fillRect(left, top, right - left, bottom - top)
}

export function terrainDetails(chapter: ChapterId) {
  const theme = chapterInfo(chapter)
  const details: (Point & { art: string })[] = []
  let seed = chapter * 1009
  const random = () => randomFromSeed(++seed)
  const point = () => ({ x: (random() - .5) * world.width, y: (random() - .5) * world.height })
  for (let index = 0; index < theme.waveThemeDetailCount; index++) {
    let at: Point | undefined
    // WaveThemeRuntime.TryPickDetailPosition tries up to 160 samples in the gameplay frustum.
    for (let attempt = 0; attempt < 160; attempt++) {
      const candidate = point()
      if (Math.hypot(candidate.x - bonfire.x, candidate.y - bonfire.y) >= theme.waveThemeDetailMinDistanceFromTower &&
          details.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= theme.waveThemeDetailMinSeparation)) {
        at = candidate
        break
      }
    }
    details.push({ ...(at ?? point()), art: theme.decor[Math.floor(random() * theme.decor.length)] })
  }
  return details
}

export function paintBackdrop(canvas: HTMLCanvasElement, artwork: Artwork, chapter: ChapterId) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false
  const { width, height } = viewport
  const theme = chapterInfo(chapter)
  paintGround(context, artwork, chapter, 0, 0, width, height)
  for (const detail of terrainDetails(chapter)) drawNativeSprite(context, artwork, detail.art, detail)
  scene.rim.forEach((rim, index) => {
    const art = theme.rim[Math.floor(randomFromSeed(chapter * 811 + index) * theme.rim.length)]
    drawNativeSprite(context, artwork, art, rim,
      { scale: rim.scaleX, turn: -rim.rotationRadians, alpha: rim.alpha, flipX: rim.flipX, flipY: rim.flipY })
  })
}

function silhouette(image: HTMLImageElement, color = '#e4e9e7') {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (context) {
    context.drawImage(image, 0, 0)
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = color
    context.fillRect(0, 0, image.width, image.height)
  }
  return canvas
}

function flashSprite(context: CanvasRenderingContext2D, original: HTMLImageElement | undefined, masks: Map<string, HTMLCanvasElement>,
  name: string, at: Point, alpha: number, pose: SpritePose = {}) {
  if (!original || alpha <= 0) return
  const mask = masks.get(name) ?? silhouette(original)
  masks.set(name, mask)
  const { center, width, height } = spriteMetrics(name, original, at, pose)
  sprite(context, mask, center, width, height, { ...pose, alpha })
}

function drawCrate(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, view: Presentation) {
  const age = view.introAge
  const initial = age === null
  const crate = scene.crate
  if (!initial && age > crate.openDuration) return
  const progress = initial ? 0 : animationEase(age / crate.openDuration)
  const name = initial ? 'intro-box-0.png' : 'intro-box-1.png'
  const position = { x: crate.x + progress * crate.openSlide, y: crate.y + progress * .05 }
  const scale = crate.scale * (1 + (crate.expand - 1) * progress)
  const pose = { turn: -crate.openRotationDegrees * Math.PI / 180 * progress, alpha: 1 - progress }
  const art = artwork.get(name)
  drawNativeSprite(context, artwork, name, position, { ...pose, scale })
  if (art && initial && view.crateHitAge < .36) {
    const mask = masks.get(name) ?? silhouette(art)
    masks.set(name, mask)
    const metrics = spriteMetrics(name, art, position, { scale })
    sprite(context, mask, metrics.center, metrics.width, metrics.height,
      { alpha: .87 * (1 - view.crateHitAge / .4) })
  }
}

function drawLogo(context: CanvasRenderingContext2D, artwork: Artwork, view: Presentation) {
  const age = (view.introAge ?? -1) - scene.crate.openDuration
  if (age < 0) return
  const logo = artwork.get('logo-zh.png')
  if (!logo) return
  const pop = animationEase(age / scene.logo.pop)
  const fade = 1 - Math.max(0, Math.min((age - scene.logo.pop - scene.logo.hold) / scene.logo.fade, 1))
  const width = 578 * (0.54 + 0.46 * pop)
  const rays = artwork.get('logo-rays.png')
  const alternateRays = artwork.get('logo-rays-alternate.png')
  const y = sceneCenter.y - (1 - pop) * 9
  sprite(context, rays, sceneCenter, 1040, 1040, { alpha: .19 * pop * fade, turn: age * .17 })
  sprite(context, alternateRays, sceneCenter, 870, 870, { alpha: .11 * pop * fade, turn: -age * .15 })
  sprite(context, logo, { x: sceneCenter.x, y }, width, width * logo.height / logo.width, { alpha: fade * pop })
}

function drawTower(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  view: Presentation, position: Point) {
  const destroyed = view.campaign.summary?.result === 'defeat'
  const stage = Math.min(supporterTowerSkin.bodies.length - 1,
    view.battle?.modifiers.towerVisual ?? view.arrival?.towerVisual ?? view.story?.tower?.towerVisual ?? 0)
  const name = destroyed ? supporterTowerSkin.destroyed : supporterTowerSkin.bodies[stage]
  const tower = artwork.get(name)
  const activeBuildings = destroyed ? [] : view.battle?.buildings ?? view.arrival?.buildings ?? view.story?.tower?.buildings ?? []
  const drawBuildings = (inFront: boolean) => {
    for (const { id } of activeBuildings) {
      const building = buildings[id]
      // Bonfire and its child SpriteRenderers share the same Unity layer.
      if ((building.sortingOrder > 1) !== inFront) continue
      drawNativeSprite(context, artwork, building.worldSprite,
        { x: position.x + building.position[0], y: position.y + building.position[1] })
    }
  }
  drawBuildings(false)
  const battle = view.battle
  const hit = battle?.towerHits.at(-1)
  if (tower && battle && hit && battle.animationClock - hit.at < scene.combatFeel.whiteHitFlashDuration) {
    const key = name + ':tower-hit'
    const flash = masks.get(key) ?? silhouette(tower, '#fff')
    masks.set(key, flash)
    const { center, width, height } = spriteMetrics(name, tower, position, {})
    sprite(context, flash, center, width, height)
  } else drawNativeSprite(context, artwork, name, position)
  drawBuildings(true)
}

function drawTowerLights(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  chapter: ChapterId, tower: Point, age: number, foreground: boolean, motion: boolean) {
  const tint = chapterInfo(chapter).lightColor
  // The serialized DOTween Scale uses InOutSine, relative distance and infinite yoyo.
  const pulse = motion ? .5 - .5 * Math.cos(age * Math.PI / towerArt.lightTweenDuration) : 0
  for (const light of towerArt.lights) {
    if ((light.sortingLayer > 0) !== foreground) continue
    const image = artwork.get(light.sprite)
    if (!image) continue
    const key = light.sprite + ':chapter:' + chapter
    let colored = masks.get(key)
    if (!colored) {
      const surface = document.createElement('canvas')
      surface.width = image.width
      surface.height = image.height
      const layer = surface.getContext('2d')
      if (!layer) continue
      layer.drawImage(image, 0, 0)
      const pixels = layer.getImageData(0, 0, image.width, image.height)
      const rgb = tint.slice(0, 3).map(srgbToLinear)
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        for (let channel = 0; channel < 3; channel++) {
          const source = srgbToLinear(pixels.data[offset + channel] / 255)
          pixels.data[offset + channel] = 255 * linearToSrgb(source * rgb[channel])
        }
      }
      layer.putImageData(pixels, 0, 0)
      masks.set(key, surface)
      colored = surface
    }
    const position = { x: tower.x + light.position[0], y: tower.y + light.position[1] }
    const scaleOffset = light.scaleOffset * pulse
    sprite(context, colored, screen(position), image.width * (light.scale[0] + scaleOffset) * pixelsPerWorld / 100,
      image.height * (light.scale[1] + scaleOffset) * pixelsPerWorld / 100, { alpha: light.color[3] })
  }
}

function bossDefeatPose(boss: NonNullable<Battle['bossDefeat']>, age: number, motion: boolean) {
  const config = scene.victory
  const hit = Math.max(0, Math.min(1, age / config.preDeathHitDuration))
  const time = Math.max(0, Math.min(1, (age - config.preDeathHitDuration) / config.deathFlyDuration))
  const fly = 1 - (1 - time) ** 2
  const offset = motion ? config.preDeathHitDistance * hit ** 3 + config.deathFlyDistance * fly : 0
  return {
    x: boss.x + offset * boss.direction.x,
    y: boss.y + offset * boss.direction.y,
    turn: motion ? -boss.rotation * config.deathFlyRotation * Math.PI / 180 * fly : 0,
    frame: hit < 1 && motion ? 2 : 3
  }
}

function victoryCamera(boss: Battle['bossDefeat'], bossAge: number, age: number, motion: boolean) {
  const config = scene.victory
  const time = motion ? Math.max(0, Math.min(1, (age - config.zoomDelay) / config.zoomDuration)) : 0
  if (!time) return { zoom: 1, anchor: sceneCenter }

  // EndDaySequence interpolates orthographic size and preserves the initial screen-space focus offset.
  const progress = time ** 2 * (3 - 2 * time)
  const wideSize = world.height / 2
  const zoom = wideSize / (wideSize + (config.orthoSize - wideSize) * progress)
  const start = boss ? screen(bossDefeatPose(boss, bossAge + config.zoomDelay, motion)) : sceneCenter
  const focus = boss ? screen(bossDefeatPose(boss, bossAge + age, motion)) : sceneCenter
  return {
    zoom,
    anchor: {
      x: focus.x - (start.x - sceneCenter.x) * (1 - progress) / zoom,
      y: focus.y - (start.y - sceneCenter.y) * (1 - progress) / zoom
    }
  }
}

function defeatCamera(age: number, motion: boolean) {
  const progress = motion ? defeatZoomProgress(age) : 1
  const wide = world.height / 2
  const zoom = wide / (wide + (scene.defeat.orthoSize - wide) * progress)
  const focus = screen(bonfire)
  return {
    zoom,
    anchor: {
      x: focus.x - (focus.x - sceneCenter.x) * (1 - progress) / zoom,
      y: focus.y - (focus.y - sceneCenter.y) * (1 - progress) / zoom
    }
  }
}

function visualRandom(sample: number) {
  const mixed = Math.imul(sample, 747796405) + 2891336453
  return ((mixed ^ (mixed >>> 11)) >>> 0) / 2 ** 32
}

function towerPosition(battle: Battle | null, motion: boolean): Point {
  const hit = motion ? battle?.towerHits.at(-1) : undefined
  if (!battle || !hit) return bonfire
  const config = towerArt.native
  const age = battle.animationClock - hit.at
  const duration = hit.fatal ? config.towerDestroyedShakeDuration : config.towerHitShakeDuration
  if (age >= duration) return bonfire
  const strength = (1 - age / duration) * (hit.fatal ? config.towerDestroyedShakeAmplitude : config.towerHitShakeAmplitude) / 2
  const time = (40 + 55 * (1 - age / duration)) * age
  const phase = visualRandom(hit.id) * Math.PI * 2
  return {
    x: bonfire.x + strength * (Math.sin(time + phase) + .48 * Math.sin(time * 1.73 + phase * 1.1)),
    y: bonfire.y + strength * (Math.sin(time * 1.09 + phase * .7) + .42 * Math.sin(time * 2.31 + 1.9))
  }
}

function towerCameraShake(battle: Battle | null, defeatAge?: number): Point {
  if (!battle) return { x: 0, y: 0 }
  const shake = battle.towerCamera
  const age = defeatAge ?? battle.animationClock - shake.at
  const strength = Math.max(0, 1 - age / shake.duration) * shake.amplitude * pixelsPerWorld
  if (!strength) return { x: 0, y: 0 }
  const sample = Math.floor((shake.at + age) * 60) * 2
  return {
    x: (visualRandom(sample + 131) * 2 - 1) * strength,
    y: (visualRandom(sample + 132) * 2 - 1) * strength
  }
}

function victoryShake(age: number) {
  const { punchMagnitude, punchDuration, rumbleMagnitude, rumbleDuration } = scene.victory
  const strength = age < punchDuration ? punchMagnitude * (1 - age / punchDuration) :
    rumbleMagnitude * Math.max(0, 1 - (age - punchDuration) / rumbleDuration)
  const sample = Math.floor(age * 60) * 2
  return {
    x: (visualRandom(sample) * 2 - 1) * strength * pixelsPerWorld,
    y: (visualRandom(sample + 1) * 2 - 1) * strength * pixelsPerWorld
  }
}

function project(point: Point, camera: ReturnType<typeof victoryCamera>) {
  const position = screen(point)
  return {
    x: sceneCenter.x + (position.x - camera.anchor.x) * camera.zoom,
    y: sceneCenter.y + (position.y - camera.anchor.y) * camera.zoom
  }
}

function drawTowerBar(context: CanvasRenderingContext2D, battle: Battle, position: Point, camera: ReturnType<typeof victoryCamera>) {
  if (battle.towerHp <= 0 || battle.towerHp >= battle.towerMaxHp) return
  const bar = scene.towerFeedback.bar
  const scale = viewport.height / 1080
  const at = project(position, camera)
  const stage = Math.min(supporterTowerSkin.healthOffsets.length - 1, battle.modifiers.towerVisual ?? 0)
  const offset = supporterTowerSkin.healthOffsets[stage]
  context.fillStyle = bar.color
  context.fillRect(at.x + (bar.offset[0] + offset.x - bar.width / 2) * scale,
    at.y - (bar.offset[1] + offset.y) * scale, bar.width * scale * fillFraction(battle.towerHp, battle.towerMaxHp),
    bar.height * scale)
}

function drawTowerHitParticles(context: CanvasRenderingContext2D, battle: Battle, motion: boolean) {
  const config = scene.towerFeedback.hitParticles
  for (const hit of battle.towerHits) {
    const debris = hit.fatal ? scene.defeat.debris : null
    for (let burst = 0; burst < (debris?.bursts ?? 1); burst++) {
      const age = battle.animationClock - hit.at - burst * (debris?.interval ?? 0)
      const lifetime = debris?.lifetime ?? config.duration
      if (age < 0 || age >= lifetime) continue
      context.save()
      context.globalAlpha *= 1 - age / lifetime
      const fall = motion ? .5 * 9.81 * config.gravity * age ** 2 : 0
      for (let i = 0; i < (debris?.count ?? config.count); i++) {
        const seed = hit.id * 2053 + burst * 179 + i * 11
        const size = (config.size[0] + (config.size[1] - config.size[0]) * randomFromSeed(seed)) * pixelsPerWorld
        const rotation = config.rotation[0] + (config.rotation[1] - config.rotation[0]) * randomFromSeed(seed + 1)
        const tint = randomFromSeed(seed + 2)
        const color = config.color[0].map((min, channel) => Math.round((min + (config.color[1][channel] - min) * tint) * 255))
        let x = bonfire.x
        let y = bonfire.y + (debris?.y ?? 0) - fall
        if (debris && motion) {
          const heading = randomFromSeed(seed + 3) * Math.PI * 2
          const speed = debris.speed[0] + (debris.speed[1] - debris.speed[0]) * randomFromSeed(seed + 4)
          const distance = age * speed * Math.sin(debris.angle * Math.PI / 180 * randomFromSeed(seed + 5))
          x += Math.cos(heading) * distance
          y += Math.sin(heading) * distance
        }
        const at = screen({ x, y })
        context.save()
        context.translate(at.x, at.y)
        if (motion) context.rotate(age * rotation)
        context.fillStyle = 'rgb(' + color.join(',') + ')'
        context.fillRect(-size / 2, -size / 2, size, size)
        context.restore()
      }
      context.restore()
    }
  }
}

function drawTowerDeathSmoke(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  battle: Battle, age: number, motion: boolean) {
  const death = battle.towerHits.at(-1)
  const smoke = scene.defeat.smoke
  const atlas = artwork.get(smoke.asset)
  if (!death?.fatal || !atlas) return
  const particles: { x: number; y: number; size: number; frame: number; alpha: number }[] = []
  for (const emitter of smoke.emitters) {
    const clock = emitter.unscaled ? age : defeatWorldAge(age)
    for (let burst = 0; burst < emitter.bursts; burst++) {
      const elapsed = clock - burst * emitter.interval
      if (elapsed < 0 || elapsed >= emitter.life[1]) continue
      for (let i = 0; i < emitter.count; i++) {
        const seed = death.id * 2053 + emitter.pathId + burst * 179 + i * 11
        const lifetime = emitter.life[0] + (emitter.life[1] - emitter.life[0]) * randomFromSeed(seed)
        if (elapsed >= lifetime) continue
        const fraction = elapsed / lifetime
        const size = (emitter.size[0] + (emitter.size[1] - emitter.size[0]) * randomFromSeed(seed + 1)) *
          evaluateCurve(smoke.sizeCurve, fraction) * pixelsPerWorld
        const angle = randomFromSeed(seed + 2) * Math.PI * 2
        const radius = Math.sqrt(randomFromSeed(seed + 3)) * smoke.radius
        const speed = smoke.speed[0] + (smoke.speed[1] - smoke.speed[0]) * randomFromSeed(seed + 4)
        const drift = motion ? elapsed * speed * Math.sin(smoke.angle * Math.PI / 180 * randomFromSeed(seed + 5)) : 0
        const gravity = motion ? .5 * 9.81 * smoke.gravity * elapsed ** 2 : 0
        const at = screen({ x: bonfire.x + Math.cos(angle) * (radius + drift),
          y: bonfire.y + emitter.y + Math.sin(angle) * (radius + drift) - gravity })
        const frame = Math.min(smoke.frames - 1, Math.floor(fraction * smoke.frames))
        particles.push({ x: at.x - size / 2, y: at.y - size / 2, size, frame, alpha: 1 - fraction })
      }
    }
  }
  if (!particles.length) return

  // Mobile/Particles/Additive uses SrcAlpha + One in Unity's linear framebuffer.
  const atlasKey = smoke.asset + ':linear'
  let linearAtlas = masks.get(atlasKey)
  if (!linearAtlas) {
    const surface = document.createElement('canvas')
    surface.width = atlas.width
    surface.height = atlas.height
    const layer = surface.getContext('2d')
    if (!layer) return
    layer.drawImage(atlas, 0, 0)
    const pixels = layer.getImageData(0, 0, surface.width, surface.height)
    const tint = srgbToLinear(smoke.tint)
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) pixels.data[i + c] = 255 * srgbToLinear(pixels.data[i + c] / 255) * tint
    }
    layer.putImageData(pixels, 0, 0)
    masks.set(atlasKey, surface)
    linearAtlas = surface
  }

  // Read just the smoke's destination rectangle in device pixels.
  const transform = context.getTransform()
  const left = Math.max(0, Math.floor(Math.min(...particles.map(p => p.x)) * transform.a + transform.e))
  const top = Math.max(0, Math.floor(Math.min(...particles.map(p => p.y)) * transform.d + transform.f))
  const right = Math.min(context.canvas.width, Math.ceil(Math.max(...particles.map(p => p.x + p.size)) * transform.a + transform.e))
  const bottom = Math.min(context.canvas.height, Math.ceil(Math.max(...particles.map(p => p.y + p.size)) * transform.d + transform.f))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return
  const layerKey = 'tower-death-light'
  const surface = masks.get(layerKey) ?? document.createElement('canvas')
  masks.set(layerKey, surface)
  if (surface.width !== width) surface.width = width
  if (surface.height !== height) surface.height = height
  const layer = surface.getContext('2d', { willReadFrequently: true })
  if (!layer) return
  layer.resetTransform()
  layer.clearRect(0, 0, width, height)
  layer.setTransform(transform.a, 0, 0, transform.d, transform.e - left, transform.f - top)
  layer.imageSmoothingEnabled = false
  layer.globalCompositeOperation = 'lighter'
  const frameWidth = atlas.width / smoke.frames
  for (const particle of particles) {
    layer.globalAlpha = particle.alpha
    layer.drawImage(linearAtlas, particle.frame * frameWidth, 0, frameWidth, atlas.height,
      particle.x, particle.y, particle.size, particle.size)
  }
  const light = layer.getImageData(0, 0, width, height).data
  const target = context.getImageData(left, top, width, height)
  for (let i = 0; i < light.length; i += 4) {
    const alpha = light[i + 3] / 255
    if (!alpha) continue
    for (let c = 0; c < 3; c++) {
      const mixed = srgbToLinear(target.data[i + c] / 255) + light[i + c] / 255 * alpha
      target.data[i + c] = 255 * linearToSrgb(Math.min(1, mixed))
    }
  }
  context.putImageData(target, left, top)
}

function drawVictoryMastery(context: CanvasRenderingContext2D, artwork: Artwork,
  boss: NonNullable<Battle['bossDefeat']>, bossAge: number, age: number, camera: ReturnType<typeof victoryCamera>) {
  const { masteryFlyCount, masteryFlyStagger, masteryFlyDuration, masteryFlySize, zoomDelay } = scene.victory
  const image = artwork.get('mastery-fly.png')
  const end = project(bonfire, camera)
  for (let index = 0; index < masteryFlyCount; index++) {
    const born = zoomDelay + index * masteryFlyStagger
    const time = (age - born) / masteryFlyDuration
    if (time < 0 || time >= 1) continue
    const start = project(boss, victoryCamera(boss, bossAge, born, true))
    start.x += visualRandom(index * 2 + 137) * 10 - 5
    start.y -= visualRandom(index * 2 + 138) * 7
    const progress = time ** 2 * (3 - 2 * time)
    const size = masteryFlySize * (1.4 - .9 * time)
    sprite(context, image, {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress - Math.sin(Math.PI * time) * 35
    }, size, size, { turn: -Math.PI * time, alpha: Math.min(1, (1 - time) / .2) })
  }
}

function unitScale(unit: Pick<Battle['allies'][number] | Battle['enemies'][number], 'id' | 'giant'>) {
  return (monsters[unit.id as MonsterId]?.spriteScale ?? 1) * (unit.giant ? 1.5 : 1)
}

function drawFallenUnits(context: CanvasRenderingContext2D, artwork: Artwork, battle: Battle, motion: boolean) {
  for (const unit of battle.fallen) {
    const age = battle.animationClock - unit.at
    const pose = fallenUnitPose(unit, age, visualRandom(unit.uid * 119 + 13) * 2 - 1, motion)
    const name = cardArt(unit.id, pose.frame)
    if (!name) continue
    drawNativeSprite(context, artwork, name, pose,
      { scale: unitScale(unit), flipX: unit.flip, turn: pose.turn, alpha: pose.alpha })
  }
}

function drawFighters(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  battle: Battle, view: Presentation, towerPosition: Point) {
  const tower = { y: bonfire.y, tower: true }
  const units = [...battle.allies, ...battle.enemies, ...battle.expiringPortals, ...battle.fieldTomes, tower].sort((a, b) => b.y - a.y)
  for (const unit of units) {
    if ('tower' in unit) {
      drawTower(context, artwork, masks, view, towerPosition)
      continue
    }
    if ('droppedAt' in unit) {
      drawFieldTome(context, artwork, unit, battle.clock)
      continue
    }
    if ('portalExpiredAt' in unit) {
      const scale = unitScale(unit) * portalExpireScale(battle.animationClock - unit.portalExpiredAt)
      context.save()
      if (unit.foil) context.filter = 'saturate(1.5) brightness(1.21)'
      drawNativeSprite(context, artwork, portalIdleSprite(unit.portalIdleAge), unit, { scale, flipX: unit.flip })
      context.restore()
      continue
    }
    if (battle.respawn && (unit.hp <= 0 || unit.id === 'Boss3_Witch2')) continue
    const attack = unit.attackedUntil > battle.clock ? (unit.lunge ? 1 : 5) : 0
    const frame = unit.id === 'Boss3_Witch' && unit.castUntil > battle.clock ? 4 :
      unit.hitUntil > battle.clock ? 2 : attack
    const clone = unit.id === 'Hero3_Illusionist' && unit.illusionistPrincipal !== null && frame === 0
    const name = unit.id === 'Hero3_Portal' ? portalIdleSprite(unit.portalIdleAge) :
      clone ? heroes.Hero3_Illusionist.frames.altSprite :
        unit.dash ? heroes.Hero2_Monk.frames.dashSprite : cardArt(unit.id, frame)
    if (!name) continue
    const art = artwork.get(name)
    if (!art) continue
    const pose = { scale: unitScale(unit), flipX: unit.flip }
    if (unit.entry) pose.scale *= heroEntryPose(unit.entry, battle.clock - unit.born).scale
    if (unit.id === 'Hero3_Portal' && unit.castUntil > battle.clock) {
      pose.scale *= portalCastScale(heroes.Hero3_Portal.native.spawnerCastPopDuration - (unit.castUntil - battle.clock))
    }
    const metrics = spriteMetrics(name, art, unit, pose)
    context.save()
    if (unit.foil) context.filter = 'saturate(1.5) brightness(1.21)'
    sprite(context, art, metrics.center, metrics.width, metrics.height, pose)
    context.restore()
    if (unit.flashUntil > battle.clock) {
      const mask = masks.get(name) ?? silhouette(art)
      masks.set(name, mask)
      sprite(context, mask, metrics.center, metrics.width, metrics.height, pose)
    }
  }
}

function drawFieldTome(context: CanvasRenderingContext2D, artwork: Artwork, tome: FieldTome, clock: number) {
  const config = scene.tomeField
  const travel = animationEase((clock - tome.droppedAt) / config.slideDuration)
  const age = tome.openedAt === null ? -1 : clock - tome.openedAt
  const pose = tomeOpeningPose(tome.id, age)
  const at = {
    x: tome.origin.x + (tome.x - tome.origin.x) * travel + pose.x,
    y: tome.origin.y + (tome.y - tome.origin.y) * travel + pose.y
  }
  const art = cardArt(tome.id)
  if (art) drawNativeSprite(context, artwork, art, at, {
    turn: tome.turn * travel + pose.turn, scale: pose.scale, alpha: pose.alpha
  })
}

function drawThunderstormRain(context: CanvasRenderingContext2D, battle: Battle) {
  const config = scene.thunderstormRain
  const [startX, startY] = config.origin
  const diagonal = Math.SQRT1_2
  context.save()
  context.fillStyle = config.color
  for (const tome of battle.tomes) {
    if (tome.id !== 'Tome_Thunderstorm' || tome.until <= battle.clock) continue
    const age = battle.clock - tome.startedAt
    const last = Math.floor(age * config.rate)
    const first = Math.max(1, Math.floor((age - config.lifetime) * config.rate) + 1)
    for (let particle = first; particle <= last; particle++) {
      const seed = tome.uid * 311 + particle * 7
      const speed = config.speed[0] + (config.speed[1] - config.speed[0]) * visualRandom(seed)
      const span = (visualRandom(seed + 1) - .5) * config.emitterSpan
      const depth = (visualRandom(seed + 2) - .5) * config.emitterDepth + (age - particle / config.rate) * speed
      const at = screen({ x: startX + (span - depth) * diagonal, y: startY - (span + depth) * diagonal })
      if (at.x < -10 || at.x > viewport.width + 10 || at.y < -10 || at.y > viewport.height + 10) continue
      const width = (config.width[0] + (config.width[1] - config.width[0]) * visualRandom(seed + 3)) * pixelsPerWorld
      const height = (config.height[0] + (config.height[1] - config.height[0]) * visualRandom(seed + 4)) * pixelsPerWorld
      context.save()
      context.translate(at.x, at.y)
      context.rotate(Math.PI / 4)
      context.fillRect(-width / 2, -height / 2, width, height)
      context.restore()
    }
  }
  context.restore()
}

function drawDashTrails(context: CanvasRenderingContext2D, battle: Battle) {
  const { duration, startWidth, endWidth, widthSteps, startColor, startAlpha, midAlpha } = scene.monkDash.trail
  const cutoff = battle.clock - duration
  context.save()
  for (const trail of battle.dashTrails) {
    for (let i = 1; i < trail.length; i++) {
      const older = trail[i - 1]
      const newer = trail[i]
      if (newer.at <= cutoff) continue
      const clipped = Math.max(0, (cutoff - older.at) / (newer.at - older.at))
      const start = screen({ x: older.x + (newer.x - older.x) * clipped, y: older.y + (newer.y - older.y) * clipped })
      const end = screen(newer)
      const time = (battle.clock - (Math.max(cutoff, older.at) + newer.at) / 2) / duration
      const width = Math.floor(time * widthSteps) / widthSteps
      const opacity = time <= .5 ? startAlpha + (midAlpha - startAlpha) * time * 2 : midAlpha * (1 - time) * 2
      const color = startColor.map(channel => Math.round((channel + (1 - channel) * time) * 255))
      context.lineWidth = (startWidth + (endWidth - startWidth) * width) * pixelsPerWorld
      context.strokeStyle = 'rgba(' + [...color, opacity].join(',') + ')'
      context.beginPath()
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      context.stroke()
    }
  }
  context.restore()
}

function fillFraction(remaining: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
}

function drawUnitBars(context: CanvasRenderingContext2D, battle: Battle, camera: ReturnType<typeof victoryCamera>) {
  const bars = scene.unitBars
  const { clock } = battle
  type Unit = Battle['allies'][number] | Battle['enemies'][number]

  function fill(x: number, y: number, height: number, fraction: number, color: string, alpha = 1) {
    if (fraction <= 0 || alpha <= 0) return
    context.fillStyle = color
    context.globalAlpha = alpha
    context.fillRect(x - bars.width / 2, y, bars.width * fraction, height)
  }

  function draw(unit: Unit, offset: number, healthColor: string, healthAlpha: number, spellFill: number, spellOffset: number) {
    const point = project(unit, camera)
    const healthY = point.y - offset
    const shieldFill = fillFraction(unit.shield, unit.maxShield)
    const shieldY = healthY - bars.healthHeight - bars.gap
    fill(point.x, healthY, bars.healthHeight, fillFraction(unit.hp, unit.maxHp), healthColor, healthAlpha)
    fill(point.x, shieldY, bars.healthHeight, shieldFill, bars.shield)

    const chargeY = (shieldFill > 0 ? shieldY : healthY) - bars.chargeHeight - bars.gap
    const showCharge = unit.chargeIntensity > .001
    if (showCharge) {
      const progress = unit.attackPeriod > 0 ? 1 - fillFraction(unit.attackAt - clock, unit.attackPeriod) : 1
      fill(point.x, chargeY, bars.chargeHeight, progress, bars.attack, unit.chargeIntensity)
    }
    const spellY = showCharge ? chargeY - bars.chargeHeight - bars.gap : point.y - spellOffset
    fill(point.x, spellY, bars.chargeHeight, spellFill, bars.spell)
  }

  context.save()
  for (const unit of battle.allies) {
    if (unit.hp <= 0) continue
    const fraction = fillFraction(unit.hp, unit.maxHp)
    const color = bars.allyHealthLow.map((value, index) =>
      value + (bars.allyHealthHigh[index] - value) * fraction
    )
    const spell = unit.spellPeriod > 0 ? 1 - fillFraction(unit.spellAt - clock, unit.spellPeriod) : 0
    draw(unit, bars.heroOffset, 'rgb(' + color.join(',') + ')', Number(unit.lastDamageAt >= 0), spell, bars.heroSpellOffset)
  }
  for (const unit of battle.enemies) {
    if (unit.hp <= 0) continue
    const data = monsters[unit.id]
    const additionalOffset = 'bossAdditionalBarYOffset' in data ? data.bossAdditionalBarYOffset :
      'native' in data ? data.native.bossAdditionalBarYOffset : 0
    const offset = (bars.monsterOffset + additionalOffset / 2) * data.spriteScale
    const age = clock - unit.lastDamageAt
    const alpha = unit.lastDamageAt < 0 ? 0 : unit.id.startsWith('Boss') ? 1 :
      1 - fillFraction(age - bars.monsterHealthHold, bars.monsterHealthFade)
    let special = 0
    if (unit.id === 'Boss3_Witch') {
      const active = unit.castUntil > clock
      special = active ? 1 - fillFraction(unit.castUntil - clock, monsters.Boss3_Witch.native.necromancerCastDuration) :
        1 - fillFraction(unit.spellAt - clock, unit.spellPeriod)
    }
    const shieldOffset = unit.shield > 0 ? bars.healthHeight + bars.gap : 0
    draw(unit, offset, bars.enemyHealth, alpha, special, offset + shieldOffset + bars.chargeHeight + bars.gap)
  }
  context.restore()
}

export function paintDamageNumbers(context: CanvasRenderingContext2D, view: Presentation, camera: ReturnType<typeof victoryCamera>) {
  const state = view.battle?.damageNumbers
  if (!state || state.mode === 'off' || !state.entries.length) return
  const config = scene.damageNumbers
  context.save()
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  for (const number of state.entries) {
    if (number.shown === null) continue
    const look = damageNumberLook(number, state.clock)
    if (look.alpha <= 0 || look.fontSize <= 0) continue
    const anchor = project({ x: number.anchor.x, y: number.anchor.y + config.worldOffset }, camera)
    const drift = (visualRandom(number.id * 103 + 221) * 2 - 1) * config.driftPixels
    const x = anchor.x + drift
    const y = anchor.y - look.lift
    context.globalAlpha = look.alpha
    context.font = look.fontSize + 'px "Jersey 10", monospace'
    context.lineWidth = Math.max(.6, look.fontSize * .14)
    context.strokeStyle = 'rgba(0,0,0,.65)'
    context.strokeText(look.text, x, y + .45)
    context.fillStyle = look.color
    context.fillText(look.text, x, y)
  }
  context.restore()
}

export function paintQuestPopups(context: CanvasRenderingContext2D, artwork: Artwork, battle: Battle | null,
  camera: ReturnType<typeof victoryCamera>) {
  const state = battle?.damageNumbers
  if (!state?.quests.length) return
  const config = scene.damageNumbers
  const image = artwork.get(config.questText.art)
  if (!image) return
  context.save()
  context.imageSmoothingEnabled = true
  for (const quest of state.quests) {
    const look = questPopupLook(state.clock - quest.at)
    const anchor = project({ x: quest.position.x, y: quest.position.y + config.worldOffset }, camera)
    sprite(context, image, { x: anchor.x, y: anchor.y - look.lift }, image.width * look.scale, image.height * look.scale,
      { alpha: look.alpha })
  }
  context.restore()
}

function drawWitchTransition(context: CanvasRenderingContext2D, artwork: Artwork, phase: WitchRespawn,
  shot: ReturnType<typeof witchShot>, motion: boolean) {
  const id = phase.revealed ? 'Boss3_Witch2' : 'Boss3_Witch'
  const name = cardArt(id, phase.revealed ? 0 : 3)
  if (!name) return
  const image = artwork.get(name)
  if (!image) return
  const pose = { scale: monsters[id].spriteScale, flipX: phase.flip }
  const { center: at, width, height: fullHeight } = spriteMetrics(name, image, phase.point, pose)
  if (!shot.glitch || !motion) {
    sprite(context, image, at, width, fullHeight, pose)
    return
  }
  const scale = fullHeight / image.height
  const sliceCount = Math.min(image.height, witchTransition.bodySliceCount)
  const sample = Math.floor(phase.age / witchTransition.bodyStutterInterval)
  context.save()
  context.translate(at.x, at.y)
  if (phase.flip) context.scale(-1, 1)
  for (let row = 0; row < sliceCount; row++) {
    const y = Math.floor(image.height * row / sliceCount)
    const height = Math.floor(image.height * (row + 1) / sliceCount) - y
    const drift = Math.round(Math.sin(row * 5.9 + sample * 1.6) * witchTransition.bodyGlitchIntensity * 3)
    context.drawImage(image, 0, y, image.width, height, drift - width * .5,
      (y - image.height / 2) * scale, width, height * scale)
  }
  context.restore()
}

function drawParticle(
  context: CanvasRenderingContext2D, artwork: Artwork, kind: ParticleId, at: Point, elapsed: number, size: number,
  turn = 0, appearance?: { height: number; image?: HTMLCanvasElement | HTMLImageElement }
) {
  const atlas = particleArt[kind]
  const texture = appearance?.image ?? artwork.get(atlas.asset)
  if (!texture || elapsed < 0 || elapsed >= 1) return
  const width = texture.width / atlas.columns
  const height = texture.height / atlas.rows
  const count = atlas.columns * (atlas.singleRow ? 1 : atlas.rows)
  const frame = Math.min(count - 1, Math.floor(elapsed * count))
  const row = atlas.singleRow ? atlas.rows - 1 - atlas.row : Math.floor(frame / atlas.columns)
  const center = screen(at)
  const drawHeight = appearance?.height ?? size * height / width
  context.save()
  context.translate(center.x, center.y)
  if (turn) context.rotate(turn)
  context.drawImage(texture, (frame % atlas.columns) * width, row * height, width, height,
    -size / 2, -drawHeight / 2, size, drawHeight)
  context.restore()
}

function drawRaiseDeadAmbient(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, battle: Battle) {
  const config = scene.raiseDead.ambient
  const atlas = artwork.get(particleArt.skeleton.asset)
  if (!atlas) return
  context.save()
  for (const tome of battle.tomes) {
    if (tome.id !== 'Tome_RaiseDead' || tome.until <= battle.clock) continue
    const elapsed = battle.clock - tome.startedAt
    const last = Math.floor(elapsed * config.rate)
    const first = Math.max(1, last - Math.ceil(config.lifetime[1] * config.rate))
    for (let particle = first; particle <= last; particle++) {
      const seed = tome.uid * 173 + particle * 11
      const life = config.lifetime[0] + (config.lifetime[1] - config.lifetime[0]) * visualRandom(seed)
      const fraction = (elapsed - particle / config.rate) / life
      if (fraction < 0 || fraction >= 1) continue
      const x = bonfire.x + (visualRandom(seed + 1) - .5) * config.emitterSize[0]
      const y = bonfire.y + (visualRandom(seed + 2) - .5) * config.emitterSize[1]
      const size = (config.size[0] + (config.size[1] - config.size[0]) * visualRandom(seed + 3)) * pixelsPerWorld
      const tint = visualRandom(seed + 4)
      const shadeStep = Math.round(tint * 15)
      const key = particleArt.skeleton.asset + ':ambient:' + shadeStep
      let tinted = masks.get(key)
      if (!tinted) {
        tinted = document.createElement('canvas')
        tinted.width = atlas.width
        tinted.height = atlas.height
        const layer = tinted.getContext('2d')
        if (layer) {
          layer.drawImage(atlas, 0, 0)
          layer.globalCompositeOperation = 'source-atop'
          const gray = config.gray[0] + (config.gray[1] - config.gray[0]) * shadeStep / 15
          layer.fillStyle = 'rgba(0,0,0,' + (1 - gray) + ')'
          layer.fillRect(0, 0, atlas.width, atlas.height)
          masks.set(key, tinted)
        }
      }
      context.globalAlpha = config.alpha[0] + (config.alpha[1] - config.alpha[0]) * tint
      drawParticle(context, artwork, 'skeleton', { x, y }, fraction, size, 0, { height: size, image: tinted })
    }
  }
  context.restore()
}

function particleSizeAt(curve: number[][], progress: number) {
  const next = curve.findIndex(key => progress < key[0])
  if (next < 1) return next === 0 ? curve[0][1] : curve.at(-1)![1]
  const [start, value, outgoing] = curve[next - 1]
  const [end, endValue, incoming] = curve[next]
  const duration = end - start
  const t = (progress - start) / duration
  const t2 = t * t
  const t3 = t2 * t
  return Math.max(0, (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * duration * outgoing +
    (-2 * t3 + 3 * t2) * endValue + (t3 - t2) * duration * incoming)
}

function drawDragonGround(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, battle: Battle) {
  const config = scene.dragon.ground
  const atlas = artwork.get(particleArt.dragonTrail.asset)
  if (!atlas) return
  for (const dragon of battle.dragons) {
    const speed = Math.abs(dragon.exit.x - dragon.start.x) / (dragon.exitAt - dragon.startedAt)
    const rate = config.ratePerUnit * speed
    const age = battle.clock - dragon.startedAt
    const first = Math.max(1, Math.floor((age - config.lifetime[1]) * rate) + 1)
    const last = Math.floor(Math.min(age, dragon.exitAt - dragon.startedAt) * rate)
    for (let index = first; index <= last; index++) {
      const seed = dragon.uid * 311 + index * 13
      const elapsed = age - index / rate
      const lifetime = config.lifetime[0] + (config.lifetime[1] - config.lifetime[0]) * randomFromSeed(seed)
      const fraction = elapsed / lifetime
      if (fraction < 0 || fraction >= 1) continue
      const p = dragonPosition(dragon, dragon.startedAt + index / rate)
      const angle = 2 * Math.PI * randomFromSeed(seed + 1)
      const size = (config.size[0] + (config.size[1] - config.size[0]) * randomFromSeed(seed + 2)) *
        particleSizeAt(config.sizeCurve, fraction) * pixelsPerWorld
      const tint = Math.round(randomFromSeed(seed + 3) * 15)
      const key = 'dragon-trail:' + tint
      let tinted = masks.get(key)
      if (!tinted) {
        const surface = document.createElement('canvas')
        surface.width = atlas.width
        surface.height = atlas.height
        const layer = surface.getContext('2d')
        if (layer) {
          layer.drawImage(atlas, 0, 0)
          const image = layer.getImageData(0, 0, surface.width, surface.height)
          const color = config.colorMin.map((min, channel) => min + (config.colorMax[channel] - min) * tint / 15)
          for (let offset = 0; offset < image.data.length; offset += 4) {
            for (let channel = 0; channel < 3; channel++) image.data[offset + channel] *= color[channel]
          }
          layer.putImageData(image, 0, 0)
          masks.set(key, surface)
          tinted = surface
        }
      }
      const at = {
        x: p.x + config.offset[0] + Math.cos(angle) * config.shapeRadius,
        y: p.y + config.offset[1] + Math.sin(angle) * config.shapeRadius - config.gravity * elapsed * elapsed / 2
      }
      context.save()
      context.globalAlpha *= 1 - fraction
      drawParticle(context, artwork, 'dragonTrail', at, (fraction * config.atlasCycles) % 1, size, 0, { height: size, image: tinted })
      context.restore()
    }
  }
}

function drawDragons(context: CanvasRenderingContext2D, artwork: Artwork, battle: Battle) {
  const config = scene.dragon
  const mouth = config.mouth
  for (const dragon of battle.dragons) {
    if (dragon.exitAt <= battle.clock) continue
    const p = dragonPosition(dragon, battle.clock)
    const rotation = (dragon.exit.x < dragon.start.x ? 180 - config.headAngle : -config.headAngle) * Math.PI / 180
    const side = Math.cos(rotation)
    const body = { x: p.x + config.bodyOffset[0] * side, y: p.y + config.bodyOffset[1] * side }
    drawNativeSprite(context, artwork, config.body, body, { scale: config.scale, turn: -rotation })
    const age = battle.clock - dragon.startedAt
    const first = Math.max(1, Math.floor((age - mouth.lifetime[1]) * mouth.rate) + 1)
    const last = Math.floor(age * mouth.rate)
    for (let index = first; index <= last; index++) {
      const seed = dragon.uid * 421 + index * 9
      const elapsed = age - index / mouth.rate
      const lifetime = mouth.lifetime[0] + (mouth.lifetime[1] - mouth.lifetime[0]) * randomFromSeed(seed)
      const fraction = elapsed / lifetime
      if (fraction < 0 || fraction >= 1) continue
      const depth = mouth.coneLength * randomFromSeed(seed + 1) + elapsed * mouth.speed
      const scatter = (2 * randomFromSeed(seed + 2) - 1) * depth * Math.tan(mouth.coneAngle * Math.PI / 180)
      const at = { x: p.x + (mouth.offset[0] + scatter) * side, y: p.y + (mouth.offset[1] + depth) * side }
      const size = (mouth.size[0] + (mouth.size[1] - mouth.size[0]) * randomFromSeed(seed + 3)) * pixelsPerWorld
      drawParticle(context, artwork, 'dragonMouth', at, fraction, size, 2 * Math.PI * randomFromSeed(seed + 4), { height: size })
    }
  }
}

function drawMeleeCone(context: CanvasRenderingContext2D, artwork: Artwork, clock: number, effect: Effect) {
  const cone = effect.cone
  if (!cone) return
  const config = scene.enemyCone
  const age = (clock - effect.start) * config.simulationSpeed
  const { axis, length } = cone
  const slope = Math.tan(config.shapeAngle * Math.PI / 180)
  for (let i = 0; i < config.count; i++) {
    const seed = effect.uid * 101 + i * 7
    const life = config.lifetime[0] + (config.lifetime[1] - config.lifetime[0]) * visualRandom(seed)
    const time = age / life
    if (time < 0 || time >= 1) continue
    const scatter = Math.sqrt(visualRandom(seed + 2)) * Math.cos(2 * Math.PI * visualRandom(seed + 3)) * slope
    const depth = length * config.shapeLengthFactor * Math.cbrt(visualRandom(seed + 1)) + age * config.speed
    const lateral = depth * scatter
    const size = (config.size[0] + (config.size[1] - config.size[0]) * visualRandom(seed + 4)) *
      particleSizeAt(config.sizeCurve, time) * pixelsPerWorld
    drawParticle(context, artwork, 'enemyArea', {
      x: effect.x + axis.x * depth - axis.y * lateral,
      y: effect.y + axis.y * depth + axis.x * lateral
    }, time, size, Math.PI * 2 * visualRandom(seed + 5))
  }
}

function drawIllusionistBlasts(context: CanvasRenderingContext2D, artwork: Artwork, battle: Battle) {
  const config = scene.illusionistExplosion
  for (const blast of battle.illusionistBlasts) {
    const age = battle.animationClock - blast.at
    for (let index = 0; index < config.count; index++) {
      const seed = blast.uid * 137 + index * 11
      const lifetime = config.lifetime[0] + (config.lifetime[1] - config.lifetime[0]) * visualRandom(seed)
      const time = age / lifetime
      if (time < 0 || time >= 1) continue
      const angle = 2 * Math.PI * visualRandom(seed + 1)
      const radius = config.scatter * Math.sqrt(visualRandom(seed + 2))
      const at = { x: blast.x + Math.cos(angle) * radius, y: blast.y + Math.sin(angle) * radius }
      const size = config.size[0] + (config.size[1] - config.size[0]) * visualRandom(seed + 3)
      const width = size * config.sizeMultiplier * particleSizeAt(config.sizeCurve, time) * pixelsPerWorld
      drawParticle(context, artwork, 'blast', at, time, width, 2 * Math.PI * visualRandom(seed + 4))
    }
  }
}

function drawTomeSparks(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  kind: TomeSpark, item: Effect, age: number) {
  const config = scene.tomeField.sparks[kind]
  const atlas = particleArt[kind]
  const texture = artwork.get(atlas.asset)
  if (!texture) return
  const [warm, white] = config.color
  for (let index = 0; index < config.count * config.cycles; index++) {
    const pose = tomeSparkPose(kind, item.uid, index, age)
    if (!pose) continue
    const rgb = warm.slice(0, 3).map((channel, i) => Math.round(255 * (channel + (white[i] - channel) * pose.tint / 7)))
    const image = tintedTexture(texture, atlas.asset, rgb, masks)
    const size = pose.size * pixelsPerWorld
    context.save()
    context.globalAlpha *= pose.alpha
    drawParticle(context, artwork, kind, { x: item.x + pose.x, y: item.y + pose.y },
      (pose.frame + .5) / (atlas.columns * atlas.rows), size, 0, { height: size, image })
    context.restore()
  }
}

function drawEffect(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, clock: number, item: Effect) {
  if (item.kind === 'tomeSpark' && (item.art === 'packHit' || item.art === 'packOpen')) {
    drawTomeSparks(context, artwork, masks, item.art, item, clock - item.start)
    return
  }
  if (item.kind === 'thunderbolt') {
    const { asset, frames, emissionDelay, particleLifetime, width, height, offsetY } = scene.thunderbolt
    const time = (clock - item.start - emissionDelay) / particleLifetime
    const atlas = artwork.get(asset)
    if (!atlas || time < 0 || time >= 1) return
    const frameWidth = atlas.width / frames
    const frame = Math.floor(time * frames)
    const at = screen({ x: item.x, y: item.y + offsetY })
    context.drawImage(atlas, frame * frameWidth, 0, frameWidth, atlas.height,
      at.x - width * pixelsPerWorld / 2, at.y - height * pixelsPerWorld / 2, width * pixelsPerWorld, height * pixelsPerWorld)
    return
  }
  if (item.art === 'skeleton') {
    const { size, emissionDelay, lifetime } = scene.raiseDead.spawn
    const pixels = size * pixelsPerWorld
    drawParticle(context, artwork, 'skeleton', item, (clock - item.start - emissionDelay) / lifetime, pixels, 0, { height: pixels })
    return
  }
  if (item.art === 'heroLand') {
    const { emissionDelay, duration, size, opacity } = scene.heroPackEntry.smoke
    context.save()
    context.globalAlpha *= opacity
    drawParticle(context, artwork, item.art, item, (clock - item.start - emissionDelay) / duration, size * pixelsPerWorld)
    context.restore()
    return
  }
  if (item.art === 'spawn' && item.unit && isHero(item.unit)) {
    const { sizes, colors, emissionDelay, duration } = scene.heroPackEntry.burst
    const progress = (clock - item.start - emissionDelay) / duration
    if (progress < 0) return
    const rarity = Math.min(3, heroes[item.unit].rarity)
    const atlas = artwork.get(particleArt.spawn.asset)
    const key = 'hero-spawn:' + rarity
    let tinted = masks.get(key)
    if (!tinted && rarity > 0 && atlas) {
      const surface = document.createElement('canvas')
      surface.width = atlas.width
      surface.height = atlas.height
      const layer = surface.getContext('2d')
      if (layer) {
        layer.drawImage(atlas, 0, 0)
        const pixels = layer.getImageData(0, 0, surface.width, surface.height)
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] *= colors[rarity][channel]
        }
        layer.putImageData(pixels, 0, 0)
        masks.set(key, surface)
        tinted = surface
      }
    }
    const size = sizes[rarity] * pixelsPerWorld
    drawParticle(context, artwork, item.art, item, progress, size, 0, { height: size, image: tinted })
    return
  }
  if (item.cone) {
    drawMeleeCone(context, artwork, clock, item)
    return
  }
  if (item.art) {
    const fraction = (clock - item.start) / (item.until - item.start)
    drawParticle(context, artwork, item.art, item, fraction, 54)
  }
}

const groundFire = projectileConfig.fireball
const groundFireTint = 'rgb(' + groundFire.groundColor.map(value => Math.round(value * 255)).join(',') + ')'

function drawProjectileGround(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, battle: Battle) {
  for (const event of battle.projectileEffects) {
    const age = (battle.clock - event.start) / (event.until - event.start)
    if (age < 0 || age >= 1) continue
    if (event.kind === 'fireGround') {
      const image = artwork.get(groundFire.groundAsset)
      if (!image) continue
      const tinted = masks.get(groundFire.groundAsset) ?? silhouette(image, groundFireTint)
      masks.set(groundFire.groundAsset, tinted)
      const scale = 1 - age
      const { center, width, height } = spriteMetrics(groundFire.groundAsset, image, event, { scale })
      sprite(context, tinted, center, width, height, { alpha: groundFire.groundAlpha * scale })
    } else if (event.kind === 'infectionGround') {
      const config = projectileConfig.infection
      const image = artwork.get(config.groundAsset)
      if (!image) continue
      drawNativeSprite(context, artwork, config.groundAsset, event,
        { scale: event.radius * 2 * config.groundGeometry.pixelsPerUnit / image.width, alpha: config.groundAlpha * (1 - age) })
    }
  }
}

function drawProjectiles(context: CanvasRenderingContext2D, artwork: Artwork, battle: Battle) {
  const config = projectileConfig.fireball
  const flames = artwork.get(config.flameAsset)
  if (flames) {
    const frameSize = flames.width / config.flameFrames
    const size = config.flameSize * pixelsPerWorld
    const coneSlope = Math.tan(config.flameConeAngleDegrees * Math.PI / 180)
    for (const event of battle.projectileEffects) {
      if (event.kind !== 'flame' && event.kind !== 'fireBurst') continue
      const elapsed = battle.clock - event.start
      const life = elapsed / (event.until - event.start)
      if (life < 0 || life >= 1) continue
      const frame = Math.floor(life * config.flameFrames * config.flameFrameMultiplier)
      const burst = event.kind === 'fireBurst'
      const count = burst ? config.burstCount : 1
      const speed = burst ? config.burstParticleSpeed : config.trailParticleSpeed
      const point = screen(event)
      context.save()
      context.globalAlpha *= 1 - life
      context.globalCompositeOperation = 'lighter'
      for (let i = 0; i < count; i++) {
        const sample = event.uid * 109 + i * 3
        const angle = randomFromSeed(sample) * Math.PI * 2
        const fraction = Math.sqrt(randomFromSeed(sample + 1))
        const slope = coneSlope * fraction
        const spread = (config.flameConeRadius * fraction + speed * elapsed * slope / Math.hypot(1, slope)) *
          pixelsPerWorld
        context.save()
        context.translate(point.x + Math.cos(angle) * spread, point.y - Math.sin(angle) * spread)
        context.rotate(randomFromSeed(sample + 2) * 2 * Math.PI)
        context.drawImage(flames, frameSize * frame, 0, frameSize, flames.height,
          -size / 2, -size / 2, size, size)
        context.restore()
      }
      context.restore()
    }
  }
  for (const shot of battle.projectiles) {
    const { asset } = projectileConfig[shot.kind]
    drawNativeSprite(context, artwork, asset, shot, { turn: shot.turn, scale: shot.source.giant ? 1.5 : 1 })
  }
}

function drawPack(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>, view: Presentation, motion: boolean) {
  const elapsed = view.battle?.clock ?? 0
  const progress = Math.min(elapsed / .46, 1)
  for (const [index, pack] of view.campaign.activePacks.entries()) {
    const launch = pack.launch
    if (launch && elapsed < (launch.startsAt ?? 0)) continue
    const thrown = launch && packThrowPose(launch, elapsed, pack.box)
    const at = thrown ?? packLocation(pack, index)
    const lift = pack.position ? 0 : -(1 - progress) * 1.9 + Math.sin(progress * Math.PI) * .34
    const position = thrown ?? { x: at.x, y: at.y + lift }
    const name = packArt(pack.id, false, pack.box) ?? packs[pack.id].packSprite
    const art = artwork.get(name)
    const hitAge = view.time - (view.packHits.get(pack) ?? -Infinity)
    const hit = hitAge < .27
    const stress = hit ? Math.sin(hitAge * packPresentation.hitSquashFrequency) *
      Math.exp(-hitAge * packPresentation.hitSquashDamping) : 0
    const scale = (pack.box ? boxScale : 1) * (1 + stress * packPresentation.hitSquashAmount)
    const pose = { turn: thrown?.turn ?? (-1.11 + (1 - progress) * 1.9 + index * .27), scale }
    drawNativeSprite(context, artwork, name, position, pose)
    const flash = hit ? .88 * (1 - hitAge / .3) : 0
    flashSprite(context, art, masks, name, position, flash, pose)
  }
  for (const open of view.openedPacks) drawTablePackOpening(context, artwork, masks, open, motion)
}

type DissolveSurface = { context: CanvasRenderingContext2D; source: Uint8ClampedArray; frame: ImageData }
const dissolveSurfaces = new WeakMap<HTMLImageElement, DissolveSurface>()

function packSurface(art: HTMLImageElement) {
  let surface = dissolveSurfaces.get(art)
  if (!surface) {
    const canvas = document.createElement('canvas')
    canvas.width = art.width
    canvas.height = art.height
    const layer = canvas.getContext('2d')
    if (!layer) return
    layer.drawImage(art, 0, 0)
    surface = {
      context: layer, source: layer.getImageData(0, 0, art.width, art.height).data,
      frame: layer.createImageData(art.width, art.height)
    }
    dissolveSurfaces.set(art, surface)
  }
  return surface
}

function drawDissolvingPackSprite(context: CanvasRenderingContext2D, art: HTMLImageElement, name: string, at: Point,
  pose: SpritePose, progress: number, white: number, tint: string, seed: number) {
  const metrics = spriteMetrics(name, art, at, pose)
  const origin = geometry[name]?.textureOrigin
  const surface = origin && packSurface(art)
  if (!surface) {
    sprite(context, art, metrics.center, metrics.width, metrics.height, { ...pose, alpha: 1 - progress })
    return
  }
  const { source, frame } = surface
  const thresholds = packDissolveThresholds(progress)
  const edge = [1, 3, 5].map(offset => Number.parseInt(tint.slice(offset, offset + 2), 16))
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const offset = (y * art.width + x) * 4
      const noise = source[offset + 3] && progress > 0 ?
        packDissolveNoise(origin[0] + x, origin[1] + art.height - 1 - y, seed) : 1
      frame.data[offset + 3] = noise < thresholds.cut ? 0 : source[offset + 3]
      if (!frame.data[offset + 3]) continue
      for (let channel = 0; channel < 3; channel++) {
        const color = source[offset + channel]
        frame.data[offset + channel] = noise < thresholds.edge ? edge[channel] : white > 0 ?
          255 * linearToSrgb(white + srgbToLinear(color / 255) * (1 - white)) : color
      }
    }
  }
  surface.context.putImageData(frame, 0, 0)
  sprite(context, surface.context.canvas, metrics.center, metrics.width, metrics.height, pose)
}

type ActiveReveal = NonNullable<Presentation['reveal']>
const discoveryChargeMasks = new WeakMap<ActiveReveal, PackChargeMask>()
const discoveryAuraMasks = new WeakMap<ActiveReveal, Map<string, PackAuraMask>>()

function drawChargedDiscoveryPack(context: CanvasRenderingContext2D, artwork: Artwork, name: string, reveal: ActiveReveal,
  pose: SpritePose, hits: number, hitAge: number, tint: string) {
  const art = artwork.get(name)
  const surface = art && packSurface(art)
  if (!art || !surface) return
  const { source, frame } = surface
  let mask = discoveryChargeMasks.get(reveal)
  if (!mask) {
    mask = createPackChargeMask(source, art.width, art.height, geometry[name]?.textureOrigin ?? [0, 0], reveal.seed)
    discoveryChargeMasks.set(reveal, mask)
  }
  const { charge, flash, white } = discoveryPackCharge(reveal.timeline, reveal.age, hits, hitAge)
  const color = [1, 3, 5].map(offset => Number.parseInt(tint.slice(offset, offset + 2), 16))
  for (let pixel = 0; pixel < art.width * art.height; pixel++) {
    const offset = pixel * 4
    frame.data[offset + 3] = source[offset + 3] < 1 ? 0 : source[offset + 3]
    if (!frame.data[offset + 3]) continue
    const material = packChargeTexel(mask, pixel, charge, flash, reveal.age)
    for (let channel = 0; channel < 3; channel++) {
      const shade = material === 2 ? 255 : material === 1 ? color[channel] : source[offset + channel]
      frame.data[offset + channel] = white > 0 ?
        255 * linearToSrgb(white + srgbToLinear(shade / 255) * (1 - white)) : shade
    }
  }
  surface.context.putImageData(frame, 0, 0)
  const metrics = spriteMetrics(name, art, reveal.position, pose)
  sprite(context, surface.context.canvas, metrics.center, metrics.width, metrics.height, pose)
}

function drawDiscoveryAura(context: CanvasRenderingContext2D, artwork: Artwork, reveal: ActiveReveal,
  name: string, tint: string, pose: SpritePose, material: {
    angles?: readonly number[]; rays?: readonly PackAuraRay[]; dissolve?: number; noiseSeedOffset?: number; rainbowHue?: number
  }) {
  const art = artwork.get(name)
  const surface = art && packSurface(art)
  if (!art || !surface) return
  const { source, frame } = surface
  let masks = discoveryAuraMasks.get(reveal)
  if (!masks) {
    masks = new Map()
    discoveryAuraMasks.set(reveal, masks)
  }
  let mask = masks.get(name)
  if (!mask) {
    const data = geometry[name]
    const cx = (data?.rect?.[2] ?? art.width) * (data?.pivot?.[0] ?? .5) - (data?.textureRectOffset?.[0] ?? 0)
    const cy = (data?.rect?.[3] ?? art.height) * (data?.pivot?.[1] ?? .5) - (data?.textureRectOffset?.[1] ?? 0)
    mask = createPackAuraMask(source, art.width, art.height, data?.textureOrigin ?? [0, 0], cx, cy,
      material.angles ?? [], reveal.seed + (material.noiseSeedOffset ?? 0))
    masks.set(name, mask)
  }
  const rgb = [1, 3, 5].map(offset => srgbToLinear(Number.parseInt(tint.slice(offset, offset + 2), 16) / 255))
  const rainbowHue = material.rainbowHue
  const rainbow = rainbowHue === undefined ? undefined : material.rays?.map((_, index, rays) =>
    packRainbowColor(rainbowHue + index / rays.length).map(channel => srgbToLinear(channel / 255)))
  const thresholds = packDissolveThresholds(material.dissolve ?? 0)
  for (let pixel = 0; pixel < mask.ray.length; pixel++) {
    const offset = pixel * 4
    const slot = mask.ray[pixel]
    const ray = material.rays?.[slot]
    frame.data[offset + 3] = mask.reach[pixel] <= (ray?.reach ?? Infinity) && mask.noise[pixel] >= thresholds.cut
      ? source[offset + 3] : 0
    if (!frame.data[offset + 3]) continue
    const flash = mask.noise[pixel] < thresholds.edge ? 1 : ray?.flash ?? 0
    const color = rainbow?.[slot] ?? rgb
    for (let channel = 0; channel < 3; channel++) {
      const base = srgbToLinear(source[offset + channel] / 255) * color[channel]
      frame.data[offset + channel] = 255 * linearToSrgb(base + (1 - base) * flash)
    }
  }
  surface.context.putImageData(frame, 0, 0)
  const metrics = spriteMetrics(name, art, reveal.position, pose)
  sprite(context, surface.context.canvas, metrics.center, metrics.width, metrics.height, pose)
}

function tintedTexture(texture: HTMLImageElement, assetKey: string, rgb: readonly number[], masks: Map<string, HTMLCanvasElement>) {
  const key = `${assetKey}:${rgb.join(',')}`
  const cached = masks.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = texture.width
  canvas.height = texture.height
  const layer = canvas.getContext('2d')
  if (!layer) return texture
  layer.drawImage(texture, 0, 0)
  const pixels = layer.getImageData(0, 0, texture.width, texture.height)
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] *= rgb[channel] / 255
  }
  layer.putImageData(pixels, 0, 0)
  masks.set(key, canvas)
  return canvas
}

function drawTablePackOpening(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  open: Presentation['openedPacks'][number], motion: boolean) {
  const { pack, position } = open
  const config = pack.box ? boxOpening : ordinaryOpening
  const age = open.age - config.wobbleDuration
  const turn = open.turn ?? -1.11
  const restScale = pack.box ? boxScale : 1
  const closed = packArt(pack.id, false, pack.box) ?? packs[pack.id].packSprite
  const tint = pack.box ? '#ffffff' : packOpeningColors[open.rarity] ?? packOpeningColors[0]
  if (age < 0) {
    const shake = Math.sin(open.age * 40) * .07
    const grow = Math.sin(Math.PI * open.age / config.wobbleDuration) * .3
    drawNativeSprite(context, artwork, closed, position, { turn: turn + shake, scale: restScale * (1 + grow) })
    return
  }

  if (age < config.ripDuration) {
    const pose = packRipPose(age, pack.box)
    const tear = pack.box ? undefined : packs[pack.id].packTearSprite
    const opened = packArt(pack.id, true, pack.box)
    const hasOpenPiece = !!opened && (pack.box || !!tear)
    const name = hasOpenPiece ? opened : closed
    const move = hasOpenPiece ? pose.slide * restScale : 0
    const offset = { x: -Math.sin(turn) * move, y: -Math.cos(turn) * move }
    const scale = restScale * pose.scale
    const drawPiece = (spriteName: string, sign: number, rotation: number) => {
      const at = { x: position.x + sign * offset.x, y: position.y + sign * offset.y }
      const art = artwork.get(spriteName)
      if (!art) return
      drawDissolvingPackSprite(context, art, spriteName, at, { scale, turn: rotation }, pose.dissolve, pose.white,
        tint, open.seed + (sign < 0 ? 37 : 0))
    }
    drawPiece(name, 1, turn + (hasOpenPiece ? pose.openTurn : 0))
    if (tear) drawPiece(tear, -1, turn + pose.tearTurn)
  }

  if (!motion) return
  const center = screen(position)
  // RarityManager's common tier disables the ring. Boxes and foil reveals enable it.
  if (age < config.ringDuration && (pack.box || open.rarity > 0 || open.foil)) {
    const frames = packPresentation.ripRingFrames
    const name = frames[Math.floor(age / config.ringDuration * frames.length)]
    const ring = artwork.get(name)
    if (ring) {
      const size = pixelsPerWorld / 100 * restScale
      let image: CanvasImageSource = ring
      if (!pack.box) {
        const key = name + tint
        const colored = masks.get(key) ?? silhouette(ring, tint)
        masks.set(key, colored)
        image = colored
      }
      sprite(context, image, center, ring.width * size, ring.height * size)
    }
  }

  const seed = Math.floor(position.x * 1013 + position.y * 6673)
  if (age < config.scrapLifetime) {
    const size = config.scrapSize * pixelsPerWorld
    const fall = config.scrapGravity * age ** 2 / 2
    context.save()
    context.globalAlpha *= 1 - (age / config.scrapLifetime) ** 2
    context.fillStyle = tint
    for (let index = 0; index < config.scrapCount; index++) {
      const angle = (20 + 140 * randomFromSeed(seed + index * 2)) * Math.PI / 180
      const travel = config.scrapSpeed * age * (.6 + .6 * randomFromSeed(seed + index * 2 + 1))
      const x = center.x + Math.cos(angle) * travel * pixelsPerWorld
      const y = center.y - (Math.sin(angle) * travel - fall) * pixelsPerWorld
      context.fillRect(x - size / 2, y - size / 2, size, size)
    }
    context.restore()
  }

  const shine = artwork.get(particleArt.packOpen.asset)
  if (!shine) return
  const { lifetime, burstInterval, burstCount, particlesPerBurst, speedRange, sizeRange, radius } = packOpeningShine
  const { columns, rows } = particleArt.packOpen
  const tileWidth = shine.width / columns
  const tileHeight = shine.height / rows
  const particleTint = open.rarity > 0 ? tint : '#ffffff'
  const rgb = [1, 3, 5].map(offset => Number.parseInt(particleTint.slice(offset, offset + 2), 16))
  context.save()
  // ShineMaterial uses Mobile/Particles/Additive with source-alpha blending.
  if (!pack.box) context.globalCompositeOperation = 'lighter'
  const alpha = context.globalAlpha
  for (let burst = 0; burst < burstCount; burst++) {
    const time = age - burst * burstInterval
    if (time < 0 || time >= lifetime) continue
    const fade = alpha * (1 - time / lifetime)
    for (let index = 0; index < particlesPerBurst; index++) {
      const key = seed + 100 + (burst * particlesPerBurst + index) * 6
      const angle = randomFromSeed(key) * 2 * Math.PI
      const z = randomFromSeed(key + 1) * 2 - 1
      const speed = speedRange[0] + (speedRange[1] - speedRange[0]) * randomFromSeed(key + 2)
      const spread = radius * Math.cbrt(randomFromSeed(key + 3))
      const travel = (spread + time * speed) * Math.sqrt(1 - z * z) * pixelsPerWorld
      const size = (sizeRange[0] + (sizeRange[1] - sizeRange[0]) * randomFromSeed(key + 4)) * pixelsPerWorld
      const frame = Math.floor(randomFromSeed(key + 5) * columns * rows)
      const x = center.x + Math.cos(angle) * travel - size / 2
      const y = center.y - Math.sin(angle) * travel - size / 2
      const color = pack.box ? undefined : packShineStartColor(randomFromSeed(key + 903), rgb, !!open.foil)
      const atlas = color ? tintedTexture(shine, particleArt.packOpen.asset, color.rgb, masks) : shine
      context.globalAlpha = fade * (color?.alpha ?? 1)
      context.drawImage(atlas, frame % columns * tileWidth, Math.floor(frame / columns) * tileHeight,
        tileWidth, tileHeight, x, y, size, size)
    }
  }
  context.restore()
}

function drawDiscovery(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  reveal: NonNullable<Presentation['reveal']>, pose: ReturnType<typeof discoveryPose>, camera: ReturnType<typeof victoryCamera>,
  motion: boolean) {
  context.save()
  context.fillStyle = 'rgba(0,0,0,' + pose.dim + ')'
  context.fillRect(0, 0, viewport.width, viewport.height)
  const { zoom, anchor } = camera
  context.translate(sceneCenter.x - anchor.x * zoom, sceneCenter.y - anchor.y * zoom)
  context.scale(zoom, zoom)

  const { pack, position, timeline, rarity, foil, seed } = reveal
  const { cardAge, hitAge, hits, white } = pose
  const tint = packOpeningColors[rarity] ?? packOpeningColors[0]
  const auraRays = foil ? packPresentation.auraFoilRaysSprite : packPresentation.auraRaysSprite
  const auraAngles = foil ? packPresentation.auraFoilRayAngles : packPresentation.auraRayAngles
  const auraLengths = foil ? packPresentation.auraFoilRayLengths : packPresentation.auraRayLengths
  const raySpin = -packPresentation.auraRaysSpinSpeed * Math.PI / 180
  const rays = motion ? packAuraRays(auraLengths, timeline, reveal.age, seed) : []
  if (cardAge < 0) {
    const hit = Math.max(0, Math.min(1, hitAge / packPresentation.chargeStepDuration))
    const kick = motion ? Math.sin(Math.PI * hit) : 0
    const turn = reveal.turn + kick * Math.sin(hitAge * packPresentation.discoveryTremorSpeed) * .05 * timeline.shake
    const scale = 1 + kick * packPresentation.pulseScalePunch
    const name = packArt(pack.id, false, pack.box) ?? packs[pack.id].packSprite
    if (rays.length && hits) {
      drawDiscoveryAura(context, artwork, reveal, auraRays, tint, {
        turn: reveal.age * raySpin, alpha: linearToSrgb(timeline.raysAlpha)
      }, { angles: auraAngles, rays, rainbowHue: foil ? reveal.age * packPresentation.auraFoilHueSpeed : undefined })
    }
    drawChargedDiscoveryPack(context, artwork, name, reveal, { turn, scale }, hits, hitAge, tint)
    if (foil && white > 0) {
      context.restore()
      context.save()
      context.fillStyle = 'rgba(255,255,255,' + white + ')'
      context.fillRect(0, 0, viewport.width, viewport.height)
    }
    context.restore()
    return
  }

  const fade = reveal.exitAge === undefined ? 1 : Math.max(0, 1 - reveal.exitAge / cardDiscovery.discoveryOutroDuration)
  const aura = discoveryAuraLook(cardAge)
  const rainbowHue = foil ? reveal.age * packPresentation.auraFoilHueSpeed : undefined
  const burstLook = motion ? discoveryBurstLook(cardAge, seed) : null
  if (burstLook) {
    const burst = packPresentation.revealBurstRayLengths.map(length => ({
      reach: length * burstLook.reach, flash: burstLook.flash
    }))
    drawDiscoveryAura(context, artwork, reveal, packPresentation.revealBurstRaysSprite, foil ? '#ffffff' : tint, {
      alpha: linearToSrgb(packPresentation.revealBurstRaysAlpha), turn: burstLook.turn
    }, {
      angles: packPresentation.revealBurstRayAngles, rays: burst, dissolve: burstLook.dissolve,
      noiseSeedOffset: 51.7, rainbowHue
    })
  }
  drawDiscoveryAura(context, artwork, reveal, packPresentation.auraGlowSprite, tint, {
    scale: aura.glowScale, alpha: linearToSrgb(timeline.glowAlpha * aura.alpha) * fade
  }, { dissolve: aura.glowDissolve })
  if (rays.length) drawDiscoveryAura(context, artwork, reveal, auraRays, tint, {
    turn: reveal.age * raySpin + aura.extraTurn, alpha: linearToSrgb(timeline.raysAlpha * aura.alpha) * fade
  }, { angles: auraAngles, rays, rainbowHue })
  drawTablePackOpening(context, artwork, masks,
    { pack, position, age: cardAge, turn: reveal.turn, rarity, foil, seed }, motion)

  const name = cardArt(reveal.card)
  if (name && pose.cardScale > 0) {
    context.save()
    if (foil) context.filter = 'saturate(1.5) brightness(1.21)'
    drawNativeSprite(context, artwork, name, position, { scale: pose.cardScale, alpha: fade })
    context.restore()
  }
  context.restore()
}

function drawCursor(context: CanvasRenderingContext2D, artwork: Artwork, masks: Map<string, HTMLCanvasElement>,
  cursor: Cursor, battle: Battle | null, motion: boolean) {
  const at = screen(cursor)
  const config = scene.cursorPresentation
  const profile = battle && cursorProfile(battle)
  const pop = battle && motion ? cursorPopScale(battle.clock - battle.cursorPulseAt) : 1
  const radius = cursor.radius * pixelsPerWorld * (profile?.radius ?? 1) * pop
  const frenzy = profile?.stacks ? tomes[frenzyTome].native : null
  const fraction = battle && profile ? 1 - Math.max(0, Math.min((battle.nextPulse - battle.clock) / profile.interval, 1)) : .82
  const end = (2 * fraction - .5) * Math.PI
  context.strokeStyle = frenzy ? 'rgba(' + frenzy.cursorDpsRangeRingColor.join(',') + ')' :
    battle ? 'rgba(255,255,255,' + config.ringAlpha + ')' : ringColor
  context.lineWidth = battle ? config.width * pixelsPerWorld : .86
  context.beginPath()
  if (battle) {
    context.moveTo(at.x + radius, at.y)
    for (let segment = 1; segment < config.segments; segment++) {
      const angle = 2 * Math.PI * segment / config.segments
      context.lineTo(at.x + radius * Math.cos(angle), at.y + radius * Math.sin(angle))
    }
    context.closePath()
  } else context.arc(at.x, at.y, radius, 0, 2 * Math.PI)
  context.stroke()
  const texture = artwork.get('cursor-ring.png')
  if (battle && texture && fraction > 0) {
    context.save()
    context.beginPath()
    context.moveTo(at.x, at.y)
    context.arc(at.x, at.y, radius, -Math.PI / 2, end)
    context.closePath()
    context.clip()
    const fill = frenzy?.cursorDpsRadialFillColor
    const image = fill ? tintedTexture(texture, 'cursor-ring.png', fill.slice(0, 3), masks) : texture
    sprite(context, image, at, radius * 2, radius * 2, { alpha: fill?.[3] ?? config.radialAlpha })
    context.restore()
  }
  if (!battle && cursor.pressed) {
    context.strokeStyle = 'rgba(241,248,208,.38)'
    context.lineWidth = 1.12
    context.beginPath()
    context.arc(at.x, at.y, radius, -Math.PI / 2, end)
    context.stroke()
  }
}

export const artNames = [
  scene.damageNumbers.questText.art,
  'mastery-fly.png',
  'intro-box-0.png', 'intro-box-1.png', 'logo-zh.png', 'logo-rays.png', 'logo-rays-alternate.png',
  'ground-chapter1.png', 'bonfire.png', 'bonfire-destroyed.png',
  'pack-closed.png', 'pack-open.png', 'pack-tear.png', 'cursor-ring.png',
  ...towerArt.lights.map(light => light.sprite),
  scene.defeat.smoke.asset,
  ...chapters.flatMap(chapter => [chapter.ground, ...chapter.rim, ...chapter.decor]),
  ...supporterTowerSkin.bodies, supporterTowerSkin.destroyed,
  packPresentation.auraRaysSprite, packPresentation.auraGlowSprite, packPresentation.revealBurstRaysSprite,
  ...packPresentation.ripRingFrames,
  ...Object.values(buildings).map(building => building.worldSprite),
  ...Object.values(particleArt).map(item => item.asset),
  scene.dragon.body,
  scene.thunderbolt.asset,
  ...Object.values(projectileConfig).map(item => item.asset),
  projectileConfig.fireball.flameAsset, projectileConfig.fireball.groundAsset, projectileConfig.infection.groundAsset,
  heroes.Hero2_Monk.frames.dashSprite, heroes.Hero3_Illusionist.frames.altSprite, ...portalSprites,
  ...Object.keys({ ...heroes, ...monsters, ...tomes, ...relics })
    .flatMap(name => [0, 1, 2, 3, 4, 5].map(frame => cardArt(name as CardId | MonsterId, frame))),
  ...Object.keys(packs).flatMap(id => {
    const key = id as keyof typeof packs
    return [packArt(key), packArt(key, true), packArt(key, false, true), packArt(key, true, true), packs[key].packTearSprite]
  })
]

export function paintArenaFrame(
  context: CanvasRenderingContext2D, backdrop: HTMLCanvasElement, artwork: Artwork,
  masks: Map<string, HTMLCanvasElement>, view: Presentation, pointer: Cursor | null, motion: boolean, crt = false
) {
  const respawn = view.battle?.respawn
  const shot = respawn && witchShot(respawn)
  const reveal = view.reveal
  const discovery = reveal && discoveryPose(reveal.timeline, reveal.age, reveal.exitAge)
  const revealFocus = discovery && motion ? discovery.focus : 0
  const drawAt = reveal ? screen(reveal.position) : sceneCenter
  const victory = view.battle?.summary?.result === 'victory'
  const defeat = view.campaign.summary?.result === 'defeat'
  const defeatedBoss = view.battle?.bossDefeat
  const bossAge = defeatedBoss && view.battle ? view.battle.clock - defeatedBoss.at : 0
  const corpse = defeatedBoss && bossDefeatPose(defeatedBoss, bossAge + (victory ? view.victoryAge : 0), motion)
  const camera = victory ? victoryCamera(defeatedBoss ?? null, bossAge, view.victoryAge, motion) : null
  const summaryCamera = defeat ? defeatCamera(view.summaryAge, motion) : camera
  const arrival = scene.arrivalCamera
  const arrivalTime = view.arrival && motion ? Math.min(1, view.arrival.age / arrival.duration) : 1
  const arrivalProgress = arrivalTime * arrivalTime * (3 - 2 * arrivalTime)
  const arrivalOrthoSize = arrival.startOrthoSize + (arrival.wideOrthoSize - arrival.startOrthoSize) * arrivalProgress
  const zoom = view.story?.ending === 'summary' || view.story?.ending === 'gate' ? actEndingTowerZoom : summaryCamera ? summaryCamera.zoom :
    view.campaign.summary ? 1 + 1.33 * animationEase(view.summaryAge / .65) :
    discovery ? (motion ? discovery.zoom : 1) :
    shot && motion ? 1 + (world.height / (2 * witchTransition.zoomInSize) - 1) * shot.focus :
    arrival.wideOrthoSize / arrivalOrthoSize
  const focus = respawn && motion ? screen(respawn.point) : sceneCenter
  const anchor = summaryCamera ? summaryCamera.anchor : reveal ? {
    x: sceneCenter.x + (drawAt.x - sceneCenter.x) * revealFocus,
    y: sceneCenter.y + (drawAt.y - sceneCenter.y) * revealFocus
  } : shot ? {
    x: sceneCenter.x + (focus.x - sceneCenter.x) * shot.focus,
    y: sceneCenter.y + (focus.y - sceneCenter.y) * shot.focus
  } : sceneCenter
  const shake = motion && view.preferences.screenShake ?
    (victory ? victoryShake(view.victoryAge) : towerCameraShake(view.battle, defeat ? view.summaryAge : undefined)) : { x: 0, y: 0 }
  const worldAnchor = { x: anchor.x + shake.x, y: anchor.y + shake.y }
  context.save()
  context.translate(sceneCenter.x - worldAnchor.x * zoom, sceneCenter.y - worldAnchor.y * zoom)
  context.scale(zoom, zoom)
  const left = worldAnchor.x - sceneCenter.x / zoom
  const top = worldAnchor.y - sceneCenter.y / zoom
  const width = viewport.width / zoom
  const height = viewport.height / zoom
  const chapter = view.battle?.chapter ?? view.campaign.dayNumber
  if (left < 0 || top < 0 || left + width > viewport.width || top + height > viewport.height) {
    paintGround(context, artwork, chapter, left, top, width, height)
  }
  context.drawImage(backdrop, 0, 0)

  const tower = towerPosition(view.battle, motion)
  if (view.campaign.introComplete) {
    drawTowerLights(context, artwork, masks, chapter, tower, view.time, false, motion)
    if (view.battle) drawProjectileGround(context, artwork, masks, view.battle)
    if (view.battle) drawDragonGround(context, artwork, masks, view.battle)
    if (view.battle) {
      drawPack(context, artwork, masks, view, motion)
      if (defeatedBoss && corpse) {
        const name = cardArt(defeatedBoss.id, corpse.frame)
        if (name) drawNativeSprite(context, artwork, name, corpse, {
          turn: corpse.turn, scale: monsters[defeatedBoss.id].spriteScale, flipX: defeatedBoss.flip
        })
      }
      drawFallenUnits(context, artwork, view.battle, motion)
      drawFighters(context, artwork, masks, view.battle, view, tower)
      drawTowerHitParticles(context, view.battle, motion)
      if (defeat) drawTowerDeathSmoke(context, artwork, masks, view.battle, view.summaryAge, motion)
      drawDashTrails(context, view.battle)
      drawProjectiles(context, artwork, view.battle)
      drawDragons(context, artwork, view.battle)
      for (const effect of view.battle.effects) drawEffect(context, artwork, masks, view.battle.clock, effect)
      drawIllusionistBlasts(context, artwork, view.battle)
      drawThunderstormRain(context, view.battle)
      drawRaiseDeadAmbient(context, artwork, masks, view.battle)
    } else drawTower(context, artwork, masks, view, tower)
    drawTowerLights(context, artwork, masks, chapter, tower, view.time, true, motion)
    if (respawn && shot) {
      context.fillStyle = 'rgba(11,4,18,' + (shot.focus * .57) + ')'
      context.fillRect(0, 0, viewport.width, viewport.height)
      drawWitchTransition(context, artwork, respawn, shot, motion)
    }
  } else {
    drawCrate(context, artwork, masks, view)
  }
  context.restore()
  if (view.battle && view.campaign.introComplete && !view.battle.summary && !view.campaign.summary && !respawn && !reveal) {
    drawUnitBars(context, view.battle, { zoom, anchor: worldAnchor })
    drawTowerBar(context, view.battle, tower, { zoom, anchor: worldAnchor })
  }
  if (camera && defeatedBoss && motion) drawVictoryMastery(context, artwork, defeatedBoss, bossAge, view.victoryAge, camera)
  if (shot && shot.flood > 0) {
    context.fillStyle = 'rgba(175,144,201,' + shot.flood * (motion ? .28 : .12) + ')'
    context.fillRect(0, 0, viewport.width, viewport.height)
  }
  if (!view.campaign.introComplete && view.introAge !== null) drawLogo(context, artwork, view)
  if (reveal && discovery) drawDiscovery(context, artwork, masks, reveal, discovery, { zoom, anchor: worldAnchor }, motion)
  if (pointer && !view.paused && !view.reveal && !respawn && !view.campaign.summary && view.introAge === null) {
    if (!view.campaign.introComplete || view.campaign.resumePhase === 'beginning') {
      drawCursor(context, artwork, masks, pointer, view.battle, motion)
    }
  }
  if (!crt) {
    const vignette = context.createRadialGradient(sceneCenter.x, sceneCenter.y, 80, sceneCenter.x, sceneCenter.y, viewport.width * .62)
    vignette.addColorStop(0, 'transparent')
    vignette.addColorStop(.62, chapter === 1 ? 'rgba(0,6,4,.12)' : 'rgba(10,0,5,.08)')
    vignette.addColorStop(1, 'rgba(0,2,0,.59)')
    context.fillStyle = vignette
    context.fillRect(0, 0, viewport.width, viewport.height)
    context.strokeStyle = 'rgba(0,0,0,.46)'
    context.lineWidth = 8
    context.strokeRect(0, 0, viewport.width, viewport.height)
  }
  return { zoom, anchor: worldAnchor }
}

export function ArenaCanvas({ model, pointer, crtAvailable, onCrtChange }: {
  model: Presentation
  pointer: RefObject<Cursor>
  crtAvailable: boolean
  onCrtChange: (available: boolean) => void
}) {
  const element = useRef<HTMLCanvasElement>(null)
  const crtElement = useRef<HTMLCanvasElement>(null)
  const overlayElement = useRef<HTMLCanvasElement>(null)
  const showCrt = crtAvailable && model.preferences.crt
  const current = useRef({ model, pointer })
  current.current = { model, pointer }

  useEffect(() => {
    const canvas = element.current
    const context = canvas?.getContext('2d')
    const crtSurface = crtElement.current
    const overlay = overlayElement.current
    const overlayContext = overlay?.getContext('2d')
    if (!canvas || !context || !crtSurface || !overlay || !overlayContext) return
    let crtRenderer: ReturnType<typeof createCrtRenderer> = null
    let crtAttempted = false
    let dirty = true
    let disposed = false
    const loseCrt = (event: Event) => {
      event.preventDefault()
      crtRenderer = null
      dirty = true
      onCrtChange(false)
    }
    const restoreCrt = () => {
      crtAttempted = false
      dirty = true
    }
    crtSurface.addEventListener('webglcontextlost', loseCrt)
    crtSurface.addEventListener('webglcontextrestored', restoreCrt)
    const artwork: Artwork = new Map()
    const masks = new Map<string, HTMLCanvasElement>()
    const backdrop = document.createElement('canvas')
    backdrop.width = viewport.width
    backdrop.height = viewport.height
    let backdropDirty = true
    let paintedChapter: ChapterId | undefined
    const terrainNames = new Set(chapters.flatMap(chapter => [chapter.ground, ...chapter.rim, ...chapter.decor]))
    for (const name of new Set(artNames)) {
      if (!name) continue
      const url = asset(name)
      if (!url) continue
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        if (disposed) return
        artwork.set(name, image)
        if (terrainNames.has(name)) backdropDirty = true
        dirty = true
      }
      image.src = url
    }

    const size = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 1280 / bounds.width, 720 / bounds.height)
      const width = Math.max(1, Math.round(bounds.width * ratio))
      const height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      dirty = true
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(canvas)
    let frame = 0
    let nextPaint = 0
    let wasStill = false
    let paintedCampaign: Presentation['campaign'] | undefined
    let paintedPreferences: Presentation['preferences'] | undefined
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionChanged = () => { dirty = true }
    const paint = (now: number) => {
      frame = requestAnimationFrame(paint)
      if (document.hidden) return
      const { model: view, pointer } = current.current
      if (view.menu) {
        dirty = true
        return
      }
      const still = view.paused || (view.campaign.introComplete && view.campaign.resumePhase === 'prepare' && !view.arrival && !view.story)
      const changed = dirty || still !== wasStill || (still && paintedCampaign !== view.campaign) ||
        paintedPreferences !== view.preferences
      if (still && !changed) return
      const interval = 1000 / (view.preferences.frameRate || 60)
      if (!changed && now + .75 < nextPaint) return
      nextPaint = changed ? now + interval : Math.max(nextPaint + interval, now)
      dirty = false
      wasStill = still
      paintedCampaign = view.campaign
      paintedPreferences = view.preferences

      if (view.preferences.crt && !crtAttempted) {
        crtAttempted = true
        crtRenderer = createCrtRenderer(crtSurface)
        onCrtChange(Boolean(crtRenderer))
      } else if (!view.preferences.crt && crtAttempted) {
        crtRenderer?.dispose()
        crtRenderer = null
        crtAttempted = false
        crtSurface.width = crtSurface.height = 1
        overlay.width = overlay.height = 1
        onCrtChange(false)
      }
      const chapter = view.battle?.chapter ?? view.campaign.dayNumber
      if (backdropDirty || paintedChapter !== chapter) {
        paintBackdrop(backdrop, artwork, chapter)
        backdropDirty = false
        paintedChapter = chapter
      }
      const scaleX = canvas.width / viewport.width
      const scaleY = canvas.height / viewport.height
      context.setTransform(scaleX, 0, 0, scaleY, 0, 0)
      context.imageSmoothingEnabled = false
      const crt = view.preferences.crt ? crtRenderer : null
      const aim = pointer.current ?? (!view.campaign.introComplete
        ? { x: -.85, y: -2.24, radius: rules.cursor.baseRadius, pressed: false } : null)
      const camera = paintArenaFrame(context, backdrop, artwork, masks, view, aim, !reducedMotion.matches, Boolean(crt))
      if (crt) {
        crt.paint(canvas, battleCrtLook(view))
        if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
          overlay.width = canvas.width
          overlay.height = canvas.height
        }
        overlayContext.setTransform(scaleX, 0, 0, scaleY, 0, 0)
        overlayContext.clearRect(0, 0, viewport.width, viewport.height)
      }
      const foreground = crt ? overlayContext : context
      paintDamageNumbers(foreground, view, camera)
      paintQuestPopups(foreground, artwork, view.battle, camera)
    }
    const visibilityChanged = () => {
      cancelAnimationFrame(frame)
      dirty = true
      if (!document.hidden) frame = requestAnimationFrame(paint)
    }
    visibilityChanged()
    document.addEventListener('visibilitychange', visibilityChanged)
    reducedMotion.addEventListener('change', motionChanged)
    return () => {
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibilityChanged)
      reducedMotion.removeEventListener('change', motionChanged)
      crtSurface.removeEventListener('webglcontextlost', loseCrt)
      crtSurface.removeEventListener('webglcontextrestored', restoreCrt)
      crtRenderer?.dispose()
    }
  }, [onCrtChange])

  return <>
    <canvas ref={element} className="arena-layer arena-canvas" aria-hidden="true" style={{
      visibility: showCrt ? 'hidden' : undefined,
      filter: showCrt ? 'none' : 'brightness(' + model.preferences.brightness + ') contrast(' + model.preferences.contrast + ')'
    }} />
    <canvas ref={crtElement} className="arena-layer arena-crt" aria-hidden="true" hidden={!showCrt} />
    <canvas ref={overlayElement} className="arena-layer arena-overlay" aria-hidden="true" hidden={!showCrt} />
  </>
}
