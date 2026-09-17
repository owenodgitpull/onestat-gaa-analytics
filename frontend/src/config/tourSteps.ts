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
    element: '[data-tour="nav-matches"]',
    popover: {
      title: 'Matches',
      description:
        'View match results and manage upcoming fixtures. The sidebar shows Results and Fixtures when you\'re in this section.',
    },
  },
  {
    element: '[data-tour="nav-reports"]',
    popover: {
      title: 'Reports',
      description:
        'Generate a full Season Report showing every KPI and chart in one view. Great for committee meetings or reviewing your team\'s overall performance.',
    },
  },
  {
    element: '[data-tour="view-mode-toggle"]',
    popover: {
      title: 'View Modes',
      description:
        'Switch between Season Stats, Squad Conditioning, and AI Insights. Squad Conditioning analysis runs automatically after every training session and match — no manual action needed.',
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

// ── Match Recording Tour (14 steps) ────────────────────────────────────────

export const matchRecordingSteps: DriveStep[] = [
  {
    element: '[data-tour="pitch-container"]',
    popover: {
      title: 'Interactive Pitch',
      description:
        'Tap anywhere on the pitch to move the ball marker. The ball tracks where play is happening — move it up the field as your team builds an attack, then log the event when it happens.',
    },
  },
  {
    element: '[data-tour="jersey-strip"]',
    popover: {
      title: 'Ball Carrier Tracking (Optional)',
      description:
        'Tap a jersey number to mark who\'s carrying the ball. This is completely optional — but if you do it, your AI analysis gets much richer: carry maps, passing networks, and player involvement stats all come from this data.',
    },
  },
  {
    element: '[data-tour="possession-indicator"]',
    popover: {
      title: 'Possession Tracker',
      description:
        'Shows which team has the ball and where on the pitch. Use the swap button (top-right of pitch) to toggle possession. It changes automatically after scores, turnovers, and kickouts.',
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
      title: 'Logging a Score',
      description:
        'Move the ball to where the shot was taken, then tap the scoring button. If the ball is inside the 2-point arc, the "2PT" button enables automatically. Move the ball close to goal before logging — this tracks where shots are taken from.',
    },
  },
  {
    popover: {
      title: 'After a Score → Kickout',
      description:
        'After every score or wide, the kickout tab opens automatically. Select the kickout type, then tap the pitch where the ball lands. This tracks kickout strategy and retention rates — one of the most important GAA metrics.',
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
    element: '[data-tour="weather-btn"]',
    popover: {
      title: 'Weather Conditions',
      description:
        'Tap to set the weather and temperature. This feeds into AI analysis — it can spot patterns like lower scoring accuracy in wet conditions or kickout strategy changes on windy days.',
    },
  },
  {
    element: '[data-tour="fullscreen-btn"]',
    popover: {
      title: 'Fullscreen Mode',
      description:
        'Opens a focused view with the pitch and action buttons — ideal for pitchside recording on a phone or tablet. All controls (pause, swap, substitution) are in the top bar.',
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
        'See all recorded events in real-time, newest first. Swipe left on any event to undo it if you made a mistake. Tap an event dot on the pitch to see who was involved.',
    },
  },
  {
    element: '[data-tour="stoppage-btn"]',
    popover: {
      title: 'Stoppage & Half-Time',
      description:
        'Pause the match timer during injuries or delays. Find it in the top-right controls above the pitch. At half-time, use the phase controls to end the first half and start the second.',
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
