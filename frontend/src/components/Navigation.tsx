import { Link, useLocation } from 'react-router-dom'
import { Home, Activity, BarChart3, PlusCircle } from 'lucide-react'

export default function Navigation() {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-xl bg-slate-900/80 border-b border-white/10">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center transform group-hover:scale-105 transition-transform">
              <span className="text-2xl font-bold">D</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white group-hover:text-gradient transition-colors">Dungloe GAA</h1>
              <p className="text-xs text-white/60">Analytics Platform</p>
            </div>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center space-x-2">
            <Link
              to="/"
              className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-medium transition-all ${
                isActive('/')
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Home size={20} />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>

            <Link
              to="/match/new"
              className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-medium transition-all ${
                isActive('/match')
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/50'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Activity size={20} />
              <span className="hidden sm:inline">Live Match</span>
            </Link>

            <button className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 hover:text-white font-medium transition-all">
              <BarChart3 size={20} />
              <span className="hidden sm:inline">Reports</span>
            </button>

            {/* CTA Button */}
            <Link
              to="/match/new"
              className="hidden lg:flex items-center space-x-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium shadow-lg hover:shadow-xl hover:from-emerald-700 hover:to-teal-700 transition-all ml-4"
            >
              <PlusCircle size={20} />
              <span>New Match</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}


