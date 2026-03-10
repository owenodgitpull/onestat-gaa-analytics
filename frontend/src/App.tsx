import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ClubProvider } from './contexts/ClubContext'
import RequireAuth from './components/RequireAuth'
import MatchSetup from './pages/MatchSetup'
import MatchRecording from './pages/MatchRecording'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Results from './pages/Results'
import MatchResult from './pages/MatchResult'
import Attendance from './pages/Attendance'
import Players from './pages/Players'
import PlayerView from './pages/PlayerView'
import Navigation from './components/Navigation'
import PlayerNavigation from './components/PlayerNavigation'
import Settings from './pages/Settings'
import VideoTagging from './pages/VideoTagging'
import VideoSessionList from './pages/VideoSessionList'
import Fixtures from './pages/Fixtures'
import Onboarding from './pages/Onboarding'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import JoinClub from './pages/JoinClub'
import SelectPlayer from './pages/SelectPlayer'

// Player portal pages
import PlayerDashboard from './pages/player/PlayerDashboard'
import { lazy, Suspense } from 'react'
import InstallBanner from './components/InstallBanner'

const LeaderboardPage = lazy(() => import('./pages/player/LeaderboardPage'))
const MyStatsPage = lazy(() => import('./pages/player/MyStatsPage'))
const PlayerProfile = lazy(() => import('./pages/player/PlayerProfile'))

// Lazy-load heavy admin pages
const AIAnalystPage = lazy(() => import('./pages/AIAnalystPage'))
const SeasonReport = lazy(() => import('./pages/SeasonReport'))
const SquadFitness = lazy(() => import('./pages/SquadFitness'))
const MatchPrep = lazy(() => import('./pages/MatchPrep'))
const FixturePreview = lazy(() => import('./pages/FixturePreview'))
const PlayerComparison = lazy(() => import('./pages/PlayerComparison'))

// Initialize offline-first infrastructure (IndexedDB, network monitor, sync engine)
import { initOffline } from './services/offline'
initOffline()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function PlayerLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          {/* Animated background with floating orbs and shimmer */}
          <div className="app-background">
            <div className="app-bg-orb" />
            <div className="app-bg-shimmer" />
          </div>

          <InstallBanner />
          <div className="min-h-screen relative z-10">
            <Routes>
              {/* Public routes — no auth required */}
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/join/:code" element={<JoinClub />} />

              {/* Onboarding — requires auth but no Navigation */}
              <Route path="/onboarding" element={
                <RequireAuth>
                  <Onboarding />
                </RequireAuth>
              } />

              {/* Player self-selection — requires auth but no ClubProvider/Navigation */}
              <Route path="/select-player" element={
                <RequireAuth>
                  <SelectPlayer />
                </RequireAuth>
              } />

              {/* Player Portal — bottom tab nav, mobile-first */}
              <Route path="/player/*" element={
                <RequireAuth>
                  <ClubProvider>
                    <main className="px-4 py-5 pb-24 max-w-lg mx-auto">
                      <Suspense fallback={<PlayerLoading />}>
                        <Routes>
                          <Route path="/" element={<PlayerDashboard />} />
                          <Route path="/leaderboards" element={<LeaderboardPage />} />
                          <Route path="/stats" element={<MyStatsPage />} />
                          <Route path="/profile" element={<PlayerProfile />} />
                        </Routes>
                      </Suspense>
                    </main>
                    <PlayerNavigation />
                  </ClubProvider>
                </RequireAuth>
              } />

              {/* Admin app — top nav + sidebar (club_admin only) */}
              <Route path="*" element={
                <RequireAuth requiredRole="club_admin">
                  <ClubProvider>
                    <Navigation />
                    <main className="md:ml-14 px-4 py-6">
                      <div className="max-w-7xl mx-auto">
                        <Suspense fallback={<PlayerLoading />}>
                        <Routes>
                          <Route path="/" element={<AnalyticsDashboard />} />
                          <Route path="/match/:matchId/setup" element={<MatchSetup />} />
                          <Route path="/match/:matchId" element={<MatchRecording />} />
                          <Route path="/match-prep/:matchId" element={<MatchPrep />} />
                          <Route path="/fixtures" element={<Fixtures />} />
                          <Route path="/fixtures/:matchId/preview" element={<FixturePreview />} />
                          <Route path="/results" element={<Results />} />
                          <Route path="/results/:matchId" element={<MatchResult />} />
                          <Route path="/results/:matchId/video" element={<VideoSessionList />} />
                          <Route path="/video/:sessionId" element={<VideoTagging />} />
                          <Route path="/players" element={<Players />} />
                          <Route path="/players/compare" element={<PlayerComparison />} />
                          <Route path="/players/:playerId" element={<PlayerView />} />
                          <Route path="/training" element={<Attendance />} />
                          <Route path="/attendance" element={<Attendance />} />
                          <Route path="/reports/season" element={<SeasonReport />} />
                          <Route path="/analyst" element={<AIAnalystPage />} />
                          <Route path="/analyst/:sessionId" element={<AIAnalystPage />} />
                          <Route path="/fitness" element={<SquadFitness />} />
                          <Route path="/settings" element={<Settings />} />
                        </Routes>
                        </Suspense>
                      </div>
                    </main>
                  </ClubProvider>
                </RequireAuth>
              } />
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
