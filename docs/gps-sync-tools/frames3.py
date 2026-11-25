import asyncio, subprocess, sys, json
import numpy as np
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.match import Match
from app.models.match_gps_track import MatchGPSSync
from app.models.match_lineup import MatchLineup
from app.models.player import Player
from app.models.video_session import VideoSession
from app.services.video.video_splitter import _find_ffmpeg
from app.services.storage_service import storage
from app.services.gps_timeseries import service as svc, geo
from app.services.gps_timeseries.clock import video_to_gps_ms

CLUB = "74a08940-6066-40dc-8bcf-6fd3e1ed3dad"
OPP = sys.argv[1]
HALVES = [int(x) for x in sys.argv[2].split(",")]
FIXED = [int(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else None


async def main():
    ff = _find_ffmpeg()
    async with AsyncSessionLocal() as db:
        m = (await db.execute(select(Match).where(Match.club_id == CLUB, Match.opponent == OPP).order_by(Match.match_date.desc()))).scalars().first()
        s = await db.get(MatchGPSSync, m.id)
        vs = (await db.execute(select(VideoSession).where(VideoSession.match_id == m.id).order_by(VideoSession.created_at.desc()))).scalars().first()
        url = storage.get_download_url(vs.video_r2_key, expires_in=3000, club_id=str(m.club_id))
        loaded = await svc.load_tracks(db, m.id)
        lu = (await db.execute(select(MatchLineup, Player).join(Player, Player.id == MatchLineup.player_id).where(MatchLineup.match_id == m.id))).all()
        jers = {str(l.player_id): (l.jersey_number or p.jersey_number) for l, p in lu}
        cal = s.calibration; L = float(cal["pitch_length_m"]); W = float(cal["pitch_width_m"])
        trs = {jers.get(str(r.player_id)): tr for r, tr in loaded}
        print("match", m.id, str(m.match_date)[:10], "L", L, "W", W, "arfh", m.attacking_right_first_half, flush=True)

        def pos(t_s):
            g = video_to_gps_ms(s.periods, t_s * 1000.0)
            out = {}
            for j, tr in trs.items():
                i = tr.index_for_ms(np.array([g]))[0]
                if i < 0:
                    continue
                u, v = geo.latlon_to_uv(np.array([tr.lat[i]]), np.array([tr.lon[i]]), cal)
                u = float(u[0]); v = float(v[0])
                if abs(u) > L / 2 + 2 or abs(v) > W / 2 + 1:
                    continue
                out[j] = (round(u, 1), round(v, 1), round(float(tr.speed[i]), 1))
            return out

        picks = []
        if FIXED:
            picks = FIXED
        else:
            for p in sorted(s.periods, key=lambda p: p["video_start_ms"]):
                if p["half"] not in HALVES:
                    continue
                st = int(p["video_start_ms"] / 1000)
                cand = []
                for t in range(st + 120, st + 1700, 2):
                    pp = pos(float(t))
                    fast = [(u, v) for u, v, sp in pp.values() if sp >= 4.5]
                    if len(fast) < 6:
                        continue
                    us = np.array([u for u, v in fast])
                    # play near one end (lines to measure from): most of the fast ones within 55 m of the same end line
                    for sign in (1, -1):
                        if np.sum(sign * us > L / 2 - 55) >= 5:
                            cand.append((len(fast), t))
                            break
                cand.sort(reverse=True)
                got = []
                for n, t in cand:
                    if all(abs(t - g) > 150 for g in got):
                        got.append(t)
                    if len(got) >= 3:
                        break
                picks += sorted(got)
        print("picked", picks, flush=True)
        res = {"L": L, "W": W, "frames": {}}
        for t in picks:
            out = f"/tmp/kh_{OPP}_{t}.jpg"
            subprocess.run([ff, "-v", "error", "-y", "-ss", str(t), "-i", url, "-frames:v", "1", "-q:v", "3", out], timeout=120)
            res["frames"][str(t)] = {str(dt): pos(t + dt) for dt in np.arange(-6, 6.01, 0.25)}
            p0 = pos(float(t))
            print(f"video {t}s ({t//60}:{t%60:02d}) u/v/speed:", "  ".join(f"#{j}:{u:.0f}/{v:+.0f}/{sp:.1f}" for j, (u, v, sp) in sorted(p0.items())), flush=True)
        json.dump(res, open(f"/tmp/kh_{OPP}.json", "w"))


asyncio.run(main())
