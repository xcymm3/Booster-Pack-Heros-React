import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import menuLabels from '../../assets/menu/labels.json'
import chapterLabels from '../../assets/menu/chapter-labels.json'
import credits from '../../assets/menu/credits.json'
import type { DamageNumberMode } from '../../game/damage-numbers'
import { loadCampaign, parseCampaign, writeCampaign } from '../../game/save'
import { asset, playSound, releaseAudio } from './media'
import './main-menu.css'

type Language = 'zh-CN' | 'en'
type LabelKey = keyof typeof menuLabels
type SettingsTab = 'general' | 'graphics' | 'gameplay' | 'audio'
type MenuView = 'title' | 'settings' | 'credits' | 'reset' | 'quit' | 'exited'

const art = (name: string) => asset('menu/' + name + '.png')
const label = (key: LabelKey, language: Language) => menuLabels[key][language]

export const MENU_PREFERENCES_CHANGED = 'bph:menu-preferences'
const preferencesKey = 'booster-pack-heroes:h5:preferences'
const damageNumberModes = ['all', 'big', 'off'] as const
const defaults = {
  music: 1,
  sfx: 1,
  brightness: 1,
  contrast: 1,
  crt: true,
  screenShake: true,
  skilltreeAnimations: true,
  damageNumberMode: 'all' as DamageNumberMode,
  vibration: 1,
  gamepadSensitivity: 1,
  vsync: true,
  frameRate: 0,
  analytics: false,
  language: 'zh-CN' as Language
}
export type MenuPreferences = typeof defaults

export function readMenuPreferences(): MenuPreferences {
  try {
    const raw = localStorage.getItem(preferencesKey)
    const data = raw ? JSON.parse(raw) as Partial<MenuPreferences> : {}
    return {
      music: validRange(data.music, 0, 1, defaults.music),
      sfx: validRange(data.sfx, 0, 1, defaults.sfx),
      brightness: validRange(data.brightness, .65, 1.45, defaults.brightness),
      contrast: validRange(data.contrast, .65, 1.45, defaults.contrast),
      crt: data.crt !== false,
      screenShake: data.screenShake !== false,
      skilltreeAnimations: data.skilltreeAnimations !== false,
      damageNumberMode: data.damageNumberMode === 'big' || data.damageNumberMode === 'off' ? data.damageNumberMode : 'all',
      vibration: validRange(data.vibration, 0, 1, defaults.vibration),
      gamepadSensitivity: validRange(data.gamepadSensitivity, .25, 2, defaults.gamepadSensitivity),
      vsync: data.vsync !== false,
      frameRate: [30, 60, 120].includes(data.frameRate ?? 0) ? data.frameRate! : 0,
      analytics: data.analytics === true,
      language: data.language === 'en' ? 'en' : 'zh-CN'
    }
  } catch {
    return { ...defaults }
  }
}

function validRange(value: number | undefined, min: number, max: number, fallback: number) {
  return typeof value === 'number' && value >= min && value <= max ? value : fallback
}

