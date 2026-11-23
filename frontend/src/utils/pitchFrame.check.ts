/** Run: npx tsx src/utils/pitchFrame.check.ts  (a self-check, not shipped in the app bundle) */
import { setPitchFrame, pctToSvgX, svgToPctX, fortyFiveLinePct } from './pitchFrame'

let failed = 0
const ok = (c: boolean, msg: string) => { if (!c) { failed++; console.error('FAIL', msg) } }

// frame off: exactly the old formulas
setPitchFrame(null)
for (const p of [0, 12.5, 34, 50, 66, 100]) {
  ok(pctToSvgX(p, 30) === (p / 100) * 1960 + 183, `off: to svg ${p}`)
  ok(svgToPctX((p / 100) * 1960 + 183, 400) === p || Math.abs(svgToPctX((p / 100) * 1960 + 183, 400) - p) < 1e-9, `off: back ${p}`)
}
ok(fortyFiveLinePct(true) === 66 && fortyFiveLinePct(false) === 34, 'off: 45 line is 34 / 66')

// frame on: round trip, symmetry, the 45 lands on the true 45 m line
for (const [L, W] of [[137.82, 86.75], [144.02, 83.68], [143.3, 85.89], [144.9, 89.5]]) {
  setPitchFrame({ L, W })
  for (const p of [0, 3, 13, 20, 31, 34.97, 40, 50, 60, 65.03, 80, 97, 100]) {
    for (const py of [0, 10, 35, 50, 70, 100]) {
      const sx = pctToSvgX(p, py), sy = 123 + (py / 100) * 1167
      ok(Math.abs(svgToPctX(sx, sy) - p) < 0.02, `round trip L=${L} x=${p} y=${py}: ${svgToPctX(sx, sy)}`)
    }
  }
  // the artwork's 45 (34.97 %) is drawn on the true 45 m line, from either end
  const x45 = (pctToSvgX(34.97, 50) - 183) / 1960 * L
  ok(Math.abs(x45 - 45) < 0.3, `45 m line L=${L}: ${x45.toFixed(2)}`)
  const x45r = L - (pctToSvgX(65.03, 50) - 183) / 1960 * L
  ok(Math.abs(x45r - 45) < 0.3, `45 m line (far end) L=${L}: ${x45r.toFixed(2)}`)
  // halfway stays halfway
  ok(Math.abs(pctToSvgX(50, 50) - (183 + 980)) < 0.5, `halfway L=${L}`)
  ok(fortyFiveLinePct(true) === 65.03 && fortyFiveLinePct(false) === 34.97, 'on: 45 line')
}
setPitchFrame(null)
if (failed) throw new Error(failed + ' pitch frame checks failed')
console.log('pitchFrame checks passed')
