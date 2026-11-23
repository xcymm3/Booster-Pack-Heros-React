import config from '../data/projectiles.json'
import { world, type Point } from './rules'

export type ProjectileKind = keyof typeof config
export type Flight = Point & {
  kind: ProjectileKind
  origin: Point
  landing: Point
  direction: Point | null
  age: number
  duration: number
  turn: number
}

export function castDirections(from: Point, target: Point, count: number) {
  const dx = target.x - from.x
  const dy = target.y - from.y
  const initial = Math.atan2(dy, dx)
  return Array.from({ length: count }, (_, index) => {
    const angle = initial + index * 2 * Math.PI / count
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })
}

export function createFlight(
  kind: ProjectileKind, from: Point, target: Point, directional?: { direction: Point; range: number }
): Flight {
  const direction = directional?.direction ?? null
  const range = directional && kind !== 'arrow' ? Math.max(config[kind].directionalMinDistance, directional.range) : 0
  const destination = direction ? { x: from.x + direction.x * range, y: from.y + direction.y * range } : target
  const landing = kind === 'infection' ? clampInfectionLanding(destination) : { x: destination.x, y: destination.y }
  const dx = landing.x - from.x
  const dy = landing.y - from.y
  return {
    kind, x: from.x, y: from.y,
    origin: { x: from.x, y: from.y },
    landing, direction, age: 0,
    duration: kind === 'arrow' ? Math.max(config.arrow.minFlightTime, Math.hypot(dx, dy) / config.arrow.speed) :
      kind === 'infection' ? config.infection.flightTime : range / config.fireball.speed,
    turn: kind === 'arrow' ? config.arrow.tipDegrees * Math.PI / 180 - Math.atan2(dy, dx) : 0
  }
}

function clampInfectionLanding(point: Point): Point {
  const padding = config.infection.playfieldPadding
  const limitX = Math.max(.1, world.width / 2 - padding)
  const limitY = Math.max(.1, world.height / 2 - padding)
  return { x: Math.max(-limitX, Math.min(limitX, point.x)), y: Math.max(-limitY, Math.min(limitY, point.y)) }
}

export function advanceFlight(flight: Flight, target: Point, dt: number) {
  flight.age += dt
  if (flight.kind === 'fireball') {
    if (flight.direction) {
      const step = config.fireball.speed * dt
      flight.x += flight.direction.x * step
      flight.y += flight.direction.y * step
      return flight.age >= flight.duration
    }
    const dx = target.x - flight.x
    const dy = target.y - flight.y
    const gap = Math.hypot(dx, dy)
    const step = Math.min(gap, config.fireball.speed * dt)
    if (gap > 0) {
      flight.x += dx * step / gap
      flight.y += dy * step / gap
    }
    return gap - step < config.fireball.arrivalDistance
  }

  const goal = flight.kind === 'arrow' ? target : flight.landing
  const dx = goal.x - flight.origin.x
  const dy = goal.y - flight.origin.y
  const progress = Math.min(1, flight.age / flight.duration)
  flight.x = flight.origin.x + dx * progress
  flight.y = flight.origin.y + dy * progress
  if (flight.kind === 'arrow') {
    if (Math.hypot(dx, dy) >= .0001) {
      flight.turn = config.arrow.tipDegrees * Math.PI / 180 - Math.atan2(dy, dx)
    }
    return progress >= .9999 || Math.hypot(goal.x - flight.x, goal.y - flight.y) < config.arrow.arrivalDistance
  }
  flight.y += Math.sin(progress * Math.PI) * Math.hypot(dx, dy) * config.infection.arcHeightFactor
  flight.turn = -flight.age * config.infection.spinDegreesPerSecond * Math.PI / 180
  return progress >= 1
}
