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

from app.services.ai.phase_facts import period_bounds, when_label

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


NEXT_PERIOD = {1: "2nd half", 2: "extra time 1", 3: "extra time 2"}
PERIOD_NUM = {"1st half": 1, "2nd half": 2, "extra time 1": 3, "extra time 2": 4}



def fix_added_time(text: str, hdm: int, event_minutes=None, score_minutes=None, score_events=None) -> Tuple[str, List[str]]:
    """A minute past a period's end: "extra time 1 81'" is either that period's added time ("extra time 1 80+1'") or the
    NEXT period ("extra time 2 81'" - McHugh's points in Dublin, written as extra time 1). The logged events decide: when
    nothing was logged at that minute in the named period but something was in the next one, it is the next period."""
    fixed = []

    def sub(m):
        word, at, minute = m.group(1), m.group(2) or "", int(m.group(3))
        half = {"1st half": 1, "2nd half": 2, "extra time 1": 3, "extra time 2": 4}[word.lower()]
        end = period_bounds(half, hdm)[1]
        if minute <= end:
            return m.group(0)
        # a sentence about a score is judged by the scores (both periods had other events at 81' in Dublin)
        around = m.string[max(0, m.start() - 120): m.end() + 40].lower()
        # the scorer named nearby decides first (Murphy at 70+1' and Guiden at extra time 1 71' share minute 71)
        for h, mi, sur in score_events or ():
            if mi == minute and sur and re.search(r"\b" + re.escape(sur) + r"\b", around):
                if h == half + 1 and half in NEXT_PERIOD:
                    new = f"{NEXT_PERIOD[half]} {at}{minute}'"
                    fixed.append(f"{m.group(0)} -> {new}")
                    return new
                if h == half:
                    break
        ev = (score_minutes if score_minutes and re.search(r"scor|point|goal|two-pointer|free", around) else event_minutes) or set()
        if ev and (half, minute) not in ev and (half + 1, minute) in ev and half in NEXT_PERIOD:
            new = f"{NEXT_PERIOD[half]} {at}{minute}'"
        else:
            new = f"{word} {at}{end}+{minute - end}'"
        fixed.append(f"{m.group(0)} -> {new}")
        return new

    return re.sub(PERIOD_RE + r" (at )?(\d{1,3})'", sub, text, flags=re.IGNORECASE), fixed


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
        # "a missed 45" / "one save" count as 1 (8 wides, 3 shorts, 1 hit post, 1 save and a missed 45 = 14)
        parts = [("1" if p[0] in ("a", "an", "one") else p[0], p[1]) for p in
                 re.findall(r"\b(\d+|a|an|one) (wides?|shorts?|hit posts?|saves?|missed 45s?|missed penalt(?:y|ies))", low)]
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
                # a named subset ("the 22 Dublin scores with a GPS frame", "tracked", "measured") is not a total
                if total and n != total and str(total) not in s and not re.search(r"gps frame|tracked|measured|could trace|traced", low):
                    issues.append({"quote": s, "problem": f"{n} {opp} scores quoted as if it were all of them",
                                   "truth": f"{opp} scored {total} times; say how many of them the figure covers"})

        # 4. a minute from full time on without its period
        for m in re.finditer(r"(?<![+\d:])(\d{2,3})'", s):
            minute = int(m.group(1))
            if minute < 2 * hdm:
                continue
            before = s[max(0, m.start() - 28):m.start()].lower()
            if re.search(r"^\s*\((?:also )?(?:in )?(?:the )?(1st half|2nd half|extra time [12])", s[m.end():m.end() + 30].lower()):
                continue                   # the period straight after: "82' (also in extra time 2, ...)"
            if re.search(r"(extra time [12]|half) (?:at )?\d{1,3}(?:\+\d+)?'(?:[^.;]{0,30}?, \d{1,3}(?:\+\d+)?')*[^.;]{0,30}?(?:,| and| or)\s*$", s[:m.start()].lower()):
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
                             r"not matched to|the unit is shown|in the match data|isn't in the match|is not in the match)\b", low):
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
        for m in re.finditer(r"([A-Z][\w'’\-]+)\**(?: \([^)]*\))?,? (?:scored|scoring|scores|finished with|had|kicked|added|with) (\d+)-(\d+)\b", s):
            want = (facts.get("player_scores") or {}).get(_surname(m.group(1)))
            got = f"{m.group(2)}-{m.group(3)}"
            if want and want != got:
                issues.append({"quote": s, "problem": f"{m.group(1)} scored {want}, not {got}", "truth": f"{m.group(1)}: {want}"})

        # 12b. the same in other forms: "Guiden (0-3)", "S. Guiden: 0-3", "Guiden's 0-3" (reviewer: Guiden 0-3 was 0-4)
        for m in re.finditer(r"\b([A-Z][\w'’\-]+)(?:'s)?\**(?: \((?=\d)|:\s*|\s+)(\d+)-(\d{1,2})\b", s):
            want = (facts.get("player_scores") or {}).get(_surname(m.group(1)))
            got = f"{m.group(2)}-{m.group(3)}"
            if want and want != got and not any(i["quote"] == s and m.group(1) in i["problem"] for i in issues):
                issues.append({"quote": s, "problem": f"{m.group(1)} scored {want}, not {got}",
                               "truth": f"{m.group(1)}: {want}" + (f" ({facts['player_score_detail'][_surname(m.group(1))]})" if _surname(m.group(1)) in (facts.get("player_score_detail") or {}) else "")})

        # 12c. a player who came off and went back on, described as only replaced / taken off
        for sur, spells in (facts.get("returned") or {}).items():
            if re.search(r"\b" + re.escape(sur) + r"\b", s, re.I) and re.search(r"\b(replaced|taken off|came off|went off|withdrawn|replaced by)\b", low) \
                    and not re.search(r"\b(return|returned|came back|back on|re-?enter)", low):
                issues.append({"quote": s, "problem": f"{sur.title()} came off and went back on; the sentence says only that he was replaced",
                               "truth": f"{sur.title()} on the pitch: {'; '.join(spells)} (write 'returned' with the time)"})

        # 12d. "played the full match / the full N minutes" for someone who did not
        if re.search(r"\bfull (?:match|game|\d+ minutes)|\bevery minute\b|\bplayed (?:it )?all\b", low):
            mins, full = facts.get("player_minutes") or {}, facts.get("match_minutes")
            short = [f"{k.title()} {v} min" for k, v in mins.items() if v is not None and full and v < full - 1
                     and re.search(r"\b" + re.escape(k) + r"\b", s, re.I)]
            if short:
                issues.append({"quote": s, "problem": "says the full match for players who did not play it: " + ", ".join(short),
                               "truth": f"the match ran {full} minutes; " + ", ".join(short)})

        # 12e. a claim about never getting close again, against the real score timeline
        if re.search(r"\b(?:did not|didn't|never|could not|couldn't) (?:get|got|come|came) (?:back )?(?:within|closer)", low) and facts.get("late_timeline"):
            issues.append({"quote": s, "problem": "claims we never got within a score again; check it against the score timeline",
                           "truth": "score timeline (us-them after each score): " + facts["late_timeline"]})

        # 12f. "the second half was level / drawn" against the half's real score
        for m in re.finditer(r"\b(first|second|1st|2nd) half (?:was|ended|finished) (?:level|drawn|even)", low):
            h = 1 if m.group(1) in ("first", "1st") else 2
            u, t = (facts.get("half_scores") or {}).get(h, (None, None))
            if u is not None and u != t:
                issues.append({"quote": s, "problem": f"the {m.group(1)} half was not level",
                               "truth": f"{m.group(1)} half: us {u} points, them {t} points ({'we' if u > t else 'they'} won it by {abs(u - t)})"})

        # 12g. "won by 4 points to 1": a margin and a score jumbled together
        if re.search(r"\bby \d+ points? to \d+\b", low):
            issues.append({"quote": s, "problem": "'by N points to M' mixes a margin with a score",
                           "truth": "write the margin and the score separately, e.g. 'by 4 points, 0-08 to 0-04'"})

        # 12h. a target with no figure in it (or this match's own figure as the target)
        if re.search(r"\btarget (?:to aim for|for next|is)\b", low) and not re.search(r"\d", s):
            issues.append({"quote": s, "problem": "a target sentence with no target figure in it",
                           "truth": "give a figure different from this match's, marked as a suggestion, or delete the sentence"})

        # 12i. a substitution written the wrong way round: "Sean Martin for Dáire Ó Baoill" when Ó Baoill came on for Martin
        subs = facts.get("subs") or set()
        # (letters, not A-Z: "Ó Baoill", "Ó Cofaigh Byrne")
        for m in re.finditer(r"([^\W\d_][\w'’\-]+) for ((?:[^\W\d_][\w'’\-]* ){0,2}[^\W\d_][\w'’\-]+)", s):
            if not (m.group(1)[0].isupper() and m.group(2)[0].isupper()):
                continue
            a, b = _surname(m.group(1)), _surname(m.group(2))
            if (a, b) not in subs and (b, a) in subs:
                issues.append({"quote": s, "problem": f"substitution the wrong way round: {m.group(2)} came on for {m.group(1)}, not the reverse",
                               "truth": f"{m.group(2)} on for {m.group(1)}"})

        # 12j. "the busiest carrier / most passes on the pitch / of anyone" for one of ours, when a Dublin player had more
        # "the most of anyone on our side" is a claim about our team only (Cork, 2026-11-11: Langan's 38 carries)
        if (re.search(r"\b(on the pitch|of anyone|either side|in the match|on the night|in the game)\b", low)
                and re.search(r"\b(busiest|most|top|highest|leading)\b", low)
                and not re.search(r"\b(on our side|of ours|our players|on our team|in our team|for us)\b", low)):
            for what, key in (("carr", "carries"), ("pass", "passes")):
                if what in low and facts.get(f"top_{key}_both"):
                    nm, n, side = facts[f"top_{key}_both"]
                    if side != "own" and not re.search(r"\b" + re.escape(_surname(nm)) + r"\b", s, re.I):
                        issues.append({"quote": s, "problem": f"claims the most {key} on the pitch for one of ours, but {nm} ({side}) had {n}",
                                       "truth": f"say 'our most {key}'; {nm} had the most on the pitch ({n})"})

        # 12k. wording the reviewer flagged: frees "followed by a free shot"; "finished in the sin bin" after a 10-minute bin
        if re.search(r"followed by (?:a )?free shots?", low):
            issues.append({"quote": s, "problem": "'followed by a free shot' is meaningless (every free is)",
                           "truth": f"write 'they scored from {facts.get('opp_free_scores', 'N')} of the {facts.get('our_fouls', 'M')} frees we conceded'"})
        if re.search(r"(finished|ended|stayed) (?:the (?:game|match) )?in the sin bin", low):
            issues.append({"quote": s, "problem": "a black card is 10 minutes; they came back on", "truth": "say 'were sin-binned at <time>'"})

        # 12l. an outside benchmark (other teams' typical figures): the report compares the team only with itself
        if re.search(r"\b(the usual|typical(?:ly)?|the norm|benchmark|elite (?:teams|level)|average (?:for|at) (?:county|inter-county|club))\b[^.]{0,40}\b\d", low):
            issues.append({"quote": s, "problem": "compares with an outside benchmark (other teams' figures)",
                           "truth": "compare only with this team's own figures, or drop the comparison"})

        # 12m. "on at <time>" for a player who was already on the pitch before it (Malone scored at 20' but was "on at extra
        # time 1 80+2'": his first exit was never logged, so he only appears to come on then)
        for m in re.finditer(r"\b(?:on at|on from|came on at|came on in|brought on at)\b (?:the )?(1st half|2nd half|extra time [12]) (?:at )?(\d{1,3})", s, re.I):
            # the player is the last of ours named in the 70 characters before it
            before = s[max(0, m.start() - 70):m.start()]
            named = [(k, v) for k, v in (facts.get("first_event") or {}).items() if re.search(r"\b" + re.escape(k) + r"\b", before, re.I)]
            if not named:
                continue
            sur, first = max(named, key=lambda kv: before.lower().rfind(kv[0]))
            claim = (PERIOD_NUM[m.group(1).lower()], int(m.group(2)))
            if first[:2] < claim:
                issues.append({"quote": s, "problem": f"{sur.title()} is said to come on at {m.group(1)} {m.group(2)}', but he was already playing ({first[2]})",
                               "truth": f"{sur.title()} played from the start; his exit before that was not logged, so say his minutes before then are not known"})

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

    issues += round7_issues(text, facts)

    # one issue per quote+problem
    seen, out = set(), []
    for i in issues:
        k = (i["quote"], i["problem"])
        if k not in seen:
            seen.add(k)
            out.append(i)
    return out


