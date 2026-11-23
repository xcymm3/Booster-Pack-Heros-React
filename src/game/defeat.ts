import scene from '../data/scene-canvas.json'
import type { Summary } from './save'

export function defeatWorldAge(age: number) {
  const { zoomDuration, slowMotionScale } = scene.defeat
  return Math.min(age, zoomDuration) * slowMotionScale + Math.max(0, age - zoomDuration)
}

export function defeatZoomProgress(age: number) {
  const time = Math.max(0, Math.min(1, age / scene.defeat.zoomDuration))
  return time * time * (3 - 2 * time)
}

export function daySummaryDelay(result: Summary['result']) {
  return result === 'defeat' ? scene.defeat.zoomDuration : .32
}

export function defeatSummaryTiming(summary: Summary) {
  const { titlePopDuration, summaryRowPopDuration, summaryRowStagger, summaryCountDuration } = scene.defeat
  const tableAt = titlePopDuration
  const rowsAt = tableAt + summaryRowPopDuration
  const resourcesAt = rowsAt + summaryRowPopDuration + (summary.unitStats?.length ?? 0) * summaryRowStagger
  let at = resourcesAt + summaryRowPopDuration
  const values = [Math.floor(summary.elapsed), summary.packsOpened ?? 0, summary.mastery, summary.coins]
  const rows = values.map(value => {
    const row = { at, value }
    if (value > 0) at += summaryCountDuration
    return row
  })
  return { tableAt, rowsAt, resourcesAt, rows, continueAt: at }
}
