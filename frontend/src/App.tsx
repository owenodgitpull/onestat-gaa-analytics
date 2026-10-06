import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ClubProvider } from './contexts/ClubContext'
import RequireAuth from './components/RequireAuth'
import MatchSetup from './pages/MatchSetup'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Results from './pages/Results'
import Navigation from './components/Navigation'
import PlayerNavigation from './components/PlayerNavigation'
import Settings from './pages/Settings'
import VideoSessionList from './pages/VideoSessionList'
import Fixtures from './pages/Fixtures'
import Onboarding from './pages/Onboarding'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import JoinClub from './pages/JoinClub'
import InvitationPage from './pages/InvitationPage'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import SelectPlayer from './pages/SelectPlayer'

// Player portal pages
import PlayerDashboard from './pages/player/PlayerDashboard'
import { Suspense } from 'react'
import { lazyWithRetry } from './utils/lazyWithRetry'
import ErrorBoundary from './components/ErrorBoundary'
import InstallBanner from './components/InstallBanner'
import TrialBanner from './components/TrialBanner'
import PlayerPreviewBanner from './components/PlayerPreviewBanner'
import EnableNotificationsBanner from './components/EnableNotificationsBanner'

const LeaderboardPage = lazyWithRetry(() => import('./pages/player/LeaderboardPage'))
const MyStatsPage = lazyWithRetry(() => import('./pages/player/MyStatsPage'))
const PlayerProfile = lazyWithRetry(() => import('./pages/player/PlayerProfile'))
const MyClipsPage = lazyWithRetry(() => import('./pages/player/MyClipsPage'))
const PlaybooksPage = lazyWithRetry(() => import('./pages/player/PlaybooksPage'))
const TrainingPage = lazyWithRetry(() => import('./pages/player/TrainingPage'))

// Lazy-load heavy admin pages
const AIAnalystPage = lazyWithRetry(() => import('./pages/AIAnalystPage'))
const SeasonReport = lazyWithRetry(() => import('./pages/SeasonReport'))
const SquadFitness = lazyWithRetry(() => import('./pages/SquadFitness'))
const MatchPrep = lazyWithRetry(() => import('./pages/MatchPrep'))
const PresentationsPage = lazyWithRetry(() => import('./pages/PresentationsPage'))
const VideoCompilationsPage = lazyWithRetry(() => import('./pages/VideoCompilationsPage'))
const PresentationEditor = lazyWithRetry(() => import('./pages/PresentationEditor'))
const FixturePreview = lazyWithRetry(() => import('./pages/FixturePreview'))
const PlayerComparison = lazyWithRetry(() => import('./pages/PlayerComparison'))
const MatchResult = lazyWithRetry(() => import('./pages/MatchResult'))
const PlayerView = lazyWithRetry(() => import('./pages/PlayerView'))
const MatchRecordingRouter = lazyWithRetry(() => import('./pages/MatchRecordingRouter'))
const VideoTagging = lazyWithRetry(() => import('./pages/VideoTagging'))
const Attendance = lazyWithRetry(() => import('./pages/Attendance'))
const Players = lazyWithRetry(() => import('./pages/Players'))

// Initialize offline-first infrastructure (IndexedDB, network monitor, sync engine)
import { initOffline } from './services/offline'
initOffline()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Data doesn't change second-to-second — avoid a full refetch every
      // time a user navigates back to a page they just visited.
      staleTime: 60_000,
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

function AdminMain({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  const isVideo = loc.pathname.startsWith('/video/')
  return (
    <main className={`${isVideo ? '' : 'md:ml-14 px-4 py-6'} overflow-x-hidden`}>
      <div className={isVideo ? '' : 'max-w-7xl mx-auto'}>
        {children}
      </div>
    </main>
  )
}

function App() {
  return (
    <ErrorBoundary>
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
              <Route path="/invitation/:token" element={<InvitationPage />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />

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
                    <PlayerPreviewBanner />
                    <EnableNotificationsBanner />
                    <main className="px-4 pt-8 pb-24 max-w-lg mx-auto safe-area-top">
                      <Suspense fallback={<PlayerLoading />}>
                        <Routes>
                          <Route path="/" element={<PlayerDashboard />} />
                          <Route path="/leaderboards" element={<LeaderboardPage />} />
                          <Route path="/training" element={<TrainingPage />} />
                          <Route path="/stats" element={<MyStatsPage />} />
                          <Route path="/playbooks" element={<PlaybooksPage />} />
                          <Route path="/clips" element={<MyClipsPage />} />
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
                    <TrialBanner />
                    <AdminMain>
                        <Suspense fallback={<PlayerLoading />}>
                        <Routes>
                          <Route path="/" element={<AnalyticsDashboard />} />
                          <Route path="/match/:matchId/setup" element={<MatchSetup />} />
                          <Route path="/match/:matchId" element={<MatchRecordingRouter />} />
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
                          <Route path="/presentations" element={<PresentationsPage />} />
                          <Route path="/presentations/:presentationId" element={<PresentationEditor />} />
                          <Route path="/video-compilations" element={<VideoCompilationsPage />} />
                        </Routes>
                        </Suspense>
                    </AdminMain>
                  </ClubProvider>
                </RequireAuth>
              } />
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
