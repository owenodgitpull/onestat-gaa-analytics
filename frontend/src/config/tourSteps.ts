import type { DriveStep } from 'driver.js'

// ── Dashboard Tour (10 steps) ──────────────────────────────────────────────

export const dashboardSteps: DriveStep[] = [
  {
    popover: {
      title: 'Welcome to OneStat',
      description:
        'This is your season dashboard. It shows KPIs, charts, and AI insights across all your matches. Let\'s take a quick tour of the key features.',
    },
  },
  {
    element: '[data-tour="nav-fixtures"]',
    popover: {
      title: 'Fixtures & Scheduling',
      description:
        'Manage upcoming fixtures here. You can import from a spreadsheet or add them manually.',
    },
  },
  {
    element: '[data-tour="view-mode-toggle"]',
    popover: {
      title: 'View Modes',
      description:
        'Switch between Season Stats, Squad Health (GPS/fitness), and AI Insights. Each view surfaces different data.',
    },
  },
  {
    element: '[data-tour="kpi-grid"]',
    popover: {
      title: 'KPI Cards',
      description:
        'Your key performance indicators at a glance. Tap the info button for explanations, or tap a card to flip it and see the paired metric.',
    },
  },
  {
    element: '[data-tour="kpi-library-btn"]',
    popover: {
      title: 'KPI Library',
      description:
        'Customise which KPIs are visible. Toggle metrics on or off to build the dashboard that matters to you.',
    },
  },
  {
    element: '[data-tour="chart-library-btn"]',
    popover: {
      title: 'Chart Library',
      description:
        'Show or hide charts from your dashboard. Hidden charts can be restored here at any time.',
    },
  },
  {
    element: '[data-tour="chart-drag-handle"]',
    popover: {
      title: 'Drag to Reorder',
      description:
        'Grab the drag handle on any chart to reorder it. Your layout is saved automatically.',
    },
  },
  {
    element: '[data-tour="section-drag-handle"]',
    popover: {
      title: 'Reorder Sections',
      description:
        'Drag entire sections up or down to customise the page layout.',
    },
  },
  {
    element: '[data-tour="nav-analyst"]',
    popover: {
      title: 'AI Analyst Chat',
      description:
        'Ask the AI analyst anything about your season, players, or tactical patterns. It has access to all your data.',
    },
  },
  {
    element: '[data-tour="nav-settings"]',
    popover: {
      title: 'Settings',
      description:
        'Configure your club profile, upload knowledge base documents, manage users, and control notifications. You can replay this tour from Settings any time.',
    },
  },
]

// ── Match Recording Tour (11 steps) ────────────────────────────────────────

