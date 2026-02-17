 #Backend:
  cd backend
  venv/Scripts/uvicorn app.main:app --host 0.0.0.0 --port 8001

  #Frontend:
  cd frontend
  npx vite --port 3001