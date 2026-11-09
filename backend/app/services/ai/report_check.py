"""Numbers check on a finished post-match report, in code (not the model).

A reviewer found the same kinds of error coming back report after report: parts that do not add up to the total quoted
beside them, a margin that does not match the scoreline in brackets, a count of opposition scores that is not their real
total, a superlative that is not true, a pass link quoted the wrong way round, field names leaking, minutes without a period
or with added time written as a later minute. Prompt rules alone have not stopped them, so the finished text is checked
against the tool data here.

check_report() returns (text, fixed, issues):
  - fixed: deterministic repairs already applied (added-time labels, field-name leaks)
  - issues: each a dict {"quote": exact text from the report, "problem": what is wrong, "truth": the right figure} for the
    caller to repair (one short model pass that may only change those quotes) or to log.
"""
from __future__ import annotations

import json
import re
from typing import List, Optional, Tuple

from app.services.ai.phase_facts import period_bounds

PERIOD_RE = r"(1st half|2nd half|extra time 1|extra time 2)"

FIELD_NAMES = {
    "impact_points": "impact score",
}


def _sentences(text: str) -> List[str]:
    out = []
    for line in text.split("\n"):
        if line.startswith("|"):
            continue                       # tables are computed, not written
        out.extend(s for s in re.split(r"(?<=[.!?])\s+", line) if s.strip())
    return out


def _gaa_total(g: str, p: str) -> int:
    return int(g) * 3 + int(p)


def _surname(name: str) -> str:
    name = re.sub(r"\(c\)", "", name or "").strip()
    return name.split(" ")[-1].lower() if name else ""


def fix_added_time(text: str, hdm: int) -> Tuple[str, List[str]]:
    """'extra time 1 81'' -> 'extra time 1 80+1''; the tools now write it this way, this catches a model that did not."""
    fixed = []

    def sub(m):
        word, minute = m.group(1), int(m.group(2))
        half = {"1st half": 1, "2nd half": 2, "extra time 1": 3, "extra time 2": 4}[word.lower()]
        end = period_bounds(half, hdm)[1]
        if minute > end:
            new = f"{word} {end}+{minute - end}'"
            fixed.append(f"{m.group(0)} -> {new}")
            return new
        return m.group(0)

    return re.sub(PERIOD_RE + r" (\d{1,3})'", sub, text, flags=re.IGNORECASE), fixed


def fix_field_names(text: str) -> Tuple[str, List[str]]:
    fixed = []
    for raw, plain in FIELD_NAMES.items():
        if raw in text:
            text = text.replace(f"his {raw}", f"his {plain}").replace(raw, plain)
            fixed.append(f"{raw} -> {plain}")
    for pat in (r"By the tool'?s count,?\s*", r"\s*\(?per the ball-carrier data\)?", r"\s*as per the log"):
        if re.search(pat, text, flags=re.IGNORECASE):
            text = re.sub(pat, " " if pat.startswith(r"\s") else "", text, flags=re.IGNORECASE)
            fixed.append(f"removed '{pat}'")
    text = re.sub(r"  +", " ", text)
    return text, fixed


