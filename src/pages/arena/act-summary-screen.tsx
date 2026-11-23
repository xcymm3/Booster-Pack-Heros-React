import { useMemo, type CSSProperties } from 'react'
import locale from '../../data/summary-locale.json'
import { actMedals, actSummary } from '../../game/act-summary'
import { cardArt, unitName } from '../../game/rules'
import type { Campaign } from '../../game/save'
import { asset } from './media'
import { actSummaryLayout } from './summary-layout'

type Language = 'zh-CN' | 'en'

const fraction = (age: number, from: number, duration: number) =>
  Math.max(0, Math.min(1, (age - from) / duration))

function art(name?: string) {
  const src = name && asset(name)
  return src ? <img src={src} alt="" draggable={false} /> : null
}

function durationLabel(ms: number, language: Language) {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (language === 'en') return (hours ? hours + ' h ' : '') + rest + ' min'
  return (hours ? hours + ' 小时 ' : '') + rest + ' 分钟'
}

export function ActSummaryScreen({ campaign, age, language, distortion, next, skip }: {
  campaign: Campaign; age: number; language: Language; distortion: number; next: () => void; skip: () => void
}) {
  const results = useMemo(() => actSummary(campaign), [campaign])
  const layout = useMemo(() => actSummaryLayout(distortion), [distortion])
  const { panels, mvp, mvpAt, triesAt, attempts, medal, continueAt, playedTimeMillis } = results
  const label = (key: string) => key === 'section_collection' ? locale['ui.tab.collection'][language] :
    locale[('ui.prestigesummary.' + key) as keyof typeof locale][language]
  const number = (value: number) => value.toLocaleString(language)
  const countedTries = Math.round(attempts * fraction(age, triesAt + .25, 2.5))
  const endOfBar = actMedals[2].tries + 2
  const ready = age >= continueAt
  const mvpCounts = mvp && [
    ['mvp_damage', mvp.damage], ['mvp_spawns', mvp.count], ['mvp_share', mvp.share * 100]
  ] as const
  const titleOpacity = fraction(age, .4, .5)

  return <section className="intermission result-screen act-summary" aria-labelledby="act-summary-title"
    data-ui="" style={{ backgroundColor: 'rgb(0 0 0 / ' + .44 * fraction(age, 0, .4) + ')' }}
    onClick={ready ? undefined : skip}>
    <header className="result-title" style={{ opacity: titleOpacity }}>
      <span className="result-separator" style={layout.topRule} aria-hidden="true" />
      <span className="result-separator" style={layout.bottomRule} aria-hidden="true" />
      <h1 id="act-summary-title" style={layout.title}>{label('title').replace('{0}', '1')}</h1>
    </header>
    <div className="result-panel act-stats" style={{ ...layout.stats, opacity: titleOpacity }}>
      {panels.map(panel => <section key={panel.title} className={'act-' + panel.title.replace('section_', '')}>
        <h2 style={{ visibility: age >= panel.at ? 'visible' : 'hidden' }}>{label(panel.title)}</h2>
        <dl>
          {panel.rows.map(({ key, icon, value, at, duration }) => {
            const shown = value === undefined ? '—' : number(Math.round(value * (duration ? fraction(age, at, duration) : 1)))
            return <div key={key} className="act-stat-row" style={{ visibility: age >= at ? 'visible' : 'hidden' }}>
              <dt>{art(icon === 'packs' ? 'summary/packs.png' : 'summary/act-' + icon + '.png')}{label(key)}</dt>
              <dd>{shown}</dd>
            </div>
          })}
        </dl>
      </section>)}
    </div>
    {mvp && mvpCounts && age >= mvpAt && <section className="result-panel act-mvp" aria-label={label('mvp')}
      style={{ ...layout.mvp, opacity: fraction(age, mvpAt, .25) }}>
      <h2 className="act-mvp-badge">{label('mvp')}</h2>
      <div className="act-mvp-body">
        <div className="act-mvp-art" style={{ '--act-hero-pop': .7 + .3 * fraction(age, mvpAt + .25, .35) } as CSSProperties}>
          <div className="act-mvp-rays" aria-hidden="true">
            {art('chapter-2-3/906-pack_glow.png')}
            {art('summary/act-rays.png')}
            {art('chapter-2-3/900-pack_rays_large.png')}
          </div>
          <div className="act-mvp-portrait">{art(cardArt(mvp.hero))}</div>
        </div>
        <div className="act-mvp-details">
          <h3>{unitName(mvp.hero, language)}</h3>
          <dl>
            {mvpCounts.map(([key, value], index) => {
              const count = value * fraction(age, mvpAt + .6 + index * .6, .45)
              const shown = key === 'mvp_share' ? Math.round(count) + '%' :
                key === 'mvp_damage' && count >= 1000 ? (count / 1000).toFixed(1) + 'K' : number(Math.round(count))
              return <div key={key} className="act-stat-row"><dt>{label(key)}</dt><dd>{shown}</dd></div>
            })}
          </dl>
        </div>
      </div>
    </section>}
    {age >= triesAt && <section className="result-panel act-tries" aria-label={label('tries').replace('{0}', String(attempts))}
      style={{ ...layout.tries, opacity: fraction(age, triesAt, .25) }}>
      <div className="act-try-head">
        <span>{art('summary/time.png')}{durationLabel(playedTimeMillis, language)}</span>
        {medal && ready && <strong>{label('medal_' + medal)}</strong>}
        <span>{label(countedTries === 1 ? 'tries_one' : 'tries').replace('{0}', number(countedTries))}</span>
      </div>
      <div className="act-try-bar" aria-hidden="true">
        <span className="act-try-fill" style={{ width: Math.min(1, countedTries / endOfBar) * 100 + '%' }} />
        {actMedals.map(mark => <span key={mark.id} className={'act-medal' +
          (countedTries > mark.tries ? ' act-medal-lost' : '') + (ready && medal === mark.id ? ' act-medal-won' : '')}
          style={{ left: mark.tries / endOfBar * 100 + '%' }}>
          {art('summary/act-medal-' + mark.id + '.png')}
          <span>{mark.tries}</span>
        </span>)}
      </div>
    </section>}
    {ready && <button type="button" className="result-continue" style={layout.next} onClick={next}>
      {locale['ui.button.continue'][language]}
    </button>}
  </section>
}
