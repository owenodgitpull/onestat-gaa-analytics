# Dungloe GAA Analytics Platform - Implementation Plan

## 🎯 Project Overview

**Goal:** Build a comprehensive GAA team analytics platform with AI-powered insights, replacing the current HTML-based system.

**Target Users:** 
- Noel (Manager) - Primary user, will use on iPad + iPhone constantly
- Coaching staff - iPad/desktop access
- Players - View their own stats (future)

**Key Features:**
1. Fitness testing with AI analysis & squad comparisons
2. **Training attendance tracking** (NEW)
3. Match recording & analysis
4. GPS/training data import (flexible format)
5. AI pattern detection & recommendations
6. Mobile-first design (iPad/iPhone optimized)

---

## 💰 Cost Breakdown

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **Vercel** | Frontend hosting (React app) | **$0** (Hobby tier) |
| **Fly.io** | Backend API hosting | **$0-5** (Free tier 3 VMs) |
| **Supabase** | PostgreSQL database + Auth + Storage | **$0** (Free 500MB DB) |
| **Claude API** | AI analysis (Anthropic) | **$10-20** (usage-based) |
| **Domain** (optional) | dungloe-analytics.com | **$1/mo** ($12/year) |
| **TOTAL** | | **$10-25/month** |

**First Year Total:** ~€150-300 (cheaper than a team dinner!)

---

## 🛠️ Tech Stack

### Frontend
```
React 18 + Vite
├── TailwindCSS (styling)
├── Shadcn/UI (components)
├── Recharts (charts/graphs)
├── React Query (data fetching)
├── React Router (navigation)
└── Lucide Icons (icons)
```

**Why:** Fast, modern, mobile-first, looks professional

### Backend
```
Python 3.11+ FastAPI
├── SQLAlchemy (ORM)
├── Alembic (DB migrations)
├── Anthropic SDK (Claude API)
├── Pandas (data processing)
├── Pydantic (validation)
└── Python-multipart (file uploads)
```

**Why:** Perfect for AI integration, fast, auto-docs, type-safe

### Database
```
PostgreSQL 15 (via Supabase)
├── Supabase Auth (login system)
├── Row-level Security
├── Real-time subscriptions
└── Storage buckets (file uploads)
```

**Why:** Free tier is generous, includes auth + storage, rock-solid

### DevOps
```
Frontend: Vercel (auto-deploy from Git)
Backend: Fly.io (Docker-based)
CI/CD: GitHub Actions
Monitoring: Sentry (error tracking - free tier)
```

---

## 📊 Database Schema

See the SQL schema in previous message. Key tables:

1. **players** - Squad roster
2. **training_sessions** - Each training/gym session
3. **training_attendance** - Who attended what (NEW)
4. **fitness_tests** - Fitness test results + AI analysis
5. **matches** - Match records
6. **player_match_stats** - Individual player performance per match
7. **gps_data** - GPS/training data (flexible schema)
8. **ai_insights** - System-generated insights
9. **squad_benchmarks** - Squad averages for comparisons

---

## 📱 Mobile-First Design

### Responsive Breakpoints
```css
/* TailwindCSS built-in */
sm: 640px   /* Phone landscape */
md: 768px   /* Tablet portrait (iPad) */
lg: 1024px  /* Tablet landscape / small desktop */
xl: 1280px  /* Desktop */
```

### PWA (Progressive Web App)
```javascript
// Install on home screen (iOS/Android)
// Works offline (cached data)
// Push notifications possible
```

**User Experience:**
- Noel opens Safari on iPad → navigates to app
- Taps "Add to Home Screen"
- Now has app icon like native app
- Opens instantly, feels native

---

## 🗓️ Implementation Phases

### **Phase 1: Foundation (Week 1-2)** - MVP
**Goal:** Get basic system working with fitness data

#### Backend
- [ ] Set up FastAPI project structure
- [ ] Configure PostgreSQL connection (Supabase)
- [ ] Create database schema (Alembic migrations)
- [ ] Build core API endpoints:
  - `POST /players` - Add player
  - `GET /players` - List players
  - `POST /fitness-tests` - Upload fitness test
  - `GET /fitness-tests/{player_id}` - Get player tests
  - `POST /fitness-tests/bulk-import` - CSV import
