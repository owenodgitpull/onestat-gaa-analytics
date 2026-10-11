"""
Lineup timeline - who played WHERE, and WHEN. Pure functions (no DB, no LLM) plus one loader.

A player's position is not one value for the match: a midfielder swaps with a half forward at 40', a sub takes a slot
at 34'. This builds each player's spells (position + the time they held it) from three things the app already records:

  * the lineup            (match_lineups: starter/bench + the position_id the player holds NOW)
  * substitution events   (who came on / went off, and when)
  * position moves        (match_position_changes: from/to + when)

so a starter's first position is the `from` of his first move (the lineup row has been updated to where he is now),
and no extra rows are needed for starts or subs. Events are then attributed to the position held at that minute, and
each personnel move is given a before/after so the agents can judge whether it worked.

Time is (half, seconds) - seconds from the match clock where recorded, else minute*60 - so first-half added time
(minute 34 of half 1) never collides with the second half's 30-34.
"""
from dataclasses import dataclass, field
from typing import Iterable, Optional

from app.services.ai.phase_facts import SCORE_TYPES, points_for

POSITION_LABEL = {
    'gk': 'goalkeeper',
    'fb-left': 'left corner back', 'fb-center': 'full back', 'fb-right': 'right corner back',
    'hb-left': 'left half back', 'hb-center': 'centre half back', 'hb-right': 'right half back',
    'mf-left': 'midfield', 'mf-right': 'midfield',   # GAA has no left/right midfield - just midfield
    'hf-left': 'left half forward', 'hf-center': 'centre half forward', 'hf-right': 'right half forward',
    'ff-left': 'left corner forward', 'ff-center': 'full forward', 'ff-right': 'right corner forward',
}
POSITION_CATEGORY = {
    'gk': 'goalkeeper',
    'fb-left': 'defender', 'fb-center': 'defender', 'fb-right': 'defender',
    'hb-left': 'defender', 'hb-center': 'defender', 'hb-right': 'defender',
    'mf-left': 'midfielder', 'mf-right': 'midfielder',
    'hf-left': 'forward', 'hf-center': 'forward', 'hf-right': 'forward',
    'ff-left': 'forward', 'ff-center': 'forward', 'ff-right': 'forward',
}

WINDOW_MINUTES = 10   # how far either side of a move is compared

Time = tuple  # (half, seconds)


def label(position_id: Optional[str]) -> str:
    return POSITION_LABEL.get(position_id or "", position_id or "unknown position")


def stamp(half: Optional[int], minute: Optional[int], clock_s: Optional[int]) -> Time:
    return (half or 1, clock_s if clock_s is not None else (minute or 0) * 60)


@dataclass
class Spell:
    player_id: str
    position_id: str
    start: Time
    end: Optional[Time] = None        # None = still there at the end of the data
    via: str = "start"                # start | sub_on | move

    def contains(self, t: Time) -> bool:
        return self.start <= t and (self.end is None or t < self.end)


@dataclass
class Sub:
    off_id: str
    on_id: str
    half: int
    minute: int
    clock_s: Optional[int] = None

    @property
    def t(self) -> Time:
        return stamp(self.half, self.minute, self.clock_s)


@dataclass
class Move:
    player_id: str
    from_pos: str
    to_pos: str
    half: int
    minute: int
    clock_s: Optional[int] = None

    @property
    def t(self) -> Time:
        return stamp(self.half, self.minute, self.clock_s)


def build_spells(lineup: Iterable[tuple], subs: list, moves: list) -> dict:
    """lineup rows: (player_id, position_id, is_substitute). Returns player_id -> chronological, non-empty spells."""
    out: dict = {}
    ordered_subs = sorted(subs, key=lambda s: s.t)
    for pid, pos, is_sub in lineup:
        pid = str(pid)
        my_moves = sorted((m for m in moves if str(m.player_id) == pid), key=lambda m: m.t)
        entry_pos = my_moves[0].from_pos if my_moves else pos
        if is_sub:
            on = next((s for s in ordered_subs if str(s.on_id) == pid), None)
            if on is None:
                continue                       # never came on
            begin, via = on.t, "sub_on"
        else:
            begin, via = (1, 0), "start"
        off = next((s for s in ordered_subs if str(s.off_id) == pid and s.t >= begin), None)
        exit_t = off.t if off else None

        spells = []
        cur_pos, cur_start, cur_via = entry_pos, begin, via
        for m in my_moves:
            if exit_t is not None and m.t >= exit_t:
                break
            if m.t > cur_start:
                spells.append(Spell(pid, cur_pos, cur_start, m.t, cur_via))
            # a move at the very instant of entry simply replaces the entry position
            cur_pos, cur_start, cur_via = m.to_pos, max(m.t, cur_start), "move"
        spells.append(Spell(pid, cur_pos, cur_start, exit_t, cur_via))
        out[pid] = [s for s in spells if s.end is None or s.end > s.start]
    return out