function usePreferences() {
  const [preferences, setPreferences] = useState(readMenuPreferences)

  function setPreference<K extends keyof MenuPreferences>(key: K, value: MenuPreferences[K]) {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    try {
      localStorage.setItem(preferencesKey, JSON.stringify(next))
    } catch {
      // Settings still apply during this session when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent<MenuPreferences>(MENU_PREFERENCES_CHANGED, { detail: next }))
  }

  return { preferences, setPreference }
}

type SoundProps = {
  muted: boolean
  onToggleMute: () => void
}

type MainMenuProps = SoundProps & {
  chapter: number
  chapterTitle: string
  hasProgress: boolean
  onPlay: () => void
  onResetProgress?: () => void
  onQuit?: () => void
  paused?: boolean
}

type GameMenuProps = SoundProps & {
  chapter?: number
  chapterTitle?: string
  onResetProgress?: () => void
  onResume: () => void
  onMainMenu: () => void
}

const developerLinks = [
  { name: 'Funday Games', image: 'funday', url: 'https://store.steampowered.com/developer/FundayGames' },
  { name: 'Zup Games', image: 'zup', url: 'https://store.steampowered.com/search/?developer=zup' },
  { name: 'Newsletter', image: 'newsletter', url: 'https://fundaygames.dk/booster-pack-heroes/newsletter' }
]
const discordUrl = 'https://discord.gg/zaSpzQwjMZ'
const bugReportUrl = 'https://survey.fundaygames.dk/bph-bugs?version=1.0&platform=Web'
const privacyUrl = 'https://www.fundaygames.dk/legal/privacy-policy'
const titleAsset = 'logo-zh.png'

function Action({ children, onClick, gold, disabled, className = '' }: {
  children: ReactNode
  onClick: () => void
  gold?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      className={['bph-menu-button', gold && 'is-gold', className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function MenuLink({ children, href, name }: { children: ReactNode; href: string; name?: string }) {
  return <a aria-label={name} className="bph-menu-button" href={href} target="_blank" rel="noreferrer">{children}</a>
}

function useSubmenuBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return
    function handleBack(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onBack()
    }
    window.addEventListener('keydown', handleBack, true)
    return () => window.removeEventListener('keydown', handleBack, true)
  }, [active, onBack])
}

function shellStyle(): CSSProperties {
  return {
    '--menu-button': `url("${asset('button-gray.png')}")`,
    '--menu-button-gold': `url("${asset('button-gold.png')}")`,
    '--menu-slider-track': `url("${art('slider-track')}")`,
    '--menu-slider-thumb': `url("${art('slider-thumb')}")`,
    '--menu-checkmark': `url("${art('checkmark')}")`,
    '--menu-dropdown': `url("${art('dropdown-arrow')}")`
  } as CSSProperties
}

function playMenuSound(name: 'hover' | 'select', muted: boolean, sfx: number) {
  if (!muted) playSound('menu/' + name, sfx * (name === 'hover' ? .15 : .35))
}

function useTitleMusic(enabled: boolean, volume: number) {
  const music = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    const url = asset('menu/music.ogg')
    if (!enabled || !url) return
    const track = new Audio()
    track.preload = 'none'
    track.src = url
    track.loop = true
    music.current = track
    return () => {
      releaseAudio(track)
      music.current = null
    }
  }, [enabled])

  useEffect(() => {
    const track = music.current
    if (!track) return
    track.volume = volume * .449
    if (volume === 0) track.pause()
    else void track.play().catch(() => {})
  }, [enabled, volume])

  return () => {
    const track = music.current
    if (track && track.paused && track.volume > 0) void track.play().catch(() => {})
  }
}

export function MainMenu({ chapter, chapterTitle, hasProgress, onPlay, onResetProgress, onQuit, paused, ...sound }: MainMenuProps) {
  const [view, setView] = useState<MenuView>('title')
  const menu = useRef<HTMLElement>(null)
  const { preferences, setPreference } = usePreferences()
  const { language } = preferences
  const chapterName = chapterLabels['WaveChapter.title'][language].replace('{0}', String(chapter))
  const chapterKey = `WaveChapter${chapter}.description` as keyof typeof chapterLabels
  const description = chapterLabels[chapterKey]?.[language] ?? chapterTitle
  const isChinese = language === 'zh-CN'
  const close = () => setView('title')
  useSubmenuBack(view !== 'title', close)
  const startMusic = useTitleMusic(view !== 'exited' && !paused, sound.muted ? 0 : preferences.music)
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="dialog"]')?.focus()
  }, [view])

  if (view === 'exited') return <section aria-label={label('ui.button.quit', language)} className="bph-menu bph-menu-exited" />

  return (
    <section
      aria-label={isChinese ? '主菜单' : 'Main menu'}
      className="bph-menu bph-title-screen"
      data-ui=""
      lang={language}
      ref={menu}
      style={shellStyle()}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('.bph-menu-button')) playMenuSound('select', sound.muted, preferences.sfx)
        startMusic()
      }}
      onPointerOver={(event) => {
        const button = (event.target as HTMLElement).closest('.bph-menu-button')
        if (button && !button.contains(event.relatedTarget as Node | null)) playMenuSound('hover', sound.muted, preferences.sfx)
      }}
    >
      <img alt={isChinese ? '卡包英雄' : 'Booster Pack Heroes'} className="bph-title-logo" src={isChinese ? asset(titleAsset) : art('logo-en')} />
      <img alt="" className="bph-title-tower" src={art('tower')} />
      {view === 'title' && <>
        <div className="bph-title-chapter">
          <strong>{chapterName}</strong>
          <span>{description}</span>
        </div>
        <Action className="bph-title-play" gold onClick={onPlay}>
          {hasProgress ? label('ui.button.continue', language) : isChinese ? '开始' : 'PLAY'}
        </Action>
        <nav aria-label={isChinese ? '主菜单选项' : 'Main menu options'} className="bph-title-actions">
          <Action onClick={() => setView('settings')}>{label('ui.button.settings', language)}</Action>
          <Action onClick={() => setView('credits')}>{label('ui.credits.button', language)}</Action>
          <MenuLink href={discordUrl}>DISCORD</MenuLink>
          <MenuLink href={bugReportUrl}>{label('ui.button.reportbug', language)}</MenuLink>
          <Action disabled={!onResetProgress} onClick={() => setView('reset')}>{label('ui.button.resetprogress', language)}</Action>
          <Action onClick={() => setView('quit')}>{label('ui.button.quit', language)}</Action>
        </nav>
        <nav aria-label={isChinese ? '开发者链接' : 'Developer links'} className="bph-title-developers">
          {developerLinks.map(({ name, image, url }) => (
            <MenuLink href={url} key={name} name={name}><img alt="" src={art(image)} /></MenuLink>
          ))}
        </nav>
        <span className="bph-title-version">v1.0</span>
      </>}
      {view === 'settings' && <Settings prefs={preferences} setPreference={setPreference} onBack={close} {...sound} />}
      {view === 'credits' && <Credits language={language} onBack={close} />}
      {view === 'reset' && (
        <Confirm language={language} confirmLabel={label('ui.button.delete_save', language)} onCancel={close} onConfirm={() => { onResetProgress?.(); close() }}>
          {label('ui.menu.resetdesc', language)}
        </Confirm>
      )}
      {view === 'quit' && <Confirm language={language} onCancel={close} onConfirm={() => {
        if (onQuit) onQuit()
        else {
          window.close()
          setView('exited')
        }
      }}>
        {isChinese ? '要退出游戏吗？' : 'Quit the game?'}
      </Confirm>}
    </section>
  )
}

