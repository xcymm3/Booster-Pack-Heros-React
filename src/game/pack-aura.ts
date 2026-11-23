import { packDissolveNoise } from './pack-opening'
import { packPixelThreshold } from './pack-charge'
import { packPresentation } from './rules'
import type { DiscoveryTimeline } from './discovery'

const radians = Math.PI / 180
const frontDitherWidth = 4
const clamp = (value: number) => Math.max(0, Math.min(1, value))

// BlackBox/PackAuraRays, globalgamemanagers.assets:8.
export function createPackAuraMask(source: Uint8ClampedArray, width: number, height: number,
  origin: readonly number[], centerX: number, centerY: number, angles: readonly number[], seed: number) {
  const size = width * height
  const ray = new Uint8Array(size)
  const reach = new Float32Array(size)
  const noise = new Float32Array(size)
  const directions = angles.map(angle => [Math.cos(angle * radians), Math.sin(angle * radians)])
  for (let index = 0; index < size; index++) {
    if (source[index * 4 + 3] === 0) continue
    const col = index % width
    const row = height - 1 - Math.floor(index / width)
    const x = col + .5 - centerX
    const y = row + .5 - centerY
    let closest = -Infinity
    for (let slot = 0; slot < directions.length; slot++) {
      const [dx, dy] = directions[slot]
      const alignment = x * dx + y * dy
      if (alignment > closest) {
        closest = alignment
        ray[index] = slot
      }
    }
    const texelX = Math.floor(origin[0]) + col
    const texelY = Math.floor(origin[1]) + row
    reach[index] = Math.hypot(x, y) + frontDitherWidth * packPixelThreshold(texelX, texelY)
    noise[index] = packDissolveNoise(texelX, texelY, seed)
  }
  return { ray, reach, noise }
}

export type PackAuraMask = ReturnType<typeof createPackAuraMask>
export type PackAuraRay = { reach: number; flash: number }

export function packAuraRays(lengths: readonly number[], timeline: DiscoveryTimeline, age: number, seed: number): PackAuraRay[] {
  // Light the atlas rays in an evenly spaced sequence across each hit.
  const stride = lengths.length % 3 === 0 ? 1 : 3
  const order = Array.from({ length: lengths.length }, (_, slot) => (slot * stride + Math.floor(seed)) % lengths.length)
  return lengths.map((length, slot) => {
    const index = order.indexOf(slot)
    const hit = Math.floor(index / packPresentation.auraRaysPerHit)
    const ray = index % packPresentation.auraRaysPerHit
    const start = (timeline.hitTimes[hit] ?? Infinity) + ray * packPresentation.auraRayInterval
    const elapsed = age - start
    const growth = clamp(elapsed / packPresentation.auraRayGrowDuration)
    const flash = elapsed >= 0 ? 1 - clamp(elapsed / packPresentation.auraRayFlashDuration) : 0
    return { reach: length * (1 - (1 - growth) ** 3), flash }
  })
}
