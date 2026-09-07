# OneStat — Platform Overview (Short Brief)

**Confidential — Subject to NDA**

---

## What It Is

OneStat is a full-stack GAA performance analytics platform built for county and club teams. It captures live match data, processes GPS and fitness information, runs agentic AI analysis across all data types, and delivers insights to coaches, analysts, and players through a single web application accessible on any device.

---

## Core Capabilities

**Live Match Recording**
A touch-based pitch interface allows an analyst to record every event in real time — scores, wides, turnovers, kickouts, cards, fouls, substitutions, and possession. The ball is tracked across the pitch continuously. AI-generated insights are delivered every five minutes and at half time.

**Post-Match Analysis**
Following a match, the platform produces an AI-generated report covering scoring patterns, possession, kickout efficiency, turnover locations, and shot outcomes — all mapped visually on the pitch.

**GPS & Fitness Integration**
GPS files from wearable devices are uploaded and automatically processed. Player load, distance, speed zones, and heart rate data are correlated with match and training performance. Fitness test results are tracked longitudinally across the squad.

**Season Intelligence**
A season-level AI dashboard surfaces KPI trends, outlier alerts, a weekly brief, and cross-data correlations (e.g. whether high training load predicts underperformance, or which players are in form).

**Video Analysis**
Match video is uploaded and can be tagged manually or analysed automatically using AI computer vision — detecting player positions, classifying events, and generating a tactical bird's-eye view.

**Set Piece & Tactical Preparation**
Coaches build an animated playbook of set piece routines using a drag-and-drop pitch editor, record voiceovers, and push plays directly to players. An AI opposition briefing tool researches opponents using live web data.

**Player Portal**
Players log in to a separate view showing their personal stats, leaderboard positions, and playbooks sent by the coaching staff.

**AI Analyst Chat**
A conversational AI analyst — with full access to the club's match, training, GPS, and fitness data — answers natural language questions from coaches.

---

## Technical Architecture

- **Frontend:** React (TypeScript), hosted on Vercel
- **Backend:** Python / FastAPI, hosted on Fly.io
- **Database:** PostgreSQL (Supabase)
- **Object Storage:** Cloudflare R2
- **Authentication:** AWS Cognito (OAuth 2.0 / PKCE)
- **AI:** Anthropic Claude API (agentic tool-loop architecture)
- **Multi-tenant:** Full club-level data isolation

---

*OneStat — Turning GAA data into decisions.*