export function GameMenu({ chapter = 1, chapterTitle = '', onMainMenu, onResume, onResetProgress, ...sound }: GameMenuProps) {
  return <MainMenu chapter={chapter} chapterTitle={chapterTitle} hasProgress paused onPlay={onResume}
    onResetProgress={onResetProgress} onQuit={onMainMenu} {...sound} />
}

function Confirm({ children, language, confirmLabel = label('ui.button.confirm', language), onCancel, onConfirm }: {
  children: ReactNode
  language: Language
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="bph-menu-modal">
      <section className="bph-menu-popup" role="dialog" aria-modal="true" aria-labelledby="bph-menu-confirm" tabIndex={-1}>
        <p id="bph-menu-confirm">{children}</p>
        <div className="bph-menu-row">
          <Action onClick={onCancel}>{label('ui.button.cancel', language)}</Action>
          <Action gold onClick={onConfirm}>{confirmLabel}</Action>
        </div>
      </section>
    </div>
  )
}

function Credits({ language, onBack }: { language: Language; onBack: () => void }) {
  const title = label('ui.credits.button', language)
  return (
    <div className="bph-menu-modal">
      <section className="bph-menu-credits" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="bph-credit-roll">
          <img alt={language === 'zh-CN' ? '卡包英雄' : 'Booster Pack Heroes'} src={language === 'zh-CN' ? asset(titleAsset) : art('logo-en')} />
          {credits.map(({ heading, names, roles }, index) => (
            <section key={heading}>
              <h2>{label(heading as LabelKey, language)}</h2>
              {index === 0 && <img alt="Zup Games" src={art('credits-zup')} />}
              {index === 1 && <img alt="Funday Games" src={art('credits-funday')} />}
              {names.map((name) => <p key={name}>{name}</p>)}
              {roles.map(({ label: role, names: members }) => (
                <div key={role}>
                  <h3>{role.startsWith('ui.') ? label(role as LabelKey, language) : role}</h3>
                  {members.map((name) => <p key={name}>{name}</p>)}
                </div>
              ))}
            </section>
          ))}
          <p>{label('ui.credits.closing', language)}</p>
        </div>
        <Action className="bph-settings-back" onClick={onBack}>{label('ui.credits.back', language)}</Action>
      </section>
    </div>
  )
}

type SettingsProps = SoundProps & {
  prefs: MenuPreferences
  setPreference: ReturnType<typeof usePreferences>['setPreference']
  onBack: () => void
}

const tabs: SettingsTab[] = ['general', 'graphics', 'gameplay', 'audio']