export const matchRecordingSteps: DriveStep[] = [
  {
    element: '[data-tour="pitch-container"]',
    popover: {
      title: 'Interactive Pitch',
      description:
        'Tap anywhere on the pitch to move the ball marker. The ball position determines which zone events are recorded in, and enables context-aware buttons (like 2-pointers inside the arc).',
    },
  },
  {
    element: '[data-tour="possession-indicator"]',
    popover: {
      title: 'Possession Tracker',
      description:
        'Shows which team has the ball. Tap the swap button to toggle possession manually. Possession changes automatically after scores, turnovers, and kickouts.',
    },
  },
  {
    element: '[data-tour="action-category-tabs"]',
    popover: {
      title: 'Action Categories',
      description:
        'Events are grouped into tabs: Shooting, Turnovers, Our Kickouts, Opp Kickouts, plus Foul and Discipline buttons.',
    },
  },
  {
    element: '[data-tour="scoring-buttons"]',
    popover: {
      title: 'Context-Aware Scoring',
      description:
        'Scoring buttons adapt to the ball position. Inside the 2-point arc, the "2PT" button enables automatically. The regular "Point" button disables to prevent mistakes.',
    },
  },
  {
    element: '[data-tour="turnovers-tab"]',
    popover: {
      title: 'Turnover Flow',
      description:
        'After recording a turnover, an interception button appears so you can credit the player who won it back. Buttons disable based on which team has possession.',
    },
  },
  {
    element: '[data-tour="fouls-tab"]',
    popover: {
      title: 'Foul → Free Kick Flow',
      description:
        'Tap "Foul" to select which team committed it. A free kick outcome panel then appears (Point Free, Wide Free, Short Pass) so the full sequence is captured.',
    },
  },
  {
    element: '[data-tour="discipline-cards"]',
    popover: {
      title: 'Discipline Cards',
      description:
        'Tap yellow, black, or red card buttons. Black cards start a 10-minute sin bin timer that counts down on screen.',
    },
  },
  {
    popover: {
      title: 'Kickout Auto-Open',
      description:
        'After any score or wide, the kickout tab opens automatically so you can record the restart without extra taps. This saves time during fast-paced play.',
    },
  },
  {
    element: '[data-tour="fullscreen-btn"]',
    popover: {
      title: 'Fullscreen Mode',
      description:
        'Opens a focused view with just the pitch and action buttons. Great for pitchside recording on mobile devices.',
    },
  },
  {
    element: '[data-tour="player-selection"]',
    popover: {
      title: 'Player Attribution',
      description:
        'After each event, select the player responsible. The modal shows your match lineup with jersey numbers for quick identification.',
    },
  },
  {
    element: '[data-tour="event-feed"]',
    popover: {
      title: 'Event Feed',
      description:
        'See all recorded events in real-time. Swipe left on any event to undo it if you made a mistake.',
    },
  },
]

// ── Video Tagging Tour (7 steps) ───────────────────────────────────────────

export const videoTaggingSteps: DriveStep[] = [
  {
    element: '[data-tour="video-player"]',
    popover: {
      title: 'Video Player',
      description:
        'Scrub through your match footage. When you tap an event button, the video auto-pauses so you can place it at the exact moment.',
    },
  },
  {
    element: '[data-tour="video-quick-actions"]',
    popover: {
      title: 'Quick Actions',
      description:
        'Three-tap flow: tap an event type here, then tap the pitch zone, then select the player. The event is created with the current video timestamp.',
    },
  },
  {
    element: '[data-tour="video-scoreboard"]',
    popover: {
      title: 'Live Scoreboard',
      description:
        'The scoreboard updates in real-time as you tag scoring events. The possession indicator shows which team has the ball.',
    },
  },
  {
    element: '[data-tour="event-timeline"]',
    popover: {
      title: 'Event Timeline',
      description:
        'Visual timeline of all tagged events. Click any event marker to jump to that moment in the video.',
    },
  },
  {
    element: '[data-tour="video-event-log"]',
    popover: {
      title: 'Event Log',
      description:
        'Expandable list of all events with details. You can verify, edit zones, or delete events from here.',
    },
  },
  {
    popover: {
      title: 'AI Auto-Analyse',
      description:
        'Use the "Auto-Analyse" button in the header to let AI detect events from your video automatically. You can review and correct the results afterwards.',
    },
  },
  {
    popover: {
      title: 'Sync to Match',
      description:
        'When you\'re done tagging, hit "Save to Match" to sync video events back to the main match record for inclusion in AI analysis and reports.',
    },
  },
]

// ── Settings Tour (4 steps) ────────────────────────────────────────────────

export const settingsSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-tab-profile"]',
    popover: {
      title: 'Club Profile',
      description:
        'Set your club name, upload a crest, and configure basic settings.',
    },
  },
  {
    element: '[data-tour="settings-tab-knowledge"]',
    popover: {
      title: 'Knowledge Base',
      description:
        'Upload club documents (tactics playbooks, scouting reports). The AI analyst uses these to give contextual answers.',
    },
  },
  {
    element: '[data-tour="settings-tab-users"]',
    popover: {
      title: 'User Management',
      description:
        'Invite coaches and analysts, change roles, and manage access to your club\'s data.',
    },
  },
  {
    element: '[data-tour="settings-tab-notifications"]',
    popover: {
      title: 'Notifications',
      description:
        'Enable push notifications to get alerted when match reports, GPS data, or fitness results are ready.',
    },
  },
]