# ---- round 7 (reviewer, after Dublin v6) ------------------------------------------------------------------------------

BANNED = (
    (r"\bwas not used\b|\bwere not used\b", "process line ('was not used')", re.I),
    (r"\blast N matches\b", "'last N matches' with N never filled in", 0),
    (r"\blevers?\b", "internal label 'lever'", re.I),
    (r"\bno criticism applies\b", "an instruction to the writer printed in the report ('no criticism applies')", re.I),
    (r"\bimpact_points\b", "internal field name 'impact_points'", 0),
    (r"\bby the tool'?s count\b", "talks about the tools ('by the tool's count')", re.I),
    (r"\bper the ball-carrier data\b", "talks about the tools ('per the ball-carrier data')", re.I),
)

# metric -> how to read it from a player's impact row
_METRICS = {
    "turnovers won": lambda r: r.get("turnovers_won", 0),
    "turnovers lost": lambda r: r.get("turnovers_lost", 0),
    "kickouts won": lambda r: r.get("kickouts_won", 0),
    "unforced errors": lambda r: r.get("unforced_errors", 0),
    "two-pointers": lambda r: r.get("two_pointers", 0),
    "assists": lambda r: r.get("assists", 0),
    "carries": lambda r: r.get("carries", 0),
    "passes": lambda r: r.get("passes_made", 0),
    "wides": lambda r: r.get("wides", 0),
    "fouls": lambda r: r.get("fouls", 0),
    "goals": lambda r: r.get("goals", 0),
    "scores": lambda r: r.get("goals", 0) + r.get("points", 0) + r.get("two_pointers", 0),
    "points": lambda r: 3 * r.get("goals", 0) + r.get("points", 0) + 2 * r.get("two_pointers", 0),
}
_METRIC_WORDS = [
    (r"turnovers? won", "turnovers won"), (r"turnovers? lost", "turnovers lost"), (r"kick-?outs? won", "kickouts won"),
    (r"turnovers?", "turnovers"), (r"unforced errors?", "unforced errors"), (r"two-pointers?", "two-pointers"), (r"assists?", "assists"),
    (r"carries|carry", "carries"), (r"passes", "passes"), (r"wides?", "wides"), (r"fouls?", "fouls"),
    (r"goals?", "goals"), (r"scores", "scores"), (r"points", "points"),
]
_METRIC_RE = re.compile(r"\b(" + "|".join(p for p, _ in _METRIC_WORDS) + r")\b")


