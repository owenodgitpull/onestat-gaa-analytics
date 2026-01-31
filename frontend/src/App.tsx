import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MatchRecording from './pages/MatchRecording'
import AnalyticsDashboard from './pages/AnalyticsDashboard'
import Results from './pages/Results'
import MatchResult from './pages/MatchResult'
import Attendance from './pages/Attendance'
import Players from './pages/Players'
import PlayerView from './pages/PlayerView'
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
        <div className="min-h-screen">
          <Navigation />
          <main className="container mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<AnalyticsDashboard />} />
              <Route path="/match/:matchId" element={<MatchRecording />} />
              <Route path="/results" element={<Results />} />
              <Route path="/results/:matchId" element={<MatchResult />} />
              <Route path="/players" element={<Players />} />
              <Route path="/players/:playerId" element={<PlayerView />} />
              <Route path="/training" element={<Attendance />} />
              <Route path="/attendance" element={<Attendance />} />
            </Routes>
          </main>
        </div>
      </Router>
    </QueryClientProvider>
  )
}

export default App

