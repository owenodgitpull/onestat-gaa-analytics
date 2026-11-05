# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Coaches and analysts** (club and inter-county): tag matches live from the sideline or from video, read reports, prepare opposition. Work mostly on laptops and tablets in both orientations, and on mobile too.
- **Inter-county staff** (e.g. Donegal's manager Jim): live insights during matches and a Match Result report afterwards.
- **Club admins**: manage squads, users, notifications, the knowledge base and multi-team licensing.
- **Players** (portal at `/player/*`): see their own stats, leaderboards, clips and GPS data; read-only, no AI calls.

## Product Purpose
ONEStat is a GAA football analytics SaaS. It turns live-tagged events, video tagging, GPS data and club documents into charts, leaderboards, reports and clips that coaches can act on. Success: a coach trusts the numbers enough to use them in match prep and in-game decisions.

## Positioning
A GAA-native AI analyst: agents that know GAA rules and tactics, grounded in a knowledge base, and reason over the club's own tagged events, GPS and video together.

## Operating Context
- Tagging happens in real time during matches (live recording, offline-first with an outbox) or by tagging recorded video (Video Tagging page); reliability and speed while the ball is in play matter more than polish.
- Pitch geometry is standardized at 145 m; attack direction is a per-match setting.
- Three agentic agents (MatchAgent, SeasonAgent, ChatAgent); no loose LLM calls from pages.

## Capabilities and Constraints
- Stack: React + TypeScript + Vite + Tailwind + TanStack Query (Vercel); FastAPI backend (Fly.io); Supabase Postgres; Cloudflare R2; Cognito auth.
- Responsive: tablets (both orientations), laptops and mobile all matter. Tablets and laptops lead the layout (`md:` breakpoint for grids), but every screen must also work on a phone.
- Every async action needs visible feedback (spinner and status line).
- Always uses the production database; no backend deploys while a match is being tagged.

## Evidence on Hand
Real match data (e.g. Donegal v Down, Donegal v Kerry), tagged video, GPS files and uploaded club documents exist in production. Do not fabricate customers, testimonials or benchmarks.

## Product Principles
- Never lose a tagged event; saving and recovery come before features.
- Speed under pressure: tagging flows must be fast, guided and hard to get wrong.
- Numbers must match across live, video and results views.
- Say what is happening: every wait, save and failure is visible.
- Built for GAA, not generic sport.