def _metric_key(word: str) -> Optional[str]:
    return next((k for p, k in _METRIC_WORDS if re.fullmatch(p, word)), None)


_BOTH_TEAMS = r"\b(on the pitch|of anyone|either side|in the match|on the night|in the game|both teams|both sides)\b"
_OUR_SIDE = r"\b(on our side|of ours|our players|on our team|in our team|for us|our (?:top|most|highest|leading))\b"


def _named(pool: dict, s: str) -> List[str]:
    return [k for k in pool if re.search(r"\b" + re.escape(k) + r"\b", s, re.I)]


def _superlative_issues(s: str, low: str, facts: dict) -> List[dict]:
    """'the most / the highest / the only' about one named player, against every player's row in the impact table
    (ours, or both teams when the sentence says 'on the pitch')."""
    out = []
    own, opp = facts.get("impact_own") or {}, facts.get("impact_opp") or {}
    if not own:
        return out
    both = bool(re.search(_BOTH_TEAMS, low)) and not re.search(_OUR_SIDE, low)
    pool = dict(own)
    if both:
        pool.update({k: v for k, v in opp.items() if k not in own})
    for m in re.finditer(r"\b(the most|most of any|the highest|the only|joint-top|the top)\b", low):
        lo = max(0, m.start() - 40)
        win = low[lo: m.end() + 45]
        # "15.9 m per carry, the highest" is about metres per carry, not the number of carries
        cands = sorted((abs(lo + mm.start() - m.start()), mm.group(1)) for mm in _METRIC_RE.finditer(win)
                       if not re.search(r"\bper\s*$", win[:mm.start()]))
        if not cands:
            continue
        key = _metric_key(cands[0][1])
        if key == "turnovers":            # "won the most turnovers" / "lost the most turnovers"
            key = ("turnovers won" if re.search(r"\bw[io]n\b", win) else
                   "turnovers lost" if re.search(r"\b(lost|lose|gave away|conceded)\b", win) else None)
        if not key or (both and key in ("carries", "passes")):     # 12j already checks carries/passes across both teams
            continue
        get = _METRICS[key]
        named = _named(pool, s)
        if len(named) != 1:
            continue
        who = named[0]
        if m.group(1) == "the only":
            holders = [k for k, r in pool.items() if get(r) > 0]
            if len(holders) > 1 and key in ("goals", "two-pointers", "assists"):
                out.append({"quote": s, "problem": f"says {who.title()} was the only one with {key}, but {len(holders)} players had them",
                            "truth": ", ".join(f"{k.title()} {get(pool[k])}" for k in sorted(holders, key=lambda k: -get(pool[k])))})
            continue
        best = max(get(r) for r in pool.values())
        if get(pool[who]) < best:
            tops = [k for k, r in pool.items() if get(r) == best]
            scope = "on the pitch" if both else "of ours"
            out.append({"quote": s, "problem": f"says {who.title()} had the most {key} {scope}, but he had {get(pool[who])}",
                        "truth": f"the most {key} {scope}: " + ", ".join(f"{t.title()} ({best})" for t in tops)})
    return out


