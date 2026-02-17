# Authentication & Push Notifications — Implementation Plan

## Overview

Multi-tenant authentication for a GAA SaaS platform using AWS Cognito with OAuth 2.0 / OIDC, managed hosted UI with club branding, and push notifications via FCM + AWS SNS.

**Scale**: 2,500 clubs, ~30-40 players + 3-5 admins per club = 75,000-112,000 users

---

## Part 1: AWS Cognito Architecture

### 1.1 User Pool Design

**Single User Pool** — one pool for the entire platform. Multi-tenancy is handled via custom attributes and group membership, not separate pools per club. Reasons:

- Simpler to manage at scale (one pool vs 2,500)
- Cross-club operations possible (league admins, county boards)
- Single sign-in experience regardless of club
- Easier to enforce platform-wide security policies

**User Pool Settings:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| Sign-in identifiers | Email (primary) | Universal, recoverable |
| MFA | Optional (SMS or TOTP) | Mandatory for super admins, optional for players |
| Password policy | Min 8 chars, require uppercase + number + symbol | OWASP minimum |
| Account recovery | Email verification code | No phone fallback (cost) |
| Email verification | Required before access | Prevents fake accounts |
| Advanced security | Enabled (adaptive authentication) | Detects compromised credentials, suspicious sign-ins |
| Device tracking | Remembered devices | Reduces MFA friction for trusted devices |
| Token expiration | Access: 1 hour, Refresh: 30 days, ID: 1 hour | Standard OAuth practice |

### 1.2 Custom Attributes

```
custom:club_id        → UUID of the player's/admin's club
custom:club_name      → Denormalised club name (for display without DB lookup)
custom:role           → "super_admin" | "club_admin" | "player"
custom:player_id      → UUID linking to the Player model (null for admins without player profile)
```

These are immutable by the user — only the backend (via admin API) can set them. This prevents privilege escalation.

### 1.3 Cognito Groups (Role-Based Access)

| Group | Description | Permissions |
|-------|-------------|-------------|
| `super_admin` | Platform operators (you) | All clubs, all data, user management, billing |
| `club_admin` | Club managers, coaches, selectors | Full access to own club's data, manage club players, upload GPS |
| `player` | Individual players | Read own stats, view team standings, receive notifications |

**Group precedence**: super_admin > club_admin > player

Groups are assigned on user creation and can be modified by anyone with admin privileges over that user's club.

### 1.4 App Clients

**Three app clients** on the same user pool:

| Client | Use Case | Auth Flows | Token Scope |
|--------|----------|------------|-------------|
| `web-manager` | React frontend (managers/admins) | Authorization Code + PKCE | `openid profile email custom:club_id custom:role` |
| `mobile-player` | Future mobile app (players) | Authorization Code + PKCE | `openid profile email custom:club_id custom:role custom:player_id` |
| `backend-service` | Server-to-server (backend admin ops) | Client Credentials | `admin/*` (user management, bulk operations) |

**PKCE is mandatory** for all public clients (web + mobile). No implicit flow. No client secrets in frontends.

### 1.5 OAuth 2.0 / OIDC Configuration

**Hosted UI Domain**: `auth.dungloegaa.com` (custom domain on Cognito)

**OAuth Flows:**

```
1. User clicks "Sign In"
2. Frontend redirects to Cognito Hosted UI:
   GET https://auth.dungloegaa.com/oauth2/authorize
     ?response_type=code
     &client_id=web-manager-client-id
     &redirect_uri=https://app.dungloegaa.com/callback
     &scope=openid+profile+email
     &code_challenge=<PKCE_CHALLENGE>
     &code_challenge_method=S256
     &state=<CSRF_TOKEN>

3. User authenticates (email + password, optional MFA)

4. Cognito redirects back with authorization code:
   GET https://app.dungloegaa.com/callback
     ?code=AUTH_CODE
     &state=<CSRF_TOKEN>

5. Frontend exchanges code for tokens (server-side or PKCE):
   POST https://auth.dungloegaa.com/oauth2/token
     grant_type=authorization_code
     &code=AUTH_CODE
     &redirect_uri=https://app.dungloegaa.com/callback
     &code_challenge_verifier=<PKCE_VERIFIER>

6. Cognito returns:
   - access_token (JWT, 1hr) — used for API calls
   - id_token (JWT, 1hr) — contains user attributes
   - refresh_token (opaque, 30 days) — used to get new access tokens
```

