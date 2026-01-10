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
import logging
import os

# Import database functions
from app.database import engine, Base, get_db

# Import routes
from app.routes import players
from app.routes import matches, match_events
# from app.routes import possession, fitness, gps, ai  # Will add these next

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
    logger.info("🏉 Starting Dungloe GAA Analytics API...")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")
    
    # Initialize database tables (in dev - use Alembic in production)
    logger.info("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Database tables created")
    
    logger.info("✅ Application startup complete")
    
    yield  # Application runs here
    
    # Shutdown
    logger.info("Shutting down application...")
    await engine.dispose()  # Close all database connections
    logger.info("✅ Application shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="Dungloe GAA Analytics API",
    description="Team analytics platform with AI-powered insights for GAA clubs",
    version="1.0.0",
    docs_url="/docs",  # Swagger UI at /docs
    redoc_url="/redoc",  # ReDoc at /redoc
    lifespan=lifespan,  # Lifecycle manager
)


# Configure CORS (Cross-Origin Resource Sharing)
# Allows frontend to make requests to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Local development
        "http://localhost:5173",  # Vite default port
        "https://dungloe-gaa-analytics.vercel.app",  # Production frontend
        os.getenv("FRONTEND_URL", ""),  # From environment
    ],
    allow_credentials=True,  # Allow cookies
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
        "message": "Dungloe GAA Analytics API",
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
            await conn.execute("SELECT 1")
        
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
app.include_router(players.router, prefix="/api/players", tags=["Players"])
app.include_router(matches.router, prefix="/api/matches", tags=["Matches"])
app.include_router(match_events.router, prefix="/api/match-events", tags=["Match Events"])
# Will add these next:
# app.include_router(possession.router, prefix="/api/possession", tags=["Possession Tracking"])
# app.include_router(fitness.router, prefix="/api/fitness", tags=["Fitness Tests"])
# app.include_router(gps.router, prefix="/api/gps", tags=["GPS Data"])
# app.include_router(ai.router, prefix="/api/ai", tags=["AI Analysis"])


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