def _two_pointer_direction(s: str, low: str, facts: dict) -> List[dict]:
    """'X out-scored us from range' / 'X gained from range': X must have scored more two-pointers (Dublin v6 said
    Dublin out-scored us from range with 3 against our 4)."""
    tp = facts.get("two_pointers") or {}
    if not tp.get("ours") and not tp.get("theirs"):
        return []
    n = {side: len((tp.get(side) or {}).get("from_play", [])) + len((tp.get(side) or {}).get("from_frees", []))
         for side in ("ours", "theirs")}
    opp = (facts.get("opponent") or "").lower()
    out = []
    for m in re.finditer(r"([\w'’ ]{0,40}?)\b(?:out-?scored (us|them|[\w'’]+)|gained) from range", low):
        subj, obj = m.group(1).strip(), m.group(2)
        if obj:
            winner = "theirs" if obj == "us" else ("ours" if obj == "them" or (opp and obj in opp) else None)
        elif re.search(r"\b(we|us|our)\b", subj):
            winner = "ours"
        elif re.search(r"\b(they|their|the opposition)\b", subj) or (opp and opp in subj):
            winner = "theirs"
        else:
            winner = None
        if winner is None:
            continue
        loser = "theirs" if winner == "ours" else "ours"
        if n[winner] <= n[loser]:
            truth = f"two-pointers: ours {n['ours']}, theirs {n['theirs']}"
            truth += ("; level, so neither side gained from range" if n["ours"] == n["theirs"] else
                      f"; {'we' if n['ours'] > n['theirs'] else (facts.get('opponent') or 'they')} gained from range")
            out.append({"quote": s, "problem": "the from-range claim is the wrong way round", "truth": truth})
    return out


_MIN_PATTERNS = (
    r"\bplayed (?:only |just )?(\d{1,3}) min(?:utes|s)?\b",
    r"\b(\d{1,3}) min(?:utes|s)? on the pitch\b",
    r"\bin (?:his|her|their) (\d{1,3}) min(?:utes|s)?\b",
    r"\b(\d{1,3}) min(?:utes|s)? played\b",
    r"\b(\d{1,3})-minute (?:cameo|spell|shift|appearance|outing)\b",
    r"\b(\d{1,3}) min(?:utes|s)? (?:off the bench|as a substitute|after coming on)\b",
)


