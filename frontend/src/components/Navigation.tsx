import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Home,
  Trophy,
  Users,
  PlusCircle,
  Dumbbell,
  LogOut,
  ChevronDown,
  CalendarDays,
  BarChart3,
  UserCircle,
  Settings
} from 'lucide-react'
import { useCreateMatch } from '../hooks/useMatches'
import { useState } from 'react'
import NewMatchModal from './NewMatchModal'

export default function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const createMatch = useCreateMatch()
  const [isCreatingMatch, setIsCreatingMatch] = useState(false)
  const [isNewMatchModalOpen, setIsNewMatchModalOpen] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  const handleNewMatch = async (data: { opponent: string; venue: 'home' | 'away' | 'neutral'; matchDate: Date }) => {
    setIsCreatingMatch(true)
    try {
      const match = await createMatch.mutateAsync({
        opponent: data.opponent,
        match_date: data.matchDate.toISOString(),
        venue: data.venue,
        notes: null
      })
      setIsNewMatchModalOpen(false)
      navigate(`/match/${match.id}`)
    } catch (error) {
      console.error('Failed to create match:', error)
      alert('Failed to create match. Please try again.')
    } finally {
      setIsCreatingMatch(false)
    }
  }

  // Get sidebar items based on current page
  const getSidebarItems = () => {
    if (location.pathname === '/' || location.pathname.startsWith('/results')) {
      return [
        { icon: BarChart3, label: 'Dashboard', path: '/', active: location.pathname === '/' },
        { icon: Trophy, label: 'Results', path: '/results', active: location.pathname.startsWith('/results') },
        { icon: CalendarDays, label: 'Schedule', path: '/results', active: false },
      ]
    }
    if (location.pathname.startsWith('/players')) {
      return [
        { icon: Users, label: 'Squad', path: '/players', active: location.pathname === '/players' },
        { icon: BarChart3, label: 'Stats', path: '/players', active: false },
      ]
    }
    if (location.pathname.startsWith('/training') || location.pathname.startsWith('/attendance')) {
      return [
        { icon: Dumbbell, label: 'Sessions', path: '/training', active: true },
        { icon: CalendarDays, label: 'Calendar', path: '/training', active: false },
      ]
    }
    if (location.pathname.startsWith('/match/')) {
      return [
        { icon: Trophy, label: 'Match', path: location.pathname, active: true },
        { icon: BarChart3, label: 'Stats', path: location.pathname, active: false },
      ]
    }
    return []
  }

  const sidebarItems = getSidebarItems()

  return (
    <>
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-slate-900 border-b border-white/10">
        <div className="flex items-center h-14 px-4">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 group mr-8">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center overflow-hidden">
              <img
                src="/clg-logo.png"
                alt="Dungloe GAA"
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                  if (target.parentElement) {
                    target.parentElement.innerHTML = '<span class="text-sm font-bold text-white">D</span>';
                  }
                }}
              />
            </div>
            <span className="text-lg font-bold text-white hidden sm:inline">DUNGLOE GAA</span>
          </Link>

          {/* Main Navigation Links */}
          <div className="flex items-center space-x-1">
            <Link
              to="/"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/')
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              DASHBOARD
            </Link>

            <Link
              to="/results"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/results')
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              RESULTS
            </Link>

            <Link
              to="/players"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/players')
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              PLAYERS
            </Link>

            <Link
              to="/training"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/training')
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              TRAINING
            </Link>
          </div>

          {/* Right Side - New Match + Profile */}
          <div className="flex items-center space-x-3 ml-auto">
            {/* New Match Button */}
            <button
              onClick={() => setIsNewMatchModalOpen(true)}
              disabled={isCreatingMatch}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <PlusCircle size={16} className={isCreatingMatch ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{isCreatingMatch ? 'Creating...' : 'New Match'}</span>
            </button>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                  <UserCircle size={20} className="text-white" />
                </div>
                <ChevronDown size={14} className="text-white/60" />
              </button>

              {/* Dropdown Menu */}
              {showProfileMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowProfileMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-slate-800 border border-white/10 rounded-xl shadow-xl z-20">
                    <button className="w-full px-4 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white flex items-center gap-2">
                      <Settings size={16} />
                      Settings
                    </button>
                    <hr className="my-1 border-white/10" />
                    <button className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2">
                      <LogOut size={16} />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Left Sidebar - Contextual Icons */}
      {sidebarItems.length > 0 && (
        <aside className="fixed left-0 top-14 bottom-0 w-14 bg-slate-900/50 border-r border-white/5 z-40 hidden md:flex flex-col items-center py-4 space-y-1">
          {sidebarItems.map((item, idx) => (
            <Link
              key={idx}
              to={item.path}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                item.active
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                  : 'text-white/40 hover:text-white hover:bg-white/10'
              }`}
              title={item.label}
            >
              <item.icon size={20} />
            </Link>
          ))}

          {/* Divider */}
          <div className="w-6 h-px bg-white/10 my-2" />

          {/* Quick Add - context aware */}
          {(location.pathname === '/' || location.pathname.startsWith('/results')) && (
            <button
              onClick={() => setIsNewMatchModalOpen(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
              title="New Match"
            >
              <PlusCircle size={20} />
            </button>
          )}
        </aside>
      )}

      {/* New Match Modal */}
      <NewMatchModal
        isOpen={isNewMatchModalOpen}
        onClose={() => setIsNewMatchModalOpen(false)}
        onCreate={handleNewMatch}
      />
    </>
  )
}
