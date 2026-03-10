"""
Fixture scraper service for donegalgaa.ie.

Scrapes fixtures and results, stores them in scraped_fixtures table,
and auto-creates Match records for Dungloe games.
"""

import hashlib
import logging
import re
from datetime import datetime
from typing import Optional
from uuid import UUID

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match, MatchStatus, MatchVenue
from app.models.scraped_fixture import ScrapedFixture

logger = logging.getLogger(__name__)

# Team aliases — map Irish names and variants to canonical English names
TEAM_ALIASES = {
    "An Clochán Liath": "Dungloe",
    "CLG An Clochán Liath": "Dungloe",
}

# Reverse lookup: canonical name → all aliases (including the canonical name itself)
DUNGLOE_NAMES = {"Dungloe", "An Clochán Liath", "CLG An Clochán Liath"}

BASE_URL = "https://donegalgaa.ie/fixtures-results/football/club/senior/"


def _normalize_team(name: str) -> str:
    """Normalize team name using alias map."""
    stripped = name.strip()
    return TEAM_ALIASES.get(stripped, stripped)


def _compute_hash(home: str, away: str, date: datetime, competition: str | None) -> str:
    """SHA256 dedup key from canonical fields."""
    raw = f"{home}|{away}|{date.isoformat()}|{competition or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _is_dungloe(team: str) -> bool:
    """Check if a team name refers to Dungloe."""
    return _normalize_team(team) in DUNGLOE_NAMES or team.strip() in DUNGLOE_NAMES