def _minutes_issues(s: str, low: str, facts: dict) -> List[dict]:
    """A player's minutes against his playing_minutes; 'the full N minutes' against the match length."""
    out = []
    mins, full = facts.get("player_minutes") or {}, facts.get("match_minutes")
    for m in re.finditer(r"\bfull (\d{2,3}) minutes\b", low):
        if full and abs(int(m.group(1)) - full) > 1:
            out.append({"quote": s, "problem": f"says the full {m.group(1)} minutes; the match ran {full}",
                        "truth": f"the match ran {full} minutes"})
    named = [k for k, v in mins.items() if v is not None and re.search(r"\b" + re.escape(k) + r"\b", s, re.I)]
    if len(named) != 1:
        return out
    want = mins[named[0]]
    for pat in _MIN_PATTERNS:
        for m in re.finditer(pat, low):
            got = int(m.group(1))
            if abs(got - want) > 1:
                out.append({"quote": s, "problem": f"{named[0].title()} played {want} minutes, not {got}",
                            "truth": f"{named[0].title()}: {want} minutes"})
    return out


def _phase_table(text: str) -> Optional[dict]:
    """The pasted scorecard table: the (numerator, denominator) pairs it supports."""
    lines = [ln for ln in text.split("\n") if ln.startswith("|")]
    head = next((ln for ln in lines if "Became a shot" in ln), None)
    if not head:
        return None
    cols = [c.strip().lower() for c in head.strip().strip("|").split("|")]
    try:
        ip, i_f, i_s, i_sc = cols.index("possessions"), cols.index("finished"), cols.index("became a shot"), cols.index("scored")
    except ValueError:
        return None
    pairs, denoms = set(), set()
    for ln in lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) != len(cols) or not all(cells[i].isdigit() for i in (ip, i_f, i_s, i_sc)):
            continue
        p, f, sh, sc = int(cells[ip]), int(cells[i_f]), int(cells[i_s]), int(cells[i_sc])
        pairs |= {(sh, p), (sh, f), (sc, sh), (sc, p), (sc, f)}
        denoms |= {p, f, sh}
        for c in cells[i_sc + 1:]:
            mm = re.match(r"(\d+)/(\d+) shots?, (\d+) scored", c)
            if mm:
                a, b, c3 = int(mm.group(1)), int(mm.group(2)), int(mm.group(3))
                pairs |= {(a, b), (c3, a), (c3, b)}
                denoms |= {a, b}
    return {"pairs": pairs, "denoms": denoms}


def _phase_issues(s: str, low: str, table: Optional[dict]) -> List[dict]:
    """'N shots from M possessions' / 'N of M ... shots' in a sentence about a phase must be a pair from the table."""
    if not table or not re.search(r"\b(kick-?outs?|turnovers?|possessions?|breaking balls?|contests?)\b", low):
        return []
    out = []
    for m in re.finditer(r"\b(\d+) shots? from (\d+) possessions?\b", low):
        n, d = int(m.group(1)), int(m.group(2))
        if d in table["denoms"] and (n, d) not in table["pairs"]:
            out.append({"quote": s, "problem": f"{n} shots from {d} possessions is not in the phase table",
                        "truth": "copy the shot count from that row of the phase table (Became a shot, or the half's 'a/b shots')"})
    for m in re.finditer(r"\b(\d+) of (?:the |our |their )?(\d+)\b[^.;\d]{0,40}?\bshots?\b", low):
        n, d = int(m.group(1)), int(m.group(2))
        if d in table["denoms"] and (n, d) not in table["pairs"]:
            out.append({"quote": s, "problem": f"'{n} of {d}' does not match the phase table",
                        "truth": "copy the pair from one row of the phase table (became a shot of possessions, or scored of shots)"})
    return out


_HALF_KEY = {"first": "half_1", "1st": "half_1", "second": "half_2", "2nd": "half_2"}
_PART_RE = re.compile(r"\b(\d+) of (?:our |the )?(\d+)\b([^\d.;()]{0,35}?)\b(left|right|centre|center|middle|short|medium|long)\b")


def _half_split_issues(paragraph: str, facts: dict) -> List[dict]:
    """Our kickouts kept in one half split by channel or length ('5 of 7 to our left and 3 of 8 down the centre'): the
    parts must add up to that half's kept total."""
    kbh = facts.get("kickouts_by_half") or {}
    if not kbh or not re.search(r"\bkick-?outs?\b", paragraph, re.I):
        return []
    opp = (facts.get("opponent") or "").lower()
    out = []
    for s in re.split(r"(?<=[.!?])\s+", paragraph):
        low = s.lower()
        if re.search(r"\b(their|opposition)\b[^.]{0,20}kick-?outs?", low) or (opp and re.search(re.escape(opp) + r"(?:'s)? kick-?outs?", low)):
            continue
        hm = re.search(r"\b(first|1st|second|2nd)[- ]half\b|\bextra time ([12])\b", low)
        if not hm:
            continue
        key = _HALF_KEY[hm.group(1)] if hm.group(1) else f"extra_time_{hm.group(2)}"
        entry = kbh.get(key) or {}
        ok = entry.get("our_kickouts") or {}
        tot = ok.get("kept")
        if tot is None:
            continue
        ch, ln = [], []
        for m in _PART_RE.finditer(low):
            (ln if m.group(4) in ("short", "medium", "long") else ch).append(int(m.group(1)))
        for parts, by in ((ch, "by_channel"), (ln, "by_length")):
            if len(parts) < 2:
                continue
            groups = entry.get(by) or {}
            framed = sum(v.get("kept", 0) for v in groups.values())
            if sum(parts) not in (tot, framed):
                detail = "; ".join(f"{k} {v.get('kept')} of {v.get('of')}" for k, v in groups.items())
                out.append({"quote": s, "problem": f"the {by[3:]} parts add to {sum(parts)} kept, but we kept {tot} in that period",
                            "truth": f"{key.replace('_', ' ')}: kept {tot} of {ok.get('of')}" + (f" ({detail})" if detail else "")})
    return out


