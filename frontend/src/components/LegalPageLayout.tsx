import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface LegalPageLayoutProps {
  title: string
  lastUpdated: string
  children: React.ReactNode
}

export default function LegalPageLayout({ title, lastUpdated, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0a0f14]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm mb-8 transition-colors">
          <ArrowLeft size={14} /> Back to OneStat
        </Link>

        <img src="/oneStatLogoTransparent.png" alt="OneStat Analytics" className="h-10 mb-6" />

        <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
        <p className="text-white/40 text-sm mb-8">Last updated: {lastUpdated}</p>

        <div className="mb-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-sm leading-relaxed">
          <strong>Draft — pending final legal review.</strong> This page reflects the app's actual data
          handling as of the date above, but the legal wording (liability, jurisdiction, payment terms,
          and similar clauses) has not yet been finalized by legal counsel. It will be updated once that
          review is complete.
        </div>

        <div className="prose-legal text-white/70 text-sm leading-relaxed space-y-6">
          {children}
        </div>
      </div>
    </div>
  )
}