- [ ] Integrate Claude API (basic)
- [ ] Build flexible GPS parser (see `gps_parser_flexible.py`)

#### Frontend
- [ ] Set up React + Vite project
- [ ] Configure TailwindCSS + Shadcn/UI
- [ ] Build authentication (Supabase Auth)
- [ ] Create layout:
  - Sidebar navigation
  - Top bar with user/notifications
  - Mobile hamburger menu
- [ ] Build key screens:
  - Dashboard (home)
  - Players list
  - Player detail (like Aaron Ward screenshot)
  - Fitness test import
- [ ] Implement Recharts for bar charts (squad comparison)

**Deliverable:** Can import fitness tests, view player reports with AI insights

---

### **Phase 2: Training Attendance (Week 2-3)**
**Goal:** Track who shows up to training

#### Backend
- [ ] API endpoints:
  - `POST /training-sessions` - Create session
  - `GET /training-sessions` - List sessions
  - `POST /training-attendance` - Mark attendance
  - `PUT /training-attendance/{id}` - Update status
  - `GET /training-attendance/stats` - Attendance statistics

#### Frontend
- [ ] Training session create screen:
  ```
  Date: [2026-01-08]
  Type: [Training ▼] (Training, Gym, Skills, Match)
  Duration: [90] minutes
  Focus: [Tactical - Defensive Shape]
  ```
- [ ] Attendance marking screen (optimized for iPad):
  ```
  ┌─────────────────────────────────────┐
  │ Training - 8th Jan 2026             │
  │ Tactical - Defensive Shape          │
  ├─────────────────────────────────────┤
  │ ✅ Aaron Ward        [Present ▼]    │
  │ ✅ Dylan Sweeney     [Present ▼]    │
  │ ❌ Karl Magee        [Absent ▼]     │
  │ ⏰ Darren Curran     [Late ▼]       │
  │ ✅ Damien McGowan    [Present ▼]    │
  │ ...                                  │
  └─────────────────────────────────────┘
  ```
- [ ] Attendance statistics dashboard:
  - Player attendance % over time
  - Late arrival trends
  - Correlation between attendance & match performance

#### AI Integration
```python
# Claude analyzes attendance patterns
def analyze_attendance_impact():
    """
    Find correlations between training attendance and match performance
    """
    # Example insight:
    # "Players who attended <75% of sessions in Jan performed 
    #  23% worse in February matches"
```

**Deliverable:** Full training attendance system with insights

---

### **Phase 3: Match Recording (Week 3-4)**
**Goal:** Replicate existing HTML app match tracking

#### Backend
- [ ] Match CRUD endpoints
- [ ] Real-time score updates (WebSocket or polling)
- [ ] Event timeline storage
- [ ] Match stats aggregation

#### Frontend
- [ ] Match setup screen (opponent, date, venue)
- [ ] Live match tracking (optimized for iPad portrait):
  ```
  ┌──────────────────────────────────────┐
  │ CLG An Clochán Liath  vs  Kilcar    │
  │      2-14 (23)            1-11 (14)  │
  │                                       │
  │ ⏱️ 18:34 - First Half                │
  ├──────────────────────────────────────┤
  │ DUNGLOE SCORING                      │
  │ [🥅 Goal] [🎯 Point] [2️⃣ 2-Pointer]│
  │                                       │
  │ DUNGLOE STATS                        │
  │ [💨 Wide] [🔄 Turnover] [🛡️ Block]  │
  │                                       │
  │ OPPONENT                             │
  │ [🥅 Goal] [🎯 Point] [💨 Wide]      │
  └──────────────────────────────────────┘
  ```
- [ ] Player selection modal (who scored?)
- [ ] Match analysis view (post-game)

**Deliverable:** Full match tracking system

---

### **Phase 4: AI Analysis Engine (Week 4-5)**
**Goal:** Advanced pattern detection & insights

#### Features
- [ ] Weekly automated analysis (cron job)
- [ ] Injury risk prediction
- [ ] Performance pattern detection
- [ ] Training load optimization
- [ ] Lineup suggestions
- [ ] Opposition analysis prep

