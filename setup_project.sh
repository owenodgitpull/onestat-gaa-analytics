#!/bin/bash

echo "🏉 Setting up Dungloe GAA Analytics Platform..."
echo "=============================================="

# Create all backend directories
echo "📁 Creating backend structure..."
mkdir -p backend/app/{models,routes,services,schemas}
mkdir -p backend/alembic/versions
mkdir -p backend/tests
mkdir -p data

# Create all frontend directories
echo "📁 Creating frontend structure..."
mkdir -p frontend/src/{components/{ui,pitch,charts,match,fitness,training},pages,lib,hooks,types}
mkdir -p frontend/public

# Move documentation
echo "📁 Organizing documentation..."
mkdir -p docs
mv ../IMPLEMENTATION_PLAN.md docs/ 2>/dev/null || true
mv ../PLAYER_ATTRIBUTION_SYSTEM.md docs/ 2>/dev/null || true
mv ../PITCH_TRACKING_SYSTEM.md docs/ 2>/dev/null || true
mv ../gps_parser_flexible.py backend/app/services/ 2>/dev/null || true

# Copy sample data
echo "📁 Setting up sample data..."
cp "../Game_Snr Div 2 League Final_V Ballyshannon_190725.pdf" data/sample_gps_statsports.pdf 2>/dev/null || true
cp "../Fitness_Import_Jan_03_2026_FIXED.csv" data/sample_fitness_test.csv 2>/dev/null || true

echo "✅ Project structure created!"
echo ""
echo "Next steps:"
echo "1. cd backend && pip install -r requirements.txt"
echo "2. cd frontend && npm install"
echo "3. Copy .env.example to .env and add your API keys"
echo "4. docker-compose up"
