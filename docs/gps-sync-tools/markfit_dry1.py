import asyncio
import numpy as np
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.match import Match
from app.models.match_gps_track import MatchGPSSync
from app.services.gps_timeseries import service as svc

CLUB = "74a08940-6066-40dc-8bcf-6fd3e1ed3dad"
STEP = 100
REACT_MS = 1000


def team_mean(tracks, pids, ts):
    rows = []
    for pid in pids:
        tr = tracks[pid]
        idx = tr.index_for_ms(ts)
        v = np.full(ts.shape, np.nan)
        ok = idx >= 0
        v[ok] = tr.speed[idx[ok]]
        rows.append(v)
    return np.nanmean(np.vstack(rows), axis=0)


def burst(tracks, pids, g_center, half_win=20000, w=10):
    ts = np.arange(g_center - half_win, g_center + half_win, STEP, dtype=np.float64)
    m = team_mean(tracks, pids, ts)
    cs = np.concatenate([[0], np.cumsum(np.nan_to_num(m))])
    best, bt = -9, None
    for i in range(w, len(m) - w):
        j = (cs[i + w] - cs[i]) / w - (cs[i] - cs[i - w]) / w
        if j > best:
            best, bt = j, ts[i]
    return bt, best


async def main():
    async with AsyncSessionLocal() as db:
        ms = (await db.execute(select(Match).where(Match.club_id == CLUB, Match.opponent.in_(["Down", "Cork", "Kerry", "Dublin"])).order_by(Match.match_date))).scalars().all()
        for m in ms:
            s = await db.get(MatchGPSSync, m.id)
            if not s or not s.periods:
                continue
            session, carries, events, starters, starts, ends = await svc._tagged_inputs(db, m)
            loaded = await svc.load_tracks(db, m.id)
            tracks = {str(r.player_id): t for r, t in loaded}
            pids = [p for p in starters if p in tracks]
            print("==", m.opponent, str(m.match_date)[:10])
            for p in sorted(s.periods, key=lambda p: p["video_start_ms"]):
                rate = float(p.get("rate") or 1.0); off = float(p["offset_ms"]); mark = float(p["video_start_ms"])
                cur_at_mark = mark * rate + off
                gb, jump = burst(tracks, pids, cur_at_mark)
                new_off = (gb - REACT_MS) - mark          # rate 1.0: GPS time = video time + offset
                shift = (new_off + mark) - cur_at_mark    # change in GPS time shown at the mark (+ = GPS later than now)
                end = ends.get(p["half"])
                drift_note = ""
                if end:
                    cur_end = end * rate + off; new_end = end + new_off
                    drift_note = f" ; at the half's end mark the new mapping differs from the stored one by {(new_end - cur_end)/1000:+.1f}s"
                print(f"  half {p['half']}: burst {(gb-cur_at_mark)/1000:+.1f}s from the mark under the stored sync (jump {jump:.2f}); proposed shift at the mark {shift/1000:+.1f}s (stored rate {rate:.5f}){drift_note}")


asyncio.run(main())
