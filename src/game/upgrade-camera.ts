// Rect layout in level1:23709 / 28829, with initial framing measured at 00:03:41.
export const upgradeBoardHeight = .8825
export const upgradeNodeSpacing = 4.23
export const initialUpgradeView = { x: 0, y: 0, zoom: 1 }
export type UpgradeView = typeof initialUpgradeView

export function upgradeTreeOrigin(rootBought: boolean, showDoor: boolean) {
  return { x: rootBought ? 50 : 77.25, y: showDoor ? 48.4 : rootBought ? 18 : 43.7, shift: showDoor ? 46.53 : 0 }
}

export function upgradeBackgroundOpacity(view: UpgradeView, origin: ReturnType<typeof upgradeTreeOrigin>) {
  const boardHeight = upgradeBoardHeight * 100 * 9 / 16
  const treeTop = boardHeight * origin.y / 100 + origin.shift + view.y
  const row = 15 + (boardHeight / 2 - treeTop) / (upgradeNodeSpacing * view.zoom)
  // SkillTreeGridData sharedassets1.assets:3221. Fade between rows 15 and 6.
  const progress = Math.min(1, Math.max(0, (15 - row) / 9))
  return .15 + .85 * progress
}

export const upgradeSkyLayers = [
  { art: 'nebula', depth: .9, width: 100, height: 56.25, alpha: 1 },
  { art: 'distant-stars', depth: .75, width: 800 / 19.2, height: 800 / 19.2, alpha: .7294118 },
  { art: 'twinkle-0', depth: .6, width: 800 / 19.2, height: 800 / 19.2, alpha: .6470588 }
]

export function upgradeSkyLayerPose(view: UpgradeView, layer: typeof upgradeSkyLayers[number]) {
  // ParallaxBackground in level1:47085 uses relative motion and attenuates zoom beyond 2.
  const localZoom = upgradeNodeSpacing * 19.2 / 150 * view.zoom
  const scale = localZoom / Math.max(1, localZoom / 2) ** layer.depth
  return {
    x: view.x * (1 - layer.depth), y: view.y * (1 - layer.depth),
    width: layer.width * scale, height: layer.height * scale
  }
}
