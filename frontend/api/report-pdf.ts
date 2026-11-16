/**
 * One-click report PDF (serverless, Vercel). GET /report-pdf?match=<id>&template=post-match[&blocks=a,b][&ai=1]
 *
 * Starts a slimmed headless Chrome (@sparticuz/chromium), opens the report's print page (/reports/print) AS THE CALLER
 * (their own sign-in cookies, same site, so the page sees exactly what they may see), waits until the page says every
 * chart is drawn (window.__REPORT_READY), and prints it to A4 landscape with page numbers. Nothing is stored.
 */
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ALLOWED = ['match', 'template', 'blocks', 'ai']
const READY_TIMEOUT_MS = 50_000

function parseCookies(header: string | undefined) {
  return (header || '').split(';').map(c => c.trim()).filter(Boolean).map(c => {
    const i = c.indexOf('=')
    return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) }
  }).filter(c => c.name)
}

export default async function handler(req: IncomingMessage & { query?: Record<string, string> }, res: ServerResponse) {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || ''
  const url = new URL(req.url || '/', `https://${host}`)
  const match = url.searchParams.get('match') || ''
  if (!/^[0-9a-f-]{36}$/i.test(match)) {
    res.statusCode = 400; res.end('match must be a match id'); return
  }
  const qs = new URLSearchParams()
  ALLOWED.forEach(k => { const v = url.searchParams.get(k); if (v) qs.set(k, v) })
  const target = `https://${host}/reports/print?${qs.toString()}`
  const cookies = parseCookies(req.headers.cookie)
  if (!cookies.length) { res.statusCode = 401; res.end('Sign in first'); return }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1123, height: 794, deviceScaleFactor: 1 },
    })
    const page = await browser.newPage()
    await page.setCookie(...cookies.map(c => ({ ...c, domain: host, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' as const })))
    await page.emulateMediaType('print')
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 30_000 })
    await page.waitForFunction('window.__REPORT_READY === true', { timeout: READY_TIMEOUT_MS, polling: 500 })
    const pdf = await page.pdf({
      landscape: true, format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 12mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>OneStat</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: '9mm', bottom: '11mm', left: '10mm', right: '10mm' },
    })
    const name = (url.searchParams.get('template') || 'report').replace(/[^a-z0-9-]/gi, '')
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${match.slice(0, 8)}.pdf"`)
    res.setHeader('Cache-Control', 'no-store')
    res.end(Buffer.from(pdf))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain')
    res.end(`Could not build the PDF: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
