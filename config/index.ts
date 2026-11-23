import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'booster-pack-heroes-web',
  date: '2026-11-18',
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'vite',
  h5: {
    publicPath: '/',
    router: { mode: 'hash' },
    postcss: { pxtransform: { enable: false, config: { targetUnit: 'vw' } } }
  }
})
