"""
Direction-correct coordinates for server-side analytics and the AI tools.

pitch_x / pitch_y are stored raw (as drawn on screen); see app/utils/attack_direction.py for the
rules. Any analytic that talks about short/long, thirds, "attacking half", channels (left/right) or
distance from goal must read coordinates through `own_frame` (or `side_frame`) — never raw — so the
numbers mean the same thing in every match, in both halves, for both teams.

Typical use:

    dmap = await load_direction_map(db, {e.match_id for e in events})
    for e in events:
        fx, fy = own_frame(e, dmap)          # OUR attacking frame: we attack towards x=100
        if fx is None: continue
        ...                                   # now "own goal is x=0, their goal x=100" is TRUE

`own_frame` is also the right frame for the opposition's events when describing play from OUR
perspective ("they scored from inside our 13m line"). Use `side_frame` for "from the kicker's/shooter's
own perspective" views.
"""
from typing import Dict, Iterable, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.attack_direction import own_attacks_right, side_attacks_right, to_attack_frame

# match_id (as str) -> (attacking_right_first_half, half_duration_mins)
DirectionMap = Dict[str, Tuple[Optional[bool], Optional[int]]]


async def load_direction_map(db: AsyncSession, match_ids: Iterable) -> DirectionMap:
    from app.models.match import Match  # local import: avoid circular imports

    ids = list({m for m in match_ids if m is not None})
    if not ids:
        return {}
    rows = await db.execute(
        select(Match.id, Match.attacking_right_first_half, Match.half_duration_mins).where(Match.id.in_(ids))
    )
    return {str(r[0]): (r[1], r[2]) for r in rows.all()}


def own_frame_x_sql(event_model, match_model):
    """SQL expression for an event's x in OUR attacking frame (we attack towards x=100).

    For queries that filter/aggregate in the database. The query MUST join `match_model` on
    match_id. Mirrors utils.attack_direction.own_attacks_right: an explicit `half` wins, else the
    minute vs half length; unrecorded direction defaults to "attacked right in the first half".
    """
    from sqlalchemy import case, func, not_

    base = func.coalesce(match_model.attacking_right_first_half, True)
    is_first = case(
        (event_model.half.isnot(None), event_model.half == 1),
        else_=(func.coalesce(event_model.minute, 0) < func.coalesce(match_model.half_duration_mins, 30)),
    )
    own_right = case((is_first, base), else_=not_(base))
    return case((own_right, event_model.pitch_x), else_=100 - event_model.pitch_x)


def _own_right(e, dmap: DirectionMap) -> bool:
    atk_first, hdm = dmap.get(str(getattr(e, "match_id", None)), (None, None))
    return own_attacks_right(atk_first, getattr(e, "half", None), getattr(e, "minute", None), hdm)


def own_frame(e, dmap: DirectionMap, x_attr: str = "pitch_x", y_attr: str = "pitch_y"):
    """(x, y) of event `e` in OUR attacking frame (we attack towards x=100), or (None, None)."""
    x, y = getattr(e, x_attr, None), getattr(e, y_attr, None)
    if x is None or y is None:
        return None, None
    return to_attack_frame(float(x), float(y), _own_right(e, dmap))


def side_frame(e, dmap: DirectionMap, is_own: bool, x_attr: str = "pitch_x", y_attr: str = "pitch_y"):
    """(x, y) of event `e` in the attack frame of the given side (that side attacks towards x=100)."""
    x, y = getattr(e, x_attr, None), getattr(e, y_attr, None)
    if x is None or y is None:
        return None, None
    return to_attack_frame(float(x), float(y), side_attacks_right(is_own, _own_right(e, dmap)))
