"""
API routes for fixtures — upcoming matches, fixture previews, scraping, and file import.
"""

import csv
import io
import logging
from datetime import datetime, time as dt_time
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select, and_, exists
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.database import get_db, async_session_maker
from app.models.club import Club
from app.models.match import Match, MatchStatus, MatchVenue
from app.models.match_event import MatchEvent
from app.schemas.match import MatchResponse
from app.services.fixture_scraper import FixtureScraperService, _normalize_team

logger = logging.getLogger(__name__)

router = APIRouter()


def _format_gaa_score(goals: int, points: int) -> str:
    return f"{goals}-{points}"


@router.get("/")
async def list_fixtures(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List upcoming fixtures (scheduled + in-progress matches, ordered by date ASC)."""
    result = await db.execute(
        select(Match)
        .where(
            and_(
                Match.club_id == user.club_id,
                Match.status.in_([MatchStatus.SCHEDULED, MatchStatus.IN_PROGRESS]),
                Match.is_deleted .is_(False),
            )
        )
        .order_by(Match.match_date.asc())
    )
    matches = result.scalars().all()
    return [MatchResponse.model_validate(m) for m in matches]


@router.get("/{match_id}/preview")
async def fixture_preview(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Fixture preview: match details + our recent form + opponent form + last meeting."""
    result = await db.execute(
        select(Match).where(
            and_(
                Match.id == match_id,
                Match.club_id == user.club_id,
                Match.is_deleted .is_(False),
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
                Match.is_deleted .is_(False),
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

    # Include club county so frontend knows whether AI form fetch is possible
    club_result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = club_result.scalar_one_or_none()
    club_county = club.county if club else None

    # Whether any events have already been logged for this match — used by the
    # frontend to avoid showing "Log Match Events" (implying a fresh start) on
    # a match that's already been recorded but never marked completed
    has_events_result = await db.execute(
        select(exists().where(MatchEvent.match_id == match_id))
    )
    has_events = bool(has_events_result.scalar())

    return {
        "match": MatchResponse.model_validate(match),
        "our_form": our_form,
        "opponent_form": opponent_form,
        "last_meeting": last_meeting,
        "club_county": club_county,
        "ai_opponent_form": match.ai_opponent_form,
        "has_events": has_events,
    }


# Known county GAA website domains — used to target official results pages
_COUNTY_GAA_DOMAINS: dict[str, str] = {
    "antrim": "antrimgaa.ie",
    "armagh": "armaghgaa.ie",
    "carlow": "carlowgaa.ie",
    "cavan": "cavangaa.ie",
    "clare": "claregaa.ie",
    "cork": "gaacork.ie",
    "derry": "derrygaa.ie",
    "donegal": "donegalgaa.ie",
    "down": "downgaa.ie",
    "dublin": "dublingaa.ie",
    "fermanagh": "fermanghgaa.ie",
    "galway": "galwaygaa.ie",
    "kerry": "kerrygaa.ie",
    "kildare": "kildaregaa.ie",
    "kilkenny": "kilkennygaa.ie",
    "laois": "laoisgaa.ie",
    "leitrim": "leitrimgaa.ie",
    "limerick": "limerickgaa.ie",
    "longford": "longfordgaa.ie",
    "louth": "louthgaa.ie",
    "mayo": "mayogaa.ie",
    "meath": "meathgaa.ie",
    "monaghan": "monaghangaa.ie",
    "offaly": "offalygaa.ie",
    "roscommon": "roscommongaa.ie",
    "sligo": "sligogaa.ie",
    "tipperary": "tipperarygaa.ie",
    "tyrone": "tyronegaa.ie",
    "waterford": "waterfordgaa.ie",
    "westmeath": "westmeathgaa.ie",
    "wexford": "wexfordgaa.ie",
    "wicklow": "wicklowgaa.ie",
}


async def _fetch_club_page(url: str) -> str | None:
    """Fetch a GAA club page and return stripped plain text, or None on failure."""
    import re
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as http:
            resp = await http.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; GAABot/1.0)"})
            if resp.status_code != 200:
                return None
            html = resp.text
            html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
            html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
            text = re.sub(r'<[^>]+>', ' ', html)
            text = re.sub(r'\s+', ' ', text).strip()
            return text[:10000]
    except Exception as e:
        logger.debug(f"Club page fetch failed for {url}: {e}")
        return None


async def _fetch_ai_opponent_form(opponent: str, county: str | None, competition: str | None = None) -> list[dict]:
    """Search for the county GAA website, fetch the club page, parse results with Haiku."""
    import json
    import re
    from app.services.ai._shared import web_search_tool, client

    # Detect sport from competition name — default to football
    comp_lower = (competition or "").lower()
    sport = "hurling" if "hurling" in comp_lower else "football"

    county_domain = None
    if county:
        county_domain = _COUNTY_GAA_DOMAINS.get(county.lower().strip())

    # Search DuckDuckGo targeting the county GAA domain if known, else generic
    if county_domain:
        query = f'{opponent} {county_domain}'
    else:
        query = f'{opponent} GAA club fixtures results 2026'

    search_raw = await web_search_tool(query)

    # Try to find and fetch the official club page from the county GAA site
    page_content = None
    club_page_url = None
    try:
        search_json = json.loads(search_raw)
        results = search_json.get("results", [])
        if county_domain:
            # Prefer a /clubs/ page, then any county-domain URL
            for r in results:
                url = r.get("url", "")
                if county_domain in url and "/clubs/" in url:
                    club_page_url = url
                    break
            if not club_page_url:
                for r in results:
                    url = r.get("url", "")
                    if county_domain in url:
                        club_page_url = url
                        break
    except Exception:
        pass

    if club_page_url:
        page_content = await _fetch_club_page(club_page_url)

    # Build context for Haiku — full page preferred, fall back to search snippets
    if page_content:
        context = f"Club page content from {club_page_url}:\n{page_content}"
    else:
        context = f"Web search snippets:\n{search_raw}"

    prompt = f"""Extract the last 5 GAA {sport} match results for the SENIOR team "{opponent}" from this content.

{context}

Return ONLY a JSON array (no other text). Each element:
{{"date": "YYYY-MM-DD", "opponent_faced": "Club name", "score_for": "G-PP", "score_against": "G-PP", "result": "W"|"L"|"D", "competition": "League/Championship/etc"}}

Rules:
- {sport.upper()} ONLY — exclude any hurling{"" if sport == "hurling" else ", camogie,"} or other sports
- Senior team only — exclude underage, ladies, reserve, or junior grades
- Only results FOR {opponent} (not matches where they appear as opposition)
- Use approximate dates if exact date unclear (e.g. "2026-05-01")
- Scores must be GAA format: goals-points e.g. "1-12" or "0-8"
- If no results found, return []
- At most 5 results, most recent first"""

    try:
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        arr_match = re.search(r'\[.*\]', text, re.DOTALL)
        if not arr_match:
            return []
        results = json.loads(arr_match.group())

        # Recompute W/L/D deterministically from the scores rather than
        # trusting Haiku's own arithmetic — a scraped-and-summarised result
        # (e.g. "0-19" vs "2-13", both 19 total) got called a win instead of
        # a draw, because the model was asked to both extract the score AND
        # judge the outcome from it in one step. Extraction from messy web
        # text still needs the model; the W/L/D judgement itself is a plain
        # arithmetic comparison once the score strings exist, so do that in
        # Python where it can't be wrong.
        for r in results:
            for_total = _parse_gaa_score(r.get("score_for"))
            against_total = _parse_gaa_score(r.get("score_against"))
            if for_total is not None and against_total is not None:
                if for_total > against_total:
                    r["result"] = "W"
                elif for_total < against_total:
                    r["result"] = "L"
                else:
                    r["result"] = "D"
            # else: leave whatever Haiku returned — better than nothing if the score didn't parse

        return results
    except Exception as e:
        logger.warning(f"AI opponent form parse failed: {e}")
        return []


def _parse_gaa_score(score: str | None) -> int | None:
    """Parse a GAA scoreline like "1-12" (1 goal, 12 points) into total
    points (goals*3 + points). Returns None if it doesn't look like a valid
    GAA score, so callers can fall back gracefully instead of miscounting."""
    import re
    if not score or not isinstance(score, str):
        return None
    m = re.match(r'^\s*(\d+)\s*-\s*(\d+)\s*$', score.strip())
    if not m:
        return None
    goals, points = int(m.group(1)), int(m.group(2))
    return goals * 3 + points


@router.post("/{match_id}/opponent-form/fetch")
async def fetch_ai_opponent_form(
    match_id: UUID,
    force: bool = Query(False),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Fetch opponent recent form via web search + AI parse. Cached for 48 hours.
    Pass ?force=true to bypass cache and retry immediately."""
    result = await db.execute(
        select(Match).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")

    # Return cached result if fresh and not dismissed (skip cache if force=true)
    existing = match.ai_opponent_form or {}
    if not force:
        if existing.get("dismissed"):
            return existing
        if existing.get("fetched_at"):
            age = datetime.utcnow() - datetime.fromisoformat(existing["fetched_at"])
            if age.total_seconds() < 48 * 3600:
                return existing

    # Fetch club county for search context
    club_result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = club_result.scalar_one_or_none()
    county = club.county if club else None

    results = await _fetch_ai_opponent_form(match.opponent, county, match.competition)

    payload = {
        "results": results,
        "fetched_at": datetime.utcnow().isoformat(),
        "dismissed": False,
    }
    match.ai_opponent_form = payload
    await db.commit()
    return payload


@router.delete("/{match_id}/opponent-form")
async def dismiss_ai_opponent_form(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss (report incorrect) AI opponent form so it won't auto-reload."""
    result = await db.execute(
        select(Match).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(404, "Match not found")

    match.ai_opponent_form = {"dismissed": True}
    await db.commit()
    return {"ok": True}


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
    user: AuthenticatedUser = Depends(require_admin),
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

# Year-less formats (e.g. "Sun 8 Mar", "Sun 21 June") — current year is substituted
_DATE_FORMATS_YEARLESS = [
    "%a %d %b", "%a %d %B",   # Sun 8 Mar / Sun 21 June
    "%A %d %b", "%A %d %B",   # Sunday 8 Mar / Sunday 21 June
    "%d %b", "%d %B",         # 8 Mar / 21 June
]


def _parse_date(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    # Try year-less formats — substitute current year
    current_year = datetime.now().year
    for fmt in _DATE_FORMATS_YEARLESS:
        try:
            d = datetime.strptime(raw, fmt)
            return d.replace(year=current_year)
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
                Match.is_deleted .is_(False),
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
    if getattr(club, "home_ground", None):
        aliases.add(club.home_ground.lower())
    for a in (club.team_aliases or []):
        if a:
            aliases.add(a.strip().lower())
    return aliases


def _infer_venue_from_location(venue_str: str, opponent_raw: str, club_aliases: set[str]) -> "MatchVenue":
    """Infer HOME/AWAY/NEUTRAL from a venue location string in club-centric XLSX files."""
    if not venue_str:
        return MatchVenue.HOME
    v = venue_str.strip().lower()
    opp = opponent_raw.strip().lower()
    opp_norm = _normalize_team(opponent_raw).lower()
    # Venue matches opponent name → AWAY
    if opp and (opp in v or v in opp or opp_norm in v or v in opp_norm):
        return MatchVenue.AWAY
    # Venue matches our club identifiers → HOME
    if any(alias and (alias in v or v in alias) for alias in club_aliases):
        return MatchVenue.HOME
    return MatchVenue.NEUTRAL


def _is_our_club(name: str, club_aliases: set[str]) -> bool:
    """Check if a team name matches any of our club's aliases (case-insensitive)."""
    stripped = name.strip().lower()
    return stripped in club_aliases or _normalize_team(name).lower() in club_aliases


# ---------------------------------------------------------------------------
# XLSX parsing helpers
# ---------------------------------------------------------------------------

_FIXTURE_KEYWORDS = ["home", "away", "date", "time", "throw", "division", "competition", "comp", "round", "team", "opposition", "venue"]


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
        ("our_team",    ["team"]),           # club-centric format: "Team" = our club
        ("opponent",    ["opposition"]),     # club-centric format: "Opposition" = their club
        ("date",        ["date"]),
        ("time",        ["time", "throw"]),
        ("competition", ["division", "competition", "comp"]),
        ("round",       ["round"]),
        ("venue",       ["venue"]),
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
        has_home_away = "home" in col_map and "away" in col_map
        has_team_opp = "our_team" in col_map or "opponent" in col_map
        if not has_home_away and not has_team_opp:
            continue

        for row in rows[header_idx + 1:]:
            if not row or len(row) <= max(col_map.values()):
                continue
            if has_home_away:
                home_raw = str(row[col_map["home"]] or "").strip()
                away_raw = str(row[col_map["away"]] or "").strip()
                if home_raw:
                    teams.add(home_raw)
                if away_raw:
                    teams.add(away_raw)
            else:
                for role in ("our_team", "opponent"):
                    if role in col_map and len(row) > col_map[role]:
                        v = str(row[col_map[role]] or "").strip()
                        if v:
                            teams.add(v)

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

        has_home_away = "home" in col_map and "away" in col_map
        has_team_opp = "our_team" in col_map and "opponent" in col_map

        if not (has_home_away or has_team_opp) or "date" not in col_map:
            continue  # skip sheets we can't parse

        for row in rows[header_idx + 1:]:
            if not row or len(row) <= max(col_map.values()):
                continue

            # ── Team / venue resolution ────────────────────────────────────────
            if has_home_away:
                home_raw = str(row[col_map["home"]] or "").strip()
                away_raw = str(row[col_map["away"]] or "").strip()
                if not home_raw or not away_raw:
                    continue
                is_home = _is_our_club(home_raw, club_aliases)
                is_away = _is_our_club(away_raw, club_aliases)
                if not is_home and not is_away:
                    continue
                opponent = _normalize_team(away_raw) if is_home else _normalize_team(home_raw)
                venue = MatchVenue.HOME if is_home else MatchVenue.AWAY
            else:
                # Club-centric format: every row is our fixture
                opponent_raw = str(row[col_map["opponent"]] or "").strip()
                if not opponent_raw:
                    continue
                venue_str = (
                    str(row[col_map["venue"]] or "").strip()
                    if "venue" in col_map and len(row) > col_map["venue"]
                    else ""
                )
                venue = _infer_venue_from_location(venue_str, opponent_raw, club_aliases)
                opponent = _normalize_team(opponent_raw)

            # ── Date ──────────────────────────────────────────────────────────
            date_val = row[col_map["date"]]
            if isinstance(date_val, datetime):
                match_date = date_val
            elif date_val:
                match_date = _parse_date(str(date_val))
                if not match_date:
                    continue
            else:
                continue

            # ── Time ──────────────────────────────────────────────────────────
            time_val = row[col_map["time"]] if "time" in col_map and len(row) > col_map["time"] else None
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

            # ── Optional metadata ─────────────────────────────────────────────
            competition = (
                str(row[col_map["competition"]]).strip()
                if "competition" in col_map and len(row) > col_map["competition"] and row[col_map["competition"]]
                else None
            )
            round_val = (
                str(row[col_map["round"]]).strip()
                if "round" in col_map and len(row) > col_map["round"] and row[col_map["round"]]
                else None
            )

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
    user: AuthenticatedUser = Depends(require_admin),
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
    user: AuthenticatedUser = Depends(require_admin),
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
                Match.is_deleted .is_(False),
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
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get an opponent's recent results from scraped data."""
    form = await FixtureScraperService.get_opponent_form(db, name, user.club_id)
    return form
