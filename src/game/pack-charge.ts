// BlackBox/PackCharge, globalgamemanagers.assets:11. Positions use sprite texels.
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const fraction = (value: number) => value - Math.floor(value)

export function packPixelThreshold(x: number, y: number) {
  return (bayer[(y & 3) * 4 + (x & 3)] + .5) / 16
}

function crackSeed(seed: number, cell: number, seedFactor: number, cellFactor: number) {
  const phase = Math.fround(Math.fround(seed * seedFactor) + Math.fround(cell * cellFactor))
  return .15 + .7 * fraction(Math.fround(Math.sin(phase) * 43758.546875))
}

export function createPackChargeMask(
  source: Uint8ClampedArray, width: number, height: number, origin: readonly number[], seed: number
) {
  const size = width * height
  const radius = new Float32Array(size)
  const cracks = new Float32Array(size)
  const threshold = new Float32Array(size)
  const edge = new Uint8Array(size)
  const sites = Array.from({ length: 7 }, (_, cell) => ({
    x: width * crackSeed(seed, cell, 78.233002, 12.9898),
    y: height * crackSeed(seed, cell, 11.135, 39.346802)
  }))
  const radiusScale = Math.hypot(width, height) / 2
  const transparent = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height || source[(y * width + x) * 4 + 3] < 3

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (transparent(column, row)) continue
      const index = row * width + column
      const x = column + .5
      const y = height - row - .5
      radius[index] = Math.hypot(x - width / 2, y - height / 2) / radiusScale
      let nearest = Infinity
      let second = Infinity
      for (const site of sites) {
        const distance = (x - site.x) ** 2 + (y - site.y) ** 2
        if (distance < nearest) {
          second = nearest
          nearest = distance
        } else {
          second = Math.min(second, distance)
        }
      }
      cracks[index] = Math.sqrt(second) - Math.sqrt(nearest)
      const atlasX = Math.floor(origin[0]) + column
      const atlasY = Math.floor(origin[1]) + height - row - 1
      threshold[index] = packPixelThreshold(atlasX, atlasY)
      if (transparent(column + 1, row) || transparent(column - 1, row) ||
          transparent(column, row + 1) || transparent(column, row - 1)) edge[index] = 1
      else if (transparent(column + 2, row) || transparent(column - 2, row) ||
               transparent(column, row + 2) || transparent(column, row - 2)) edge[index] = 2
    }
  }
  return { width, height, radius, cracks, threshold, edge }
}

export type PackChargeMask = ReturnType<typeof createPackChargeMask>

export function packChargeTexel(mask: PackChargeMask, index: number, charge: number, flash: number, age: number) {
  const { width, height, radius, cracks, threshold, edge } = mask
  const crackWidth = charge + .5
  const cracked = radius[index] < charge * 1.25 && cracks[index] < crackWidth
  const whiteCrack = cracked && charge > .55 && cracks[index] < crackWidth * .45
  if ((edge[index] === 1 && charge > .15) || (edge[index] === 2 && charge > .6)) {
    const x = index % width + .5
    const y = height - Math.floor(index / width) - .5
    const pulse = .5 + .5 * Math.sin(40 * age + .7 * x + y)
    if (threshold[index] + .2 < .8 * charge + .3 * pulse + flash) return 1
  }
  if (whiteCrack) return 2
  return cracked || threshold[index] < 1.3 * charge ** 2 - .9 * radius[index] + .35 * flash ? 1 : 0
}
