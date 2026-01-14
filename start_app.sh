cd "/Users/owenodonnell/Documents/Dungloe App/FW_ Dungloe GAA APP/dungloe-gaa-analytics/backend"
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

cd "/Users/owenodonnell/Documents/Dungloe App/FW_ Dungloe GAA APP/dungloe-gaa-analytics/frontend"
npm run dev