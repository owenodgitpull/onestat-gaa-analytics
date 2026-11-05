"""Ingest a folder of STATSports RawDataExtended CSVs for one match, then run the video sync.

Uses the same service functions as the API (parser -> codec -> match_gps_tracks -> sync), so running it is an
end-to-end test of the plumbing minus the HTTP layer. Run with DATABASE_URL pointing at the database you mean.

    python scripts/ingest_gps_timeseries.py <match_id> "<folder with the per-player csvs>" [--no-sync] [--dry-run]

Files whose device name cannot be matched to a player are reported and skipped (never guessed).
"""
from __future__ import annotations

import asyncio
import glob
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import async_session_maker  # noqa: E402
from app.models.match import Match  # noqa: E402
from app.services.gps_timeseries import parser, service  # noqa: E402
from app.services.gps_timeseries.names import match_device_name  # noqa: E402


async def main(match_id: str, folder: str, do_sync: bool, dry_run: bool):
    files = sorted(glob.glob(os.path.join(folder, "*.csv")))
    if not files:
        print("no csv files in", folder); return
    async with async_session_maker() as db:
        match = (await db.execute(select(Match).where(Match.id == match_id))).scalar_one()
        mdate: date = match.match_date.date() if hasattr(match.match_date, "date") else match.match_date
        print(f"match {match.opponent} {mdate} club {match.club_id}: {len(files)} files")
        players = await service.club_players(db, match.club_id)
        n_ok = 0
        for f in files:
            fdate = parser.file_date_from_name(os.path.basename(f))
            if fdate and fdate != mdate:
                print(f"  SKIP {os.path.basename(f)}: file date {fdate} is not the match date {mdate}"); continue
            t = time.time()
            with open(f, encoding="utf-8", errors="replace", newline="") as fh:
                try:
                    pf = parser.parse_timeseries(fh, mdate)
                except ValueError as e:
                    print(f"  FAIL {os.path.basename(f)}: {e}"); continue
            player, how = match_device_name(pf.device_name, players)
            if player is None:
                print(f"  UNMATCHED '{pf.device_name}' ({how}) in {os.path.basename(f)}"); continue
            stats = service.track_stats(pf.track, pf.n_rows, pf.n_fixes, pf.n_bad)
            msg = (f"  {pf.device_name:16s} -> {player.name:24s} ({how:17s}) fixes {pf.n_fixes:6d} bad {pf.n_bad:6d} "
                   f"dense {pf.track.n:6d} ({stats['duration_min']:5.1f} min) {time.time()-t:4.1f}s")
            if not dry_run:
                row = await service.upsert_track(db, match, player.id, pf.track, pf.device_name, os.path.basename(f), stats)
                msg += f" blob {len(row.blob)//1024} KB"
            print(msg, flush=True); n_ok += 1
        if dry_run:
            print("dry run: nothing written"); return
        await db.commit()
        print(f"stored {n_ok} tracks")
        if do_sync:
            t = time.time()
            row = await service.run_sync(db, match, log=lambda m: print("   ", m))
            await db.commit()
            print(f"sync status {row.status} in {time.time()-t:.1f}s" + (f": {row.error}" if row.error else ""))
            for p in row.periods or []:
                print(f"  period {p['half']}: offset {p['offset_ms']/1000:.1f} s rate {p['rate']:.6f} residual {p['median_residual_m']} m (p75 {p['p75_residual_m']}) n {p['n_carries']} anchors {len(p['anchors'])} spread {p['implied_offset_spread_s']} s")
            for k, v in sorted((row.tag_lag or {}).items(), key=lambda kv: -kv[1]["n"]):
                print(f"  lag {k:34s} n={v['n']:3d} median {v['median_s']:+.1f}s (p25 {v['p25_s']:+.1f} p75 {v['p75_s']:+.1f})")
            notin = [pid for pid, q in (row.quality or {}).items() if not q["in_match"]]
            print(f"  tracks not in the match window: {len(notin)}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    asyncio.run(main(args[0], args[1], "--no-sync" not in sys.argv, "--dry-run" in sys.argv))
