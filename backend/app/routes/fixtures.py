"""
API routes for fixtures — upcoming matches, fixture previews, scraping, and file import.
"""

import csv
import io
import logging
from datetime import datetime, time as dt_time
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_club
from app.database import get_db, async_session_maker
from app.models.club import Club
from app.models.match import Match, MatchStatus, MatchVenue
from app.schemas.match import MatchResponse
from app.services.fixture_scraper import FixtureScraperService, _normalize_team

logger = logging.getLogger(__name__)

router = APIRouter()


def _format_gaa_score(goals: int, points: int) -> str:
    return f"{goals}-{points}"


@router.get("/")
async def list_fixtures(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """List upcoming fixtures (scheduled matches with future dates, ordered by date ASC)."""
    result = await db.execute(
        select(Match)
        .where(
            and_(
                Match.club_id == user.club_id,
                Match.status == MatchStatus.SCHEDULED,
                Match.is_deleted == False,
            )
        )
        .order_by(Match.match_date.asc())
    )
    matches = result.scalars().all()
    return [MatchResponse.model_validate(m) for m in matches]


@router.get("/{match_id}/preview")
async def fixture_preview(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Fixture preview: match details + our recent form + opponent form + last meeting."""
    result = await db.execute(
        select(Match).where(
            and_(
                Match.id == match_id,
                Match.club_id == user.club_id,
                Match.is_deleted == False,
            )
        )
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    our_result = await db.execute(
        select(Match)
        .where(
            and_(
                Match.club_id == user.club_id,
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
            )
        )
        .order_by(Match.match_date.desc())
        .limit(5)
    )
    our_matches = our_result.scalars().all()
    our_form = []
    for m in our_matches:
        our_form.append({
            "date": m.match_date.isoformat(),
            "opponent_faced": m.opponent,
            "score_for": _format_gaa_score(m.team_goals, m.team_points),
            "score_against": _format_gaa_score(m.opponent_goals, m.opponent_points),
            "result": "W" if m.result == "win" else ("L" if m.result == "loss" else "D"),
            "competition": m.competition,
        })

    opponent_form = await FixtureScraperService.get_opponent_form(
        db, match.opponent, user.club_id
    )
    last_meeting = await FixtureScraperService.get_last_meeting(
        db, match.opponent, user.club_id
    )

    return {
        "match": MatchResponse.model_validate(match),
        "our_form": our_form,
        "opponent_form": opponent_form,
        "last_meeting": last_meeting,
    }


async def _run_sync(club_id: UUID):
    """Background task to run the fixture sync."""
    async with async_session_maker() as db:
        try:
            stats = await FixtureScraperService.sync_all(db, club_id)
            logger.info(f"Fixture sync completed for club {club_id}: {stats}")
        except Exception as e:
            logger.error(f"Fixture sync failed for club {club_id}: {e}")


@router.post("/sync")
async def sync_fixtures(
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
):
    """Trigger scrape from donegalgaa.ie. Runs in background, returns immediately."""
    background_tasks.add_task(_run_sync, user.club_id)
    return {"status": "syncing", "message": "Fixture sync started in background"}


# ---------------------------------------------------------------------------
# Shared helpers for import
# ---------------------------------------------------------------------------

VENUE_MAP = {
    "home": MatchVenue.HOME, "h": MatchVenue.HOME,
    "away": MatchVenue.AWAY, "a": MatchVenue.AWAY,
    "neutral": MatchVenue.NEUTRAL, "n": MatchVenue.NEUTRAL,
}

DATE_FORMATS = [
    "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y",
    "%d-%m-%Y %H:%M", "%d-%m-%Y", "%d %b %Y %H:%M", "%d %b %Y",
    "%d %B %Y %H:%M", "%d %B %Y",
]


def _parse_date(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


async def _check_duplicate(db: AsyncSession, club_id: UUID, opponent: str, match_date: datetime) -> bool:
    day_start = match_date.replace(hour=0, minute=0, second=0)
    day_end = match_date.replace(hour=23, minute=59, second=59)
    existing = await db.execute(
        select(Match).where(
            and_(
                Match.club_id == club_id,
                Match.opponent == opponent,
                Match.match_date >= day_start,
                Match.match_date <= day_end,
                Match.is_deleted == False,
            )
        )
    )
    return existing.scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# Dynamic club alias helpers
# ---------------------------------------------------------------------------

def _build_club_aliases(club: Club) -> set[str]:
    """Build the set of all names this club is known by (lowercased for matching)."""
    aliases: set[str] = set()
    if club.name:
        aliases.add(club.name.lower())
    if club.short_name:
        aliases.add(club.short_name.lower())
    for a in (club.team_aliases or []):
        if a:
            aliases.add(a.strip().lower())
    return aliases


def _is_our_club(name: str, club_aliases: set[str]) -> bool:
    """Check if a team name matches any of our club's aliases (case-insensitive)."""
    stripped = name.strip().lower()
    return stripped in club_aliases or _normalize_team(name).lower() in club_aliases


# ---------------------------------------------------------------------------
# XLSX parsing helpers
# ---------------------------------------------------------------------------

_FIXTURE_KEYWORDS = ["home", "away", "date", "time", "throw", "division", "competition", "comp", "round"]


def _find_fixture_header_row(rows: list, max_scan: int = 10) -> int:
    """Scan first rows to find the one containing fixture column headers."""
    for i, row in enumerate(rows[:max_scan]):
        header = [str(c).strip().lower() if c else "" for c in row]
        matches = sum(1 for h in header if any(kw in h for kw in _FIXTURE_KEYWORDS))
        if matches >= 2:
            return i
    return 0


def _detect_xlsx_columns(header_row: list) -> dict:
    """
    Map header row to column indices. Shared between parse and preview.

    Uses keyword substring matching so it works with variations like
    "Home Organization", "Home Team", "Start Date From", etc.
    First match per role wins (leftmost column).
    """
    header = [str(c).strip().lower() if c else "" for c in header_row]
    col_map: dict[str, int] = {}

    # (role, keywords) — first keyword hit in the header claims the role
    ROLE_KEYWORDS = [
        ("home",        ["home"]),
        ("away",        ["away"]),
        ("date",        ["date"]),
        ("time",        ["time", "throw"]),
        ("competition", ["division", "competition", "comp"]),
        ("round",       ["round"]),
    ]

    for i, h in enumerate(header):
        if not h:
            continue
        for role, keywords in ROLE_KEYWORDS:
            if role not in col_map and any(kw in h for kw in keywords):
                col_map[role] = i
                break

    return col_map


def _extract_unique_teams(content: bytes) -> list[str]:
    """Extract all unique team names from an XLSX file's Home/Away columns."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    teams: set[str] = set()

    for sheet_name in wb.sheetnames:
        lower_name = sheet_name.lower()
        if any(tag in lower_name for tag in ["u16", "u14", "u12", "u18", "minor", "underage"]):
            continue

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_idx = _find_fixture_header_row(rows)
        col_map = _detect_xlsx_columns(rows[header_idx])
        if "home" not in col_map or "away" not in col_map:
            continue

        for row in rows[header_idx + 1:]:
            if not row or len(row) <= max(col_map.values()):
                continue
            home_raw = str(row[col_map["home"]] or "").strip()
            away_raw = str(row[col_map["away"]] or "").strip()
            if home_raw:
                teams.add(home_raw)
            if away_raw:
                teams.add(away_raw)

    return sorted(teams)


# ---------------------------------------------------------------------------
# XLSX import (county board format)
# ---------------------------------------------------------------------------

def _parse_xlsx_fixtures(content: bytes, club_aliases: set[str]) -> list[dict]:
    """
    Parse county board XLSX fixture files.

    Expects columns like:
      Division Name | Home Organization | Away Organization | Start Date | Start Time | Round
    or (U16 style):
      Age Level | Division Name | Home Organization | Away Organization | Start Date | Start Time | Round

    Only returns rows where the club (matched via club_aliases) is home or away.
    Skips U16 / underage sheets.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    fixtures = []

    for sheet_name in wb.sheetnames:
        lower_name = sheet_name.lower()
        if any(tag in lower_name for tag in ["u16", "u14", "u12", "u18", "minor", "underage"]):
            continue

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_idx = _find_fixture_header_row(rows)
        col_map = _detect_xlsx_columns(rows[header_idx])

        if "home" not in col_map or "away" not in col_map or "date" not in col_map:
            continue  # skip sheets we can't parse

        for row in rows[header_idx + 1:]:
            if not row or len(row) <= max(col_map.values()):
                continue

            home_raw = str(row[col_map["home"]] or "").strip()
            away_raw = str(row[col_map["away"]] or "").strip()
            if not home_raw or not away_raw:
                continue

            # Only keep our club's fixtures
            is_home = _is_our_club(home_raw, club_aliases)
            is_away = _is_our_club(away_raw, club_aliases)
            if not is_home and not is_away:
                continue

            # Parse date
            date_val = row[col_map["date"]]
            if isinstance(date_val, datetime):
                match_date = date_val
            elif date_val:
                match_date = _parse_date(str(date_val))
                if not match_date:
                    continue
            else:
                continue

            # Parse time
            time_val = row[col_map.get("time", -1)] if "time" in col_map else None
            if time_val:
                if isinstance(time_val, dt_time):
                    match_date = match_date.replace(hour=time_val.hour, minute=time_val.minute)
                elif isinstance(time_val, datetime):
                    match_date = match_date.replace(hour=time_val.hour, minute=time_val.minute)
                else:
                    time_str = str(time_val).strip()
                    try:
                        t = datetime.strptime(time_str, "%H:%M:%S")
                        match_date = match_date.replace(hour=t.hour, minute=t.minute)
                    except ValueError:
                        try:
                            t = datetime.strptime(time_str, "%H:%M")
                            match_date = match_date.replace(hour=t.hour, minute=t.minute)
                        except ValueError:
                            pass

            opponent = _normalize_team(away_raw) if is_home else _normalize_team(home_raw)
            venue = MatchVenue.HOME if is_home else MatchVenue.AWAY
            competition = str(row[col_map["competition"]]).strip() if "competition" in col_map and row[col_map["competition"]] else None
            round_val = str(row[col_map["round"]]).strip() if "round" in col_map and row[col_map["round"]] else None

            fixtures.append({
                "opponent": opponent,
                "match_date": match_date,
                "venue": venue,
                "competition": competition,
                "round": round_val,
            })

    return fixtures


# ---------------------------------------------------------------------------
# Preview teams endpoint (XLSX only)
# ---------------------------------------------------------------------------

@router.post("/preview-teams")
async def preview_teams(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_club),
):
    """Parse XLSX file and return all unique team names found (for alias selection)."""
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Team preview is only available for .xlsx files")

    content = await file.read()
    try:
        teams = _extract_unique_teams(content)
    except Exception as e:
        logger.error(f"XLSX preview parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Could not parse XLSX file: {e}")

    return {"teams": teams}


# ---------------------------------------------------------------------------
# Unified import endpoint (CSV + XLSX)
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_fixtures(
    file: UploadFile = File(...),
    mode: str = Query("add", regex="^(add|replace)$"),
    selected_team: str | None = Query(None),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Import fixtures from a CSV or XLSX file.

    **mode**: "add" (default) skips duplicates. "replace" deletes all SCHEDULED
    fixtures first, then imports.

    **selected_team**: When provided for XLSX import, this team name is
    auto-saved as a club alias and used for filtering.

    **XLSX** (county board format): auto-detects club fixtures from
    Home/Away Organization columns using club aliases. Skips underage sheets.

    **CSV** (manual format): expects columns Opponent, Date, Time, Venue, Competition.
    """
    # Load club for alias matching
    club = await db.get(Club, user.club_id)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")

    # Auto-save selected_team as a new alias
    if selected_team and selected_team.strip():
        existing_aliases = list(club.team_aliases or [])
        if selected_team.strip() not in existing_aliases:
            existing_aliases.append(selected_team.strip())
            club.team_aliases = existing_aliases
            await db.flush()

    club_aliases = _build_club_aliases(club)

    # Replace mode: delete all SCHEDULED matches first
    cleared = 0
    if mode == "replace":
        scheduled = await db.execute(
            select(Match).where(and_(
                Match.club_id == user.club_id,
                Match.status == MatchStatus.SCHEDULED,
                Match.is_deleted == False,
            ))
        )
        for m in scheduled.scalars().all():
            await db.delete(m)
            cleared += 1
        await db.flush()

    filename = (file.filename or "").lower()
    content = await file.read()

    if filename.endswith(".xlsx"):
        result = await _import_xlsx(content, user.club_id, db, club_aliases)
    elif filename.endswith(".csv"):
        result = await _import_csv(content, user.club_id, db)
    else:
        raise HTTPException(status_code=400, detail="Please upload a .csv or .xlsx file")

    if cleared > 0:
        result["cleared"] = cleared
        result["message"] = f"Cleared {cleared} scheduled fixture(s). " + result["message"]

    return result


async def _import_xlsx(content: bytes, club_id: UUID, db: AsyncSession, club_aliases: set[str]) -> dict:
    try:
        fixtures = _parse_xlsx_fixtures(content, club_aliases)
    except Exception as e:
        logger.error(f"XLSX parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Could not parse XLSX file: {e}")

    if not fixtures:
        raise HTTPException(
            status_code=400,
            detail="No fixtures found for your club in the file. "
                   "Make sure the file has Home/Away Organization columns, "
                   "and your club name or aliases match a team in the file.",
        )

    created = 0
    skipped = 0

    for f in fixtures:
        if await _check_duplicate(db, club_id, f["opponent"], f["match_date"]):
            skipped += 1
            continue

        notes = f"Round {f['round']}" if f.get("round") else None
        new_match = Match(
            club_id=club_id,
            opponent=f["opponent"],
            match_date=f["match_date"],
            venue=f["venue"],
            competition=f["competition"],
            notes=notes,
            status=MatchStatus.SCHEDULED,
        )
        db.add(new_match)
        created += 1

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": [],
        "message": f"Imported {created} fixture(s)" + (f", {skipped} skipped (duplicates)" if skipped else ""),
    }


async def _import_csv(content: bytes, club_id: UUID, db: AsyncSession) -> dict:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no header row")

    header_map: dict[str, str] = {}
    for h in reader.fieldnames:
        lower = h.strip().lower()
        if lower in ("opponent", "opposition", "team"):
            header_map[h] = "opponent"
        elif lower in ("date", "match_date", "match date"):
            header_map[h] = "date"
        elif lower in ("time", "throw-in", "throw_in", "kickoff", "kick-off"):
            header_map[h] = "time"
        elif lower in ("venue", "home/away", "h/a"):
            header_map[h] = "venue"
        elif lower in ("competition", "comp", "tournament"):
            header_map[h] = "competition"

    if "opponent" not in header_map.values():
        raise HTTPException(
            status_code=400,
            detail="CSV must have an 'Opponent' column. Found: " + ", ".join(reader.fieldnames),
        )
    if "date" not in header_map.values():
        raise HTTPException(
            status_code=400,
            detail="CSV must have a 'Date' column. Found: " + ", ".join(reader.fieldnames),
        )

    created = 0
    skipped = 0
    errors = []

    for row_num, row in enumerate(reader, start=2):
        mapped = {}
        for orig_key, val in row.items():
            norm = header_map.get(orig_key)
            if norm:
                mapped[norm] = (val or "").strip()

        opponent = mapped.get("opponent", "").strip()
        date_raw = mapped.get("date", "").strip()
        if not opponent or not date_raw:
            skipped += 1
            continue

        match_date = _parse_date(date_raw)
        if not match_date:
            errors.append(f"Row {row_num}: could not parse date '{date_raw}'")
            continue

        time_raw = mapped.get("time", "").strip()
        if time_raw and match_date.hour == 0 and match_date.minute == 0:
            try:
                t = datetime.strptime(time_raw, "%H:%M")
                match_date = match_date.replace(hour=t.hour, minute=t.minute)
            except ValueError:
                pass
        elif match_date.hour == 0 and match_date.minute == 0:
            match_date = match_date.replace(hour=15, minute=0)

        venue_raw = mapped.get("venue", "home").strip().lower()
        venue = VENUE_MAP.get(venue_raw, MatchVenue.HOME)
        competition = mapped.get("competition") or None

        if await _check_duplicate(db, club_id, opponent, match_date):
            skipped += 1
            continue

        new_match = Match(
            club_id=club_id,
            opponent=opponent,
            match_date=match_date,
            venue=venue,
            competition=competition,
            status=MatchStatus.SCHEDULED,
        )
        db.add(new_match)
        created += 1

    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "message": f"Imported {created} fixture(s)" + (f", {skipped} skipped" if skipped else ""),
    }


@router.get("/opponent/{name}/form")
async def opponent_form(
    name: str,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get an opponent's recent results from scraped data."""
    form = await FixtureScraperService.get_opponent_form(db, name, user.club_id)
    return form
