import { upgradeAtlas } from '../../game/upgrades'
import { asset } from './media'

const atlasImage = asset('upgrades/sprites.png')

export function AtlasIcon({ slot, className }: { slot?: number | null; className?: string }) {
  if (slot == null || !atlasImage) return null
  const { columns, rows } = upgradeAtlas
  const x = slot % columns / (columns - 1) * 100
  const y = Math.floor(slot / columns) / (rows - 1) * 100
  return <span aria-hidden="true" className={'upgrade-icon' + (className ? ' ' + className : '')} style={{
    backgroundImage: 'url("' + atlasImage + '")',
    backgroundSize: columns * 100 + '% ' + rows * 100 + '%',
    backgroundPosition: x + '% ' + y + '%'
  }} />
}
