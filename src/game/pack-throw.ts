import { bonfire, packPresentation, world, type Point } from './rules'
import { boxOpening } from './pack-opening'

export type PackThrow = { from: Point; target: Point; turn: number; spin: number; startsAt?: number; fromOpenedBox?: true }
type ThrowFrame = Point & { turn: number }

const halfWidth = world.width / 2
const halfHeight = world.height / 2
const offscreenPadding = Math.max(halfWidth, halfHeight) * .15 + .5
const toRadians = Math.PI / 180
const step = 1 / 120
const boxFriction = 11
export const boxScale = 1.2
// GameManager's preparation animation.
export const purchaseThrowSpread = 1
export const packHitRadius = (box?: boolean) => box ? .15 * boxScale : .15

// WaveSpawner in level1:39119 and the booster exclusion radius on the Bonfire.
const landingRadius = { x: 2.5, y: 1.5 }
const towerRadius = .4
const towerClearance = towerRadius + .25
const framesForThrow = new WeakMap<PackThrow, ThrowFrame[]>()

export function planPackThrow(random: () => number, box = false, startsAt = 0): PackThrow {
  const innerRadius = towerRadius + (box ? .198 : .195)
  let target: Point
  let direction: number
  for (let attempt = 0; ; attempt++) {
    direction = random() * Math.PI * 2
    const distance = Math.sqrt(random())
    const x = Math.cos(direction) * distance * landingRadius.x
    const y = Math.sin(direction) * distance * landingRadius.y
    if (Math.hypot(x, y) >= innerRadius || attempt === 15) {
      direction = Math.atan2(Math.sin(direction) * landingRadius.y, Math.cos(direction) * landingRadius.x)
      const radius = Math.max(innerRadius, Math.hypot(x, y))
      target = { x: bonfire.x + Math.cos(direction) * radius, y: bonfire.y + Math.sin(direction) * radius }
      break
    }
  }

  // PlanThrow rotates the outward direction by up to 10 degrees and traces to the offscreen edge.
  direction += (random() * 20 - 10) * toRadians
  const x = Math.cos(direction)
  const y = Math.sin(direction)
  const edgeX = Math.abs(x) < .0001 ? Infinity : (Math.sign(x) * (halfWidth + offscreenPadding) - target.x) / x
  const edgeY = Math.abs(y) < .0001 ? Infinity : (Math.sign(y) * (halfHeight + offscreenPadding) - target.y) / y
  const distance = Math.min(edgeX, edgeY)
  const spin = (200 - random() * 400) * toRadians
  return {
    target, from: { x: target.x + x * distance, y: target.y + y * distance },
    spin, turn: -random() * 2 * Math.PI, startsAt
  }
}

export function planBoxContents(from: Point, count: number, openedAt: number, random: () => number): PackThrow[] {
  return Array.from({ length: count }, (_, index) => {
    // LaunchPacksAndGrantRewards rotates the unit direction in equal increments, with 20 degrees of jitter.
    const angle = (90 + 360 * index / count + random() * 40 - 20) * toRadians
    const speed = 3 + (random() * 2 - 1) * .5
    const distance = speed ** 2 / (2 * packPresentation.throwFriction)
    return {
      from, target: { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance },
      spin: (60 - random() * 120) * toRadians, turn: -random() * 2 * Math.PI,
      startsAt: openedAt + boxOpening.wobbleDuration, fromOpenedBox: true
    }
  })
}

function simulateThrow(launch: PackThrow, box: boolean) {
  let { x, y } = launch.from
  let { turn, spin } = launch
  const dx = launch.target.x - x
  const dy = launch.target.y - y
  const distance = Math.max(.0001, Math.hypot(dx, dy))
  const friction = box ? boxFriction : packPresentation.throwFriction
  const speed = Math.sqrt(2 * friction * distance)
  const frames: ThrowFrame[] = [{ x, y, turn }]
  let vx = speed * dx / distance
  let vy = speed * dy / distance
  const spriteExtent = box ? .198 : .195
  const extentX = halfWidth - spriteExtent
  const extentY = halfHeight - spriteExtent
  // InitializeThrownTo starts braking immediately. Rebound retains 40% of the normal speed and 60% tangentially.
  for (let time = 0; time < 3 && Math.hypot(vx, vy) > .1; time += step) {
    x += vx * step
    y += vy * step
    turn += spin * step
    if (Math.abs(x) > extentX && x * vx > 0) {
      x = Math.sign(x) * extentX
      vx *= -.4
      vy *= .6
    }
    if (Math.abs(y) > extentY && y * vy > 0) {
      y = Math.sign(y) * extentY
      vy *= -.4
      vx *= .6
    }
    const radialX = x - bonfire.x
    const radialY = y - bonfire.y
    const radius = Math.hypot(radialX, radialY)
    if (radius < towerClearance && radius > 0) {
      const nx = radialX / radius
      const ny = radialY / radius
      x = bonfire.x + nx * towerClearance
      y = bonfire.y + ny * towerClearance
      const inward = Math.min(0, vx * nx + vy * ny)
      vx -= inward * nx
      vy -= inward * ny
    }
    const remaining = Math.hypot(vx, vy)
    const brake = remaining > 0 ? Math.max(0, 1 - friction * step / remaining) : 0
    vx *= brake
    vy *= brake
    spin = Math.sign(spin) * Math.max(0, Math.abs(spin) - friction * 3 * step * toRadians)
    frames.push({ x, y, turn })
  }
  return frames
}

export function packThrowPose(launch: PackThrow, elapsed: number, box = false) {
  let frames = framesForThrow.get(launch)
  if (!frames) {
    frames = simulateThrow(launch, box)
    framesForThrow.set(launch, frames)
  }
  const frame = Math.max(0, Math.min((elapsed - (launch.startsAt ?? 0)) / step, frames.length - 1))
  const a = frames[Math.floor(frame)]
  const b = frames[Math.ceil(frame)]
  const blend = frame % 1
  return {
    x: a.x + (b.x - a.x) * blend,
    y: a.y + (b.y - a.y) * blend,
    turn: a.turn + (b.turn - a.turn) * blend
  }
}

export function packThrowInReach(launch: PackThrow, elapsed: number, box = false) {
  if (elapsed < (launch.startsAt ?? 0)) return false
  const at = packThrowPose(launch, elapsed, box)
  const radius = packHitRadius(box)
  return Math.abs(at.x) <= halfWidth + radius && Math.abs(at.y) <= halfHeight + radius
}