function Settings({ prefs, setPreference, onBack, muted, onToggleMute }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const [saveMessage, setSaveMessage] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const { language } = prefs
  const isChinese = language === 'zh-CN'
  const t = (key: LabelKey) => label(key, language)

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.querySelector('.scene')?.requestFullscreen()
    } catch {
      setFullscreen(Boolean(document.fullscreenElement))
    }
  }

  function exportSave() {
    const { campaign } = loadCampaign()
    const data = new Blob([JSON.stringify(campaign, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(data)
    const download = document.createElement('a')
    download.href = url
    download.download = 'booster-pack-heroes-save.json'
    download.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importSave(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const campaign = parseCampaign(await file.text())
      if (campaign && writeCampaign(campaign)) {
        window.location.reload()
        return
      }
    } catch {
      // All unreadable or incompatible files use the same message.
    }
    setSaveMessage(t('ui.savetransfer.downloadfailed'))
  }

  return (
    <div className="bph-menu-modal">
      <section aria-label={t('ui.button.settings')} aria-modal="true" className="bph-settings" role="dialog" tabIndex={-1}>
        <div className="bph-settings-tabs">
          {tabs.map((option) => (
            <button type="button" className="bph-menu-button" key={option} aria-pressed={option === tab} onClick={() => setTab(option)}>
              {t(`ui.settings.${option}`)}
            </button>
          ))}
        </div>
        <div className="bph-settings-content">
          {tab === 'general' && <>
            <label className="bph-setting-select">
              <span>{t('ui.settings.language')}</span>
              <select value={language} onChange={(event) => setPreference('language', event.target.value === 'en' ? 'en' : 'zh-CN')}>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="bph-menu-row">
              <Action onClick={exportSave}>{t('ui.settings.exportsave')}</Action>
              <Action onClick={() => importInput.current?.click()}>{t('ui.settings.importsave')}</Action>
              <input accept=".json,application/json" hidden ref={importInput} type="file" onChange={importSave} />
            </div>
            {saveMessage && <span role="status">{saveMessage}</span>}
            <Check label={t('ui.settings.allowdatacollection')} value={prefs.analytics} onChange={(value) => setPreference('analytics', value)} />
            <MenuLink href={privacyUrl}>{t('ui.settings.privacypolicy')}</MenuLink>
          </>}
          {tab === 'graphics' && <>
            <Range label={t('ui.menu.brightness')} min={.65} max={1.45} value={prefs.brightness} onChange={(value) => setPreference('brightness', value)} />
            <Range label={t('ui.menu.contrast')} min={.65} max={1.45} value={prefs.contrast} onChange={(value) => setPreference('contrast', value)} />
            <Check label={t('ui.menu.fullscreen')} value={fullscreen} disabled={!document.fullscreenEnabled} onChange={toggleFullscreen} />
            <Check label={t('ui.settings.toggle_crt')} value={prefs.crt} onChange={(value) => setPreference('crt', value)} />
            <Check label={t('ui.settings.vsync')} value={prefs.vsync} onChange={(value) => setPreference('vsync', value)} />
            <label className="bph-setting-select">
              <span>FPS</span>
              <select value={prefs.frameRate} onChange={(event) => setPreference('frameRate', Number(event.target.value))}>
                <option value="0">{t('ui.settings.fps_uncapped')}</option>
                {[30, 60, 120].map((rate) => <option key={rate} value={rate}>{rate} FPS</option>)}
              </select>
            </label>
          </>}
          {tab === 'gameplay' && <>
            <Range label={t('ui.menu.vibration')} value={prefs.vibration} onChange={(value) => setPreference('vibration', value)} />
            <Range label={t('ui.settings.gamepadsensitivity')} min={.25} max={2} value={prefs.gamepadSensitivity} onChange={(value) => setPreference('gamepadSensitivity', value)} />
            <Check label={t('ui.menu.screenshake')} value={prefs.screenShake} onChange={(value) => setPreference('screenShake', value)} />
            <Check label={t('ui.menu.skilltreeanimations')} value={prefs.skilltreeAnimations} onChange={(value) => setPreference('skilltreeAnimations', value)} />
            <div className="bph-setting-cycle" role="group" aria-label={t('ui.settings.damage_numbers')}>
              <span>{t('ui.settings.damage_numbers')}</span>
              <div className="bph-setting-cycle-controls">
                {[-1, 1].map(direction => {
                  const current = damageNumberModes.indexOf(prefs.damageNumberMode)
                  const next = damageNumberModes[(current + direction + damageNumberModes.length) % damageNumberModes.length]
                  return <button key={direction} type="button" data-direction={direction}
                    aria-label={t(`ui.settings.damage_numbers_${next}`)}
                    onClick={() => setPreference('damageNumberMode', next)} />
                })}
                <output>{t(`ui.settings.damage_numbers_${prefs.damageNumberMode}`)}</output>
              </div>
            </div>
          </>}
          {tab === 'audio' && <>
            <Range label={t('ui.menu.music')} value={prefs.music} onChange={(value) => setPreference('music', value)} />
            <Range label={t('ui.menu.sfx')} value={prefs.sfx} onChange={(value) => setPreference('sfx', value)} />
            <Check label={isChinese ? '静音' : 'Mute'} value={muted} onChange={onToggleMute} />
          </>}
        </div>
        <Action className="bph-settings-back" onClick={onBack}>{t('ui.button.back')}</Action>
      </section>
    </div>
  )
}

function Check({ label, value, onChange, disabled }: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="bph-setting-check">
      <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Range({ label, min = 0, max = 1, value, onChange }: {
  label: string
  min?: number
  max?: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="bph-setting-range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step=".01" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}