#### Example Implementation
```python
from anthropic import Anthropic

async def generate_weekly_insights(team_id: str):
    """
    Runs every Monday morning, analyzes last week's data
    """
    client = Anthropic(api_key=settings.CLAUDE_API_KEY)
    
    # Gather data
    fitness_tests = get_recent_fitness_tests(days=7)
    matches = get_recent_matches(days=7)
    gps_data = get_recent_gps_data(days=7)
    attendance = get_attendance_stats(days=7)
    
    # Build comprehensive prompt
    prompt = f"""
    You are an expert GAA performance analyst. Analyze this week's data
    for Dungloe GAA Senior Men's team and provide actionable insights.
    
    FITNESS TEST RESULTS:
    {format_fitness_data(fitness_tests)}
    
    MATCH PERFORMANCE:
    {format_match_data(matches)}
    
    GPS/TRAINING DATA:
    {format_gps_data(gps_data)}
    
    TRAINING ATTENDANCE:
    {format_attendance_data(attendance)}
    
    Provide:
    1. Injury risk alerts (any players showing warning signs)
    2. Performance patterns detected
    3. Training load recommendations
    4. Individual player insights
    5. Team-wide tactical observations
    
    Format as structured JSON for our dashboard.
    """
    
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        temperature=0.3,  # Lower = more consistent
        messages=[{"role": "user", "content": prompt}]
    )
    
    insights = parse_claude_response(response.content)
    
    # Save to database
    for insight in insights:
        db.ai_insights.create(insight)
    
    # Send notification to Noel
    send_push_notification(
        user_id=noel_user_id,
        title="Weekly Analysis Ready",
        body=f"{len(insights)} new insights available"
    )
```

**Deliverable:** Automated weekly insights + on-demand analysis

---

### **Phase 5: GPS Data Integration (Week 5-6)**
**Goal:** Flexible import of any GPS device data

#### Features
- [ ] Multi-file drag & drop upload
- [ ] Auto-detect GPS device format (see `gps_parser_flexible.py`)
- [ ] Preview before import
- [ ] Map unknown columns
- [ ] Link to training sessions or matches
- [ ] Training load calculations (acute:chronic ratio)

#### UI Flow
```
1. Upload GPS file(s) (drag & drop)
   ↓
2. Auto-detect format: "StatSports Apex detected"
   ↓
3. Preview data:
   ┌────────────────────────────────────┐
   │ Found 23 players                    │
   │ Date: 2026-01-08                    │
   │ Metrics detected:                   │
   │ ✅ Total Distance                   │
   │ ✅ HSR                               │
   │ ✅ Max Speed                         │
   │ ❓ Unknown: "Player Load 2.0"       │
   │    Map to: [Player Load ▼]         │
   └────────────────────────────────────┘
   ↓
4. Link to session:
   "Is this from a training session or match?"
   [Training Session ▼] → [8 Jan - Tactical]
   ↓
5. Import → AI analyzes → Insights generated
```

**Deliverable:** Universal GPS data import system

---

### **Phase 6: Polish & Launch (Week 6-7)**
**Goal:** Production-ready system

- [ ] Performance optimization
- [ ] Error handling & validation
- [ ] User onboarding flow
- [ ] Data export (PDF reports)
- [ ] Backup/restore functionality
- [ ] Mobile app icons & PWA manifest
- [ ] Documentation for Noel
- [ ] Video tutorials (screen recordings)

---

## 🎨 UI/UX Design Principles

### Color Scheme (GAA Branding)
```css
/* From current app */
--dungloe-red: #dc2626
--dungloe-dark: #1f2937
--success-green: #16a34a
--warning-orange: #f59e0b
--info-blue: #2563eb
```

### Key Screens

