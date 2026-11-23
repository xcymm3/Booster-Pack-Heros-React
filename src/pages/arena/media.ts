import projectiles from '../../data/projectiles.json'
import scene from '../../data/scene-canvas.json'
import type { Battle } from '../../game/combat'
import type { Flight } from '../../game/projectiles'
import { tomes } from '../../game/rules'

const media = import.meta.glob<string>([
  '../../assets/**/*.{png,wav,ogg,mp3,flac}',
  '!../../assets/soundtrack/*.wav',
  '!../../assets/chapter-2-3/517-*.wav'
], {
  eager: true,
  import: 'default',
  query: '?url'
})

export function asset(name: string) {
  const key = '../../assets/' + name
  return media[key] ?? (name.endsWith('.wav') ? media[key.slice(0, -4) + '.flac'] : undefined)
}

const audio = new Map<string, HTMLAudioElement>()
const soundCacheLimit = 24

export function releaseAudio(player: HTMLAudioElement) {
  player.pause()
  player.removeAttribute('src')
  player.load()
}

function trimSoundCache() {
  for (const [name, player] of audio) {
    if (audio.size <= soundCacheLimit) break
    if (!player.paused && !player.ended) continue
    audio.delete(name)
    releaseAudio(player)
  }
}

export function playSound(name: string, volume: number) {
  const url = asset(/\.(wav|ogg|mp3|flac)$/i.test(name) ? name : name + '.wav')
  if (!url || volume <= 0) return
  let player = audio.get(name)
  if (!player) {
    player = new Audio()
    player.preload = 'none'
    player.src = url
    player.addEventListener('ended', trimSoundCache)
  }
  audio.delete(name)
  audio.set(name, player)
  player.volume = volume
  player.currentTime = 0
  void player.play().catch(() => {})
  trimSoundCache()
}

export function stopSound(name: string) {
  const player = audio.get(name)
  if (!player) return
  audio.delete(name)
  releaseAudio(player)
}

export function silenceSounds() {
  audio.forEach(releaseAudio)
  audio.clear()
}

function createLoopAudio<T>(getSound: (item: T) => { name: string; gain: number } | undefined) {
  const players = new Map<T, { player: HTMLAudioElement; gain: number }>()
  let playing = false

  return (active: readonly T[] | undefined, sfx: number) => {
    for (const [item, { player }] of players) {
      if (!active?.includes(item)) {
        releaseAudio(player)
        players.delete(item)
      } else if (sfx <= 0 && playing) {
        player.pause()
      }
    }
    if (sfx > 0 && active) {
      for (const item of active) {
        let loop = players.get(item)
        const needsStart = !loop || !playing
        if (!loop) {
          const sound = getSound(item)
          const url = sound && asset(sound.name)
          if (!sound || !url) continue
          const player = new Audio()
          player.preload = 'none'
          player.src = url
          player.loop = true
          loop = { player, gain: sound.gain }
          players.set(item, loop)
        }
        const { player, gain } = loop
        const volume = sfx * gain
        if (player.volume !== volume) player.volume = volume
        if (needsStart) void player.play().catch(() => {})
      }
    }
    playing = sfx > 0
  }
}

const fireballLoop = { name: projectiles.fireball.flightSound, gain: projectiles.fireball.flightSoundVolume }

export function createFireballAudio() {
  return createLoopAudio<Flight>(shot => shot.kind === 'fireball' ? fireballLoop : undefined)
}

export function createTomeAudio() {
  return createLoopAudio<Battle['tomes'][number]>(tome => {
    const definition = tomes[tome.id]
    if (definition.buffAmbientLoopSFX) {
      return { name: definition.buffAmbientLoopSFX, gain: definition.native.buffAmbientVolume }
    }
  })
}

export function createDragonAudio() {
  const flight = { name: scene.dragon.flightSound, gain: scene.dragon.flightVolume }
  return createLoopAudio<Battle['dragons'][number]>(() => flight)
}

