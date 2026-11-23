const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const [output, tooling] = process.argv.slice(2)
if (!output || !tooling) throw new Error('Usage: node scripts/render-opening.cjs <output-dir> <canvas-tooling-dir>')
const { createCanvas, loadImage, DOMMatrix } =
  Module.createRequire(path.join(path.resolve(tooling), 'package.json'))('@napi-rs/canvas')
const ts = require('typescript')
const compile = (mod, file) => {
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
    }
  }).outputText, file)
}
require.extensions['.ts'] = compile
require.extensions['.tsx'] = compile
const load = Module._load
Module._load = function(id, parent, ...args) {
  if (id === './media' && parent?.filename.endsWith('arena-canvas.tsx')) return { asset() {} }
  return load.call(this, id, parent, ...args)
}
global.DOMMatrix = DOMMatrix
global.document = { createElement: tag => tag === 'canvas' ? createCanvas(1, 1) : undefined }

const { artNames, viewport, paintBackdrop, paintArenaFrame } = require(path.resolve(__dirname, '../src/pages/arena/arena-canvas.tsx'))
const { createBattle } = require(path.resolve(__dirname, '../src/game/combat.ts'))
const { newCampaign, packLocation, hitPack, buyPack, beginChapter } = require(path.resolve(__dirname, '../src/game/save.ts'))
const { basicPack, discoveryCardAt } = require(path.resolve(__dirname, '../src/game/rules.ts'))
const { purchaseUpgrade, upgradeModifiers, mainUpgrade } = require(path.resolve(__dirname, '../src/game/upgrades.ts'))

async function run() {
  const art = new Map(await Promise.all([...new Set(artNames.filter(Boolean))].map(async filename => {
    const asset = path.resolve(__dirname, '../src/assets', filename)
    return [filename, fs.existsSync(asset) ? await loadImage(asset) : undefined]
  })))
  const campaign = beginChapter(buyPack(purchaseUpgrade({ ...newCampaign(), introComplete: true, coins: 3, mastery: 4 }, mainUpgrade), basicPack, 0))
  const battle = createBattle([], false, () => .5, 1, upgradeModifiers(campaign.upgradeLevels))
  battle.elapsed = 1.5
  const position = packLocation(campaign.activePacks[0], 0)
  const oneHit = hitPack(campaign, 0, () => .5)
  const twoHits = hitPack(oneHit, 0, () => .5)
  const startingView = {
    campaign, battle, crateHp: 0, crateHitAge: 5, introAge: null, reveal: null, story: null, summaryAge: 0,
    packHitAge: 5, packHitIndex: -1, openedPack: null, chapterAge: 5, time: 0, paused: false, menu: false,
    muted: true, preferences: { brightness: 1, contrast: 1, screenShake: false }
  }
  const reveal = { card: twoHits.collection[0], pack: campaign.activePacks[0], position, pending: twoHits.roster,
    traits: twoHits.rosterTraits, age: 0 }
  const views = [
    ['pack-unopened', startingView],
    ['pack-hit', { ...startingView, campaign: oneHit, packHitIndex: 0, packHitAge: .02 }],
    ['pack-anticipation', { ...startingView, campaign: twoHits, reveal: { ...reveal, age: .75 } }],
    ['pack-burst', { ...startingView, campaign: twoHits, reveal: { ...reveal, age: discoveryCardAt + .11 } }],
    ['card-show', { ...startingView, campaign: twoHits, reveal: { ...reveal, age: 3 } }]
  ]
  const root = path.resolve(output)
  fs.mkdirSync(root, { recursive: true })
  const { width, height } = viewport
  const backdrop = createCanvas(width, height)
  paintBackdrop(backdrop, art, 1)
  for (const [name, view] of views) {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    paintArenaFrame(ctx, backdrop, art, new Map(), view, null, true)
    fs.writeFileSync(path.join(root, name + '.png'), await canvas.encode('png'))
  }
  console.log('Rendered', views.length, 'Canvas frames to', root)
}
run().catch(err => { console.error(err); process.exitCode = 1 })



