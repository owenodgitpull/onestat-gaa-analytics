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
        'Customise which KPIs are visible. Toggle metrics on or off to build the dashboard that matters to you. Your choices are saved to your login, so they follow you to any device.',
    },
  },
  {
    element: '[data-tour="chart-library-btn"]',
    popover: {
      title: 'Chart Library',
      description:
        'Show or hide charts from your dashboard. Hidden charts can be restored here at any time. Saved to your login.',
    },
  },
  {
    element: '[data-tour="chart-drag-handle"]',
    popover: {
      title: 'Drag to Reorder',
      description:
        'Grab the drag handle on any chart to reorder it. Your layout is saved to your login automatically.',
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
    element: '[data-tour="profile-menu"]',
    popover: {
      title: 'Settings and your profile',
      description:
        'Open this menu for Settings: your team profile, knowledge documents for the analyst, users, and notifications. You can replay these guided tours from Settings, under Notifications, any time.',
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
        'Scrub through your match footage. When you tap an event button, the video pauses so you can place the event at the exact moment. The 1H, HT, 2H and FT labels on the bar jump straight to those marks.',
    },
  },
  {
    element: '[data-tour="video-quick-actions"]',
    popover: {
      title: 'Quick Actions',
      description:
        'Tap the event (a score, a turnover, a kickout and so on), then choose the player when asked. The event is saved at the current video time, with the ball\'s position on the pitch.',
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
        'Every tagged event in a list. Open one to check it, correct it (the player, the time or where it was on the pitch) or delete it.',
    },
  },
  {
    popover: {
      title: 'Needs attention',
      description:
        'The "Needs attention" button in the header lists blanks and oddities in your tagging, such as a score with no scorer or a kickout with no player, so you can fix them before the match is used for reports. "Match settings" next to it holds the throw-in, half-time and pitch details.',
    },
  },
  {
    popover: {
      title: 'Saved as you go',
      description:
        'Events are saved to the match as you tag them, so the Match Result page, the GPS replay and the reports pick them up straight away. There is no separate save step.',
    },
  },
]

// ── Settings Tour (4 steps) ────────────────────────────────────────────────

export const settingsSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-tab-profile"]',
    popover: {
      title: 'Team Profile',
      description:
        'Your team\'s name, crest and basic settings.',
    },
  },
  {
    element: '[data-tour="settings-tab-teams"]',
    popover: {
      title: 'Teams',
      description:
        'Manage the teams under your account and switch between them.',
    },
  },
  {
    element: '[data-tour="settings-tab-knowledge"]',
    popover: {
      title: 'Knowledge',
      description:
        'Upload documents (tactics playbooks, scouting reports). The AI analyst reads them so its answers fit how you play.',
    },
  },
  {
    element: '[data-tour="settings-tab-users"]',
    popover: {
      title: 'Users',
      description:
        'Invite coaches and analysts, change roles, and manage who can see your team\'s data.',
    },
  },
  {
    element: '[data-tour="settings-tab-preview"]',
    popover: {
      title: 'Player Preview',
      description:
        'See the app exactly as one of your players sees it, before you give them a login.',
    },
  },
  {
    element: '[data-tour="settings-tab-notifications"]',
    popover: {
      title: 'Notifications',
      description:
        'Turn on push alerts for when reports, GPS data or fitness results are ready. You can also replay these guided tours from here.',
    },
  },
  {
    element: '[data-tour="settings-tab-audit"]',
    popover: {
      title: 'Audit',
      description:
        'A log of who changed what in your team\'s account.',
    },
  },
]


// ── Squad Conditioning demo (8 steps) ──────────────────────────────────────
// Shown on the demo view of the Squad Conditioning tab: your real squad's names with made-up figures.

export const squadDemoSteps: DriveStep[] = [
  {
    popover: {
      title: 'How the Squad Conditioning Monitor works',
      description:
        'This is a demo. The players are your real squad, but every figure on this page is made up, so you can see how it reads without touching your real data.',
    },
  },
  {
    element: '[data-tour="squad-demo-grid"]',
    popover: {
      title: 'One card per player',
      description:
        'Each card is a player, coloured by their workload status: green is the sweet spot, amber is undertrained, orange is elevated and red is high risk.',
    },
  },
  {
    element: '[data-tour="squad-demo-ok"]',
    popover: {
      title: 'Green: in the sweet spot',
      description:
        'The load over the last 7 days (acute) sits comfortably against what this player has built up over the last 28 days (chronic). Nothing to do.',
    },
  },
  {
    element: '[data-tour="squad-demo-bar"]',
    popover: {
      title: 'ACWR',
      description:
        'The acute:chronic workload ratio is last week\'s load divided by the last four weeks\' average. Between 0.8 and 1.3 is the sweet spot; the bar shows where each player sits.',
    },
  },
  {
    element: '[data-tour="squad-demo-elevated"]',
    popover: {
      title: 'Orange: elevated',
      description:
        'Load is climbing faster than the player has adapted to. Worth watching, and worth thinking about the next session.',
    },
  },
  {
    element: '[data-tour="squad-demo-risk"]',
    popover: {
      title: 'Red: high risk',
      description:
        'A big spike against this player\'s normal load. This is where the monitor raises an alert so you can ease off before it becomes an injury.',
    },
  },
  {
    element: '[data-tour="squad-demo-low"]',
    popover: {
      title: 'Amber: undertrained',
      description:
        'Well under their usual load. They may be returning from a break or an injury, or just not getting enough work.',
    },
  },
  {
    popover: {
      title: 'Keep it fed',
      description:
        'To keep this live for your squad, upload training sessions (including the drills), GPS training data and fitness tests regularly. The more regularly you do, the more reliable the picture. Press "Exit demo" to go back to your real data.',
    },
  },
]
