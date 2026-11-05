---
name: ONEStat
description: Dark glass analytics for GAA coaches, emerald-to-cyan on near-black.
colors:
  night: "#060a14"
  night-deep: "#070c18"
  night-mid: "#0a1024"
  emerald: "#00E676"
  emerald-deep: "#00C853"
  cyan: "#00B0FF"
  accent-orange: "#F97316"
  ink-on-emerald: "#0a1a10"
  text: "#ffffff"
  text-muted: "rgba(255,255,255,0.5)"
  glass-fill: "rgba(255,255,255,0.08)"
  glass-border: "rgba(255,255,255,0.15)"
  danger: "#ef4444"
  warning: "#f59e0b"
  info: "#3b82f6"
  video-purple: "#c084fc"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  stat-value:
    fontFamily: "Inter, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
  stat-label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.025em"
  badge:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
rounded:
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.ink-on-emerald}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-glass:
    backgroundColor: "{colors.glass-fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  card-glass:
    backgroundColor: "{colors.glass-fill}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input-glass:
    backgroundColor: "{colors.glass-fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: ONEStat

## Overview

**Creative North Star: "The Floodlit Pitch"** (inferred from the code, not confirmed with Owen)

A near-black field lit from the corners by faint emerald and cyan glow, with content sitting on frosted glass panels. Dense data (scores, pitch maps, event logs) stays readable because the surface behind it is dark and quiet, and colour is reserved for what matters: the primary action, scoring, and status.

The app is a tool used under pressure on laptops, tablets and phones, sometimes courtside, so density and legibility beat decoration. The glass treatment is the brand, but it should never reduce contrast of the numbers.

**Key Characteristics:**
- Dark-only, near-black background with ambient green/cyan light and a faint particle field.
- Frosted glass cards with a thin light border and top-edge highlight.
- Emerald-to-cyan gradient for the primary action and gradient text.
- Small uppercase labels over large bold numbers for stats.

## Colors

Emerald and cyan on night, with semantic status colours and a distinct purple for video.

### Primary
- **Pitch Emerald** (#00E676): primary buttons, focus, positive/scoring accents, gradient start.
- **Floodlight Cyan** (#00B0FF): gradient end, input focus border, secondary glow.

### Secondary
- **Ember Orange** (#F97316): accent for warnings and highlights.
- **Video Purple** (#c084fc / Tailwind purple-400): marks anything about video analysis, including the "Video tagging in progress" pill.

### Neutral
- **Night** (#060a14 to #0a1024): page background and gradient.
- **White at 5-15% opacity**: glass fills, borders and dividers.
- **White at 40-60% opacity**: secondary text.

### Named Rules
**The Data Stays Bright Rule.** Numbers and key labels are full white; colour is for meaning, not decoration.
**The Colour Means Something Rule.** Emerald = act/positive, red = destructive/error, amber = caution, purple = video, blue = info/events.

## Typography

**Font:** Inter (with system sans fallbacks) for everything.

**Character:** neutral and modern; hierarchy comes from weight and size, not font changes.

### Hierarchy
- **Stat value** (700, 2.25rem): headline numbers and scores.
- **Stat label** (600, 0.875rem, uppercase, tracking-wide): what the number is.
- **Body** (400, 1rem): paragraphs and lists.
- **Badge** (600, 0.75rem): chips and status pills.

## Layout

Single-column stack on phones, multi-column from the `md:` breakpoint (768px) so tablet portrait gets two columns. Tablets (both orientations) and laptops lead the layout; phones must work fully. Cards use 24px padding and 16-24px gaps. Mobile safe-area padding utilities exist.

## Elevation & Depth

Depth is layered glass: backdrop blur (xl), translucent gradient fill, 1px light border, deep soft drop shadow (0 8px 32px rgba(0,0,0,0.6)) and an inner top highlight. Hover lifts with a stronger shadow and a faint emerald glow (0 0 40px -10px rgba(0,230,118,0.12)).

### Named Rules
**The Quiet Glow Rule.** Glow is an accent on hover or live state, never constant on static elements.

## Shapes

Generously rounded: 16px cards, 12px buttons and inputs, full-pill badges and chips.

## Components

### Buttons
- **Primary:** emerald-to-cyan gradient, dark text (#0a1a10), 12px radius, lifts 1px on hover with brighter glow; presses to 95% scale.
- **Glass:** translucent white fill, light border, white text.
- **Danger:** red-to-rose gradient, white text.

### Badges / Chips
- Pill, 12px semibold text, tinted 20% fill with a 30% border and light text (success emerald, danger red, warning amber, info blue).

### Cards / Containers
- Glass card, 16px radius, hover variant with stronger border and glow; stat card scales to 103% on hover.

### Inputs / Fields
- Translucent fill, light border, white text, 30% white placeholder; focus ring emerald 40% and cyan border.

## Do's and Don'ts

### Do:
- **Do** use glass cards for every panel and keep numbers at full white.
- **Do** use `md:` for multi-column grids and make phones work too.
- **Do** give every async action a spinner and a status line.
- **Do** use purple only for video-related things.

### Don't:
- **Don't** add new accent colours outside the semantic set above.
- **Don't** stack glow and heavy blur on dense data views (tagging, tables).
- **Don't** use `lg:` for the first multi-column breakpoint.
