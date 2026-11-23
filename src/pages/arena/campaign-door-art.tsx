import { useEffect, useRef, useState } from 'react'
import { campaignGatePose } from '../../game/campaign-gate'
import { packDissolveNoise } from '../../game/pack-opening'
import { campaignDoor } from '../../game/rules'
import { asset } from './media'

const { frame, closed, mask, parallaxLayers, visual, keys } = campaignDoor
const artNames = [...new Set([frame.sprite, closed.sprite, mask.sprite, ...keys.map(key => key.filled),
  ...parallaxLayers.flatMap(layer => [layer.sprite, ...layer.frames])])]
const border = 6
export const doorCanvasSize = { width: 34 + border * 2, height: 36 + border * 2 }
export const doorCanvasScale = 3
type DoorPose = ReturnType<typeof campaignGatePose>

const particle = (i: number, salt: number) => {
  const value = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function paintCampaignDoor(context: CanvasRenderingContext2D, leaf: CanvasRenderingContext2D,
  artwork: ReadonlyMap<string, CanvasImageSource>, pose: DoorPose) {
  const draw = (canvas: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number) => {
    const image = artwork.get(name)
    if (image) canvas.drawImage(image, x, y, w, h)
  }
  const { width, height } = doorCanvasSize
  context.setTransform(context.canvas.width / width, 0, 0, context.canvas.height / height, 0, 0)
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = false
  const diving = pose.zoom > visual.depthZoomStart
  for (const layer of diving ? parallaxLayers.slice(0, 2) : parallaxLayers) {
    const frameIndex = layer.frames.length ? Math.floor(pose.age * layer.framesPerSecond) % layer.frames.length : 0
    const zoom = Math.max(1, pose.zoom / visual.depthZoomStart) ** (-layer.depth * .32)
    const w = layer.rect.sizeDelta[0] / 5 * zoom
    const h = layer.rect.sizeDelta[1] / 5 * zoom
    draw(context, layer.frames[frameIndex] ?? layer.sprite, width / 2 - w / 2, height / 2 - h / 2, w, h)
  }
  if (diving) {
    // The stars repeat across the door window as the camera enters it. Positions are in door texels.
    const stars = artwork.get(parallaxLayers[2].sprite)
    const blue = artwork.get(parallaxLayers[3].frames[1])
    const largeFirst = Math.floor(pose.age * parallaxLayers[2].framesPerSecond) % 2 === 0
    if (stars) {
      for (const [x, y, upper] of [[-5.1, -1.43, 1], [10.7, -1.43, 1], [-9.86, 1.81, 0], [6.23, 1.81, 0]]) {
        const large = Boolean(upper) === largeFirst
        const size = large ? 5 : 3
        const length = size * .42
        context.drawImage(stars, large ? 2 : 15, large ? 2 : 35, size, size,
          width / 2 + x - length / 2, height / 2 + y - length / 2, length, length)
      }
    }
    if (blue) context.drawImage(blue, 2, 20, 3, 3, width / 2 - 3.36, height / 2 + 2.55, 1.42, 1.42)
  }
  context.globalCompositeOperation = 'destination-in'
  draw(context, mask.sprite, border + 6, border + 6, 22, 26)
  context.globalCompositeOperation = 'source-over'
  draw(context, frame.sprite, border, border, 34, 36)

  if (pose.dissolve < 1) {
    leaf.imageSmoothingEnabled = false
    leaf.clearRect(0, 0, width, height)
    draw(leaf, closed.sprite, border + 6, border + 5, 22, 27)
    keys.forEach((key, index) => {
      const x = Math.round(width / 2 + key.rect.anchoredPosition[0] / 5 - 3)
      const y = Math.round(height / 2 - key.rect.anchoredPosition[1] / 5 - 3)
      draw(leaf, key.filled, x, y, 6, 6)
      if (pose.key === index) {
        leaf.fillStyle = 'rgba(255,255,255,' + pose.keyFlash + ')'
        leaf.fillRect(x + 2, y + 1, 2, 4)
        leaf.fillRect(x + 1, y + 2, 4, 2)
      }
    })
    if (pose.dissolve > 0) {
      const image = leaf.getImageData(0, 0, width, height)
      for (let pixel = 0; pixel < width * height; pixel++) {
        const offset = pixel * 4
        if (!image.data[offset + 3]) continue
        const noise = packDissolveNoise(pixel % width, Math.floor(pixel / width), 17)
        const distance = noise - (pose.dissolve ** 2 * 1.13 - .065)
        if (distance < 0) image.data[offset + 3] = 0
        else if (distance < .085) {
          image.data[offset] = 255
          image.data[offset + 1] = 246
          image.data[offset + 2] = 255
        }
      }
      leaf.putImageData(image, 0, 0)
    }
    context.drawImage(leaf.canvas, 0, 0)
  }

  context.fillStyle = '#fff'
  for (let i = 0; i < visual.dissolveParticleCount && pose.particleAge > 0; i++) {
    const born = visual.dissolveDuration * (.12 + i / visual.dissolveParticleCount * .78)
    const time = pose.particleAge - born
    const lifetime = visual.particleLifetime.x + (visual.particleLifetime.y - visual.particleLifetime.x) * particle(i, 1)
    if (time < 0 || time >= lifetime) continue
    const drift = (particle(i, 2) - .5) * visual.particleSpeed.x / 5
    const rise = particle(i, 3) * visual.particleSpeed.y / 5
    const x = border + 8 + particle(i, 4) * 18 + drift * time
    const y = border + 10 + particle(i, 5) * 22 - rise * time - visual.particleRise / 10 * time * time
    const size = particle(i, 6) > .78 ? 2 : 1
    context.globalAlpha = 1 - time / lifetime
    context.fillRect(Math.round(x), Math.round(y), 1, size)
  }
  context.globalAlpha = 1
}

export function CampaignDoorArt({ pose }: { pose: DoorPose | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scratch = useRef<CanvasRenderingContext2D | null>(null)
  const [artwork, setArtwork] = useState<ReadonlyMap<string, CanvasImageSource> | null>(null)
  useEffect(() => {
    let mounted = true
    void Promise.all(artNames.map(name => new Promise<readonly [string, HTMLImageElement]>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve([name, image])
      image.onerror = reject
      image.src = asset(name)
    }))).then(entries => { if (mounted) setArtwork(new Map(entries)) }, () => {})
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!pose || !artwork) return
    const context = canvas.current?.getContext('2d')
    if (!context) return
    if (!scratch.current) {
      const surface = document.createElement('canvas')
      surface.width = doorCanvasSize.width
      surface.height = doorCanvasSize.height
      scratch.current = surface.getContext('2d', { willReadFrequently: true })
    }
    if (scratch.current) paintCampaignDoor(context, scratch.current, artwork, pose)
  }, [pose, artwork])

  return <span className="campaign-door" aria-hidden="true">
    {pose && artwork ? <canvas className="campaign-door-motion" ref={canvas}
      width={doorCanvasSize.width * doorCanvasScale} height={doorCanvasSize.height * doorCanvasScale} /> : <>
      <img className="campaign-door-frame" src={asset(frame.sprite)} alt="" draggable={false} />
      <img className="campaign-door-leaf" src={asset(closed.sprite)} alt="" draggable={false}
        style={pose ? { opacity: 1 - pose.dissolve } : undefined} />
      {keys.map(key => <img key={key.chapter} className="campaign-door-key" src={asset(key.filled)} alt="" draggable={false}
        style={{ left: (50 + key.rect.anchoredPosition[0] / 1.7) + '%',
          top: (50 - key.rect.anchoredPosition[1] / 1.8) + '%', opacity: pose ? 1 - pose.dissolve : 1 }} />)}
    </>}
  </span>
}
