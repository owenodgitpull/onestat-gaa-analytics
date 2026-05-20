# OneStat Deployment Guide

## Stack

| Service  | Host     | URL                              |
|----------|----------|----------------------------------|
| Frontend | Vercel   | https://app.onestat.ai           |
| Backend  | Fly.io   | https://onestat-api.fly.dev      |
| Database | Supabase | PostgreSQL (direct connection)   |
| Storage  | R2       | Cloudflare (S3-compatible)       |
| Auth     | Cognito  | AWS (PKCE OAuth)                 |

## Pushing Changes

### Frontend (automatic)

Push to `main` and Vercel deploys automatically.

```
git add <files>
git commit -m "your message"
git push
```

### Backend (manual deploy)

After pushing, deploy to Fly.io:

```powershell
cd backend
& 'C:\Users\owen_\.fly\bin\flyctl.exe' deploy -a onestat-api
```

### Database (if tables change)

Option A — Run create_tables.py against Supabase:

```powershell
cd backend
$env:DATABASE_URL='your-supabase-connection-string'
venv/Scripts/python create_tables.py
```

Option B — Alembic migration:

```powershell
cd backend
venv/Scripts/python -m alembic upgrade head
```

## Useful Commands

```powershell
# Check backend status
& 'C:\Users\owen_\.fly\bin\flyctl.exe' status -a onestat-api

# View backend logs
& 'C:\Users\owen_\.fly\bin\flyctl.exe' logs -a onestat-api

# Update a secret
& 'C:\Users\owen_\.fly\bin\flyctl.exe' secrets set KEY='value' -a onestat-api

# List secrets
& 'C:\Users\owen_\.fly\bin\flyctl.exe' secrets list -a onestat-api
```