def find_issues(text: str, facts: dict) -> List[dict]:
    issues: List[dict] = []
    opp = (facts.get("opponent") or "").strip()
    opp_words = [w for w in {opp.lower(), "their", "they", "opposition"} if w]
    hdm = facts.get("half_duration_mins") or 30

    for s in _sentences(text):
        low = s.lower()

        # 1. missed shots total and its parts
        for m in re.finditer(r"(\d+) missed shots", low):
            n = int(m.group(1))
            head = low[:m.start()]
            # whose shots: "of ours" (our players near THEIR shot) means theirs; only check when the sentence is clear
            theirs = "of ours" in low or (any(w in head for w in opp_words) and "we " not in head)
            ours = not theirs and bool(re.search(r"\b(we|our)\b", head.replace("of ours", "")))
            if not (theirs or ours):
                continue
            truth = facts.get("opp_missed_total" if theirs else "our_missed_total")
            if truth is not None and n != truth:
                issues.append({"quote": s, "problem": f"says {n} missed shots", "truth": f"{truth} missed shots in all ({facts.get('opp_missed_parts' if theirs else 'our_missed_parts')})"})
        parts = re.findall(r"(\d+) (wides?|shorts?|hit posts?|saves?|missed 45s?|missed penalt(?:y|ies))", low)
        tot = re.search(r"(\d+) (?:missed shots|in all|in total)", low)
        if len(parts) >= 3 and tot and sum(int(p[0]) for p in parts) != int(tot.group(1)):
            issues.append({"quote": s, "problem": f"the parts add to {sum(int(p[0]) for p in parts)}, not {tot.group(1)}",
                           "truth": facts.get("our_missed_parts", "")})

        # 2. a margin beside a scoreline in brackets
        for m in re.finditer(r"by (\d+) points?[^().]{0,60}\((\d+)-(\d{1,2}) (?:to|v) (\d+)-(\d{1,2})\)", low):
            n = int(m.group(1))
            d = abs(_gaa_total(m.group(2), m.group(3)) - _gaa_total(m.group(4), m.group(5)))
            if n != d:
                issues.append({"quote": s, "problem": f"says {n} points but the scoreline in brackets is a {d}-point gap",
                               "truth": "use score_at_end_of_block for a running score, scored_in_block for what the 10 minutes produced"})

        # 3. a count of opposition scores that is not their total
        if opp:
            for m in re.finditer(r"(\d+) " + re.escape(opp.lower()) + r" scores", low):
                n = int(m.group(1))
                total = facts.get("opp_scores")
                if total and n != total and str(total) not in s:
                    issues.append({"quote": s, "problem": f"{n} {opp} scores quoted as if it were all of them",
                                   "truth": f"{opp} scored {total} times; say how many of them the figure covers"})

        # 4. a minute from full time on without its period
        for m in re.finditer(r"(?<![+\d:])(\d{2,3})'", s):
            minute = int(m.group(1))
            if minute < 2 * hdm:
                continue
            before = s[max(0, m.start() - 28):m.start()].lower()
            if re.search(r"(extra time [12]|half) \d{1,3}(?:\+\d+)?'(?:[^.;]{0,30}?, \d{1,3}(?:\+\d+)?')*[^.;]{0,30}?(?:,| and| or)\s*$", s[:m.start()].lower()):
                continue                   # a list after one period label: "extra time 1 71', 75' (a two-pointer) and 77'"
            if re.search(r"(1st half|2nd half|extra time [12])\b[^.;']{0,25}$", s[max(0, m.start() - 45):m.start()].lower()):
                continue                   # the period a few words before: "extra time 1 at 71'", "the extra time 1 changes at 71'"
            if not re.search(r"(half|extra time|et ?[12]|\+)\s*$", before.strip()) and not re.search(r"(1st half|2nd half|extra time [12])\s*$", before):
                issues.append({"quote": s, "problem": f"{minute}' has no period (2nd half or extra time)",
                               "truth": "write the period from the tool's 'when' text"})

        # 5. superlatives on speed
        for m in re.finditer(r"(\d+\.\d+) m/s[^.]{0,40}\b(highest|fastest|quickest|top)\b[^.]{0,20}\b(squad|team|match|of anyone|on the team)", low):
            v = float(m.group(1))
            best = facts.get("max_speed")
            if best and v < best[1] - 1e-6:
                issues.append({"quote": s, "problem": f"{v} m/s is not the highest", "truth": f"{best[0]} had the highest top speed ({best[1]} m/s)"})

        # 5b. superlatives on distance covered
        for m in re.finditer(r"(\d+(?:\.\d)?) ?km[^.]{0,40}\b(the most|the highest|most of any|furthest)\b(?![^.;)]{0,30}(sprint|high-speed|carr|pass|speed))", low):
            v = float(m.group(1))
            if re.search(r"sprint|high-speed|carr|pass|speed", low[m.start():m.start(2)]):
                continue                   # "10.9 km ... 15 sprints (the most ...)": the superlative is about something else
            best = facts.get("max_distance")
            if best and v < best[1] - 0.05 and f"{best[1]} km" not in low and f"{best[1]}km" not in low:
                issues.append({"quote": s, "problem": f"{v} km is not the most", "truth": f"{best[0]} covered the most ({best[1]} km)"})

        # 6. widths wider than the pitch
        W = facts.get("pitch_width_m")
        for m in re.finditer(r"(?:width|wide)[^.\d]{0,12}(\d{2,3}(?:\.\d)?) ?m|(\d{2,3}(?:\.\d)?) ?m wide", low):
            v = float(m.group(1) or m.group(2))
            if W and v > W + 1:
                issues.append({"quote": s, "problem": f"a width of {v} m is wider than the pitch ({W:g} m)",
                               "truth": "drop the figure; that moment's GPS frame includes a player off the field"})

        # 7. pass links quoted with the wrong direction or count
        links = facts.get("pass_links") or {}
        for m in re.finditer(r"(\d+) passes from ([A-Z][\w'’\- ]+?) to ([A-Z][\w'’\-]+(?: [A-Z][\w'’\-]+)?)", s):
            n, a, b = int(m.group(1)), _surname(m.group(2)), _surname(m.group(3))
            got = links.get((a, b))
            if got is not None and got != n and (b, a) not in (facts.get("ambiguous_links") or set()):
                issues.append({"quote": s, "problem": f"{m.group(2)} to {m.group(3)} was {got} passes, not {n}", "truth": _link_truth(links, a, b)})
        for m in re.finditer(r"([A-Z][\w'’\-]+)[- ]to[- ]([A-Z][\w'’\-]+)[^.()]{0,60}\((\d+) passes?\)", s):
            a, b, n = _surname(m.group(1)), _surname(m.group(2)), int(m.group(3))
            got = links.get((a, b))
            if got is not None and got != n and (b, a) not in (facts.get("ambiguous_links") or set()):
                issues.append({"quote": s, "problem": f"{m.group(1)} to {m.group(2)} was {got} passes, not {n}", "truth": _link_truth(links, a, b)})

        # 8. process talk about the tools
        for m in re.finditer(r"\b(the tool(?:'s)? (?:flags|says|shows|count)|by the match summary|in the match summary|"
                             r"not in the match gps list|the match gps list|was not returned|were not returned|not returned by|"
                             r"(?:in|from) the (?:impact|gps|passing|ball-carrier|carrier|lineup) data|the list returned|"
                             r"not matched to|the unit is shown)\b", low):
            issues.append({"quote": s, "problem": f"talks about the tools ('{m.group(0)}')", "truth": "say what happened, or 'not recorded'"})

        # 9. our two-pointer scorers under the wrong heading
        tp = (facts.get("two_pointers") or {}).get("ours") or {}
        mp = re.search(r"(\d+) from play \(([^)]*)\)", s)
        if tp and mp and ("two-pointer" in low or "two pointer" in low):
            play = {_surname(x.split(" (")[0]) for x in tp.get("from_play", [])}
            frees = {_surname(x.split(" (")[0]) for x in tp.get("from_frees", [])}
            named = {_surname(n) for n in re.split(r",| and ", mp.group(2)) if n.strip()}
            wrong = (named & frees) - play
            if wrong:
                issues.append({"quote": s, "problem": f"{', '.join(sorted(wrong))} listed as a two-pointer from play but it was a free",
                               "truth": f"from play: {', '.join(tp.get('from_play', []))}; from frees: {', '.join(tp.get('from_frees', []))}"})

        # 10. "X of Y" followed by its parts ("7 of 33 ...: 4 of 13, 1 of 10, 0 of 1 and 2 of 3"): the parts must add up
        for m in re.finditer(r"(\d+) of (\d+)\b([^.]*?):((?:[^.]*?\b\d+ of \d+\b){2,}[^.]*)", s):
            pairs = re.findall(r"\b(\d+) of (\d+)\b", m.group(4))
            sa, sb = sum(int(a) for a, _ in pairs), sum(int(b) for _, b in pairs)
            if (sa, sb) != (int(m.group(1)), int(m.group(2))):
                issues.append({"quote": s, "problem": f"says {m.group(1)} of {m.group(2)} but its parts add to {sa} of {sb}",
                               "truth": f"{sa} of {sb}"})

        # 11. a player's wides against his own row
        for m in re.finditer(r"([A-Z][\w'’\-]+) (?:had )?(\d+) wides?\b", s):
            want = (facts.get("player_wides") or {}).get(_surname(m.group(1)))
            if want is not None and want != int(m.group(2)):
                issues.append({"quote": s, "problem": f"{m.group(1)} had {want} wide(s), not {m.group(2)}", "truth": f"{m.group(1)}: {want} wide(s)"})

        # 12. a player's score against the tool's score string (same notation as the team score)
        for m in re.finditer(r"([A-Z][\w'’\-]+)\**(?: \([^)]*\))?,? (?:scored|finished with|had|kicked) (\d+)-(\d+)\b", s):
            want = (facts.get("player_scores") or {}).get(_surname(m.group(1)))
            got = f"{m.group(2)}-{m.group(3)}"
            if want and want != got:
                issues.append({"quote": s, "problem": f"{m.group(1)} scored {want}, not {got}", "truth": f"{m.group(1)}: {want}"})

        # 13. our overall return: "N points from M shots" must be the match totals when it claims to be overall
        for m in re.finditer(r"(\d+) points from (\d+) shots", low):
            p_, s_ = int(m.group(1)), int(m.group(2))
            tp, ts = facts.get("our_points_total"), facts.get("our_shots_total")
            if tp and ts and s_ == ts and p_ != tp:
                issues.append({"quote": s, "problem": f"{p_} points from {s_} shots, but we scored {tp} points from {ts} shots",
                               "truth": f"{tp} points from {ts} shots ({tp / ts:.2f} per shot)"})

        # 13b. the internal impact-score number (means nothing to a reader)
        if re.search(r"impact (?:score|figure)s?\b[^.]{0,40}?\(?\b\d{1,3}\b|\(\s*impact score \d+\s*\)|\(\d{1,3}\)[^.]{0,15}impact", low):
            issues.append({"quote": s, "problem": "quotes an impact-score number, which means nothing to a reader",
                           "truth": "drop the number; say what the player did (scores, assists, kickouts and turnovers won)"})

        # 14. a mean written as a median
        for v in facts.get("means") or []:
            if re.search(r"median[^.]{0,25}\b" + re.escape(str(v)) + r"\b", low):
                issues.append({"quote": s, "problem": f"{v} is a mean (average), not a median", "truth": "write 'on average'"})

        # 14. leaked snake_case field names
        for m in re.finditer(r"\b[a-z0-9]+_[a-z0-9_]+\b", s):
            issues.append({"quote": s, "problem": f"internal field name '{m.group(0)}'", "truth": "say it in plain words"})

    # one issue per quote+problem
    seen, out = set(), []
    for i in issues:
        k = (i["quote"], i["problem"])
        if k not in seen:
            seen.add(k)
            out.append(i)
    return out


