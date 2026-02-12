/**
 * Shared markdown-to-JSX renderer for AI text displays.
 * Handles headers, bold, bullets, and numbered sections.
 */

/**
 * Converts simple markdown text (from AI responses) into styled JSX elements.
 */
export function renderAnalysisText(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []

  lines.forEach((line, idx) => {
    const trimmed = line.trim()

    // Skip empty lines but add spacing
    if (!trimmed) {
      elements.push(<div key={idx} className="h-2" />)
      return
    }

    // Headers (## or ###)
    if (trimmed.startsWith('###')) {
      elements.push(
        <h4 key={idx} className="text-base font-semibold text-white mt-4 mb-2">
          {trimmed.replace(/^###\s*/, '')}
        </h4>
      )
      return
    }
    if (trimmed.startsWith('##')) {
      elements.push(
        <h3 key={idx} className="text-lg font-bold text-white mt-4 mb-2">
          {trimmed.replace(/^##\s*/, '')}
        </h3>
      )
      return
    }
    if (trimmed.startsWith('#')) {
      elements.push(
        <h2 key={idx} className="text-xl font-bold text-white mt-4 mb-2">
          {trimmed.replace(/^#\s*/, '')}
        </h2>
      )
      return
    }

    // Numbered section headers (e.g., "1. **Match Summary**")
    const numberedHeader = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)$/)
    if (numberedHeader) {
      elements.push(
        <h4 key={idx} className="text-base font-semibold text-indigo-400 mt-4 mb-2">
          {numberedHeader[1]}. {numberedHeader[2]}{numberedHeader[3]}
        </h4>
      )
      return
    }

    // Bold section headers (e.g., "**Key Statistics**")
    const boldHeader = trimmed.match(/^\*\*(.+?)\*\*:?$/)
    if (boldHeader) {
      elements.push(
        <h4 key={idx} className="text-base font-semibold text-indigo-400 mt-4 mb-2">
          {boldHeader[1]}
        </h4>
      )
      return
    }

    // Bullet points
    if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
      const content = trimmed.replace(/^[-•]\s*/, '')
      // Handle bold text within bullet points
      const formattedContent = content.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      elements.push(
        <div key={idx} className="flex items-start gap-2 ml-2 mb-1">
          <span className="text-indigo-400 mt-1">•</span>
          <span
            className="text-white/80 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: formattedContent }}
          />
        </div>
      )
      return
    }

    // Regular paragraph - handle inline bold
    const formattedContent = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    elements.push(
      <p
        key={idx}
        className="text-white/80 leading-relaxed mb-2"
        dangerouslySetInnerHTML={{ __html: formattedContent }}
      />
    )
  })

  return elements
}