#### 1. Dashboard (Home)
```
┌─────────────────────────────────────────────┐
│ 🏠 Dashboard              🔔 👤 Noel       │
├─────────────────────────────────────────────┤
│                                              │
│ 🚨 CRITICAL ALERTS                          │
│ ┌─────────────────────────────────────────┐│
│ │ ⚠️ Aaron Ward - Moderate Injury Risk    ││
│ │ CMJ declining 8% over last 3 tests      ││
│ │ [View Details]                           ││
│ └─────────────────────────────────────────┘│
│                                              │
│ 📊 THIS WEEK                                │
│ ┌──────────┬──────────┬──────────────────┐ │
│ │ Training │ Avg      │ Next Match       │ │
│ │ 3/3      │ Attend   │ vs Kilcar        │ │
│ │ Complete │ 87%      │ Saturday 3pm     │ │
│ └──────────┴──────────┴──────────────────┘ │
│                                              │
│ 🎯 QUICK ACTIONS                            │
│ [➕ Record Match] [📋 Mark Attendance]     │
│ [📊 Upload Data]  [👥 View Squad]          │
│                                              │
│ 💡 RECENT INSIGHTS (3)                      │
│ • Dylan Sweeney scores 2.8x more vs...     │
│ • Team turnovers spike at 22-28 mins...    │
│ • Optimal lineup vs physical teams...      │
└─────────────────────────────────────────────┘
```

#### 2. Player Detail (Like Screenshot)
```
┌─────────────────────────────────────────────┐
│ ← Back to Squad        Aaron Ward           │
├─────────────────────────────────────────────┤
│ 📸 [Photo]  Jersey #12  Position: MF        │
│                                              │
│ ⚠️ INJURY RISK: 6/10 (Moderate)             │
│ Left ankle mobility asymmetry detected      │
│ [View Recommendations]                       │
│                                              │
│ 📊 LATEST FITNESS TEST (3 Jan 2026)         │
│ [Bar chart like your screenshot]            │
│                                              │
│ 🏃 TRAINING ATTENDANCE                      │
│ Last 30 days: 18/22 sessions (82%)          │
│ [Attendance calendar heatmap]               │
│                                              │
│ ⚽ MATCH PERFORMANCE                         │
│ Last 5 games: 2-9 total (0.4G, 1.8P/game)  │
│ [Performance trend line chart]              │
│                                              │
│ 📡 GPS DATA                                  │
│ Avg distance: 8,240m per game               │
│ [Detailed GPS metrics]                       │
└─────────────────────────────────────────────┘
```

#### 3. Training Attendance (iPad Optimized)
```
┌─────────────────────────────────────────────┐
│ Training - Wednesday 8 Jan 2026     [Save]  │
│ Type: Tactical  Duration: 90 min            │
├─────────────────────────────────────────────┤
│ MARK ATTENDANCE (23/30 marked)              │
│                                              │
│ ┌─────────────────────────────────────────┐│
│ │ [✓] Aaron Ward      [Present ▼]         ││
│ │ [✓] Dylan Sweeney   [Present ▼]         ││
│ │ [✗] Karl Magee      [Absent ▼]          ││
│ │     Notes: Work commitment               ││
│ │ [⏰] Darren Curran  [Late ▼] 18:15      ││
│ │ [✓] Damien McGowan  [Present ▼]         ││
│ │ ... (scroll)                             ││
│ └─────────────────────────────────────────┘│
│                                              │
│ [Mark All Present] [Copy from Last Session] │
└─────────────────────────────────────────────┘
```

---

## 🔐 Security & Authentication

### Supabase Auth (Built-in)
```typescript
// Simple login
const { user } = await supabase.auth.signIn({
  email: 'noel@dungloe-gaa.com',
  password: 'secure_password'
})

// Row-level security (automatic)
// Users only see their team's data
```

### User Roles
1. **Admin** (Noel) - Full access
2. **Coach** - View all, edit some
3. **Player** - View own data only (future)

---

## 📈 Analytics & Monitoring

### Error Tracking: Sentry (Free Tier)
```python
import sentry_sdk
sentry_sdk.init(dsn="your_sentry_dsn")

# Auto-captures errors
# Noel gets email if critical error
```

### Usage Analytics: PostHog (Free Tier)
```javascript
// Track feature usage
posthog.capture('fitness_test_imported', {
  player_count: 23,
  test_date: '2026-01-08'
})
```

---

## 🚀 Deployment Process

### Initial Setup (One-time)
```bash
# 1. Create accounts
- GitHub (for code)
- Vercel (connect GitHub)
- Fly.io (install CLI)
- Supabase (create project)
- Anthropic (get API key)

# 2. Clone repo
git clone <repo>

# 3. Deploy backend (Fly.io)
fly launch
fly deploy

# 4. Deploy frontend (Vercel)
vercel --prod

# 5. Configure environment variables
- SUPABASE_URL
- SUPABASE_KEY
- CLAUDE_API_KEY
- DATABASE_URL

# Done! App is live.
```