def position_at(spells: list, t: Time) -> Optional[str]:
    """The position held at time t; before the first spell or after the last, the nearest one."""
    if not spells:
        return None
    for s in spells:
        if s.contains(t):
            return s.position_id
    return spells[0].position_id if t < spells[0].start else spells[-1].position_id


def moved_players(spells: dict) -> dict:
    """Players who held more than one position (a swap, or a sub who later changed slot)."""
    # compared by name: left and right midfield are both just "midfield", so swapping them is not a move
    return {pid: sp for pid, sp in spells.items() if len({label(s.position_id) for s in sp}) > 1}


# -- stats by position spell ----------------------------------------------------------------------

def _bucket(event_type: str) -> Optional[str]:
    if event_type in ("goal", "penalty_goal"):
        return "goals"
    if event_type in ("point", "point_free", "forty_five", "two_point", "two_point_free"):
        return "scores"
    if event_type in ("wide", "wide_free", "short", "saved", "hit_post", "forty_five_missed"):
        return "wides"
    if event_type in ("turnover_won", "interception", "tackle_won", "block"):
        return "turnovers_won"
    if event_type == "turnover_lost":
        return "turnovers_lost"
    if event_type == "unforced_error":
        return "unforced_errors"
    if event_type in ("foul_committed", "free_conceded"):
        return "fouls_conceded"
    if event_type == "free_won":
        return "frees_won"
    return None


def stats_by_spell(spells: dict, events: Iterable[dict]) -> dict:
    """events: dicts with player_id, event_type, half, minute, clock_s (our team only).
    Returns player_id -> [{position_id, spell, counts}] one row per spell, in order."""
    result = {pid: [{"position_id": s.position_id, "spell": s, "counts": {}} for s in sp] for pid, sp in spells.items() if sp}
    for e in events:
        pid = str(e.get("player_id") or "")
        if pid not in result:
            continue
        b = _bucket(e["event_type"])
        if b is None:
            continue
        t = stamp(e.get("half"), e.get("minute"), e.get("clock_s"))
        rows = result[pid]
        row = next((r for r in rows if r["spell"].contains(t)), None)
        if row is None:   # outside every spell (e.g. logged before the recorded entry): the nearest one
            row = rows[0] if t < rows[0]["spell"].start else rows[-1]
        row["counts"][b] = row["counts"].get(b, 0) + 1
    return result


# -- personnel moves with a before / after ---------------------------------------------------------

def _score_line(evs: list, own: bool) -> tuple:
    pts = n = 0
    for e in evs:
        if e["own"] == own and e["event_type"] in SCORE_TYPES:
            pts += points_for(e["event_type"])
            n += 1
    return pts, n


def personnel_log(subs: list, moves: list, events: list, names: dict, window: int = WINDOW_MINUTES) -> list:
    """Chronological list of every personnel change with the scoring either side of it (same half, `window` minutes,
    cut short by the next change or the end of the data). `events` carry own(bool), event_type, half, minute."""
    items = []
    for s in subs:
        items.append((s.t, s.half, s.minute, "substitution",
                      f"{names.get(str(s.on_id), 'a substitute')} on for {names.get(str(s.off_id), 'a player')}"))
    # a swap is two Move rows at the same instant: report it once
    by_instant: dict = {}
    for m in moves:
        by_instant.setdefault((m.half, m.minute, m.t), []).append(m)
    for (half, minute, t), group in by_instant.items():
        if all(label(m.from_pos) == label(m.to_pos) for m in group):
            continue                      # e.g. the two midfielders swapping - not a change worth reporting
        parts = [f"{names.get(str(m.player_id), 'a player')}: {label(m.from_pos)} to {label(m.to_pos)}" for m in group]
        items.append((t, half, minute, "position_move", "; ".join(parts)))
    items.sort(key=lambda x: x[0])

    out = []
    for i, (t, half, minute, kind, text) in enumerate(items):
        same_half = [e for e in events if (e.get("half") or 1) == half]
        last_in_half = max((e["minute"] for e in same_half), default=minute)
        later = [e for e in events if (e.get("half") or 1) > half]
        # A change logged at the very end of a half (nothing played after it in that half) is a half-time change: its
        # "after" is the start of the NEXT half, not the added time that happened to follow it.
        at_break = bool(later) and minute >= last_in_half
        before = [e for e in same_half if minute - window <= e["minute"] < minute]
        if at_break:
            next_half = min((e.get("half") or 1) for e in later)
            pool = [e for e in later if (e.get("half") or 1) == next_half]
            start = min(e["minute"] for e in pool)
            nxt = next((x for x in items[i + 1:] if x[1] == next_half and x[2] > start), None)
            after_end = min(start + window, nxt[2]) if nxt else start + window
            after = [e for e in pool if start <= e["minute"] < after_end]
            last_minute = max(e["minute"] for e in pool)
            after_len = max(0, min(after_end, last_minute + 1) - start)
        else:
            nxt = next((x for x in items[i + 1:] if x[1] == half and x[2] > minute), None)
            after_end = min(minute + window, nxt[2]) if nxt else minute + window
            after = [e for e in same_half if minute <= e["minute"] < after_end]
            after_len = max(0, min(after_end, last_in_half + 1) - minute)
        bu, bun = _score_line(before, True)
        bt, btn = _score_line(before, False)
        au, aun = _score_line(after, True)
        at_, atn = _score_line(after, False)
        row = {
            "half": half, "minute": minute, "kind": kind, "what": text,
            **({"timing": "made at half time - 'after' is the start of the second half"} if at_break else {}),
            "minutes_before_compared": window,
            "before": {"our_points": bu, "our_scores": bun, "their_points": bt, "their_scores": btn},
            "minutes_after_compared": after_len,
            "after": {"our_points": au, "our_scores": aun, "their_points": at_, "their_scores": atn},
        }
        if after_len < 5:
            row["caution"] = f"only {after_len} minute(s) of play recorded after this change - too early to judge"
        out.append(row)
    return out


