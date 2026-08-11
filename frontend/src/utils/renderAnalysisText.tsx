/**
 * Shared markdown-to-JSX renderer for AI text displays.
 * Handles headers, bold, bullets, numbered lists, and tables.
 */

// ─── Inline formatting ─────────────────────────────────────────────────────────

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-white/90 italic">$1</em>')
    .replace(/`(.+?)`/g, '<code class="text-emerald-300 bg-white/10 px-1 rounded text-xs font-mono">$1</code>')
}

// ─── Table renderer ────────────────────────────────────────────────────────────

function renderTable(tableLines: string[], key: string): JSX.Element {
  const rows = tableLines
    .filter((l) => !l.replace(/\|/g, '').trim().match(/^[-: ]+$/)) // strip separator rows
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
    )
    .filter((cells) => cells.length > 0)

  if (rows.length === 0) return <></>

  const [header, ...body] = rows

  // For 3-column comparison tables (Metric | Player A | Player B),
  // detect numeric values to highlight the winner per row.
  const isComparison = header.length === 3

  function parseNum(v: string): number | null {
    // strip %, bold markers, trailing text — grab first number
    const m = v.replace(/\*\*/g, '').match(/^[\d.]+/)
    return m ? parseFloat(m[0]) : null
  }

  function cellStyle(
    value: string,
    colIdx: number,
    rowCells: string[]
  ): string {
    if (!isComparison || colIdx === 0) return 'text-white/90'
    const a = parseNum(rowCells[1])
    const b = parseNum(rowCells[2])
    if (a === null || b === null || a === b) return 'text-white/90'
    const isBetter =
      (colIdx === 1 && a > b) || (colIdx === 2 && b > a)
    return isBetter ? 'text-emerald-400 font-semibold' : 'text-white/55'
  }

  return (
    <div key={key} className="overflow-x-auto my-3 rounded-xl border border-white/10">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-white/8 border-b border-white/15">
            {header.map((h, i) => (
              <th
                key={i}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white/55 ${
                  i === 0 ? 'text-left' : 'text-right'
                }`}
                dangerouslySetInnerHTML={{ __html: formatInline(h) }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, ri) => {
            // Detect if this is a "total" or highlighted row
            const isBold = cells[0]
              ? /total|overall|score/i.test(cells[0]) ||
                cells[0].startsWith('**') ||
                tableLines
                  .find((l) => !l.replace(/\|/g, '').trim().match(/^[-: ]+$/))
                  ?.includes(`**${cells[0]}**`)
              : false

            return (
              <tr
                key={ri}
                className={`border-b border-white/5 transition-colors hover:bg-white/4 ${
                  ri % 2 === 0 ? 'bg-white/2' : ''
                } ${isBold ? 'bg-white/6' : ''}`}
              >
                {cells.map((cell, ci) => {
                  const cleaned = cell.replace(/\*\*/g, '')
                  const bold = cell.includes('**') || isBold
                  return (
                    <td
                      key={ci}
                      className={`px-4 py-2.5 ${ci === 0 ? 'text-left text-white/70' : 'text-right'} ${
                        cellStyle(cell, ci, cells)
                      } ${bold && ci === 0 ? 'font-semibold text-white' : ''}`}
                      dangerouslySetInnerHTML={{ __html: formatInline(cleaned) }}
                    />
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main renderer ─────────────────────────────────────────────────────────────

export function renderAnalysisText(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // ── Table block ──
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(renderTable(tableLines, `table-${i}`))
      continue
    }

    // ── Empty line ──
    if (!trimmed) {
      elements.push(<div key={i} className="h-2" />)
      i++
      continue
    }

    // ── H3 ──
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="text-base font-semibold text-white mt-4 mb-2">
          {trimmed.replace(/^###\s*/, '')}
        </h4>
      )
      i++
      continue
    }

    // ── H2 ──
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="text-lg font-bold text-white mt-4 mb-2">
          {trimmed.replace(/^##\s*/, '')}
        </h3>
      )
      i++
      continue
    }

    // ── H1 ──
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={i} className="text-xl font-bold text-white mt-4 mb-2">
          {trimmed.replace(/^#\s*/, '')}
        </h2>
      )
      i++
      continue
    }

    // ── Numbered section header: "1. **Title**" ──
    const numberedHeader = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)$/)
    if (numberedHeader) {
      elements.push(
        <h4 key={i} className="text-base font-semibold text-emerald-400 mt-4 mb-2">
          {numberedHeader[1]}. {numberedHeader[2]}{numberedHeader[3]}
        </h4>
      )
      i++
      continue
    }

    // ── Standalone bold header: "**Title**" or "**Title**:" ──
    const boldHeader = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
    if (boldHeader) {
      elements.push(
        <h4 key={i} className="text-base font-semibold text-emerald-400 mt-4 mb-2">
          {boldHeader[1]}
        </h4>
      )
      i++
      continue
    }

    // ── Horizontal rule ──
    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={i} className="border-white/10 my-3" />)
      i++
      continue
    }

    // ── Bullet list ──
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const content = trimmed.replace(/^[-•]\s*/, '')
      elements.push(
        <div key={i} className="flex items-start gap-2 ml-2 mb-1">
          <span className="text-emerald-400 mt-1 shrink-0">•</span>
          <span
            className="text-white/80 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: formatInline(content) }}
          />
        </div>
      )
      i++
      continue
    }

    // ── Numbered list item: "1. text" (not a header) ──
    const numberedItem = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numberedItem && !numberedHeader) {
      elements.push(
        <div key={i} className="flex items-start gap-2 ml-2 mb-1">
          <span className="text-emerald-400 mt-0.5 shrink-0 text-xs font-bold w-4 text-right">{numberedItem[1]}.</span>
          <span
            className="text-white/80 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: formatInline(numberedItem[2]) }}
          />
        </div>
      )
      i++
      continue
    }

    // ── Regular paragraph ──
    elements.push(
      <p
        key={i}
        className="text-white/80 leading-relaxed mb-2"
        dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }}
      />
    )
    i++
  }

  return elements
}