### Ongoing Deploys (Automatic)
```bash
git commit -m "Add new feature"
git push

# Vercel auto-deploys frontend in ~30 seconds
# Fly.io auto-deploys backend in ~2 minutes

# No manual steps needed!
```

---

## 🧪 Testing Strategy

### Backend Testing
```python
# pytest for API tests
def test_create_player():
    response = client.post("/players", json={
        "name": "Test Player",
        "position": "Forward"
    })
    assert response.status_code == 200
    assert response.json()["name"] == "Test Player"
```

### Frontend Testing
```javascript
// Vitest for component tests
test('displays player name', () => {
  render(<PlayerCard name="Aaron Ward" />)
  expect(screen.getByText('Aaron Ward')).toBeInTheDocument()
})
```

### Manual Testing Checklist
- [ ] Works on iPhone Safari
- [ ] Works on iPad Safari
- [ ] Works on Chrome desktop
- [ ] File upload works (all formats)
- [ ] Charts render correctly
- [ ] AI insights generate successfully

---

## 📚 Documentation Plan

### For Noel (User Guide)
1. **Getting Started**
   - Login
   - Dashboard overview
   - Navigation

2. **Daily Tasks**
   - Mark training attendance
   - Record match scores
   - Upload GPS data

3. **Weekly Tasks**
   - Review AI insights
   - Check injury risk alerts
   - Plan training loads

4. **Monthly Tasks**
   - Conduct fitness tests
   - Review squad benchmarks
   - Export reports

### For You (Developer Docs)
1. API documentation (auto-generated by FastAPI)
2. Database schema diagrams
3. Deployment process
4. Troubleshooting guide

---

## 🎯 Success Metrics

**Week 4 Target:**
- ✅ All fitness test data imported
- ✅ 4 weeks of training attendance recorded
- ✅ 2 matches tracked
- ✅ AI generating insights
- ✅ Noel using it daily on iPad

**Month 3 Target:**
- ✅ Full season of data
- ✅ 50+ AI insights generated
- ✅ Injury prediction accuracy improving
- ✅ Noel says: "Can't imagine managing without it"

---

## 🆘 Contingency Plans

### If Claude API too expensive
**Backup:** Use local LLM (Llama 3 70B) on Fly.io GPU machine
- Cost: ~$20-30/month (predictable)
- Quality: 80-90% of Claude
- Privacy: Data never leaves your infrastructure

### If Fly.io has issues
**Backup:** Railway.app ($5-10/month) or Render.com (free tier)

### If Supabase free tier exceeded
**Upgrade:** $25/month for 8GB (unlikely to need)
**Alternative:** Self-host PostgreSQL on Fly.io

---

## ⏱️ Timeline Summary

| Phase | Duration | Key Deliverable |
|-------|----------|-----------------|
| Phase 1 | Week 1-2 | Fitness tests working |
| Phase 2 | Week 2-3 | Training attendance |
| Phase 3 | Week 3-4 | Match recording |
| Phase 4 | Week 4-5 | AI insights engine |
| Phase 5 | Week 5-6 | GPS data import |
| Phase 6 | Week 6-7 | Production launch |

**Total: 6-7 weeks to production-ready system**

Can compress to 4-5 weeks if working full-time.

---

## 🎓 Learning Resources

If you need to ramp up on any tech:

- **FastAPI:** fastapi.tiangolo.com (excellent docs)
- **React:** react.dev (new official docs)
- **TailwindCSS:** tailwindcss.com
- **Supabase:** supabase.com/docs
- **Claude API:** docs.anthropic.com

---

## 🚦 Next Steps

**Option A: Start Building Now**
1. I create the repo structure
2. Set up database schema
3. Build first API endpoint
4. You review and we iterate

**Option B: Prototype First**
1. Build simplified version (3-4 days)
2. Show to Noel for feedback
3. Then build full version

**Option C: Deep Dive First**
1. You review this plan thoroughly
2. Ask questions / suggest changes
3. We finalize spec
4. Then start building

**Which approach do you prefer?**