# -- description for the agents --------------------------------------------------------------------

def _minute_of(t: Time) -> int:
    return t[1] // 60


def describe_personnel(tl: "Timeline", events: list) -> dict:
    """The agents' view: each player who held more than one position (with their stats in each), plus the
    chronological personnel log with before/after scoring. Empty when nothing changed."""
    moved = moved_players(tl.spells)
    log = personnel_log(tl.subs, tl.moves, events, tl.names)
    if not moved and not log:
        return {}
    own_events = [e for e in events if e.get("own") and e.get("player_id")]
    by_spell = stats_by_spell(moved, own_events) if moved else {}
    players = []
    for pid, rows in by_spell.items():
        players.append({
            "player": tl.names.get(pid, "Unknown"),
            "positions": [{
                "position": label(r["position_id"]),
                "category": POSITION_CATEGORY.get(r["position_id"], "unknown"),
                "from_minute": _minute_of(r["spell"].start),
                "to_minute": _minute_of(r["spell"].end) if r["spell"].end else None,
                **({"stats": r["counts"]} if r["counts"] else {"stats": "no events logged in this spell"}),
            } for r in rows],
        })
    return {
        "how_to_read": ("Each player's events are attributed to the position they held at that minute. to_minute null = still "
                        "there at the end of the data. The log gives the scoring in the same half in the minutes before and "
                        "after each change (cut short by the next change or the end of the data); a row with a caution is too "
                        "early to judge. State what happened either side; do not claim a move caused the result unless the "
                        "numbers clearly moved and say how small the sample is."),
        "players_who_changed_position": players,
        "personnel_log": log,
    }


# -- loader ---------------------------------------------------------------------------------------

@dataclass
class Timeline:
    spells: dict = field(default_factory=dict)       # player_id -> [Spell]
    subs: list = field(default_factory=list)
    moves: list = field(default_factory=list)
    names: dict = field(default_factory=dict)        # player_id -> name


async def load_timeline(db, match_id) -> Timeline:
    from sqlalchemy import select
    from app.models.match_event import MatchEvent
    from app.models.match_lineup import MatchLineup
    from app.models.match_position_change import MatchPositionChange
    from app.models.player import Player

    lineup_rows = (await db.execute(
        select(MatchLineup.player_id, MatchLineup.position_id, MatchLineup.is_substitute, Player.name)
        .join(Player, Player.id == MatchLineup.player_id)
        .where(MatchLineup.match_id == match_id)
    )).all()
    sub_rows = (await db.execute(
        select(MatchEvent.player_id, MatchEvent.sub_in_player_id, MatchEvent.half, MatchEvent.minute, MatchEvent.match_clock_s)
        .where(MatchEvent.match_id == match_id, MatchEvent.event_type == "substitution",
               MatchEvent.sub_in_player_id.isnot(None), MatchEvent.player_id.isnot(None))
    )).all()
    move_rows = (await db.execute(
        select(MatchPositionChange).where(MatchPositionChange.match_id == match_id)
    )).scalars().all()

    subs = [Sub(str(r[0]), str(r[1]), r[2] or 1, r[3] or 0, r[4]) for r in sub_rows]
    moves = [Move(str(m.player_id), m.from_position_id, m.to_position_id, m.half, m.minute, m.match_clock_s) for m in move_rows]
    tl = Timeline(subs=subs, moves=moves, names={str(r[0]): r[3] for r in lineup_rows})
    tl.spells = build_spells([(r[0], r[1], r[2]) for r in lineup_rows], subs, moves)
    return tl
