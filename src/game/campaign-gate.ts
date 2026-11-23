import { campaignDoor } from './rules'
import { evaluateCurve } from './unity-curve'
import type { UpgradeView } from './upgrade-camera'

const { native, visual, keys } = campaignDoor
const focusDuration = native.doorOpenFocusDuration
const blinkTimes: number[] = []
let blinkTime = focusDuration
for (let loop = 0; loop < native.keyBlinkLoops; loop++) {
  const interval = native.keyBlinkStartInterval * native.keyBlinkIntervalScale ** loop
  for (const _key of keys) {
    blinkTimes.push(blinkTime)
    blinkTime += interval
  }
}

// OpenRoutine rounds the fraction of key pulses to choose when the door starts dissolving.
const dissolveAt = blinkTimes[Math.round(blinkTimes.length * native.keyBlinkDissolveStart)]
const diveAt = dissolveAt + visual.dissolveDuration + visual.particleLifetime.x
const diveDuration = .6
const fadeAt = diveAt + diveDuration + .2
const fadeDuration = .9
const focusZoom = 1.84
const dissolveCurve = visual.dissolveCurve.m_Curve.map(key => [key.time, key.value, key.inSlope, key.outSlope])
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (value: number) => value * value * (3 - 2 * value)
const blend = (from: number, to: number, t: number) => from + (to - from) * t

export const gateBlinkTimes: readonly number[] = blinkTimes
export const gateDissolveAt = dissolveAt
export const gateTransitionDuration = fadeAt + fadeDuration
// The tower stays at this camera distance through the post-dive fade and the act report.
export const actEndingTowerZoom = 1.56

export type GateCamera = {
  view: UpgradeView
  offset: { x: number; y: number }
  centerDelta: { x: number; y: number }
}

export function campaignGatePose(age: number, motion = true) {
  const focus = ease(clamp(age / focusDuration))
  const dive = ease(clamp((age - diveAt) / diveDuration))
  const dissolve = evaluateCurve(dissolveCurve, clamp((age - dissolveAt) / visual.dissolveDuration))
  let pulse = blinkTimes.findIndex(time => time > age)
  pulse = (pulse < 0 ? blinkTimes.length : pulse) - 1
  const sincePulse = pulse >= 0 ? age - blinkTimes[pulse] : Infinity
  return {
    age, focus, dive, dissolve, opacity: 1 - ease(clamp((age - fadeAt) / fadeDuration)),
    key: motion && sincePulse < native.keyBlinkDuration ? pulse % keys.length : -1,
    keyFlash: motion ? clamp((1 - sincePulse / native.keyBlinkDuration) / .6) : 0,
    zoom: blend(1, native.doorEnterZoom, motion ? dive : 0),
    particleAge: motion ? age - dissolveAt : -1
  }
}

export function campaignGateView(camera: GateCamera, pose: ReturnType<typeof campaignGatePose>, motion: boolean): UpgradeView {
  if (!motion) return camera.view
  const { view, offset, centerDelta } = camera
  const zoom = blend(view.zoom, focusZoom, pose.focus) * pose.zoom
  return {
    x: view.x + centerDelta.x * pose.focus - offset.x * (zoom - view.zoom),
    y: view.y + centerDelta.y * pose.focus - offset.y * (zoom - view.zoom),
    zoom
  }
}
