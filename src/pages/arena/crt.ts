import scene from '../../data/scene-canvas.json'
import type { Presentation } from './use-game'

export const crtVertexSource = `
attribute vec2 position;
varying vec2 uv;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
}
`

export const crtFragmentSource = `
precision highp float;
varying vec2 uv;
uniform sampler2D sourceFrame;
uniform vec2 frameSize;
uniform vec4 lens;
uniform vec3 scanlines;
uniform float contrast;

vec3 toLinear(vec3 color) {
  return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
}

// Decode each texel before interpolation, as an sRGB texture would.
vec3 sampleLinear(vec2 uv) {
  vec2 pixel = uv * frameSize - 0.5;
  vec2 ratio = fract(pixel);
  vec2 corner = floor(pixel) + 0.5;
  vec3 topLeft = toLinear(texture2D(sourceFrame, corner / frameSize).rgb);
  vec3 topRight = toLinear(texture2D(sourceFrame, (corner + vec2(1.0, 0.0)) / frameSize).rgb);
  vec3 bottomLeft = toLinear(texture2D(sourceFrame, (corner + vec2(0.0, 1.0)) / frameSize).rgb);
  vec3 bottomRight = toLinear(texture2D(sourceFrame, (corner + 1.0) / frameSize).rgb);
  return mix(mix(topLeft, topRight, ratio.x), mix(bottomLeft, bottomRight, ratio.x), ratio.y);
}

float toSrgb(float channel) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
}

// BlackBox/CRT, release pixel shader. lens = distortion, vignette, chroma, brightness.
void main() {
  vec2 offset = uv - 0.5;
  float radiusSquared = dot(offset, offset);
  vec2 sampleUv = 0.5 + offset * (1.0 + lens.x * radiusSquared);
  if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 shift = offset * (8.0 * lens.z);
  vec3 color = vec3(sampleLinear(sampleUv + shift).r,
    sampleLinear(sampleUv).g, sampleLinear(sampleUv - shift).b);
  float wave = cos(sampleUv.y * scanlines.y * 3.141592653589793) * 0.5 + 0.5;
  float line = pow(clamp(wave, 0.0, 1.0), max(scanlines.z, 0.08));
  float shade = 1.0 + scanlines.x * (0.14 * line - 0.12);
  float vignette = clamp(1.0 - radiusSquared * lens.y * 2.5, 0.0, 1.0);
  color *= shade * vignette * lens.w;
  color = clamp(0.5 + (color - 0.5) * contrast, 0.0, 1.0);
  gl_FragColor = vec4(toSrgb(color.r), toSrgb(color.g), toSrgb(color.b), 1.0);
}
`

export function battleCrtLook(view: Presentation) {
  const config = scene.victory
  // BossDefeatJuice starts its look change when the final-blow stinger plays.
  const age = view.battle?.summary?.result === 'victory' ? view.victoryAge - config.stingerDelay : -1
  const blend = age >= 0 ? Math.max(0, Math.min(1, (config.crtHold + config.crtFadeOut - age) / config.crtFadeOut)) : 0
  return {
    distortion: scene.crt.distortion + (config.crtDistortion - scene.crt.distortion) * blend,
    vignette: scene.crt.vignette + (config.crtVignette - scene.crt.vignette) * blend,
    chromaticAberration: scene.crt.chromaticAberration + (config.crtChromaticAberration - scene.crt.chromaticAberration) * blend,
    brightness: view.preferences.brightness * (1 + (config.crtBrightness - 1) * blend),
    contrast: view.preferences.contrast
  }
}

export function crtSamplePoint(x: number, y: number, distortion: number) {
  const dx = x - .5
  const dy = y - .5
  const scale = 1 + (dx * dx + dy * dy) * distortion
  return { x: .5 + dx * scale, y: .5 + dy * scale }
}

export function crtDisplayPoint(x: number, y: number, distortion: number) {
  const dx = x - .5
  const dy = y - .5
  const bend = (dx * dx + dy * dy) * distortion
  let scale = 1
  for (let iteration = 0; iteration < 5; iteration++) scale = 1 / (1 + bend * scale * scale)
  return { x: .5 + dx * scale, y: .5 + dy * scale }
}

function compile(gl: WebGLRenderingContext, type: number, code: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, code)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

export function createCrtRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false })
  if (!gl) return null
  const program = gl.createProgram()
  const vertex = compile(gl, gl.VERTEX_SHADER, crtVertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, crtFragmentSource)
  const geometry = gl.createBuffer()
  const frameTexture = gl.createTexture()
  const dispose = () => {
    gl.deleteProgram(program)
    gl.deleteTexture(frameTexture)
    gl.deleteBuffer(geometry)
  }
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!program || !geometry || !frameTexture || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose()
    return null
  }

  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, frameTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  // RGBA uploads allow Chrome to transfer canvas frames on the GPU.
  gl.uniform1i(gl.getUniformLocation(program, 'sourceFrame'), 0)
  gl.uniform3f(gl.getUniformLocation(program, 'scanlines'), scene.crt.scanlineIntensity, scene.crt.scanlineCount, scene.crt.scanlineWidth)
  const frameSize = gl.getUniformLocation(program, 'frameSize')
  const lens = gl.getUniformLocation(program, 'lens')
  const contrast = gl.getUniformLocation(program, 'contrast')
  let textureWidth = 0
  let textureHeight = 0

  return {
    paint(source: HTMLCanvasElement, look: ReturnType<typeof battleCrtLook>) {
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width
        canvas.height = source.height
      }
      if (textureWidth !== source.width || textureHeight !== source.height) {
        textureWidth = source.width
        textureHeight = source.height
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(frameSize, textureWidth, textureHeight)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
      }
      gl.uniform4f(lens, look.distortion, look.vignette, look.chromaticAberration, look.brightness)
      gl.uniform1f(contrast, look.contrast)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose
  }
}
