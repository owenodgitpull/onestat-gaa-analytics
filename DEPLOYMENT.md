# Dungloe GAA Analytics - Deployment Guide

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Vercel (FREE)  │────▶│  Railway (~€12/mo)   │────▶│ Cloudflare R2   │
│  React Frontend │     │  FastAPI + PostgreSQL │     │ File Storage    │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Anthropic API       │
                        │  (pay-per-use)       │
                        └──────────────────────┘
```

**Estimated Monthly Cost: €15-25**

---

## Step 1: Set Up Cloudflare R2 (File Storage)

### 1.1 Create Cloudflare Account
1. Go to https://dash.cloudflare.com/sign-up
2. Sign up (free account is fine)

### 1.2 Create R2 Bucket
1. In Cloudflare dashboard, click **R2** in left sidebar
2. Click **Create bucket**
3. Name: `dungloe-gaa-data`
4. Location: **Automatic** (or choose EU for GDPR)
5. Click **Create bucket**

### 1.3 Create API Token
1. In R2, click **Manage R2 API Tokens**
2. Click **Create API token**
3. Name: `dungloe-gaa-backend`
4. Permissions: **Object Read & Write**
5. Specify bucket: `dungloe-gaa-data`
6. Click **Create API Token**
7. **SAVE THESE VALUES** (shown only once):
   - Access Key ID
   - Secret Access Key

### 1.4 Note Your Account ID
- Find it in the URL: `dash.cloudflare.com/<ACCOUNT_ID>/r2`
- Or in R2 dashboard under bucket details

---

## Step 2: Deploy Backend to Railway

### 2.1 Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub (recommended)

### 2.2 Create New Project
1. Click **New Project**
2. Select **Deploy from GitHub repo**
3. Connect your GitHub account if needed
4. Select `dungloe-gaa-analytics` repository
5. Choose the `backend` folder as root directory

### 2.3 Add PostgreSQL Database
1. In your Railway project, click **+ New**
2. Select **Database** → **PostgreSQL**
3. Railway automatically creates `DATABASE_URL` variable

### 2.4 Configure Environment Variables
In Railway project → **Variables** tab, add:

```
DATABASE_URL          → (auto-added by Railway)
ENVIRONMENT           → production
ANTHROPIC_API_KEY     → sk-ant-api03-your-key-here
R2_ACCOUNT_ID         → your-cloudflare-account-id
R2_ACCESS_KEY_ID      → your-r2-access-key
R2_SECRET_ACCESS_KEY  → your-r2-secret-key
R2_BUCKET_NAME        → dungloe-gaa-data
R2_ENDPOINT_URL       → https://<account-id>.r2.cloudflarestorage.com
FRONTEND_URL          → https://dungloe-gaa.vercel.app (update after Step 3)
```

### 2.5 Deploy
1. Railway auto-deploys on push to `main` branch
2. Or click **Deploy** manually
3. Wait for build to complete (~2-3 minutes)
4. Click on deployment to get your URL: `https://xxx.railway.app`

### 2.6 Test Backend
```bash
curl https://your-app.railway.app/health
# Should return: {"status":"healthy","database":"connected",...}
```

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Create Vercel Account
1. Go to https://vercel.com
2. Sign up with GitHub (recommended)

### 3.2 Import Project
1. Click **Add New** → **Project**
2. Select **Import Git Repository**
3. Choose `dungloe-gaa-analytics`
4. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 3.3 Add Environment Variables
In Vercel project settings → **Environment Variables**:

```
VITE_API_URL → https://your-app.railway.app
```

### 3.4 Deploy
1. Click **Deploy**
2. Wait for build (~1-2 minutes)
3. Your app is live at: `https://dungloe-gaa.vercel.app`

### 3.5 Update Railway CORS
Go back to Railway and update:
```
FRONTEND_URL → https://dungloe-gaa.vercel.app (your actual Vercel URL)
```

---

## Step 4: Custom Domain (Optional)

### Where to Buy a Domain
| Provider | Price | Notes |
|----------|-------|-------|
| **Cloudflare** | ~€9/year | No markup, includes DNS |
| **Namecheap** | ~€10/year | Good UI, often has deals |
| **Google Domains** | ~€12/year | Simple, reliable |
| **Porkbun** | ~€8/year | Cheapest option |

Suggested domain: `dungloe-gaa.ie` or `dungloegaa.com`

### Connect Domain to Vercel (Frontend)
1. In Vercel project → **Settings** → **Domains**
2. Add your domain: `dungloe-gaa.ie`
3. Add DNS records as shown in Vercel
4. Wait for SSL certificate (automatic, ~5 min)

### Connect Subdomain to Railway (Backend API)
1. Create subdomain: `api.dungloe-gaa.ie`
2. In Railway → **Settings** → **Networking** → **Custom Domain**
3. Add DNS CNAME record pointing to Railway
4. Update frontend env: `VITE_API_URL=https://api.dungloe-gaa.ie`

---

## Step 5: Verify Everything Works

### Checklist
- [ ] Backend health check returns OK
- [ ] Frontend loads without errors
- [ ] Can log in / access dashboard
- [ ] Can create a match
- [ ] Can record events
- [ ] AI insights generate correctly
- [ ] File uploads work (if R2 configured)

### Common Issues

**CORS Errors**
- Ensure `FRONTEND_URL` in Railway matches your Vercel URL exactly

**Database Connection Fails**
- Check `DATABASE_URL` format: `postgresql+asyncpg://...` (needs `+asyncpg`)

**AI Features Not Working**
- Verify `ANTHROPIC_API_KEY` is set correctly

---

## Monitoring & Maintenance

### Railway Dashboard
- View logs: Project → **Deployments** → Click deployment → **View Logs**
- Monitor usage: **Settings** → **Usage**

### Vercel Dashboard
- View analytics: Project → **Analytics**
- Check functions: Project → **Functions**

### Database Backups
Railway provides automatic daily backups. To create manual backup:
1. Go to PostgreSQL service
2. Click **Backups** tab
3. Click **Create Backup**

---

## Cost Breakdown

| Service | Free Tier | Paid Estimate |
|---------|-----------|---------------|
| Vercel | Unlimited (hobby) | €0 |
| Railway | $5 credit/month | ~€10-12/month |
| Cloudflare R2 | 10GB storage | ~€1-2/month |
| Anthropic API | None | ~€5-10/month |
| Domain | N/A | ~€10/year |
| **TOTAL** | - | **~€18-25/month** |

---

## Quick Commands

```bash
# Test backend locally with production DB
DATABASE_URL="postgresql+asyncpg://..." uvicorn app.main:app --reload

# Build frontend locally
cd frontend && npm run build && npm run preview

# View Railway logs
railway logs

# Connect to Railway PostgreSQL
railway connect postgres
```

---

## Support

- Railway Docs: https://docs.railway.app
- Vercel Docs: https://vercel.com/docs
- Cloudflare R2 Docs: https://developers.cloudflare.com/r2
