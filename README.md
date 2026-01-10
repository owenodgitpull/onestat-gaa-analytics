# Dungloe GAA Analytics Platform

Modern team analytics platform for GAA clubs with AI-powered insights.

## 🏉 Features

- **Fitness Testing**: Import CSV data, AI analysis, squad comparisons
- **Training Attendance**: Track sessions, analyze patterns
- **Match Recording**: Live possession tracking with interactive pitch
- **Player Attribution**: Individual performance tracking & leaderboards
- **GPS Integration**: StatSports data import and analysis
- **AI Insights**: Claude-powered pattern detection and recommendations
- **Competition System**: Healthy competition through stats & achievements

## 🛠️ Tech Stack

### Backend
- Python 3.11+
- FastAPI (async web framework)
- SQLAlchemy + Alembic (ORM & migrations)
- PostgreSQL (Supabase)
- Anthropic Claude API (AI analysis)
- Pandas (data processing)

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- TailwindCSS + Shadcn/UI (styling & components)
- Recharts (charts/graphs)
- Framer Motion (animations)
- @use-gesture/react (touch gestures for iPad)

### Infrastructure
- Vercel (frontend hosting)
- Fly.io (backend hosting)
- Supabase (PostgreSQL + Auth + Storage)
- Docker (local development)

## 💰 Cost

**Estimated: €5-20/month**
- Vercel: Free (hobby tier)
- Fly.io: $0-5/month (free tier likely sufficient)
- Supabase: Free (500MB database)
- Claude API: $3-15/month (usage-based)

## 📋 Prerequisites

- Python 3.11+
- Node.js 18+
- Docker & Docker Compose
- Git

## 🚀 Quick Start (Local Development)

### 1. Clone Repository

```bash
git clone https://github.com/owenodgitpull/dungloe-gaa-analytics.git
cd dungloe-gaa-analytics
```

### 2. Environment Setup

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your keys:
# - CLAUDE_API_KEY (get from https://console.anthropic.com)
# - SUPABASE_URL (from https://supabase.com)
# - SUPABASE_KEY
# - DATABASE_URL
```

### 3. Start with Docker

```bash
# Start all services (backend, frontend, database)
docker-compose up

# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### 4. Run Database Migrations

```bash
# In a new terminal
docker-compose exec backend alembic upgrade head
```

## 🏗️ Development (Without Docker)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

## 📖 Project Structure

```
dungloe-gaa-analytics/
├── backend/                 # Python FastAPI backend
│   ├── app/
│   │   ├── main.py         # FastAPI app entry
│   │   ├── models/         # Database models
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic (AI, GPS parsing)
│   │   ├── schemas/        # Request/response schemas
│   │   └── database.py     # Database connection
│   ├── alembic/            # Database migrations
│   └── tests/              # Backend tests
│
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Route pages
│   │   ├── lib/            # Utilities
│   │   └── hooks/          # Custom hooks
│   └── public/             # Static assets
│
└── docs/                   # Documentation
    ├── IMPLEMENTATION_PLAN.md
    ├── PLAYER_ATTRIBUTION_SYSTEM.md
    └── PITCH_TRACKING_SYSTEM.md
```

## 🎯 API Endpoints

### Players
- `GET /api/players` - List all players
- `POST /api/players` - Create player
- `GET /api/players/{id}` - Get player details
- `PUT /api/players/{id}` - Update player
- `DELETE /api/players/{id}` - Delete player

### Fitness Tests
- `POST /api/fitness-tests/upload` - Upload CSV
- `GET /api/fitness-tests` - List all tests
- `GET /api/fitness-tests/player/{player_id}` - Player's tests
- `POST /api/fitness-tests/{id}/analyze` - Trigger AI analysis

### Matches
- `POST /api/matches` - Create match
- `GET /api/matches` - List matches
- `GET /api/matches/{id}` - Match details
- `POST /api/matches/{id}/events` - Record match event
- `GET /api/matches/{id}/possession` - Possession summary

### GPS Data
- `POST /api/gps/upload` - Upload GPS data
- `GET /api/gps/match/{match_id}` - GPS data for match
- `GET /api/gps/player/{player_id}` - Player GPS history

### AI Analysis
- `POST /api/ai/analyze-fitness` - Analyze fitness test
- `POST /api/ai/analyze-match` - Analyze match performance
- `GET /api/ai/insights` - Get recent insights
- `POST /api/ai/weekly-report` - Generate weekly report

## 📱 iPad Optimization

The app is specifically optimized for iPad use during matches:

- **Touch Targets**: Minimum 44px (Apple HIG standard)
- **No Double-Tap Zoom**: Disabled for fast input
- **Gesture Support**: Drag, pinch, swipe optimized
- **Portrait & Landscape**: Both orientations supported
- **Offline Capable**: PWA with offline match recording

## 🧪 Testing

### Backend Tests
```bash
cd backend
pytest
```

### Frontend Tests
```bash
cd frontend
npm test
```

## 🚢 Deployment

### Backend (Fly.io)
```bash
cd backend
fly launch
fly deploy
```

### Frontend (Vercel)
```bash
cd frontend
vercel --prod
```

See `docs/DEPLOYMENT.md` for detailed deployment instructions.

## 📊 Sample Data

Sample data files for testing:
- `data/fitness_test_sample.csv` - Fitness test format
- `data/gps_statsports_sample.pdf` - StatSports GPS report
- `data/squad_roster.csv` - Player roster template

## 🤝 Contributing

This is a private project for Dungloe GAA. For questions or issues, contact the development team.

## 📄 License

Proprietary - Dungloe GAA Club © 2026

## 🆘 Support

For technical issues or questions:
- Email: [your-email]
- GitHub Issues: Create an issue with details
- Documentation: See `/docs` folder

## 🗺️ Roadmap

### Phase 1 (Weeks 1-2) ✅
- [x] Project setup
- [ ] Database schema
- [ ] Basic API endpoints
- [ ] Frontend skeleton
- [ ] Authentication

### Phase 2 (Weeks 2-3)
- [ ] Fitness testing module
- [ ] Training attendance
- [ ] CSV import functionality

### Phase 3 (Weeks 3-4)
- [ ] Match recording
- [ ] Interactive pitch tracking
- [ ] Possession system

### Phase 4 (Weeks 4-5)
- [ ] Player attribution
- [ ] Statistics aggregation
- [ ] Leaderboards

### Phase 5 (Weeks 5-6)
- [ ] GPS data integration
- [ ] Charts & graphs
- [ ] AI analysis engine

### Phase 6 (Week 7)
- [ ] Polish & optimization
- [ ] Deployment
- [ ] Documentation
- [ ] Training videos

## 🎓 Documentation

- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Full build roadmap
- [Player Attribution System](docs/PLAYER_ATTRIBUTION_SYSTEM.md) - Competition features
- [Pitch Tracking System](docs/PITCH_TRACKING_SYSTEM.md) - Possession tracking design
- [API Documentation](http://localhost:8000/docs) - Interactive API docs (when running)

---

Built with ❤️ for Dungloe GAA

