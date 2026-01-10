import { Link, useLocation } from 'react-router-dom'
import { Home, Activity, BarChart3 } from 'lucide-react'

export default function Navigation() {
  const location = useLocation()

  return (
    <nav className="glass-card m-4 p-4">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
            <span className="text-xl font-bold">D</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">Dungloe GAA</h1>
            <p className="text-xs text-white/60">Analytics Platform</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Link
            to="/"
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all ${
              location.pathname === '/'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Home size={20} />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>

          <Link
            to="/matches"
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl transition-all ${
              location.pathname.includes('/match')
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Activity size={20} />
            <span className="hidden sm:inline">Live Match</span>
          </Link>

          <button className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all">
            <BarChart3 size={20} />
            <span className="hidden sm:inline">Reports</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

