const { execFile } = require('node:child_process')
const { copyFile, cp, mkdir, mkdtemp, readdir, realpath, rm, stat, unlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, extname, join, resolve } = require('node:path')
const { promisify } = require('node:util')
const { Arch, Platform, build } = require('electron-builder')

const run = promisify(execFile)

async function prepareCompactGame(dist, game) {
  const ffmpeg = process.env.BPH_FFMPEG || 'ffmpeg'
  await cp(dist, game, { recursive: true })
  const media = join(game, 'static', 'media')
  for (const name of await readdir(media)) {
    if (extname(name) !== '.flac') continue
    const original = join(media, name)
    const compressed = original + '.webm'
    try {
      await run(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', original,
        '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '160k', '-vbr', 'on', compressed
      ], { windowsHide: true })
    } catch (error) {
      throw new Error('无法压缩 ' + name + '。请检查 BPH_FFMPEG 或 PATH 中的 FFmpeg 是否支持 libopus。', { cause: error })
    }
    const [before, after] = await Promise.all([stat(original), stat(compressed)])
    if (after.size >= before.size) {
      await unlink(compressed)
    } else {
      await unlink(original)
      console.log(name + ' ' + before.size + ' -> ' + after.size + ' bytes')
    }
  }
}

async function packageWindows() {
  const projectDir = resolve(__dirname, '..')
  const compact = process.argv.includes('--compact')
  const artifactName = compact ? 'Booster-Pack-Heroes-Compact.exe' : 'Booster-Pack-Heroes.exe'
  const temporaryRoot = await realpath(tmpdir())
  // A separate package prevents Electron Builder from collecting Taro's build-time dependencies.
  const staging = await mkdtemp(join(temporaryRoot, 'booster-pack-heroes-'))
  try {
    await Promise.all(['package.json', 'main.cjs'].map(name =>
      copyFile(join(__dirname, name), join(staging, name))
    ))
    const dist = join(projectDir, 'dist')
    const game = compact ? join(staging, 'game') : dist
    if (compact) await prepareCompactGame(dist, game)
    const artifacts = await build({
      projectDir: staging,
      targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
      publish: 'never',
      config: {
        appId: 'local.boosterpackheroes.desktop',
        productName: 'Booster Pack Heroes',
        artifactName,
        directories: { output: compact ? join(projectDir, '.desktop-build', 'compact') : join(projectDir, '.desktop-build') },
        electronVersion: require('electron/package.json').version,
        electronDist: dirname(require('electron')),
        files: ['main.cjs'],
        extraResources: [{ from: game, to: 'game' }],
        npmRebuild: false,
        win: {
          icon: join(__dirname, 'icon.ico'),
          signExecutable: false,
          ...(compact && { electronLanguages: ['en-US', 'zh-CN'] })
        },
        portable: { requestExecutionLevel: 'user' }
      }
    })

    const executable = artifacts.find(file => extname(file) === '.exe')
    if (!executable) throw new Error('Portable EXE was not generated')

    const release = join(projectDir, 'release')
    await mkdir(release, { recursive: true })
    const output = join(release, artifactName)
    await copyFile(executable, output)
    console.log(output)
  } finally {
    const resolved = await realpath(staging)
    if (dirname(resolved) === temporaryRoot && resolved === staging) {
      await rm(resolved, { recursive: true })
    }
  }
}

packageWindows().catch(error => {
  console.error(error)
  process.exitCode = 1
})