_POSITIONS = (r"goalkeeper|(?:left |right )?corner[- ]back|centre[- ]half[- ]back|full[- ]back|(?:left |right )?half[- ]back|"
              r"midfielder|midfield|centre[- ]half[- ]forward|(?:left |right )?half[- ]forward|(?:left |right )?corner[- ]forward|full[- ]forward")


def _position_issues(text: str, facts: dict) -> List[dict]:
    """One listed position per player across the report: 'Mogan (left corner back)' here and 'Mogan (left half back)'
    there. A player who changed position in the match is skipped."""
    moved = facts.get("moved") or set()
    seen: dict = {}
    multi = set()
    for m in re.finditer(r"\b([A-Z][\w'’\-]+)\**\s*\(([^)]{3,80})\)", text):
        sur = m.group(1).lower()
        if sur in moved:
            continue
        found = re.findall(_POSITIONS, m.group(2), re.I)
        if not found:
            continue
        if len(found) != 1 or re.search(r"\b(then|moved|later|switched|after)\b", m.group(2), re.I):
            multi.add(sur)
            continue
        pos = found[0].lower().replace("-", " ")
        seen.setdefault(sur, []).append(("midfield" if pos.startswith("midfield") else pos, m.group(0)))
    out = []
    for sur, rows in seen.items():
        if sur in multi:
            continue
        first = rows[0][0]
        other = next(((p, q) for p, q in rows[1:] if p != first), None)
        if other:
            out.append({"quote": other[1], "problem": f"{sur.title()} is listed as {first} and elsewhere as {other[0]}",
                        "truth": "one position per player throughout: use the lineup's position"})
    return out


