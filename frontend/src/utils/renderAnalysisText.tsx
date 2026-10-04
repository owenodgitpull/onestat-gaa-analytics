/**
 * Shared markdown-to-JSX renderer for AI text displays.
 * Uses react-markdown + remark-gfm for robust table and GFM support.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

// ─── Custom component overrides ────────────────────────────────────────────────

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h2 className="text-xl font-bold text-white mt-4 mb-2">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="text-lg font-bold text-white mt-4 mb-2">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-base font-semibold text-white mt-4 mb-2">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-emerald-400 mt-3 mb-1">{children}</h4>
  ),

  // Paragraphs
  p: ({ children }) => (
    <p className="text-white/80 leading-relaxed mb-2">{children}</p>
  ),

  // Bold / italic / code inline
  strong: ({ children }) => (
    <strong className="text-white font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-white/90 italic">{children}</em>
  ),
  code: ({ children, className }) => {
    // code block (```...```) vs inline code
    if (className) {
      return (
        <pre className="bg-white/5 rounded-lg p-3 overflow-x-auto my-2">
          <code className="text-emerald-300 text-xs font-mono">{children}</code>
        </pre>
      )
    }
    return (
      <code className="text-emerald-300 bg-white/10 px-1 rounded text-xs font-mono">{children}</code>
    )
  },

  // Lists
  ul: ({ children }) => (
    <ul className="space-y-1 mb-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-1 mb-2 list-none">{children}</ol>
  ),
  li: ({ children, ...props }) => {
    // @ts-expect-error - ordered comes from parent
    const ordered = props.ordered || props.node?.parentNode?.tagName === 'ol'
    return (
      <div className="flex items-start gap-2 ml-2">
        <span className="text-emerald-400 mt-1 shrink-0 text-xs">{ordered ? '›' : '•'}</span>
        <span className="text-white/80 leading-relaxed">{children}</span>
      </div>
    )
  },

  // Horizontal rule
  hr: () => <hr className="border-white/10 my-3" />,

  // ── Table ────────────────────────────────────────────────────────────────────
  // Mobile-first responsive table with horizontal scroll + scroll hint
  table: ({ children }) => (
    <div className="relative my-3">
      {/* Scroll hint shadow */}
      <div className="absolute top-0 right-0 bottom-0 w-12 bg-gradient-to-l from-slate-900/60 to-transparent pointer-events-none z-10 md:hidden" />
      <div className="overflow-x-auto rounded-xl border border-white/10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        <table
          className="w-full text-sm border-collapse table-auto min-w-[600px] md:min-w-0 [&_th:first-child]:text-left [&_th:not(:first-child)]:text-right [&_td:first-child]:text-left [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:tabular-nums"
        >
          {children}
        </table>
      </div>
      {/* Mobile scroll hint text */}
      <div className="text-[10px] text-white/30 text-center mt-1 md:hidden">
        ← Swipe to see all columns →
      </div>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-white/15 bg-white/5 sticky top-0 z-10">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-white/5 transition-colors hover:bg-white/[0.04] even:bg-white/[0.02]">
      {children}
    </tr>
  ),
  th: ({ children, style }) => {
    const extraStyle = style ?? {}
    return (
      <th
        className="px-3 py-2 md:px-4 md:py-2.5 text-[10px] md:text-xs font-semibold uppercase tracking-wide text-white/50 whitespace-nowrap"
        style={extraStyle}
      >
        {children}
      </th>
    )
  },
  td: ({ children, style }) => (
    <td
      className="px-3 py-2 md:px-4 md:py-2.5 text-[11px] md:text-sm text-white/80 whitespace-nowrap"
      style={style ?? {}}
    >
      {children}
    </td>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-emerald-500/50 pl-3 my-2 text-white/60 italic">
      {children}
    </blockquote>
  ),
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function renderAnalysisText(text: string): JSX.Element[] {
  return [
    <ReactMarkdown
      key="md"
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {text}
    </ReactMarkdown>,
  ]
}
