const { app, BrowserWindow, dialog, Menu, net, protocol } = require('electron')
const { createReadStream, existsSync } = require('node:fs')
const { stat } = require('node:fs/promises')
const { extname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

const scheme = 'bph'
const entry = scheme + '://game/'
const contentPolicy = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

protocol.registerSchemesAsPrivileged([{
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}])

app.setPath('userData', join(app.getPath('appData'), 'Booster Pack Heroes Web'))

function gameOrigin(url) {
  return url.protocol === scheme + ':' && url.host === 'game' && !url.username && !url.password
}

async function serveCompactAudio(file, request) {
  const { size } = await stat(file)
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': 'audio/webm',
    'Content-Security-Policy': contentPolicy
  })
  let start = 0
  let end = size - 1
  let status = 200
  const range = request.method === 'GET' ? request.headers.get('range') : null
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]))
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start > end) {
      headers.set('Content-Range', 'bytes */' + size)
      return new Response(null, { status: 416, headers })
    }
    status = 206
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(file, { start, end }))
  return new Response(body, { status, headers })
}

function serveGame() {
  const root = app.isPackaged ? join(process.resourcesPath, 'game') : resolve(__dirname, '../dist')
  const mediaPrefix = join('static', 'media') + sep

  protocol.handle(scheme, async request => {
    try {
      const url = new URL(request.url)
      if (!gameOrigin(url) || !['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, { status: 404 })
      }

      const pathname = decodeURIComponent(url.pathname)
      const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname)
      const inGame = relative(root, file)
      if (!inGame || isAbsolute(inGame) || inGame === '..' || inGame.startsWith('..' + sep)) {
        return new Response(null, { status: 404 })
      }

      const compact = file + '.webm'
      if (inGame.startsWith(mediaPrefix) && extname(file) === '.flac' && existsSync(compact)) {
        return await serveCompactAudio(compact, request)
      }
      const response = await net.fetch(pathToFileURL(file).href, {
        method: request.method,
        headers: request.headers
      })
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', contentPolicy)
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function createGameWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 750,
    minWidth: 640,
    minHeight: 400,
    title: 'Booster Pack Heroes',
    backgroundColor: '#050807',
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    if (!gameOrigin(new URL(target))) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.loadURL(entry).catch(error => {
    dialog.showErrorBox('Booster Pack Heroes', '无法加载游戏。\n' + error.message)
    app.quit()
  })
  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    serveGame()
    window = createGameWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
