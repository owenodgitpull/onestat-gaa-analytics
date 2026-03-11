"""
FastAPI Application Entry Point.

This is the main application file that:
- Configures FastAPI app
- Sets up CORS for frontend communication
- Registers all API routes
- Handles application lifecycle (startup/shutdown)
- Configures error handling and logging
"""

from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from contextlib import asynccontextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import logging
import os

# Import database functions
from app.database import engine, Base, get_db

# Import routes
from app.routes import players
from app.routes import matches, match_events, possession_events, match_lineups, analytics, ai, attendance, knowledge_base, training_performance, live_insights, rag, squad_health, match_gps, fitness_tests, club, onboarding, player_portal, notifications
from app.routes import auth as auth_routes
from app.routes import video_analysis, video_events, fixtures, club_members, player_movement, match_prep, organizations, invitations, playbook_push

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    
    Handles startup and shutdown tasks:
    - Startup: Initialize database, load configs, etc.
    - Shutdown: Close connections, cleanup resources
    
    This is the modern FastAPI way (replaces @app.on_event)
    """
    # Startup
    logger.info("🏉 Starting GAA Analytics API...")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")
    
    # Initialize database tables (dev only - use Alembic in production)
    if os.getenv("ENVIRONMENT") != "production":
        logger.info("Creating database tables (dev mode)...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created")
    else:
        logger.info("Production mode — skipping auto-create (use Alembic migrations)")
    
    logger.info("✅ Application startup complete")
    
    yield  # Application runs here
    
    # Shutdown
    logger.info("Shutting down application...")
    await engine.dispose()  # Close all database connections
    logger.info("✅ Application shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="GAA Analytics API",
    description="Team analytics platform with AI-powered insights for GAA clubs",
    version="1.0.0",
    docs_url="/docs",  # Swagger UI at /docs
    redoc_url="/redoc",  # ReDoc at /redoc
    lifespan=lifespan,  # Lifecycle manager
)


# ---------- Rate limiting ----------
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],  # Global default
    storage_uri="memory://",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Configure CORS (Cross-Origin Resource Sharing)
# Allows frontend to make requests to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Local development
        "http://localhost:3001",  # Local development (alternative port)
        "http://localhost:3002",  # Vite fallback port
        "http://localhost:3003",  # Vite fallback port
        "http://localhost:3004",  # Vite fallback port
        "http://localhost:3005",  # Vite fallback port
        "http://localhost:5173",  # Vite default port
        "https://dungloe-gaa-analytics.vercel.app",  # Production frontend
        "https://app.onestat.ai",  # Production custom domain
        os.getenv("FRONTEND_URL", ""),  # From environment
    ],
    allow_credentials=True,  # Allow cookies (httpOnly auth cookies)
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, PUT, DELETE)
    allow_headers=["*"],  # Allow all headers
)


# Global exception handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """
    Handle HTTP exceptions consistently.
    
    Returns standardized error responses:
    {
        "error": "Error message",
        "detail": "Additional details",
        "status_code": 404
    }
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Catch-all exception handler for unexpected errors.
    
    Logs error details and returns generic error response.
    Prevents exposing internal error details to client.
    """
    logger.error(f"Unexpected error: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": "An unexpected error occurred" if os.getenv("ENVIRONMENT") == "production" else str(exc),
            "status_code": 500,
        }
    )


# Health check endpoint
@app.get("/")
async def root():
    """
    Root endpoint - Health check.
    
    Returns basic API information and status.
    Useful for monitoring and load balancers.
    """
    return {
        "message": "GAA Analytics API",
        "status": "operational",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    """
    Detailed health check endpoint.
    
    Checks:
    - API is responsive
    - Database connection is healthy
    - External services are reachable
    
    Returns:
        200: All systems operational
        503: Service unavailable
    """
    try:
        # Test database connection
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        
        return {
            "status": "healthy",
            "database": "connected",
            "environment": os.getenv("ENVIRONMENT", "unknown"),
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "database": "disconnected",
                "error": str(e),
            }
        )


# Register API routes
app.include_router(players.router, prefix="/api/v1/players", tags=["Players"])
app.include_router(matches.router, prefix="/api/v1/matches", tags=["Matches"])
app.include_router(match_events.router, prefix="/api/v1/match-events", tags=["Match Events"])
app.include_router(possession_events.router, prefix="/api/v1/possession-events", tags=["Possession Tracking"])
app.include_router(match_lineups.router)  # Uses prefix from router definition
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics Dashboard"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["AI Analysis"])
app.include_router(attendance.router, prefix="/api/v1/attendance", tags=["Attendance Tracking"])
app.include_router(knowledge_base.router, prefix="/api/v1/knowledge-base", tags=["Knowledge Base"])
app.include_router(training_performance.router, prefix="/api/v1/training", tags=["Training Performance"])
app.include_router(live_insights.router, prefix="/api/v1/live-insights", tags=["Live Match Insights"])
app.include_router(rag.router, prefix="/api/v1/rag", tags=["RAG Knowledge Base"])
app.include_router(squad_health.router, prefix="/api/v1/squad-health", tags=["Squad Health"])
app.include_router(match_gps.router, prefix="/api/v1/matches", tags=["Match GPS Data"])
app.include_router(fitness_tests.router, prefix="/api/v1/fitness-tests", tags=["Fitness Tests"])
app.include_router(club.router, prefix="/api/v1/club", tags=["Club"])
app.include_router(onboarding.router, prefix="/api/v1/onboarding", tags=["Onboarding"])
app.include_router(auth_routes.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(player_portal.router, prefix="/api/v1/player-portal", tags=["Player Portal"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(fixtures.router, prefix="/api/v1/fixtures", tags=["Fixtures"])
app.include_router(video_analysis.router, prefix="/api/v1/video", tags=["Video Analysis"])
app.include_router(video_events.router, prefix="/api/v1/video/events", tags=["Video Events"])
app.include_router(club_members.router, prefix="/api/v1/club", tags=["Club Members"])
app.include_router(player_movement.router, prefix="/api/v1/player-movement", tags=["Player Movement"])
app.include_router(match_prep.router, prefix="/api/v1/match-prep", tags=["Match Prep"])
app.include_router(organizations.router, prefix="/api/v1", tags=["Organizations"])
app.include_router(invitations.router, prefix="/api/v1/invitations", tags=["Invitations"])
app.include_router(playbook_push.router, prefix="/api/v1/playbook", tags=["Playbook"])


if __name__ == "__main__":
    import uvicorn
    
    # Run application directly (for development)
    # In production, use: uvicorn app.main:app --host 0.0.0.0 --port 8000
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Auto-reload on code changes
        log_level="info",
    )

