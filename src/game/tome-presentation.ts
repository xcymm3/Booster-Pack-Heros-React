import scene from '../data/scene-canvas.json'
import { tomes, type TomeId } from './rules'
import { randomFromSeed } from './visual-random'

const { anticipation, openDuration, sparks } = scene.tomeField
export type TomeSpark = keyof typeof sparks

export function tomeOpeningPose(id: TomeId, age: number) {
  const progress = Math.max(0, Math.min(1, (age - anticipation) / openDuration))
  const shake = age >= 0 && age < anticipation ? .035 * Math.sin(age * 75) * (1 - age / anticipation) : 0
  return {
    scale: 1 + (tomes[id].native.openExpandScale - 1) * progress ** 2,
    alpha: 1 - progress,
    x: shake * .55,
    y: shake * .4,
    turn: -shake * 14 * Math.PI / 180
  }
}

export function tomeSparkDuration(kind: TomeSpark) {
  const { cycles, interval, lifetime } = sparks[kind]
  return (cycles - 1) * interval + lifetime
}

export function tomeSparkPose(kind: TomeSpark, uid: number, index: number, age: number) {
  const config = sparks[kind]
  const time = age - Math.floor(index / config.count) * config.interval
  if (index >= config.count * config.cycles || time < 0 || time >= config.lifetime) return null
  const key = uid * 131 + index * 7
  const angle = randomFromSeed(key) * 2 * Math.PI
  const depth = 2 * randomFromSeed(key + 1) - 1
  const innerRadius = 1 - config.thickness
  // The prefab emits in a sphere. Unity's orthographic camera projects it onto the table.
  const radius = config.radius * Math.cbrt(innerRadius ** 3 + (1 - innerRadius ** 3) * randomFromSeed(key + 2))
  const speed = config.speed[0] + (config.speed[1] - config.speed[0]) * randomFromSeed(key + 3)
  const distance = (radius + speed * time) * Math.sqrt(1 - depth ** 2)
  const tint = Math.round(7 * randomFromSeed(key + 4))
  const opacity = config.color[0][3] + (config.color[1][3] - config.color[0][3]) * tint / 7
  return {
    x: distance * Math.cos(angle),
    y: distance * Math.sin(angle),
    size: .05 + .03 * randomFromSeed(key + 5),
    frame: Math.floor(8 * randomFromSeed(key + 6)),
    tint,
    alpha: opacity * (1 - time / config.lifetime)
  }
}

export function cursorPopScale(age: number) {
  const { popDuration, popScale } = scene.cursorPresentation
  const remaining = Math.max(0, 1 - Math.max(0, age) / popDuration)
  return 1 + (popScale - 1) * remaining ** 2
}