**Scopes:**

| Scope | Contents |
|-------|----------|
| `openid` | Subject (user ID) |
| `profile` | Name |
| `email` | Email, email_verified |

Custom attributes (`club_id`, `role`, `player_id`) are included in the ID token automatically when the user is authenticated.

### 1.6 Managed Login UI with Branding

Cognito's managed login supports custom branding:

- **Logo**: Club logo or Dungloe GAA Analytics logo
- **CSS customisation**: Match the app's colour scheme (dark theme, indigo accents)
- **Custom domain**: `auth.dungloegaa.com` with SSL certificate via ACM

**Branding configuration:**

```
Background:     #0f172a (slate-900, matches app)
Primary colour: #6366f1 (indigo-500)
Logo:           Platform logo (not per-club — single login page for all)
Font:           System font stack
```

Per-club branding on the login page is not practical with a single user pool. Instead, the login page shows the platform brand, and once authenticated, the app displays the club's colours/logo within the dashboard.

---

## Part 2: Security Hardening

### 2.1 Token Validation (Backend)

Every API request is validated:

```
1. Extract access_token from Authorization: Bearer <token> header
2. Decode JWT header, verify:
   - iss (issuer) = https://cognito-idp.{region}.amazonaws.com/{userPoolId}
   - aud (audience) = app client ID
   - token_use = "access"
   - exp (expiration) > current time
3. Verify signature against Cognito JWKS (cache the keys, refresh hourly)
4. Extract custom:club_id and custom:role from the token
5. Enforce: user can only access data where club_id matches their own
```

### 2.2 Multi-Tenancy Enforcement

**Every database query is scoped by club_id.** This is the most critical security boundary.

```python
# Example: get matches for the authenticated user's club
@router.get("/matches/")
async def get_matches(
    db: AsyncSession = Depends(get_db),
    current_user: CognitoUser = Depends(get_current_user),  # extracts club_id from token
):
    query = select(Match).where(Match.club_id == current_user.club_id)
    ...
```

**No endpoint should ever return data from another club.** This is enforced at the service layer, not just the route layer, so even internal service calls respect tenancy.

### 2.3 Attack Surface Mitigations

| Threat | Mitigation |
|--------|------------|
| **Credential stuffing** | Cognito advanced security (adaptive auth) detects and blocks unusual sign-in patterns |
| **Brute force** | Account lockout after 5 failed attempts (Cognito built-in) |
| **Token theft** | Short-lived access tokens (1hr), refresh token rotation enabled, HTTPS only |
| **CSRF** | State parameter in OAuth flow, SameSite cookies |
| **XSS leading to token theft** | Tokens stored in memory (not localStorage), httpOnly cookies for refresh token |
| **Privilege escalation** | Custom attributes immutable by users, role checked on every request |
| **Cross-tenant data access** | club_id enforced on every query at service layer |
| **Compromised credentials** | Cognito checks against breached password databases |
| **Token replay** | Token binding via audience and issuer validation |
| **Open redirect** | Callback URLs whitelisted in Cognito app client settings |
| **PKCE downgrade** | PKCE enforced, no implicit flow allowed |

### 2.4 Refresh Token Security

- **Rotation enabled** — each refresh token use issues a new refresh token and invalidates the old one
- **Stored as httpOnly, Secure, SameSite=Strict cookie** — not accessible to JavaScript
- **30-day expiry** — balances convenience with security
- **Revocation on password change** — all refresh tokens invalidated when password changes
- **Revocation on role change** — admin can invalidate all tokens for a user

### 2.5 Rate Limiting

Cognito has built-in rate limits. On top of that, add application-level rate limiting:

| Endpoint Category | Rate Limit | Window |
|-------------------|------------|--------|
| Auth (login/token) | 10 requests | Per minute per IP |
| AI chat | 20 requests | Per minute per user |
| AI analysis | 5 requests | Per minute per user |
| GPS upload | 3 requests | Per minute per user |
| General API | 100 requests | Per minute per user |

---

## Part 3: Database Changes

### 3.1 New Club Model