def _link_truth(links: dict, a: str, b: str) -> str:
    ab, ba = links.get((a, b)), links.get((b, a))
    return f"{a.title()} to {b.title()}: {ab or 0}; {b.title()} to {a.title()}: {ba or 0}"


async def gather_facts(db, match_id: str, club_id) -> dict:
    """The figures the checks compare against, from the same tools the report was written from."""
    from app.services.ai._shared import execute_tool
    facts: dict = {}
    try:
        summ = json.loads(await execute_tool("get_match_summary", {"match_id": match_id}, db, club_id=club_id))
        st = summ.get("stats") or {}
        facts["opponent"] = (summ.get("match") or {}).get("opponent")
        facts["half_duration_mins"] = (summ.get("match") or {}).get("half_duration_mins")
        facts["our_missed_total"] = st.get("missed_shots_total")
        facts["opp_missed_total"] = st.get("opponent_missed_shots_total")
        facts["our_missed_parts"] = (f"{st.get('wides', 0)} wides, {st.get('shorts', 0)} shorts, {st.get('hit_posts', 0)} hit posts, "
                                     f"{st.get('saved', 0)} saved" + (f", {st['forty_fives_missed']} missed 45s" if st.get("forty_fives_missed") else "")
                                     + (f", {st['penalties_missed']} missed penalties" if st.get("penalties_missed") else ""))
        facts["opp_missed_parts"] = (f"{st.get('opponent_wides', 0)} wides, {st.get('opponent_shorts', 0)} shorts, "
                                     f"{st.get('opponent_hit_posts', 0)} hit posts, {st.get('opponent_saved', 0)} saved")
        facts["two_pointers"] = summ.get("two_pointers")
        facts["our_points_total"] = (summ.get("score") or {}).get("team_total")
        facts["our_shots_total"] = st.get("team_total_shots")
        _w, _dup = {}, set()
        for r in summ.get("player_breakdown") or []:
            k = _surname(r.get("name", ""))
            if k in _w:
                _dup.add(k)          # two players share a surname: cannot check by surname
            _w[k] = r.get("wides", 0)
        facts["player_wides"] = {k: v for k, v in _w.items() if k not in _dup}
        tot_shots = st.get("opponent_total_shots")
        if tot_shots is not None and facts["opp_missed_total"] is not None:
            facts["opp_scores"] = tot_shots - facts["opp_missed_total"]
    except Exception:
        pass
    try:
        gps = json.loads(await execute_tool("get_match_gps", {"match_id": match_id}, db, club_id=club_id))
        sp = [(p["name"], p.get("max_speed_ms") or 0) for p in gps.get("players", [])]
        if sp:
            facts["max_speed"] = max(sp, key=lambda r: r[1])
        dk = [(p["name"], p.get("distance_km") or 0) for p in gps.get("players", [])]
        if dk:
            facts["max_distance"] = max(dk, key=lambda r: r[1])
    except Exception:
        pass
    try:
        bc = json.loads(await execute_tool("get_ball_carrier_data", {"match_id": match_id}, db, club_id=club_id))
        links, seen = {}, {}
        for c in (bc.get("pass_network") or []):
            k = (_surname(c["from_name"]), _surname(c["to_name"]))
            full = (c["from_name"], c["to_name"])
            if k in seen and seen[k] != full:
                links[k] = None          # two players share a surname (two O'Donnells): the check cannot tell them apart
            else:
                seen[k] = full
                links[k] = c["count"]
        facts["pass_links"] = {k: v for k, v in links.items() if v is not None}
        facts["ambiguous_links"] = {k for k, v in links.items() if v is None}
    except Exception:
        pass
    try:
        imp = json.loads(await execute_tool("get_match_player_impact", {"match_id": match_id}, db, club_id=club_id))
        sc, dup = {}, set()
        for side in ("own", "opposition"):
            for r in (imp.get(side) or []):
                if not r.get("score"):
                    continue
                k = _surname(r.get("player", ""))
                if k in sc:
                    dup.add(k)
                sc[k] = r["score"].split(" ")[0]
        facts["player_scores"] = {k: v for k, v in sc.items() if k not in dup}
    except Exception:
        pass
    try:
        ga = json.loads(await execute_tool("get_gps_match_analysis", {"match_id": match_id}, db, club_id=club_id))
        sup = ((ga.get("summary") or {}).get("support") or {})
        facts["means"] = [v for v in (sup.get("mean_within_15m"),) if v is not None]
    except Exception:
        pass
    try:
        from sqlalchemy import text as _t
        w = (await db.execute(_t("select pitch_width_m from matches where id = :m"), {"m": str(match_id)})).scalar_one_or_none()
        facts["pitch_width_m"] = float(w or 90.0)
    except Exception:
        facts["pitch_width_m"] = 90.0
    return facts


