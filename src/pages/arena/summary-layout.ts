import { crtDisplayPoint } from './crt'

const width = 1920
const height = 1080
const percent = (value: number) => value * 100 + '%'

function projectLayout(distortion: number) {
  const position = (x: number, y: number) => crtDisplayPoint(x / width, y / height, distortion)
  const box = (x: number, y: number, w: number, h: number) => {
    const a = position(x, y)
    const b = position(x + w, y + h)
    return { left: percent(a.x), top: percent(a.y), width: percent(b.x - a.x), height: percent(b.y - a.y) }
  }
  const titleAt = (y: number) => ({ top: percent(position(width / 2, y).y) })
  const ruleAt = (y: number) => box(53.0874 / 2, y - 5.0835 / 2, width - 53.0874, 5.0835)
  return { box, titleAt, ruleAt }
}

// DaySummaryPanel RectTransforms in level1.
export function summaryLayout(distortion: number, attempts: boolean) {
  const { box, titleAt, ruleAt } = projectLayout(distortion)
  const extra = attempts ? 50 : 0
  const panels = box(305, 180 + extra, 1310, 0)
  return {
    title: titleAt(92.5),
    // The TMP text sits at the top of the 75 px attempts rectangle.
    tries: titleAt(157.5),
    topRule: ruleAt(30),
    bottomRule: ruleAt(155 + extra),
    panels: { left: panels.left, top: panels.top, width: panels.width },
    statsHeight: 960 - 180 - extra - 48 - 15 - 20,
    next: box((width - 354) / 2, height - 120, 354, 100)
  }
}

// PrestigeSummaryPanel RectTransforms reset to the tower after the door dissolves.
export function actSummaryLayout(distortion: number) {
  const { box, titleAt, ruleAt } = projectLayout(distortion)
  const right = 310 + 669.54248
  return {
    title: titleAt(80),
    topRule: ruleAt(30),
    bottomRule: ruleAt(130),
    stats: box(310, 160, 629.54248, 770),
    mvp: box(right, 160, 630.45752, 568),
    tries: box(right, 744, 630.45752, 186),
    next: box((width - 354) / 2, height - 70.1 - 87 / 2, 354, 87)
  }
}