```python
class Club(Base):
    __tablename__ = "clubs"

    id = Column(UUID, primary_key=True, default=uuid4)
    name = Column(String(200), nullable=False)          # "Dungloe GAA"
    county = Column(String(100), nullable=False)         # "Donegal"
    province = Column(String(50), nullable=False)        # "Ulster"
    cognito_group_prefix = Column(String(100))           # for group naming
    logo_url = Column(String(500), nullable=True)
    primary_colour = Column(String(7), nullable=True)    # "#1e3a8a"
    secondary_colour = Column(String(7), nullable=True)  # "#fbbf24"
    subscription_tier = Column(String(50), default="free")
    subscription_expires_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

### 3.2 Add club_id to Existing Models

Every model that holds club-specific data gets a `club_id` foreign key:

```
Match          → club_id (FK to clubs.id)
Player         → club_id (FK to clubs.id)
TrainingSession → club_id (FK to clubs.id)
MatchEvent     → (inherits via match.club_id)
MatchGPSData   → (inherits via match.club_id)
Attendance     → (inherits via session.club_id)
InsightAlert   → club_id (FK to clubs.id)
FitnessTest    → (inherits via player.club_id)
DocumentChunk  → club_id (FK to clubs.id)
```

### 3.3 User Model (Lightweight — Cognito is Source of Truth)

```python
class User(Base):
    __tablename__ = "users"

    id = Column(UUID, primary_key=True, default=uuid4)
    cognito_sub = Column(String(100), unique=True, index=True)  # Cognito subject ID
    email = Column(String(255), unique=True, index=True)
    name = Column(String(200), nullable=False)
    club_id = Column(UUID, ForeignKey("clubs.id"), nullable=True)
    role = Column(String(50), nullable=False)  # super_admin, club_admin, player
    player_id = Column(UUID, ForeignKey("players.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

This is a **sync table** — Cognito is the authority. On first login, a Cognito Post Authentication Lambda (or backend middleware) upserts the user record.

---

## Part 4: Backend Integration

### 4.1 FastAPI Dependencies

```python
# New dependency: extract and validate Cognito JWT
async def get_current_user(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    """
    Validates the Cognito access token, extracts claims,
    and returns the authenticated user context.
    """
    token = authorization.replace("Bearer ", "")
    claims = verify_cognito_token(token)  # JWKS validation
    return AuthenticatedUser(
        cognito_sub=claims["sub"],
        email=claims.get("email"),
        club_id=claims.get("custom:club_id"),
        role=claims.get("custom:role"),
    )

# Role-based dependency
def require_role(*allowed_roles):
    async def check(user: AuthenticatedUser = Depends(get_current_user)):
        if user.role not in allowed_roles:
            raise HTTPException(403, "Insufficient permissions")
        return user
    return check
```

### 4.2 Applying to Routes

```python
# Any authenticated user
@router.get("/matches/")
async def get_matches(
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Match).where(Match.club_id == user.club_id)
    ...

# Club admins only
@router.post("/matches/")
async def create_match(
    user: AuthenticatedUser = Depends(require_role("club_admin", "super_admin")),
    ...
):
    ...

# Super admin only
@router.get("/admin/clubs/")
async def list_all_clubs(
    user: AuthenticatedUser = Depends(require_role("super_admin")),
    ...
):
    ...
```

### 4.3 New Environment Variables

```
COGNITO_USER_POOL_ID      → eu-west-1_XXXXXXXXX
COGNITO_APP_CLIENT_ID     → web-manager client ID
COGNITO_REGION            → eu-west-1
COGNITO_DOMAIN            → auth.dungloegaa.com
```

### 4.4 Migration Strategy

The existing app has no auth. Migration approach:

1. **Phase 1**: Add `club_id` column to all models with a default value (your club's ID). Existing data tagged to Dungloe.
2. **Phase 2**: Add auth middleware but make it optional (`get_optional_user`). Existing endpoints keep working.
3. **Phase 3**: Create Cognito user pool, set up hosted UI, create first admin user.
4. **Phase 4**: Switch middleware to mandatory. All requests require valid token.
5. **Phase 5**: Frontend login flow — redirect to Cognito hosted UI, handle callback, store tokens.

No data loss. No downtime. Gradual rollout.

---

## Part 5: Frontend Integration

### 5.1 Auth Flow in React

```
App loads
  → Check for valid access_token in memory
  → If missing/expired, check for refresh_token (httpOnly cookie)
  → If refresh available, call /oauth2/token with grant_type=refresh_token
  → If no refresh, redirect to Cognito hosted login
  → On callback, exchange code for tokens (PKCE)
  → Store access_token in memory, refresh_token as httpOnly cookie
  → Redirect to dashboard
```

### 5.2 Token Storage

| Token | Storage | Reason |
|-------|---------|--------|
| Access token | In-memory variable (React state/context) | Cleared on tab close, not accessible to XSS |
| Refresh token | httpOnly, Secure, SameSite=Strict cookie | Not accessible to JavaScript at all |
| ID token | Not stored (extracted once for user info, then discarded) | Contains PII, minimise exposure |

**Never use localStorage or sessionStorage for tokens.**

### 5.3 Auth Context

```tsx
// AuthProvider wraps the app
<AuthProvider>
  <App />
</AuthProvider>

// Any component can access:
const { user, isAuthenticated, isLoading, logout } = useAuth()

// user object:
{
  sub: "cognito-uuid",
  email: "manager@dungloegaa.com",
  name: "John Doe",
  clubId: "club-uuid",
  clubName: "Dungloe GAA",
  role: "club_admin",
  playerId: null
}
```

### 5.4 Route Protection

```tsx
// Public routes (login, landing page)
<Route path="/login" element={<Login />} />

// Authenticated routes
<Route path="/dashboard" element={
  <RequireAuth>
    <Dashboard />
  </RequireAuth>
} />

// Admin-only routes
<Route path="/admin/*" element={
  <RequireAuth roles={["club_admin", "super_admin"]}>
    <AdminPanel />
  </RequireAuth>
} />
```

---

## Part 6: Push Notifications

### 6.1 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────┐
│  Mobile App  │────▶│  FCM / APNs  │◀────│  AWS SNS  │◀────│  Backend  │
│  (Player)    │     │  (delivery)  │     │  (router) │     │  (FastAPI)│
└─────────────┘     └──────────────┘     └──────────┘     └──────────┘
      │                                        ▲
      │ Register device token                  │
      └────────────────────────────────────────┘
```

**FCM (Firebase Cloud Messaging)** handles device delivery — it's free at any scale.

**AWS SNS** acts as the server-side router — free for the first 1 million push notifications per month. At 500k notifications/month, this costs **$0**.

### 6.2 Why This Combination

| Service | Role | Cost at 100k Users |
|---------|------|--------------------|
| **FCM** | Token management on device, delivery to Android + iOS (via APNs) | Free, unlimited |
| **AWS SNS** | Server-side publish, topic subscriptions, integrates with Cognito | Free up to 1M notifs/month |
| **OneSignal** | ~~Alternative~~ | $1,200+/month at 100k MAUs — not viable at scale |

### 6.3 How It Works

**Device Registration (on app install / login):**

1. Mobile app requests push permission from the OS
2. FCM SDK returns a device token
3. App sends the token to the backend: `POST /api/v1/notifications/register-device`
4. Backend creates an SNS Platform Endpoint with the FCM token
5. Backend stores the SNS endpoint ARN against the user record

**Sending a Notification:**

1. An event triggers a notification (e.g., GPS upload generates insight alert)
2. Backend determines which players should be notified
3. Backend publishes to each player's SNS endpoint ARN
4. SNS forwards to FCM, FCM delivers to the device

**Topic-Based Notifications (club-wide):**

- Each club gets an SNS Topic: `club-{club_id}-players`
- On registration, player is subscribed to their club's topic
- Club-wide notifications (e.g., "Training tomorrow at 7pm") publish to the topic
- All subscribed devices receive it

### 6.4 Notification Types

| Trigger | Recipients | Message Example |
|---------|------------|-----------------|
| GPS upload processed | Individual player | "Your match GPS is ready — 8.2km covered, check your stats" |
| Insight alert generated | Club admins | "3 players flagged for high workload this week" |
| Fitness test analysed | Individual player | "Your fitness report is ready — CMJ improved 12%" |
| Training session created | All club players | "Training session added: Thursday 7pm" |
| Weekly performance digest | Individual player | "Your weekly summary: 2 matches, 1-3 scored, 92% attendance" |
| Teammate comparison update | Individual player | "You're now #3 for turnovers won — 2 behind Sean Boyle" |

### 6.5 Notification Preferences

Players can control what they receive:

```python
class NotificationPreferences(Base):
    __tablename__ = "notification_preferences"

    user_id = Column(UUID, ForeignKey("users.id"), primary_key=True)
    match_insights = Column(Boolean, default=True)
    training_reminders = Column(Boolean, default=True)
    fitness_updates = Column(Boolean, default=True)
    weekly_digest = Column(Boolean, default=True)
    teammate_comparisons = Column(Boolean, default=True)
    club_announcements = Column(Boolean, default=True)
```

### 6.6 Cost Projection

| Users | Notifications/Month | FCM Cost | SNS Cost | Total |
|-------|---------------------|----------|----------|-------|
| 10,000 | 50,000 | $0 | $0 | **$0** |
| 50,000 | 250,000 | $0 | $0 | **$0** |
| 100,000 | 500,000 | $0 | $0 | **$0** |
| 100,000 | 2,000,000 | $0 | $0.50 | **$0.50** |

Effectively free at any realistic scale.

### 6.7 Future: Amazon Pinpoint (Optional Add-On)

If you later need campaign management (A/B testing subject lines, scheduled sends, engagement analytics), Pinpoint sits on top of SNS:

- $0.0012 per targeted endpoint above 5,000 free
- At 100k users: ~$114/month
- Adds: segments, campaigns, scheduling, analytics dashboard
- Not needed at launch — add when you have the scale to justify it

---

## Part 7: Implementation Order

### Phase 1 — Foundation (Week 1-2)
1. Create Cognito User Pool with settings from Section 1.1
2. Configure custom attributes, groups, app clients
3. Set up hosted UI with custom domain and branding
4. Create Club model and add club_id to existing models
5. Database migration — tag all existing data to Dungloe club_id
6. Create User model (sync table)

### Phase 2 — Backend Auth (Week 2-3)
7. Add JWT validation dependency (`get_current_user`)
8. Add role-based dependency (`require_role`)
9. Add club_id scoping to all service-layer queries
10. Add auth middleware to all routes (optional mode first)
11. Create user management endpoints (admin: create user, assign role, assign club)
12. Add rate limiting middleware

### Phase 3 — Frontend Auth (Week 3-4)
13. Add AuthProvider context with token management
14. Implement login redirect to Cognito hosted UI
15. Handle OAuth callback (code exchange with PKCE)
16. Add Authorization header to all API calls
17. Add route protection (RequireAuth, role-based)
18. Add user profile display in navigation
19. Switch auth to mandatory — all routes protected

### Phase 4 — Push Notifications (Week 4-5)
20. Set up FCM project (Firebase Console)
21. Create SNS Platform Application (for FCM)
22. Create SNS Topics per club
23. Add device registration endpoint
24. Add notification preferences model and endpoints
25. Wire up notification triggers (GPS upload, insight alerts, fitness tests)
26. Test end-to-end on iOS and Android

### Phase 5 — Multi-Tenancy Polish (Week 5-6)
27. Club onboarding flow (super admin creates club, first admin user)
28. Club admin can invite players (generates Cognito user, sends welcome email)
29. Player self-registration with club invite code
30. Club settings page (logo, colours, preferences)
31. Super admin dashboard (all clubs, usage metrics, subscription management)

---

## Part 8: Updated Cost Projection

| Service | Current | With Auth + Notifications |
|---------|---------|---------------------------|
| Vercel (frontend) | €0 | €0 |
| Railway (backend + DB) | ~€12/month | ~€12/month (scales with clubs) |
| Cloudflare R2 | ~€1-2/month | ~€1-2/month |
| Anthropic API | ~€5-10/month | Scales per club (~€0.50-2/club/month) |
| AWS Cognito | N/A | €0 (under 50k MAU) → ~€250/month at 100k |
| AWS SNS | N/A | €0 (under 1M notifs/month) |
| FCM | N/A | €0 |
| Custom domain | ~€10/year | ~€10/year |
| **Total (single club)** | **~€18-25/month** | **~€18-25/month** |
| **Total (at 100k users)** | — | **~€275-500/month** (Cognito is main cost) |

At 2,500 clubs paying even €10/month each = €25,000/month revenue against ~€500/month infrastructure. Healthy margins.
