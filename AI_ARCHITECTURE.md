# AI Service Architecture

## Overview

The AI layer uses a **3-agent + chart-engine** design. Each agent has a single
responsibility, a tailored system prompt, and pulls domain knowledge dynamically
via RAG. Shared constants, tools, and tool functions live in `_shared.py`.

```
backend/app/services/ai/
    __init__.py            Re-exports for backward compatibility
    _shared.py             Client, GAA_ESSENTIALS, tool definitions, tool execution
    post_match_agent.py    Post-match analysis (tool loop) + GPS analysis
    live_match_agent.py    Live insights (Haiku, single-shot)
    chat_agent.py          Conversational analyst (tool loop)
    chart_engine.py        All chart generation & recommendations
```

## Knowledge Architecture

Knowledge flows through three layers:

| Layer | What | Where | Size |
|-------|------|-------|------|
| **GAA Essentials** | Scoring rules, positions, club info | `_shared.py` → `GAA_ESSENTIALS` | ~15 lines |
| **Agent prompt** | Behavioural instructions, output format, detection triggers | Hardcoded in each agent file | Varies |
| **RAG context** | Tactics, GPS benchmarks, playbooks, rules, historical analysis | `RAGService.get_context_for_query()` | Dynamic |

**Key principle:** Behavioural instructions (what to detect, how to format output)
go in the agent's system prompt. Domain knowledge (tactical systems, GPS benchmarks,
rules, playbooks) comes from RAG.

### GAA Essentials (~15 lines)
Every agent receives this. Contains only universally needed facts:
- Scoring system (goal = 3pts, point = 1pt, 2-pointer = 2pts)
- Score display format (Goals-Points)
- Player positions (15-a-side layout)
- Dungloe GAA identity (Donegal, blue & gold)

### Agent-Specific Prompts
Each agent has a tailored system prompt defining its role and behaviour:
- **Post-match**: Structured report format, tool-first approach, player ratings 1-10
- **Live match**: Detection triggers (scoring runs, droughts, kickout shifts, fatigue)
- **Chat**: Source citation, proactive context surfacing
- **Chart engine**: Chart type selection, Recharts JSON format

### RAG Context
All domain knowledge comes from documents in the Knowledge base folder:
- GAA rules and regulations
- GPS/fitness reports and benchmarks
- Tactical playbooks and formations
- Match analysis documents

Each agent requests RAG context with a task-specific query and token budget:
- Post-match: 3000 tokens, query based on analysis type
- Live match: 1500 tokens, query based on recent event types
- Chat: 3000 tokens, query is the user's actual message
- Charts: 1000-2000 tokens, query based on chart/analytics type

### Adding New Knowledge

1. Place documents (PDF, text) in the `Knowledge base/` folder
2. Call `POST /rag/sync` to index the documents
3. Agents will automatically pull relevant context from new documents

Future: Documents will be stored in an R2 bucket and synced automatically.

## Agents

### 1. Post-Match Agent (`post_match_agent.py`)
- **Model:** Claude Sonnet (tool loop)
- **Functions:** `analyze_match`, `generate_post_match_report`, `analyze_match_gps`
- **Purpose:** Deep post-match analysis. Uses tool loop to query match events,
  summary, and scoring patterns before generating a report. Handles GPS
  analysis as a standalone single-shot call.
- **RAG:** Fetches tactical docs, GPS benchmarks, and rules for comparison
- **Caching:** Reports are persisted on the Match model (`ai_analysis`,
  `ai_analysis_version`). Regenerated only on `force_regenerate=True` (e.g.
  after GPS upload).

### 2. Live Match Agent (`live_match_agent.py`)
- **Model:** Claude Haiku (single-shot, no tools)
- **Functions:** `live_match_insight`
- **Purpose:** Fast, concise tactical insights during a live match. Receives
  match summary + recent events in context. Returns 2-3 sentence advice.
- **RAG:** Fetches GPS benchmarks and tactical patterns for fatigue detection
- **Detection triggers** (in system prompt, not RAG):
  - Scoring run: 3+ consecutive scores without reply
  - Scoring drought: 10+ minutes without a score
  - Kickout dominance shift: 3+ consecutive kickouts won/lost
  - Turnover crisis: 5+ turnovers in 10 minutes
  - Fatigue indicators: compared to GPS benchmarks from RAG

### 3. Chat Agent (`chat_agent.py`)
- **Model:** Claude Sonnet (tool loop)
- **Functions:** `chat_with_analyst`
- **Purpose:** Conversational interface. Maintains conversation history and
  can call tools to answer questions about matches, players, and tactics.
- **RAG:** Uses the user's actual question as the RAG query for maximum relevance

### 4. Chart Engine (`chart_engine.py`)
- **Model:** Claude Sonnet (single-shot for specs, Haiku for quick analysis)
- **Functions:** `get_dynamic_chart_recommendations`, `get_chart_analysis`,
  `generate_agentic_chart`, `generate_custom_insight`,
  `generate_dashboard_charts`, `generate_single_chart`
- **Purpose:** All chart-related generation. Produces Recharts-compatible JSON
  specs from match data.
- **RAG:** Fetches analytics benchmarks and performance metrics

## Shared Module (`_shared.py`)

Contains everything the agents share:
- `client` — Anthropic client singleton
- `GAA_ESSENTIALS` — minimal static context (scoring rules, positions, club identity)
- `TOOLS` — tool definitions for Claude tool use
- `execute_tool()` — dispatcher
- Tool functions: `get_match_events`, `get_match_summary`,
  `get_player_season_stats`, `get_team_season_stats`, `get_scoring_patterns`,
  `get_turnover_analysis`

## Import Facade (`__init__.py`)

Re-exports all public functions so that consumers import from
`app.services.ai`. Current consumers:
- `routes/ai.py`
- `routes/match_gps.py`
- `services/match_service.py`
- `services/live_insights_service.py`

## Bug Fixes Applied

### RAG Bug (chart_engine.py)
`generate_dashboard_charts()` previously called the non-existent
`RAGService(db).get_relevant_context(...)`. Fixed to use the correct static
method `RAGService.get_context_for_query(db, query, ...)`.

### GPS Race Condition (routes/match_gps.py)
The background GPS upload processor set `status = "completed"` immediately
after storing GPS data, before the AI re-analysis finished. The frontend would
poll for "completed" and re-fetch the report, getting the stale cached version.

Fixed by introducing `status = "gps_processed"` after GPS data is stored, and
only setting `status = "completed"` after `trigger_match_reanalysis_with_gps()`
returns successfully.