def drop_empty_headings(text: str) -> Tuple[str, List[str]]:
    """A heading with nothing under it before the next heading, the footnote or the end ("## Match Charts")."""
    lines, out, fixed = text.split("\n"), [], []
    for i, ln in enumerate(lines):
        if ln.startswith("#"):
            rest = next((x for x in lines[i + 1:] if x.strip()), "")
            if not rest or rest.startswith("#") or (rest.startswith("*Knowledge base") and ln.startswith("## ")):
                fixed.append(f"empty heading removed: {ln.strip()}")
                continue
        out.append(ln)
    return "\n".join(out), fixed


def check_report(text: str, facts: dict) -> Tuple[str, List[str], List[dict]]:
    hdm = facts.get("half_duration_mins") or 30
    text, f1 = fix_added_time(text, hdm)
    text, f2 = fix_field_names(text)
    text, f3 = drop_empty_headings(text)
    return text, f1 + f2 + f3, find_issues(text, facts)


REPAIR_SYSTEM = """You correct specific factual errors in a finished GAA match report. You get the report and a list of problems,
each with the exact sentence it is in and the right figure. For each problem, rewrite ONLY that sentence so it is true, using
the right figure given (or removing the wrong claim if no figure is given). Keep the writer's style; change as little as
possible; never add new claims, never add a bracketed explanation, and keep the sentence about the same subject (if the right
figure is about a different team or player than the sentence, remove the wrong claim instead of swapping the figure in). Often the
best fix is to delete the false clause ("the most", "the highest") and keep the rest. Reply with JSON only: a list of {"old": "<the exact sentence as given>", "new": "<the corrected
sentence>"}."""


async def repair(client, model: str, text: str, issues: List[dict]) -> Tuple[str, int]:
    """One short model pass that may change only the quoted sentences. Returns (text, n_applied); on any failure the text is
    returned unchanged."""
    import asyncio
    if not issues:
        return text, 0
    payload = json.dumps(issues[:25], ensure_ascii=False, indent=1)

    def _call():
        return client.messages.create(model=model, max_tokens=4000, system=REPAIR_SYSTEM,
                                      messages=[{"role": "user", "content": f"PROBLEMS:\n{payload}"}])
    try:
        resp = await asyncio.to_thread(_call)
        raw = "".join(getattr(b, "text", "") for b in resp.content).strip()
        raw = raw[raw.find("["): raw.rfind("]") + 1]
        edits = json.loads(raw)
    except Exception:
        return text, 0
    n = 0
    for e in edits if isinstance(edits, list) else []:
        old, new = (e or {}).get("old"), (e or {}).get("new")
        if old and new and text.count(old) == 1:
            text = text.replace(old, new)
            n += 1
    return text, n
