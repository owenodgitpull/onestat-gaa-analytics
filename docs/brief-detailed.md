# OneStat — Detailed Platform Brief

**Confidential — Subject to NDA**

---

## Overview

OneStat is a comprehensive GAA performance analytics platform designed for use by county and club management teams. The system captures, stores, and analyses data across every dimension of team performance — live match events, GPS and physical output, fitness testing, video footage, and training sessions. A suite of agentic AI models processes this data continuously and surfaces intelligence to coaches, analysts, and players through a web application accessible on any device without installation.

---

## 1. Live Match Recording

The centrepiece of OneStat is its live match recording interface — a touch-optimised pitch map operated by an analyst on the sideline during a game.

**Event Recording**
Every meaningful match event is captured with pitch coordinates, minute, and the player involved:
- Scores: goals, points, two-pointers (from play, free, 45, penalty)
- Shots off target: wides, hit post, dropped short, saved, blocked
- Possession changes: turnovers won/lost, tackles won, interceptions, unforced errors
- Kickout outcomes: won cleanly, won from breaking ball, lost to opposition — for both own and opponent kickouts
- Dead balls: sideline balls, kickout sideline events, frees awarded
- Discipline: yellow cards, black cards (with automated 10-minute countdown timer), red cards, fouls
- Set play: substitutions, formation snapshots, man marking assignments

**Possession & Ball Tracking**
The ball's position is tracked continuously across the pitch. Possession is associated with a team at all times, and spell-based possession counting (number of distinct possession runs per team) is calculated alongside time-based possession percentage.

**Real-Time Stats**
A statistics sidebar updates live during the match showing: score, possession %, possession count, shots, wides, shooting accuracy, turnovers won/lost, kickouts won/lost, fouls, and cards for both teams.

**AI Live Insights**
The AI model generates a tactical insight summary every five minutes of match time. At half time and full time, dedicated reports are generated. These appear in a prioritised sidebar — the half time and full time reports always surface at the top.

**Offline-First Architecture**
The recording interface is designed to work through network interruptions. Events are queued locally in the browser (IndexedDB) and synchronised to the server automatically when connectivity is restored, with deduplication to prevent double-entries. Match state (timer, ball position, possession, half) is saved to the device every five seconds and can be restored on page reload.

**Formation Snapshots**
At any point during play, the analyst can capture a formation snapshot — placing player dots on the pitch to record the team shape at a given moment.

---

## 2. Post-Match Analysis

After a match concludes, the platform generates a comprehensive post-match package.

**AI Match Report**
An AI-generated narrative report covering: overall performance summary, scoring efficiency, possession patterns, kickout strategy, turnover analysis, and key moments. The report is stored on the match and can be regenerated.

**Event Map**
All recorded events are plotted on a pitch map. Filters allow the analyst to isolate specific event categories: scoring, wides, turnovers, kickouts, discipline, sideline balls. Each event shows the player, minute, and outcome on hover.

**Visual Charts**
- Scoring timeline (cumulative score progression by minute)
- Possession territory heat map
- Shot outcome distribution by zone
- Kickout landing zones and retention rates
- Turnover location map
- Paths taken chart (ball movement patterns)

**GPS Integration**
GPS files exported from wearable devices (Polar, GPSports, Catapult and others) are uploaded as PDF or CSV. The system automatically extracts player-level metrics: total distance, high-speed running distance, max speed, accelerations, heart rate zones, and player load. This data is correlated with the match performance data and included in the AI match report.

---

## 3. Season Dashboard & Intelligence

**KPI Dashboard**
The season dashboard aggregates performance across all matches in the current season. Key performance indicators displayed include: scoring rates, possession averages, kickout efficiency, turnover ratios, shooting accuracy, discipline records, and GPS load trends. Each KPI card includes an AI-generated insight explaining the trend.

**AI Alerts**
The system monitors all data and raises alerts when statistically significant patterns emerge — e.g. a player's load exceeding safe thresholds, a sudden drop in kickout efficiency, or a scoring drought from a particular zone.

**Weekly Brief**
Every week, the AI generates a brief covering: team form summary, players to watch, physical state of the squad, a tactical insight, and preparation priorities for the upcoming fixture. This is delivered via push notification to coaching staff.

**Outlier Detection**
The AI identifies statistical outliers across the squad and prompts the analyst to investigate — surfacing players who are significantly above or below their own baseline or squad averages.

**Cross-Data Correlations**
The platform correlates data across its different sources:
- GPS training load vs match performance (does high load predict underperformance?)
- Fitness test results vs match stats (do stronger players win more turnovers?)
- Player form trajectory (improving or declining over recent matches?)
- Workload risk assessment — acute:chronic workload ratio (ACWR) for injury prevention signalling

---

## 4. Player Profiles & Leaderboards

**Individual Player Stats**
Each player has a profile page showing their season statistics across all tracked metrics. An AI model generates a personalised season story narrative and identifies challenges (areas for improvement) for each player.

**Leaderboards**
Eight leaderboard categories rank the squad: top scorers, most turnovers won, kickout efficiency, tackling, highest GPS output, fitness scores, and others.

---

## 5. Player Portal