def round7_issues(text: str, facts: dict) -> List[dict]:
    issues: List[dict] = []
    table = _phase_table(text)
    for s in _sentences(text):
        low = s.lower()
        for pat, problem, flags in BANNED:
            if re.search(pat, s, flags):
                issues.append({"quote": s, "problem": problem, "truth": "delete it, or say it plainly"})
        issues += _two_pointer_direction(s, low, facts)
        issues += _superlative_issues(s, low, facts)
        issues += _minutes_issues(s, low, facts)
        issues += _phase_issues(s, low, table)
    for para in re.split(r"\n\s*\n", text):
        if not para.lstrip().startswith("|"):
            issues += _half_split_issues(para, facts)
    issues += _position_issues(text, facts)
    return issues


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
        facts["moved"] = {_surname(r.get("name", "")) for r in summ.get("player_breakdown") or [] if r.get("positions_played")}
        tot_shots = st.get("opponent_total_shots")
        if tot_shots is not None and facts["opp_missed_total"] is not None:
            facts["opp_scores"] = tot_shots - facts["opp_missed_total"]
    except Exception:
        pass
    try:
        gps = json.loads(await execute_tool("get_match_gps_running_totals", {"match_id": match_id}, db, club_id=club_id))
        facts["match_minutes"] = gps.get("match_minutes")
        _sur = [_surname(p["name"]) for p in gps.get("players", []) if p.get("name")]
        # two players share a surname (Shane and Conor O'Donnell): the checks cannot tell whose minutes a sentence means
        facts["player_minutes"] = {_surname(p["name"]): p.get("playing_minutes") for p in gps.get("players", [])
                                   if p.get("name") and _sur.count(_surname(p["name"])) == 1}
        facts["returned"] = {_surname(p["name"]): p.get("on_the_pitch") for p in gps.get("players", []) if p.get("returned_after_going_off")}
        sp = [(p["name"], p.get("max_speed_ms") or 0) for p in gps.get("players", [])]
        if sp:
            facts["max_speed"] = max(sp, key=lambda r: r[1])
        dk = [(p["name"], p.get("distance_km") or 0) for p in gps.get("players", [])]
        if dk:
            facts["max_distance"] = max(dk, key=lambda r: r[1])
    except Exception:
        pass
    try:
        bc = json.loads(await execute_tool("get_match_ball_carrying_and_passing", {"match_id": match_id}, db, club_id=club_id))
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
        sc, dup, detail, own_scorers = {}, set(), {}, []
        for side in ("own", "opposition"):
            for r in (imp.get(side) or []):
                if not r.get("score"):
                    continue
                k = _surname(r.get("player", ""))
                if k in sc:
                    dup.add(k)
                sc[k] = r["score"].split(" ")[0]
                detail[k] = r["score"]
                if side == "own":
                    own_scorers.append((r.get("player", ""), r["score"].split(" ")[0]))
        facts["player_scores"] = {k: v for k, v in sc.items() if k not in dup}
        facts["player_score_detail"] = {k: v for k, v in detail.items() if k not in dup}
        facts["own_scorers"] = own_scorers
        for side, key in (("own", "impact_own"), ("opposition", "impact_opp")):
            rows_, dup_ = {}, set()
            for r in (imp.get(side) or []):
                k = _surname(r.get("player", ""))
                if k in rows_:
                    dup_.add(k)          # two players share a surname: cannot check by surname
                rows_[k] = r
            facts[key] = {k: v for k, v in rows_.items() if k and k not in dup_}
    except Exception:
        pass
    try:
        ga = json.loads(await execute_tool("get_match_gps_positional_analysis", {"match_id": match_id}, db, club_id=club_id))
        sup = ((ga.get("summary") or {}).get("support") or {})
        facts["means"] = [v for v in (sup.get("mean_within_15m"),) if v is not None]
    except Exception:
        pass
    try:
        bc2 = json.loads(await execute_tool("get_match_ball_carrying_and_passing", {"match_id": match_id}, db, club_id=club_id))
        rows = [(r["name"], r.get("carries") or 0, "own") for r in bc2.get("carrier_stats") or []]
        rows += [(r["name"], r.get("carries") or 0, "Dublin" if False else (facts.get("opponent") or "opposition")) for r in ((bc2.get("opposition") or {}).get("carrier_stats") or [])]
        if rows:
            facts["top_carries_both"] = max(rows, key=lambda r: r[1])
        pl = [(r.get("name"), r.get("passes_made") or r.get("passes") or 0, "own") for r in bc2.get("pass_leaders") or []]
        pl += [(r.get("name"), r.get("passes_made") or r.get("passes") or 0, facts.get("opponent") or "opposition") for r in ((bc2.get("opposition") or {}).get("pass_leaders") or [])]
        if pl and any(x[1] for x in pl):
            facts["top_passes_both"] = max(pl, key=lambda r: r[1])
    except Exception:
        pass
    try:
        from sqlalchemy import text as _t3
        rows = (await db.execute(_t3(
            "select po.name, pi.name from match_events me join players po on po.id = me.player_id join players pi on pi.id = me.sub_in_player_id "
            "where me.match_id = :m and me.event_type::text = 'substitution'"), {"m": str(match_id)})).all()
        facts["subs"] = {(_surname(on), _surname(off)) for off, on in rows}      # (came on, went off)
        facts["our_fouls"] = (await db.execute(_t3("select count(*) from match_events where match_id = :m and team = 'own' and event_type::text = 'foul_committed'"), {"m": str(match_id)})).scalar()
        facts["opp_free_scores"] = (await db.execute(_t3("select count(*) from match_events where match_id = :m and team = 'opponent' and event_type::text in ('point_free','two_point_free')"), {"m": str(match_id)})).scalar()
    except Exception:
        pass
    try:
        ph = json.loads(await execute_tool("get_phase_summary", {"match_id": match_id}, db, club_id=club_id))
        facts["kickouts_by_half"] = ph.get("kickouts_by_half") or (ph.get("extras") or {}).get("kickouts_by_half") or {}
    except Exception:
        pass
    try:
        facts["late_timeline"] = await _late_timeline(db, match_id, facts.get("half_duration_mins") or 30)
    except Exception:
        pass
    try:
        from sqlalchemy import text as _t2
        rows = (await db.execute(_t2("select half, minute, team, event_type::text from match_events where match_id = :m and minute is not null"),
                                 {"m": str(match_id)})).all()
        facts["event_minutes"] = {(r[0] or 1, r[1]) for r in rows}
        facts["score_minutes"] = {(r[0] or 1, r[1]) for r in rows if r[3] in _SCORE_VALUE}
        srows = (await db.execute(_t2(
            "select me.half, me.minute, coalesce(p.name, op.surname, me.opponent_player_name) from match_events me "
            "left join players p on p.id = me.player_id left join opposition_players op on op.id = me.opposition_player_id "
            "where me.match_id = :m and me.minute is not null and me.event_type::text = any(:t)"), {"m": str(match_id), "t": list(_SCORE_VALUE)})).all()
        facts["score_events"] = {(r[0] or 1, r[1], _surname(r[2] or "")) for r in srows}
        frows = (await db.execute(_t2(
            "select p.name, me.half, me.minute, me.event_type::text from match_events me join players p on p.id = me.player_id "
            "where me.match_id = :m and me.team = 'own' and me.minute is not null and me.event_type::text not in ('substitution', 'other')"),
            {"m": str(match_id)})).all()
        fe = {}
        for name, h, mi, et in frows:
            k, v = _surname(name), ((h or 1), mi, f"{et.replace('_', ' ')} at {when_label(h or 1, mi, facts.get('half_duration_mins') or 30)}")
            if k not in fe or v[:2] < fe[k][:2]:
                fe[k] = v
        facts["first_event"] = fe
        hs = {}
        for h, _mi, team, et in rows:
            if et in _SCORE_VALUE:
                u, t = hs.get(h or 1, (0, 0))
                hs[h or 1] = (u + _SCORE_VALUE[et], t) if team == "own" else (u, t + _SCORE_VALUE[et])
        facts["half_scores"] = hs
    except Exception:
        pass
    try:
        from sqlalchemy import text as _t
        w = (await db.execute(_t("select pitch_width_m from matches where id = :m"), {"m": str(match_id)})).scalar_one_or_none()
        facts["pitch_width_m"] = float(w or 90.0)
    except Exception:
        facts["pitch_width_m"] = 90.0
    return facts


_SCORE_VALUE = {"goal": 3, "point": 1, "two_point": 2, "point_free": 1, "two_point_free": 2, "forty_five": 1, "penalty_goal": 3}


