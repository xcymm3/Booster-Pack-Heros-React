export function randomFromSeed(seed: number) {
  const state = (Math.imul(seed, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737)
  return ((word ^ (word >>> 22)) >>> 0) / 2 ** 32
}
