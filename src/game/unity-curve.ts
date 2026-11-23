export function evaluateCurve(keys: readonly (readonly number[])[], time: number) {
  const rightIndex = keys.findIndex(([at]) => at >= time)
  if (rightIndex < 0) return keys[keys.length - 1][1]
  if (rightIndex === 0) return keys[0][1]
  const [begin, from, incoming, outgoing = incoming] = keys[rightIndex - 1]
  const [end, to, into] = keys[rightIndex]
  const length = end - begin
  const t = (time - begin) / length
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * length * outgoing +
    (-2 * t3 + 3 * t2) * to + (t3 - t2) * length * into
}
