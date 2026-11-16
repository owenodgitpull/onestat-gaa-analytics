/**
 * A report laid out for A4 landscape: /reports/print?match=<id>&template=post-match[&blocks=a,b,c]
 * Rendered by the PDF function (frontend/api/report-pdf.ts, headless Chrome) and printable from the browser. Dark, like the
 * app. Blocks come from config/reportBlocks (the same components as the screens); a block with no data is left out.
 * Sets window.__REPORT_READY = true once every query has settled, so the PDF is taken only when everything is drawn.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useIsFetching } from '@tanstack/react-query'
import { Loader2, Printer } from 'lucide-react'
import { ReportModeContext } from '@/contexts/ReportModeContext'
import { GpsSeasonCtx } from '@/components/gps/GpsAnalysisViews'
import { useClub, useClubName } from '@/contexts/ClubContext'
import { useMatchReportData } from '@/hooks/useMatchReportData'
import { MATCH_BLOCKS, MATCH_SECTIONS, MATCH_TEMPLATES, type ReportBlock } from '@/config/reportBlocks'

const PRINT_CSS = `
@page { size: A4 landscape; margin: 9mm 10mm 11mm 10mm; }
html, body { background: #070d1a !important; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
.report-root [data-print-hide], .report-root select, .report-root input, .report-root [role="group"], .report-root [role="tablist"],
.report-root button[aria-label^="About"] { display: none !important; }
.report-root [class*="max-h-"], .report-root .overflow-y-auto, .report-root .overflow-auto { max-height: none !important; overflow: visible !important; }
.report-root .glass-card { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: rgba(255,255,255,0.045) !important; }
/* off-screen blocks skip painting on screen (180+ charts made the page crawl); printing still renders them all */
@media screen { .report-section { content-visibility: auto; contain-intrinsic-size: auto 2400px; } }
.report-block { break-inside: avoid; }
.report-block.flow { break-inside: auto; }
.report-section { break-before: page; }
.report-cover { break-after: page; }
@media print { .report-toolbar { display: none !important; } }
`

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

export default function ReportPrint() {
  const [params] = useSearchParams()
  const matchId = params.get('match') || ''
  const template = MATCH_TEMPLATES[params.get('template') || 'post-match'] || MATCH_TEMPLATES['post-match']
  const wanted = (params.get('blocks')?.split(',').filter(Boolean)) || template.blocks
  const d = useMatchReportData(matchId)
  const team = useClubName() || 'Us'
  const { club, logoUrl } = useClub()
  const opponent = d.match?.opponent || 'Opposition'
  const accent = club?.primary_colour || '#10b981'

  // ready = nothing loading for a moment (charts draw after their data arrives)
  const fetching = useIsFetching()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (d.loading || fetching > 0) { setReady(false); return }
    const t = setTimeout(() => setReady(true), 1500)
    return () => clearTimeout(t)
  }, [d.loading, fetching])
  useEffect(() => { (window as unknown as { __REPORT_READY?: boolean }).__REPORT_READY = ready }, [ready])

  const blocks = useMemo(() => wanted.map(id => MATCH_BLOCKS.find(b => b.id === id)).filter((b): b is ReportBlock => !!b), [wanted])
  const ctx = { d, team, opponent }
  const rendered = blocks.map(b => ({ b, node: d.match ? b.render(ctx) : null })).filter(x => x.node)
  const sections = MATCH_SECTIONS.map(name => ({ name, items: rendered.filter(x => x.b.section === name) })).filter(s => s.items.length)
  const seasonCtx = d.gpsSeason && d.gpsCtx ? { matchId, rows: d.gpsSeason.matches } : null
  const m = d.match
  const won = m ? m.team_goals * 3 + m.team_points - (m.opponent_goals * 3 + m.opponent_points) : 0

  return (
    <ReportModeContext.Provider value={{ print: true }}>
      <GpsSeasonCtx.Provider value={seasonCtx}>
        <style>{PRINT_CSS}</style>
        <div className="report-root min-h-screen bg-[#070d1a] text-white">
          <div className="report-toolbar sticky top-0 z-50 flex items-center justify-between gap-3 px-6 py-3 bg-slate-950/90 border-b border-white/10">
            <span className="text-sm text-white/70 flex items-center gap-2">
              {ready ? 'Report ready' : <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Drawing every chart…</>}
            </span>
            <button onClick={() => window.print()} disabled={!ready} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium">
              <Printer size={15} aria-hidden="true" /> Print / save as PDF
            </button>
          </div>

          <div className="mx-auto max-w-[1123px] px-6 py-6">
            {d.error && <p className="text-amber-300">{d.error}</p>}
            {m && (
              <section className="report-cover relative flex flex-col justify-between min-h-[700px] rounded-3xl overflow-hidden border border-white/10 p-12"
                style={{ background: `radial-gradient(120% 90% at 85% 10%, ${accent}33 0%, transparent 55%), linear-gradient(160deg, #0b1630 0%, #070d1a 70%)` }}>
                <div className="flex items-center gap-4">
                  {logoUrl && <img src={logoUrl} alt="" className="w-16 h-16 rounded-full object-cover bg-white/10" />}
                  <div>
                    <div className="text-lg font-semibold text-white/90">{team}</div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/50">{template.label}</div>
                  </div>
                </div>
                <div>
                  <div className="text-sm uppercase tracking-[0.25em] text-white/50 mb-3">{[m.competition, m.stage].filter(Boolean).join(' · ')}</div>
                  <h1 className="text-6xl font-extrabold leading-tight">{team} <span className="text-white/40 font-light">v</span> {opponent}</h1>
                  <div className="mt-6 flex items-end gap-6">
                    <div className="text-7xl font-black tabular-nums" style={{ color: won > 0 ? '#34d399' : won < 0 ? '#f87171' : '#fbbf24' }}>
                      {m.team_goals}-{String(m.team_points).padStart(2, '0')}
                    </div>
                    <div className="text-3xl font-bold text-white/40 pb-2">v</div>
                    <div className="text-7xl font-black tabular-nums text-white/80">{m.opponent_goals}-{String(m.opponent_points).padStart(2, '0')}</div>
                  </div>
                  <div className="mt-3 text-lg text-white/70">{won > 0 ? `Won by ${won}` : won < 0 ? `Lost by ${-won}` : 'Draw'}</div>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-4 text-sm text-white/60">
                  <span>{fmtDate(m.match_date)}{m.venue ? ` · ${m.venue}` : ''}</span>
                  <span>{sections.length} sections · prepared with OneStat</span>
                </div>
              </section>
            )}

            {sections.map(sec => (
              <section key={sec.name} className="report-section pt-2">
                <div className="flex items-center gap-3 mb-4 mt-6">
                  <span className="w-1.5 h-8 rounded-full" style={{ background: accent }} aria-hidden="true" />
                  <h2 className="text-3xl font-bold">{sec.name}</h2>
                  <span className="ml-auto text-xs text-white/40">{team} v {opponent}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {sec.items.map(({ b, node }) => (
                    <Fragment key={b.id}>
                      <div className={`report-block ${b.size === 'full' ? 'col-span-2' : ''} ${b.needsGps ? 'flow' : ''} min-w-0`}>
                        {b.needsGps && <h3 className="text-lg font-semibold text-white/90 mb-2">{b.label}</h3>}
                        {node}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </GpsSeasonCtx.Provider>
    </ReportModeContext.Provider>
  )
}
