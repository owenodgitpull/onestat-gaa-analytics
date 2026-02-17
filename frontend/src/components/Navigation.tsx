import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Trophy,
  Users,
  PlusCircle,
  Dumbbell,
  LogOut,
  ChevronDown,
  CalendarDays,
  BarChart3,
  UserCircle,
  Settings,
  MessageSquare,
  History,
} from 'lucide-react'
import { useCreateMatch } from '../hooks/useMatches'
import { useAuth } from '../contexts/AuthContext'
import { useState } from 'react'
import NewMatchModal from './NewMatchModal'
import AIAnalyst from './AIAnalyst'

export default function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const createMatch = useCreateMatch()
  const { user, logout } = useAuth()
  const [isCreatingMatch, setIsCreatingMatch] = useState(false)
  const [isNewMatchModalOpen, setIsNewMatchModalOpen] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)


  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  const handleNewMatch = async (data: { opponent: string; venue: 'home' | 'away' | 'neutral'; matchDate: Date; weather_condition?: string | null; temperature_celsius?: number | null }) => {
    setIsCreatingMatch(true)
    try {
      const match = await createMatch.mutateAsync({
        opponent: data.opponent,
        match_date: data.matchDate.toISOString(),
        venue: data.venue,
        notes: null,
        weather_condition: data.weather_condition,
        temperature_celsius: data.temperature_celsius,
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
    if (location.pathname.startsWith('/analyst')) {
      return [
        { icon: History, label: 'Chat History', path: '#chat-history', active: false },
      ]
    }
    return []
  }

  const sidebarItems = getSidebarItems()

  return (
    <>
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 backdrop-blur-2xl border-b border-white/[0.12]" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.06))', boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.10)' }}>
        <div className="flex items-center h-14 px-4">
          {/* Logo */}
          <Link to="/" className="flex items-center group mr-8">
            <img
              src="/oneStatLogoTransparent.png"
              alt="OneStat Analytics"
              className="h-8"
            />
          </Link>

          {/* Main Navigation Links */}
          <div className="flex items-center space-x-1">
            <Link
              to="/"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/')
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              DASHBOARD
            </Link>

            <Link
              to="/results"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/results')
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              RESULTS
            </Link>

            <Link
              to="/players"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/players')
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              PLAYERS
            </Link>

            <Link
              to="/training"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/training')
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              TRAINING
            </Link>

            <Link
              to="/analyst"
              className={`px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
                isActive('/analyst')
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              ANALYST
            </Link>
          </div>

          {/* Right Side - New Match + Profile */}
          <div className="flex items-center space-x-3 ml-auto">
            {/* New Match Button */}
            <button
              onClick={() => setIsNewMatchModalOpen(true)}
              disabled={isCreatingMatch}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg backdrop-blur-md text-white text-sm font-medium transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.18))', border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 4px 15px -3px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
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
                  <span className="text-xs font-bold text-white">
                    {user?.name?.[0]?.toUpperCase() || <UserCircle size={20} />}
                  </span>
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
                    {user && (
                      <div className="px-4 py-2 border-b border-white/10">
                        <p className="text-sm font-medium text-white truncate">{user.name}</p>
                        <p className="text-xs text-white/50 truncate">{user.email}</p>
                      </div>
                    )}
                    <button className="w-full px-4 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white flex items-center gap-2">
                      <Settings size={16} />
                      Settings
                    </button>
                    <hr className="my-1 border-white/10" />
                    <button
                      onClick={async () => { await logout(); navigate('/login'); }}
                      className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                    >
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
        <aside className="fixed left-0 top-14 bottom-0 w-14 backdrop-blur-xl border-r border-white/[0.10] z-40 hidden md:flex flex-col items-center py-4 space-y-1" style={{ background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.05))', boxShadow: '4px 0 24px rgba(0,0,0,0.3), inset 1px 0 0 rgba(255,255,255,0.08)' }}>
          {sidebarItems.map((item, idx) =>
            item.path.startsWith('#') ? (
              <button
                key={idx}
                onClick={() => window.dispatchEvent(new CustomEvent('toggle-chat-sidebar'))}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all text-white/40 hover:text-purple-400 hover:bg-purple-500/10"
                title={item.label}
              >
                <item.icon size={20} />
              </button>
            ) : (
              <Link
                key={idx}
                to={item.path}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  item.active
                    ? 'text-white border border-indigo-500/40 shadow-lg shadow-indigo-600/20' + ' ' + 'bg-gradient-to-br from-indigo-500/25 to-violet-500/20 backdrop-blur-md'
                    : 'text-white/40 hover:text-white hover:bg-white/10'
                }`}
                title={item.label}
              >
                <item.icon size={20} />
              </Link>
            )
          )}

          {/* Divider */}
          <div className="w-6 h-px bg-white/10 my-2" />

          {/* Quick Add - context aware */}
          {(location.pathname === '/' || location.pathname.startsWith('/results')) && (
            <button
              onClick={() => setIsNewMatchModalOpen(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all"
              title="New Match"
            >
              <PlusCircle size={20} />
            </button>
          )}

          {/* Spacer to push AI chat to bottom */}
          <div className="flex-1" />

          {/* AI Analyst */}
          <Link
            to="/analyst"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-purple-400 hover:bg-purple-500/10 transition-all"
            title="AI Analyst"
          >
            <MessageSquare size={20} />
          </Link>
        </aside>
      )}

      {/* New Match Modal */}
      <NewMatchModal
        isOpen={isNewMatchModalOpen}
        onClose={() => setIsNewMatchModalOpen(false)}
        onCreate={handleNewMatch}
      />

      {/* AI Chat Modal */}
      <AIAnalyst
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        initialContext="I have access to all match data, player statistics, GPS performance benchmarks, and tactical information from the knowledge base."
      />
    </>
  )
}