async def _late_timeline(db, match_id, hdm) -> str:
    """Every score of the last period played, with the running margin after it: "ET2 81' McHugh -> 27-29 ..."."""
    from sqlalchemy import text as _t
    from app.services.ai.phase_facts import when_label
    rows = (await db.execute(_t(
        "select me.team, me.event_type::text, me.half, me.minute, coalesce(p.name, op.surname, me.opponent_player_name) "
        "from match_events me left join players p on p.id = me.player_id left join opposition_players op on op.id = me.opposition_player_id "
        "where me.match_id = :m and me.event_type::text = any(:t) order by me.half, me.match_clock_s nulls last, me.minute, me.created_at"),
        {"m": str(match_id), "t": list(_SCORE_VALUE)})).all()
    if not rows:
        return ""
    last = max(r[2] or 1 for r in rows)
    us = them = 0
    out = []
    for team, et, half, minute, name in rows:
        if team == "own":
            us += _SCORE_VALUE[et]
        else:
            them += _SCORE_VALUE[et]
        if (half or 1) >= last - 1:
            out.append(f"{when_label(half or 1, minute or 0, hdm)} {(name or '?').split(' ')[-1]} ({'us' if team == 'own' else 'them'}) -> {us}-{them}")
    return "; ".join(out)


def add_missing_scorers(text: str, facts: dict) -> Tuple[str, List[str]]:
    """Every one of our scorers is named somewhere; the ones the writer left out get one line before the opposition
    standouts (reviewer: Gallagher, C. O'Donnell and Roarty each scored 0-1 and were never mentioned)."""
    missing = []
    # paragraphs, not sentences: "**Michael Langan (...) – 7/10.** Scored 0-4" splits at the rating's full stop
    sents = [p for p in re.split(r"\n\s*\n|\n(?=[-*#|])", text) if p.strip()]
    for name, score in facts.get("own_scorers") or []:
        first, sur = name.split(" ")[0], _surname(name)
        if not sur:
            continue
        # named AS a scorer: a sentence with his name (first name or initial where two share the surname) and his score or
        # a scoring word. Being named for something else (a stray pass, a workload flag) does not count.
        who = (re.escape(first) + r" O'Donnell|\b" + re.escape(first[0]) + r"\. ?O'Donnell") if sur == "o'donnell" else (r"\b" + re.escape(sur) + r"\b")
        # his name, then (within the same stretch, before another bold name starts) his score figure, a two-pointer, or
        # "scored/kicked a point|goal" - not "we scored 2 points", which is the team
        near = (r"(?:" + who + r")(?:(?!\*\*[A-Z])[\s\S]){0,220}?(?:\b" + re.escape(score) + r"\b|\btwo-pointer\b|\btwo-point free\b|"
                r"(?<!we )(?<!they )\b(?:scored|kicked|landed|added)\b(?: (?:a|the|his|one|\d))? (?:point|goal|free|two-pointer|two-point free))")
        if not any(re.search(near, x, re.I) for x in sents):
            missing.append(f"{name} {score}")
    if not missing:
        return text, []
    line = "**Also on the scoresheet:** " + ", ".join(missing) + "."
    m = (re.search(r"\n(?:#+ *|\*\*)(?:Opposition|Their|" + re.escape(facts.get("opponent") or "Opposition") + r"(?:'s)?) standouts", text, re.I)
         or re.search(r"\n#+ *3\b", text))
    text = (text[:m.start()] + "\n\n" + line + "\n" + text[m.start():]) if m else (text.rstrip() + "\n\n" + line + "\n")
    return text, [f"added missing scorers: {', '.join(missing)}"]


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


_RATED = re.compile(r"^\*\*[^\n]*?[–-] *(\d{1,2})/10\.?\*\*")


def sort_ratings(text: str) -> Tuple[str, List[str]]:
    """Top Performers highest rating first (v5 had Conor O'Donnell 5/10 above McGonagle and Mulreany 6/10). Only a run of
    consecutive rated paragraphs is reordered, stably, so equal ratings keep the writer's order."""
    paras = re.split(r"(\n\s*\n)", text)
    blocks = paras[0::2]
    i = 0
    changed = False
    while i < len(blocks):
        if not _RATED.match(blocks[i].strip()):
            i += 1
            continue
        j = i
        while j < len(blocks) and _RATED.match(blocks[j].strip()):
            j += 1
        run = blocks[i:j]
        srt = sorted(run, key=lambda b: -int(_RATED.match(b.strip()).group(1)))
        if srt != run:
            blocks[i:j] = srt
            changed = True
        i = j
    if not changed:
        return text, []
    paras[0::2] = blocks
    return "".join(paras), ["top performers put in rating order"]


def check_report(text: str, facts: dict) -> Tuple[str, List[str], List[dict]]:
    hdm = facts.get("half_duration_mins") or 30
    text, f1 = fix_added_time(text, hdm, facts.get("event_minutes"), facts.get("score_minutes"), facts.get("score_events"))
    text, f2 = fix_field_names(text)
    text, f3 = drop_empty_headings(text)
    text, f4 = add_missing_scorers(text, facts)
    text, f5 = sort_ratings(text)
    return text, f1 + f2 + f3 + f4 + f5, find_issues(text, facts)


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