Players access a separate, role-gated view of the platform through the same login. The player portal includes:
- Personal stats dashboard (their own numbers across the season)
- Squad leaderboard standings
- Playbooks sent by the coaching team (with animation and voiceover)
- Profile page

Players are invited by the club admin via email. They cannot see other players' individual stats or any coaching-level analysis.

---

## 6. Training Management

**Session Logging**
Training sessions are logged with attendance, session type (field, gym, recovery), intensity level, duration, and drill details. Session data is stored against the training calendar.

**GPS Integration for Training**
GPS files from training sessions can be uploaded and processed identically to match GPS. Load metrics are tracked across the training week, enabling ACWR calculations to flag players at risk of overload.

**AI Training Analysis**
After each session is logged, the AI generates a summary covering physical output, attendance patterns, load management, and readiness indicators for the next match.

**Calendar**
A unified fixtures and training calendar shows all matches, training sessions, and gym sessions in a monthly view with colour coding by session type. Amber warnings are displayed where a fixture has no data entered.

---

## 7. Video Analysis

**Upload & Tag**
Match video is uploaded directly to cloud storage (Cloudflare R2). An analyst can tag events on the video timeline, synchronised to the same event types used in live recording.

**AI Keyframe Analysis**
Frames are extracted from the video at 0.5fps and filtered by visual similarity. The AI (Claude Vision) analyses batches of frames to: classify events, identify player movements, detect positions, and generate an enriched event log — identifying jersey numbers from the match lineup.

**Tactical Bird's-Eye View**
A 3D tactical mode allows an analyst to pause the video and calibrate four pitch corner points. OpenCV warps the frame to a top-down pitch view, and AI player detection identifies player positions. The analyst can annotate and save tactical snapshots.

---

## 8. Set Piece & Tactical Preparation

**Playbook Builder**
A drag-and-drop SVG pitch editor allows coaches to design set piece routines phase by phase. Player dots and movement arrows are placed on the pitch. Multiple phases can be added to show a complete sequence.

**Animation**
Plays animate smoothly phase by phase — player dots tween between positions, arrows draw progressively, and the analyst can control playback speed, loop, and fullscreen display.

**Voiceover**
A voiceover can be recorded directly in the app for each play and synced to the animation. Audio is stored in cloud storage and plays back alongside the animation.

**Push to Players**
Completed plays are pushed to selected players through the platform. Players receive a push notification and can view the animated play — including interactive replay — in their player portal. Read receipts show which players have viewed each play.

**Opposition Briefing**
An AI opposition research tool uses live web search to compile a briefing on the next opponent — recent results, key players, playing style, and tactical tendencies. The briefing streams in real time and is stored for the squad.

**Man Marking Assignments**
Coaches can assign specific man-marking responsibilities for a match. These are visible on the match preparation page and available for post-match effectiveness analysis across the season.

**Tactical Notes**
Free-text tactical notes can be saved against any match. These are automatically injected into the live AI insights for that match, giving the AI context about the game plan.

---

## 9. AI Analyst Chat

A conversational AI interface gives coaches direct access to all club data through natural language. The AI analyst can answer questions across matches, players, training, GPS, fitness, and video — cross-referencing sources to give context-aware answers. Conversation history is stored per session.

---

## 10. Knowledge Base

Clubs can upload custom documents — game plans, coaching philosophies, training protocols, scouting reports — to a private knowledge base (up to five documents). The AI agents use this material as additional context when generating insights, ensuring their outputs are aligned with the club's specific approach.

---

## 11. Notifications

The platform sends push notifications (via the browser's native push API, PWA-enabled) to coaching staff for:
- Match report ready
- GPS upload processed
- Fitness results available
- Weekly brief published

---

## 12. Settings & Administration

**Club Profile**
Club name, colours, and branding managed in one place.

**User Management**
Admin users can invite coaching staff, change roles, deactivate or reactivate accounts. Player accounts are linked to their player profile by email invite.

**Knowledge Base Management**
Upload, view, and delete custom documents. Processing status tracked automatically.

**Notification Preferences**
Each user manages their own push notification subscription.

---

## 13. Security & Infrastructure

| Component | Technology |
|---|---|
| Frontend | React (TypeScript), Vercel (global CDN) |
| Backend API | Python / FastAPI, Fly.io (London region) |
| Database | PostgreSQL, Supabase |
| Object Storage | Cloudflare R2 (EU) |
| Authentication | AWS Cognito — OAuth 2.0 with PKCE, httpOnly cookies |
| AI | Anthropic Claude API (Claude Sonnet / Haiku) |

**Data Isolation**
All data is scoped to the club. Users from one club cannot access any data belonging to another. Storage keys, database queries, RAG search, and AI context are all filtered by club ID at every layer.

**Authentication**
Access tokens and refresh tokens are stored as httpOnly cookies — never exposed to JavaScript. Token verification uses AWS Cognito's JWKS endpoint with explicit client ID validation. Rate limiting is applied to all authentication endpoints.

**Offline Resilience**
Match recording is designed to survive network failure. Events are queued locally and synchronised with deduplication. Match state is persisted to the device and restored automatically after a crash or page reload.

---

*OneStat — Turning GAA data into decisions.*