def _parse_gaa_score(score_text: str) -> tuple[int, int] | None:
    """Parse a GAA score like '2-10' into (goals, points). Returns None if unparseable."""
    score_text = score_text.strip()
    match = re.match(r"(\d+)\s*-\s*(\d+)", score_text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def _format_gaa_score(goals: int | None, points: int | None) -> str:
    """Format goals/points as 'G-P' string."""
    if goals is None or points is None:
        return "—"
    return f"{goals}-{points}"


class FixtureScraperService:

    @staticmethod
    async def scrape_page(page: int, feed_type: str = "results") -> dict:
        """
        Fetch a single page from donegalgaa.ie AJAX endpoint.
        Returns {ok, html, hasMore} dict.
        """
        url = f"{BASE_URL}?ajax=1&feed_type={feed_type}&page={page}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"X-Requested-With": "XMLHttpRequest"})
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def parse_results_html(html: str) -> list[dict]:
        """
        Parse the HTML fragment returned by the AJAX endpoint.
        Returns a list of fixture/result dicts.
        """
        soup = BeautifulSoup(html, "lxml")
        fixtures = []
        current_date = None

        for el in soup.children:
            if not hasattr(el, "get"):
                continue

            # Date headers set the current date context
            if "fixtures_date" in (el.get("class") or []):
                date_text = el.get_text(strip=True)
                try:
                    current_date = datetime.strptime(date_text, "%A %d %B %Y")
                except ValueError:
                    # Try alternative format
                    try:
                        current_date = datetime.strptime(date_text, "%d %B %Y")
                    except ValueError:
                        logger.warning(f"Could not parse date: {date_text}")
                continue

            # Competition blocks contain matches
            if "competition" not in (el.get("class") or []):
                continue

            comp_name_el = el.select_one(".competition-name a, .competition-name")
            competition = comp_name_el.get_text(strip=True) if comp_name_el else None

            for detail in el.select(".comp_details"):
                home_el = detail.select_one(".home_team a, .home_team")
                away_el = detail.select_one(".away_team a, .away_team")
                if not home_el or not away_el:
                    continue

                home_team = _normalize_team(home_el.get_text(strip=True))
                away_team = _normalize_team(away_el.get_text(strip=True))

                # Parse scores
                home_score_el = detail.select_one(".home_score")
                away_score_el = detail.select_one(".away_score")
                home_score = _parse_gaa_score(home_score_el.get_text(strip=True)) if home_score_el else None
                away_score = _parse_gaa_score(away_score_el.get_text(strip=True)) if away_score_el else None

                # Parse time
                time_el = detail.select_one(".time")
                time_text = time_el.get_text(strip=True) if time_el else None

                # Parse venue/referee from more_info
                venue_name = None
                referee_name = None
                more_info = detail.select_one(".more_info")
                if more_info:
                    info_text = more_info.get_text(" ", strip=True)
                    venue_match = re.search(r"Venue:\s*(.+?)(?:\s*Referee:|$)", info_text)
                    if venue_match:
                        venue_name = venue_match.group(1).strip()
                    ref_match = re.search(r"Referee:\s*(.+?)$", info_text)
                    if ref_match:
                        referee_name = ref_match.group(1).strip()

                # Build match_date from current_date + time
                match_date = current_date or datetime.utcnow()
                if time_text and current_date:
                    try:
                        t = datetime.strptime(time_text, "%H:%M")
                        match_date = current_date.replace(hour=t.hour, minute=t.minute)
                    except ValueError:
                        pass

                is_result = home_score is not None and away_score is not None

                fixture = {
                    "home_team": home_team,
                    "away_team": away_team,
                    "match_date": match_date,
                    "competition": competition,
                    "venue": venue_name,
                    "referee": referee_name,
                    "home_goals": home_score[0] if home_score else None,
                    "home_points": home_score[1] if home_score else None,
                    "away_goals": away_score[0] if away_score else None,
                    "away_points": away_score[1] if away_score else None,
                    "is_result": is_result,
                }
                fixtures.append(fixture)

        return fixtures

    @staticmethod
    async def sync_all(db: AsyncSession, club_id: UUID) -> dict:
        """
        Scrape both fixtures and results pages (up to 5 pages each).
        Upsert into scraped_fixtures using external_hash.
        Auto-create Match records for Dungloe fixtures.
        """
        all_fixtures = []
        stats = {"fixtures_found": 0, "results_found": 0, "matches_created": 0, "matches_updated": 0}

        for feed_type in ["fixtures", "results"]:
            for page_num in range(1, 6):
                try:
                    data = await FixtureScraperService.scrape_page(page_num, feed_type)
                    if not data.get("ok"):
                        break
                    html = data.get("html", "")
                    if not html or not html.strip():
                        break
                    parsed = FixtureScraperService.parse_results_html(html)
                    all_fixtures.extend(parsed)
                    if not data.get("hasMore"):
                        break
                except Exception as e:
                    logger.error(f"Error scraping {feed_type} page {page_num}: {e}")
                    break

        # Upsert into scraped_fixtures
        for f in all_fixtures:
            ext_hash = _compute_hash(f["home_team"], f["away_team"], f["match_date"], f["competition"])

            existing = await db.execute(
                select(ScrapedFixture).where(ScrapedFixture.external_hash == ext_hash)
            )
            existing_row = existing.scalar_one_or_none()

            if existing_row:
                # Update scores if they changed (fixture → result)
                if f["is_result"] and not existing_row.is_result:
                    existing_row.home_goals = f["home_goals"]
                    existing_row.home_points = f["home_points"]
                    existing_row.away_goals = f["away_goals"]
                    existing_row.away_points = f["away_points"]
                    existing_row.is_result = True
                    existing_row.scraped_at = datetime.utcnow()
                if f["venue"] and not existing_row.venue:
                    existing_row.venue = f["venue"]
                if f["referee"] and not existing_row.referee:
                    existing_row.referee = f["referee"]
            else:
                new_row = ScrapedFixture(
                    club_id=club_id,
                    home_team=f["home_team"],
                    away_team=f["away_team"],
                    match_date=f["match_date"],
                    competition=f["competition"],
                    venue=f["venue"],
                    referee=f["referee"],
                    home_goals=f["home_goals"],
                    home_points=f["home_points"],
                    away_goals=f["away_goals"],
                    away_points=f["away_points"],
                    is_result=f["is_result"],
                    source_url=BASE_URL,
                    external_hash=ext_hash,
                )
                db.add(new_row)

            if f["is_result"]:
                stats["results_found"] += 1
            else:
                stats["fixtures_found"] += 1

            # Auto-create/update Match records for Dungloe games
            is_dungloe_home = _is_dungloe(f["home_team"])
            is_dungloe_away = _is_dungloe(f["away_team"])
            if is_dungloe_home or is_dungloe_away:
                opponent = f["away_team"] if is_dungloe_home else f["home_team"]
                venue = MatchVenue.HOME if is_dungloe_home else MatchVenue.AWAY

                # Check if Match already exists for this date + opponent
                existing_match = await db.execute(
                    select(Match).where(
                        and_(
                            Match.club_id == club_id,
                            Match.opponent == opponent,
                            Match.is_deleted.is_(False),
                        )
                    ).where(
                        # Same day match
                        Match.match_date >= f["match_date"].replace(hour=0, minute=0, second=0),
                        Match.match_date <= f["match_date"].replace(hour=23, minute=59, second=59),
                    )
                )
                match_row = existing_match.scalar_one_or_none()

                if match_row:
                    # Update with scraped data
                    if f["competition"] and not match_row.competition:
                        match_row.competition = f["competition"]
                    if f["referee"] and not match_row.referee:
                        match_row.referee = f["referee"]
                    if f["is_result"] and match_row.status == MatchStatus.SCHEDULED:
                        if is_dungloe_home:
                            match_row.team_goals = f["home_goals"] or 0
                            match_row.team_points = f["home_points"] or 0
                            match_row.opponent_goals = f["away_goals"] or 0
                            match_row.opponent_points = f["away_points"] or 0
                        else:
                            match_row.team_goals = f["away_goals"] or 0
                            match_row.team_points = f["away_points"] or 0
                            match_row.opponent_goals = f["home_goals"] or 0
                            match_row.opponent_points = f["home_points"] or 0
                        match_row.status = MatchStatus.COMPLETED
                        match_row.completed_at = f["match_date"]
                    stats["matches_updated"] += 1
                else:
                    # Create new Match
                    new_match = Match(
                        club_id=club_id,
                        opponent=opponent,
                        match_date=f["match_date"],
                        venue=venue,
                        competition=f["competition"],
                        referee=f["referee"],
                        status=MatchStatus.COMPLETED if f["is_result"] else MatchStatus.SCHEDULED,
                    )
                    if f["is_result"]:
                        if is_dungloe_home:
                            new_match.team_goals = f["home_goals"] or 0
                            new_match.team_points = f["home_points"] or 0
                            new_match.opponent_goals = f["away_goals"] or 0
                            new_match.opponent_points = f["away_points"] or 0
                        else:
                            new_match.team_goals = f["away_goals"] or 0
                            new_match.team_points = f["away_points"] or 0
                            new_match.opponent_goals = f["home_goals"] or 0
                            new_match.opponent_points = f["home_points"] or 0
                        new_match.completed_at = f["match_date"]
                    db.add(new_match)
                    stats["matches_created"] += 1

        await db.commit()
        logger.info(f"Fixture sync complete: {stats}")
        return stats

    @staticmethod
    async def get_opponent_form(
        db: AsyncSession, opponent: str, club_id: UUID, limit: int = 5
    ) -> list[dict]:
        """
        Get an opponent's recent results from scraped data.
        Returns results from the opponent's perspective (W/L/D).
        """
        normalized = _normalize_team(opponent)

        result = await db.execute(
            select(ScrapedFixture)
            .where(
                and_(
                    ScrapedFixture.club_id == club_id,
                    ScrapedFixture.is_result.is_(True),
                    or_(
                        ScrapedFixture.home_team == normalized,
                        ScrapedFixture.away_team == normalized,
                    ),
                )
            )
            .order_by(ScrapedFixture.match_date.desc())
            .limit(limit)
        )
        rows = result.scalars().all()

        form = []
        for r in rows:
            is_home = r.home_team == normalized
            goals_for = r.home_goals if is_home else r.away_goals
            goals_against = r.away_goals if is_home else r.home_goals
            points_for = r.home_points if is_home else r.away_points
            points_against = r.away_points if is_home else r.home_points

            total_for = (goals_for or 0) * 3 + (points_for or 0)
            total_against = (goals_against or 0) * 3 + (points_against or 0)

            if total_for > total_against:
                result_code = "W"
            elif total_for < total_against:
                result_code = "L"
            else:
                result_code = "D"

            opponent_faced = r.away_team if is_home else r.home_team
            form.append({
                "date": r.match_date.isoformat(),
                "opponent_faced": opponent_faced,
                "score_for": _format_gaa_score(goals_for, points_for),
                "score_against": _format_gaa_score(goals_against, points_against),
                "result": result_code,
                "competition": r.competition,
            })

        return form

    @staticmethod
    async def get_last_meeting(
        db: AsyncSession, opponent: str, club_id: UUID
    ) -> dict | None:
        """
        Get the most recent meeting between Dungloe and a given opponent.
        """
        normalized = _normalize_team(opponent)

        result = await db.execute(
            select(ScrapedFixture)
            .where(
                and_(
                    ScrapedFixture.club_id == club_id,
                    ScrapedFixture.is_result.is_(True),
                    or_(
                        and_(
                            ScrapedFixture.home_team.in_(list(DUNGLOE_NAMES)),
                            ScrapedFixture.away_team == normalized,
                        ),
                        and_(
                            ScrapedFixture.away_team.in_(list(DUNGLOE_NAMES)),
                            ScrapedFixture.home_team == normalized,
                        ),
                    ),
                )
            )
            .order_by(ScrapedFixture.match_date.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if not row:
            return None

        dungloe_home = row.home_team in DUNGLOE_NAMES or _normalize_team(row.home_team) == "Dungloe"
        our_goals = row.home_goals if dungloe_home else row.away_goals
        our_points = row.home_points if dungloe_home else row.away_points
        their_goals = row.away_goals if dungloe_home else row.home_goals
        their_points = row.away_points if dungloe_home else row.home_points

        our_total = (our_goals or 0) * 3 + (our_points or 0)
        their_total = (their_goals or 0) * 3 + (their_points or 0)

        if our_total > their_total:
            result_code = "W"
        elif our_total < their_total:
            result_code = "L"
        else:
            result_code = "D"

        return {
            "date": row.match_date.isoformat(),
            "venue": row.venue,
            "our_score": _format_gaa_score(our_goals, our_points),
            "their_score": _format_gaa_score(their_goals, their_points),
            "result": result_code,
            "competition": row.competition,
        }
