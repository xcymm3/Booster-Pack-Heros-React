// SoundManager in level1:38208 and 46395. Chapters 1–3 use these shared pools.
const battleTracks = [382, 315, 258, 300, 285, 325, 310]
const improvementsTracks = [380, 248, 265]
const ambientTrack = 268
const battleVolume = .449
const improvementsVolume = .426
const ambientVolume = .173
const summaryFadeSeconds = 1.25
const surgePitch = 1.06

export type ChapterAudioFrame = {
  phase: 'quiet' | 'battle' | 'summary' | 'improvements'
  attempt: number
  volume: number
  muted: boolean
  hidden: boolean
  menu: boolean
  cinematicPause: boolean
  surge: boolean
  discoveryGain: number
}

function loopPlayer(asset: (name: string) => string | undefined, createPlayer: () => HTMLAudioElement) {
  let player: HTMLAudioElement | undefined
  let track: number | undefined
  let requestedPlay = false

  return (next: number | undefined, gain: number, suspended: boolean, rate: number, retry: boolean, restart = false) => {
    if (next === undefined) {
      if (track !== undefined && player) {
        player.pause()
        player.removeAttribute('src')
        player.load()
        track = undefined
        requestedPlay = false
      }
      return
    }
    if (next !== track || restart) {
      const url = asset(`soundtrack/${next}.wav`)
      if (!url) return
      player ??= createPlayer()
      player.preload = 'none'
      player.pause()
      player.loop = true
      player.preservesPitch = false
      player.src = url
      track = next
      requestedPlay = false
    }
    if (!player) return
    if (player.volume !== gain) player.volume = gain
    if (player.playbackRate !== rate) player.playbackRate = rate
    if (suspended) {
      if (!player.paused) player.pause()
      requestedPlay = false
    } else if (player.paused && (!requestedPlay || retry)) {
      // Retry a rejected play on real input, without polling play() every frame.
      requestedPlay = true
      void player.play().catch(() => {})
    }
  }
}

export function createChapterAudio(
  asset: (name: string) => string | undefined,
  random = Math.random,
  createPlayer = () => new Audio()
) {
  const music = loopPlayer(asset, createPlayer)
  const ambient = loopPlayer(asset, createPlayer)
  const pick = (tracks: readonly number[]) => tracks[Math.floor(random() * tracks.length)]
  let phase: ChapterAudioFrame['phase'] = 'quiet'
  let attempt = -1
  let track: number | undefined
  let summaryAge = 0
  let battleGain = 1
  let battlePitch = 1

  function update(frame: ChapterAudioFrame, dt: number, retry = false) {
    // Suspend battle music while the tab or game scene is out of view.
    const suspended = frame.hidden || frame.menu
    const userGain = frame.muted ? 0 : frame.volume
    ambient(frame.menu ? undefined : ambientTrack, ambientVolume * userGain, suspended, 1, retry)
    if (frame.menu) {
      music(track, 0, true, 1, false)
      return
    }
    const phaseChanged = frame.phase !== phase
    const newBattle = frame.phase === 'battle' && (phaseChanged || attempt !== frame.attempt)
    const newImprovements = frame.phase === 'improvements' && phaseChanged
    if (newBattle) track = pick(battleTracks)
    else if (newImprovements) track = pick(improvementsTracks)
    else if (frame.phase === 'quiet' || (frame.phase === 'summary' && phaseChanged && phase !== 'battle')) track = undefined

    phase = frame.phase
    attempt = frame.attempt
    if (phase === 'battle') {
      battleGain = frame.discoveryGain
      battlePitch = frame.surge ? surgePitch : 1
    }
    if (phase === 'summary') {
      summaryAge = phaseChanged ? 0 : summaryAge + (suspended ? 0 : dt)
      if (summaryAge >= summaryFadeSeconds) track = undefined
    }

    const gain = phase === 'improvements' ? improvementsVolume :
      battleVolume * battleGain * (phase === 'summary' ? Math.max(0, 1 - summaryAge / summaryFadeSeconds) : 1)
    const pitch = phase === 'improvements' ? 1 : battlePitch
    music(track, gain * userGain, suspended || frame.cinematicPause, pitch, retry, newBattle || newImprovements)
  }

  function dispose() {
    music(undefined, 0, true, 1, false)
    ambient(undefined, 0, true, 1, false)
    phase = 'quiet'
    track = undefined
  }

  return { update, dispose }
}
