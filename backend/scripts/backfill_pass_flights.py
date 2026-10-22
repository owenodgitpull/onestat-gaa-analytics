"""Pass flights from the BALL TIMELINE (possession_events: video_ms + pitch_x/y). DRY RUN unless APPLY=1; BACKUP=1 prints BK lines."""
import asyncio, json, os, statistics
from sqlalchemy import select, text
from sqlalchemy.orm import lazyload
from app.database import async_session_maker
from app.models.ball_carrier_segment import BallCarrierSegment
from app.models.video_event import VideoEvent
from app.models.video_session import VideoSession
from app.models.match import Match
from app.routes import video_moves as vm
from app.services.video import live_sync
from app.utils.pitch_calibration import DEFAULT_LENGTH_M, DEFAULT_WIDTH_M, distance_m

APPLY = os.environ.get("APPLY") == "1"
BACKUP = os.environ.get("BACKUP") == "1"
MIN_JUMP_M = float(os.environ.get("MIN_JUMP_M", "6"))
MAX_DT_MS = 1600


def mmss(ms):
    s = int((ms or 0) / 1000)
    return f"{s//60}:{s%60:02d}"


def find_jump(ticks, t0, t1, L, W):
    """Biggest ball move between two neighbouring ticks inside [t0, t1] that happened quickly (a tap, not a drag)."""
    best = None
    prev = None
    for ms, x, y in ticks:
        if ms < t0:
            prev = (ms, x, y)
            continue
        if ms > t1:
            break
        if prev is not None and (x, y) != (prev[1], prev[2]) and ms - prev[0] <= MAX_DT_MS:
            d = distance_m((prev[1], prev[2]), (x, y), L, W)
            if d >= MIN_JUMP_M and (best is None or d > best[0]):
                best = (d, (prev[1], prev[2]), (x, y))
        prev = (ms, x, y)
    return best


def med(x):
    return f"{statistics.median(x):.1f}m (90%: {sorted(x)[int(len(x)*.9)]:.1f}m)" if x else "-"


async def main():
    async with async_session_maker() as db:
        ids = [r[0] for r in (await db.execute(text(
            "select m.id from matches m where (select count(*) from ball_carrier_segments s where s.match_id=m.id)>400 "
            "order by (select min(created_at) from video_events v where v.match_id=m.id)"))).all()]
        tot_n = 0; tot_m = 0.0
        for mid in ids:
            match = await db.get(Match, mid)
            L = float(match.pitch_length_m) if getattr(match, "pitch_length_m", None) else DEFAULT_LENGTH_M
            W = float(match.pitch_width_m) if getattr(match, "pitch_width_m", None) else DEFAULT_WIDTH_M
            sess = (await db.execute(select(VideoSession).where(VideoSession.match_id == mid).options(lazyload("*")))).scalars().first()
            ticks = [(int(r[0]), float(r[1]), float(r[2])) for r in (await db.execute(text(
                "select video_ms,pitch_x,pitch_y from possession_events where match_id=:m and video_ms is not null and pitch_x is not null order by video_ms, created_at"), {"m": mid})).all()]
            segs = list((await db.execute(select(BallCarrierSegment).where(BallCarrierSegment.match_id == mid).options(lazyload("*"))
                         .order_by(BallCarrierSegment.sequence_number.asc(), BallCarrierSegment.video_timestamp_ms.asc()))).scalars().all())
            events = list((await db.execute(select(VideoEvent).where(VideoEvent.video_session_id == sess.id, VideoEvent.event_type == "PASS_HAND")
                          .options(lazyload("*")))).scalars().all())
            ends_ok = n = ev_found = ev_missing = trimmed_stored = 0
            metres = 0.0
            e_o = []; e_d = []
            for i, seg in enumerate(segs):
                if seg.ended_by != "pass" or seg.end_x is None or seg.video_timestamp_ms is None or i + 1 >= len(segs):
                    continue
                nxt = segs[i + 1]
                if nxt.team != seg.team or nxt.video_timestamp_ms is None:
                    continue
                t_end = seg.end_video_ms or nxt.video_timestamp_ms
                j = find_jump(ticks, t_end - 2500, nxt.video_timestamp_ms + 700, L, W)
                if not j:
                    continue
                d, origin, dest = j
                pe = vm._pick_pass(events, seg, nxt)
                at_origin = distance_m((seg.end_x, seg.end_y), origin, L, W) <= 2.0
                if pe is not None and pe.end_x is not None:
                    if pe.pitch_x is not None:
                        e_o.append(distance_m((pe.pitch_x, pe.pitch_y), origin, L, W))
                    e_d.append(distance_m((pe.end_x, pe.end_y), dest, L, W))
                if at_origin:
                    ends_ok += 1
                    continue
                n += 1
                metres += d
                have_ev = pe is not None
                if have_ev and pe.end_x is None:
                    ev_found += 1
                elif not have_ev:
                    ev_missing += 1
                else:
                    trimmed_stored += 1
                if BACKUP:
                    print("BK " + json.dumps({"match": str(mid), "seg": str(seg.id), "end_x": seg.end_x, "end_y": seg.end_y,
                          "event": str(pe.id) if (pe is not None and pe.end_x is None) else None,
                          "pitch_x": pe.pitch_x if pe is not None else None, "pitch_y": pe.pitch_y if pe is not None else None,
                          "ev_end_x": pe.end_x if pe is not None else None, "ev_end_y": pe.end_y if pe is not None else None,
                          "scoring_context": pe.scoring_context if pe is not None else None}))
                if APPLY:
                    seg.end_x, seg.end_y = origin
                    if pe is not None and pe.end_x is None:
                        pe.pitch_x, pe.pitch_y = origin
                        pe.end_x, pe.end_y = dest
                        sc = dict(pe.scoring_context or {})
                        sc["pass_flight_estimated"] = True
                        pe.scoring_context = sc
                        await live_sync.write_through(db, pe)
            print(f"{match.opponent}: ball ticks {len(ticks)}; carries already ending at the pass origin: {ends_ok}; carries still holding a pass flight: {n} ({metres:.0f} m); "
                  f"pass event to fill {ev_found}, event already stored {trimmed_stored}, no event {ev_missing}")
            print(f"   CHECK vs the app's own saved from/to ({len(e_d)} passes): origin off by median {med(e_o)}; destination off by median {med(e_d)}")
            tot_n += n; tot_m += metres
        if APPLY:
            await db.commit()
            print("APPLIED")
        else:
            print("DRY RUN (nothing changed)")
        print("TOTAL carries to trim:", tot_n, "metres:", round(tot_m))

asyncio.run(main())
