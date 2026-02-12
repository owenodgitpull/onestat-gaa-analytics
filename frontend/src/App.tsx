import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MatchRecording from './pages/MatchRecording'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Results from './pages/Results'
import MatchResult from './pages/MatchResult'
import Attendance from './pages/Attendance'
import Players from './pages/Players'
import PlayerView from './pages/PlayerView'
import MatchPrep from './pages/MatchPrep'
import Navigation from './components/Navigation'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        {/* Animated background with floating orbs and shimmer */}
        <div className="app-background">
          <div className="app-bg-orb" />
          <div className="app-bg-shimmer" />
        </div>

        <div className="min-h-screen relative z-10">
          <Navigation />
          <main className="md:ml-14 px-4 py-6">
            <div className="max-w-7xl mx-auto">
              <Routes>
                <Route path="/" element={<AnalyticsDashboard />} />
                <Route path="/match/:matchId" element={<MatchRecording />} />
                <Route path="/match-prep/:matchId" element={<MatchPrep />} />
                <Route path="/results" element={<Results />} />
                <Route path="/results/:matchId" element={<MatchResult />} />
                <Route path="/players" element={<Players />} />
                <Route path="/players/:playerId" element={<PlayerView />} />
                <Route path="/training" element={<Attendance />} />
                <Route path="/attendance" element={<Attendance />} />
              </Routes>
            </div>
          </main>
        </div>
      </Router>
    </QueryClientProvider>
  )
}

export default App

