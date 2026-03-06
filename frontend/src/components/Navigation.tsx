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
  Camera,
} from 'lucide-react'
import { useCreateMatch } from '../hooks/useMatches'
import { useAuth } from '../contexts/AuthContext'
import { useClub } from '../contexts/ClubContext'
import { useState, useRef } from 'react'
import NewMatchModal from './NewMatchModal'
import AIAnalyst from './AIAnalyst'
import ConfirmationModal from './ConfirmationModal'

export default function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const createMatch = useCreateMatch()
  const { user, logout } = useAuth()
  const { club } = useClub()
  const [isCreatingMatch, setIsCreatingMatch] = useState(false)
  const [isNewMatchModalOpen, setIsNewMatchModalOpen] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const [errorAlert, setErrorAlert] = useState<string | null>(null)
  const [profilePic, setProfilePic] = useState<string | null>(() => {
    return localStorage.getItem('gaa_profile_pic')
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setProfilePic(dataUrl)
      localStorage.setItem('gaa_profile_pic', dataUrl)
    }
    reader.readAsDataURL(file)
  }

  // Get initials from name (first letter of first + last name)
  const getInitials = (name?: string) => {
    if (!name) return null
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0][0]?.toUpperCase() || null
  }


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
      navigate(`/match/${match.id}/setup`)
    } catch (error) {
      console.error('Failed to create match:', error)
      setErrorAlert('Failed to create match. Please try again.')
    } finally {
      setIsCreatingMatch(false)
    }
  }

  // Get sidebar items based on current page
  const getSidebarItems = () => {
    if (location.pathname.startsWith('/fixtures')) {
      return [
        { icon: CalendarDays, label: 'Fixtures', path: '/fixtures', active: true },
        { icon: Trophy, label: 'Results', path: '/results', active: false },
        { icon: BarChart3, label: 'Dashboard', path: '/', active: false },
      ]
    }
    if (location.pathname === '/' || location.pathname.startsWith('/results')) {
      return [
        { icon: BarChart3, label: 'Dashboard', path: '/', active: location.pathname === '/' },
        { icon: Trophy, label: 'Results', path: '/results', active: location.pathname.startsWith('/results') },
        { icon: CalendarDays, label: 'Fixtures', path: '/fixtures', active: false },
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
    if (location.pathname.startsWith('/settings')) {
      return [
        { icon: Settings, label: 'Settings', path: '/settings', active: true },
        { icon: BarChart3, label: 'Dashboard', path: '/', active: false },
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
          <div className="flex items-center space-x-1 h-full">
            {[
              { to: '/', label: 'DASHBOARD' },
              { to: '/results', label: 'RESULTS' },
              { to: '/fixtures', label: 'FIXTURES', tour: 'nav-fixtures' },
              { to: '/players', label: 'PLAYERS' },
              { to: '/training', label: 'TRAINING' },
              { to: '/analyst', label: 'ANALYST', tour: 'nav-analyst' },
            ].map(({ to, label, tour }) => (
              <Link
                key={to}
                to={to}
                data-tour={tour}
                className={`px-4 text-sm font-medium transition-all h-14 flex items-center border-b-2 ${
                  isActive(to)
                    ? 'text-white border-emerald-400'
                    : 'text-white/70 border-transparent hover:text-white hover:border-white/20'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Right Side - New Match + Profile */}
          <div className="flex items-center space-x-3 ml-auto">
            {/* New Match Button */}
            <button
              onClick={() => setIsNewMatchModalOpen(true)}
              disabled={isCreatingMatch}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg backdrop-blur-md text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
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
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center overflow-hidden">
                  {profilePic ? (
                    <img src={profilePic} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-white">
                      {getInitials(user?.name) || <UserCircle size={20} />}
                    </span>
                  )}
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
                  <div className="absolute right-0 top-full mt-2 w-56 py-2 bg-slate-800 border border-white/10 rounded-xl shadow-xl z-20">
                    {user && (
                      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
                        <div className="relative group flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center overflow-hidden">
                            {profilePic ? (
                              <img src={profilePic} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-sm font-bold text-white">
                                {getInitials(user.name) || <UserCircle size={24} />}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Camera size={14} className="text-white" />
                          </button>
                          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleProfilePicChange} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{user.name}</p>
                          <p className="text-xs text-white/50 truncate">{user.email}</p>
                          {club && <p className="text-xs text-emerald-400 truncate">{club.name}</p>}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => { setShowProfileMenu(false); navigate('/settings'); }}
                      data-tour="nav-settings"
                      className="w-full px-4 py-2 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white flex items-center gap-2"
                    >
                      <Settings size={16} />
                      Settings
                    </button>
                    <hr className="my-1 border-white/10" />
                    <button
                      onClick={() => logout()}
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
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10"
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
                    ? 'text-white border border-orange-500/40 shadow-lg shadow-orange-600/20' + ' ' + 'bg-gradient-to-br from-orange-500/25 to-amber-500/20 backdrop-blur-md'
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
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
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
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
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

      {/* Error Alert Modal */}
      <ConfirmationModal
        isOpen={!!errorAlert}
        onClose={() => setErrorAlert(null)}
        title="Something Went Wrong"
        message={errorAlert || ''}
        variant="danger"
      />
    </>
  )
}
