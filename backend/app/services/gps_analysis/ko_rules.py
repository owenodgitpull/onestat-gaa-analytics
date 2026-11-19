"""Kickout patterns across every GPS match (Owen 2026-11-17): which player spots, pairings and kick types go with winning
or losing a kickout, e.g. "their kickouts that come down within 20 m of McGee: won 15 of 22".

How it works, per side (our kickouts / theirs), on the kicks that landed (over the sideline left out):
- Conditions, all read AT THE KICK (before anyone knows who wins it): each player's channel (our left / centre / right
  third) and length band from the kicking goal (short < 45 m, mid 45-65, long > 65, the landing-zone bands), each player
  within 20 m of where the ball came down, two players within 10 m of each other, 5+ / 6+ of ours in a channel, and
  where the kick landed (length, channel). Nothing measured at the tag: whoever wins the ball is at the drop by then, so
  "near the drop at the tag" would just restate the result.
- Patterns are one condition or two or three together, each with at least MIN_N kicks.
- Fair comparison: a pattern about a player is set against the OTHER kicks HE WAS ON FOR, so it is about where he
  stood, not whether he was picked (e.g. McGee near the drop v McGee elsewhere, never v games he missed).
- Luck check: searching hundreds of combinations always turns up some "8 of 8". So the won/lost labels are shuffled
  within each match LUCK_RUNS times and the whole search re-run; a pattern "stands out" only when its gap beats what the
  shuffles produce for patterns of the same size, set so pure noise passes about 1 run in 20. Below that it is "worth a look" (top of the list but
  could be chance) and nothing smaller is returned. With more matches the bar drops by itself.
Read-only, numbers only; the agent and the screen show the same list.
"""
from __future__ import annotations

import itertools
from typing import Dict, List, Optional

import numpy as np

MIN_N = 6              # a pattern needs this many kicks
MIN_REST = 5           # and this many other kicks (with the same players on) to compare with
SHRINK_K = 4           # pulls small groups towards the side's normal rate before comparing (6 of 6 is not 100%)
PAIR_M = 10.0          # "together": two players this close at the kick
DROP_M = 20.0          # "near where it came down": this close to the landing spot at the kick
IMPROVE = 0.05         # a 2- or 3-part pattern must beat each smaller part by this much, else the smaller one says it
TOP_PAIRS = 150        # pairs extended to threes
LUCK_RUNS = 300
LUCK_Q = 1 - 0.05 / 3     # 1 in 20 over the whole search: three sizes share the 5%
WATCH_FRAC = 0.65      # "worth a look" from this share of the luck bar
SPREAD_MATCHES = 3     # "stands out" also needs kicks from this many matches, none over SPREAD_SHARE of them
SPREAD_SHARE = 0.6
OVERLAP = 0.6          # a pattern sharing this much of its kicks with one already listed says the same thing: skipped
MAX_OUT = 12           # per direction per side

LEN_WORD = {"short": "short (under 45 m)", "mid": "mid (45-65 m)", "long": "long (over 65 m)"}


def _band(d: float) -> str:
    return "short" if d < 45 else "mid" if d <= 65 else "long"


def _chan(y: float, W: float) -> str:
    return "left" if y < W / 3 else "centre" if y <= 2 * W / 3 else "right"


def collect(res: dict) -> List[dict]:
    """The kick rows one match's analysis gives, cut to what the patterns need, tagged with the match."""
    out = []
    L, W = res["pitch_length_m"], res["pitch_width_m"]
    for r in res["kickouts"]["kickouts"]:
        out.append({"match_id": res["match_id"], "opponent": res["opponent"], "match_date": str(res.get("match_date") or "")[:10],
                    "L": L, "W": W, **{k: r[k] for k in ("video_ms", "half", "kind", "outcome", "won", "landing_x", "landing_y")},
                    "at_kick": [p for p in r["at_kick"] if p.get("x") is not None and p.get("y") is not None]})
    return out


def _conditions(rs: List[dict], kind: str):
    n = len(rs)
    conds: Dict[str, dict] = {}
    names: Dict[str, str] = {}

    def add(key, k, **meta):
        c = conds.get(key)
        if c is None:
            c = conds[key] = {"key": key, "v": np.zeros(n, bool), **meta}
        c["v"][k] = True

    for k, r in enumerate(rs):
        L, W = r["L"], r["W"]
        dk = (lambda x: x) if kind == "own" else (lambda x: L - x)
        lb, lc = _band(dk(r["landing_x"])), _chan(r["landing_y"], W)
        add(f"land:{lb}", k, type="landing_length", value=lb, players=())
        add(f"landch:{lc}", k, type="landing_channel", value=lc, players=())
        pk = {p["player_id"]: p for p in r["at_kick"]}
        for pid, p in pk.items():
            names[pid] = p["name"]
            ch, b = _chan(p["y"], W), _band(dk(p["x"]))
            add(f"ch:{pid}:{ch}", k, type="player_channel", value=ch, players=(pid,))
            add(f"len:{pid}:{b}", k, type="player_length", value=b, players=(pid,))
            if np.hypot(p["x"] - r["landing_x"], p["y"] - r["landing_y"]) <= DROP_M:
                add(f"drop:{pid}", k, type="player_near_drop", value=DROP_M, players=(pid,))
        for a, b in itertools.combinations(sorted(pk), 2):
            if np.hypot(pk[a]["x"] - pk[b]["x"], pk[a]["y"] - pk[b]["y"]) <= PAIR_M:
                add(f"pair:{a}:{b}", k, type="pair_together", value=PAIR_M, players=(a, b))
        for ch in ("left", "centre", "right"):
            cnt = sum(1 for p in pk.values() if _chan(p["y"], W) == ch)
            for t in (5, 6):
                if cnt >= t:
                    add(f"cnt:{ch}:{t}", k, type="count_channel", value=ch, count=t, players=())
    return conds, names


def _label(c: dict, names: Dict[str, str], kind: str = "own", w3: float = 28.0) -> str:
    """Reads after "when", in plain metres (Owen 2026-11-19: "on our centre" was unclear): "McGee was within 28 m of our
    left touchline", "Murphy was over 65 m from our goal". w3 = a third of the pitch width (the channel edge)."""
    nm = lambda pid: names.get(pid, "?")
    goal = "our goal" if kind == "own" else "their goal"
    band = {"short": f"within 45 m of {goal}", "mid": f"45-65 m from {goal}", "long": f"over 65 m from {goal}"}
    side = lambda ch: (f"in the middle (over {w3:.0f} m from both touchlines)" if ch == "centre" else f"within {w3:.0f} m of our {ch} touchline")
    t = c["type"]
    if t == "landing_length":
        return f"the kick came down {band[c['value']]}"
    if t == "landing_channel":
        return f"the kick came down {side(c['value'])}"
    if t == "player_channel":
        return f"{nm(c['players'][0])} was {side(c['value'])}"
    if t == "player_length":
        return f"{nm(c['players'][0])} was {band[c['value']]}"
    if t == "player_near_drop":
        return f"{nm(c['players'][0])} was within {DROP_M:.0f} m of where it came down"
    if t == "pair_together":
        return f"{nm(c['players'][0])} and {nm(c['players'][1])} were within {PAIR_M:.0f} m of each other"
    if t == "count_channel":
        return f"{c['count']}+ of ours were {side(c['value'])}"
    return c["key"]


def _role(c: dict, names: Dict[str, str], kind: str = "own") -> str:
    """The same condition in coaching words, for the "Setup" headline (Owen 2026-11-19: the reads had no tactical speak).
    Describes WHERE players stood, never why it worked: "McGee in the drop zone", "Malone pushed up", "overload on our
    left". Bands run from the kicking goal, so 'close to it' is pushed up on their kickout and dropped short on ours."""
    nm = lambda pid: names.get(pid, "?")
    near = {"short": "pushed up" if kind == "opp" else "dropped short", "mid": "in the middle third",
            "long": "dropped deep" if kind == "opp" else "pushed up the pitch"}
    t, v = c["type"], c["value"]
    if t == "landing_length":
        return {"short": "short kick", "mid": "mid-range kick", "long": "long kick"}[v]
    if t == "landing_channel":
        return "kick down the middle" if v == "centre" else f"kick to our {v} wing"
    if t == "player_channel":
        return f"{nm(c['players'][0])} " + ("central" if v == "centre" else f"wide on our {v}")
    if t == "player_length":
        return f"{nm(c['players'][0])} {near[v]}"
    if t == "player_near_drop":
        return f"{nm(c['players'][0])} in the drop zone"
    if t == "pair_together":
        return f"{nm(c['players'][0])} and {nm(c['players'][1])} paired up"
    if t == "count_channel":
        return "overload " + ("through the middle" if v == "centre" else f"on our {v}") + f" ({c['count']}+)"
    return c["key"]


def _join(parts: List[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


class _Search:
    """Every single, pair and three of conditions, scored with matrix products so the shuffles are cheap."""

    def __init__(self, C: np.ndarray, X: np.ndarray, min_n: int = MIN_N, min_rest: int = MIN_REST):
        self.min_n, self.min_rest = min_n, min_rest
        self.C = C.astype(np.float32)          # (m, n) condition holds
        self.X = X.astype(np.float32)          # (m, n) the condition's players were on (all ones for team/landing)
        self.Cb, self.Xb = C, X
        self.m, self.n = C.shape
        self.n1 = self.C.sum(1)
        self.x1 = self.X.sum(1)
        self.n2 = self.C @ self.C.T
        self.x2 = self.X @ self.X.T

    def _gap(self, hn, hw, xn, xw):
        """shrunk win rate when it holds minus the rate on the other kicks with the same players on"""
        with np.errstate(divide="ignore", invalid="ignore"):
            rn, rw = xn - hn, xw - hw
            ctx_rate = np.where(xn > 0, xw / np.maximum(xn, 1), 0)
            ph = (hw + SHRINK_K * ctx_rate) / (hn + SHRINK_K)
            pr = np.where(rn > 0, rw / np.maximum(rn, 1), 0)
            ok = (hn >= self.min_n) & (rn >= self.min_rest)
        return np.where(ok, ph - pr, 0.0)

    def run(self, w: np.ndarray):
        w = w.astype(np.float32)
        C, X = self.C, self.X
        g1 = self._gap(self.n1, C @ w, self.x1, X @ w)
        Cw, Xw = C * w, X * w
        g2 = self._gap(self.n2, Cw @ C.T, self.x2, Xw @ X.T)
        iu = np.triu_indices(self.m, 1)
        best1 = np.maximum(np.abs(g1)[iu[0]], np.abs(g1)[iu[1]])
        g2u = g2[iu]
        keep2 = (np.abs(g2u) >= best1 + IMPROVE) & (g2u != 0)
        # threes grow from the best pairs OF THIS RUN (a shuffle searches as hard as the real data did, or the bar is too low)
        idx = np.where(keep2)[0]
        idx = idx[np.argsort(-np.abs(g2u[idx]))][:TOP_PAIRS]
        pi, pj = iu[0][idx], iu[1][idx]
        g3 = np.zeros((len(pi), self.m), np.float32)
        if len(pi):
            V = self.Cb[pi] & self.Cb[pj]
            VX = self.Xb[pi] & self.Xb[pj]
            Vf, VXf = V.astype(np.float32), VX.astype(np.float32)
            n3 = Vf @ C.T
            x3 = VXf @ X.T
            g3 = self._gap(n3, (Vf * w) @ C.T, x3, (VXf * w) @ X.T)
            gp = g2[pi, pj][:, None]
            ok3 = (np.sign(g3) == np.sign(gp)) & (np.abs(g3) >= np.abs(gp) + IMPROVE)
            ok3[np.arange(len(pi)), pi] = False
            ok3[np.arange(len(pi)), pj] = False
            g3 = np.where(ok3, g3, 0.0)
        return g1, np.where(keep2, g2u, 0.0), iu, g3, (pi, pj)


def mine(rows: List[dict], kind: str, seed: int = 7, min_n: int = MIN_N, min_rest: int = MIN_REST, spread: bool = True) -> Optional[dict]:
    rs = [r for r in rows if r["kind"] == kind and r["outcome"] != "over the sideline" and r.get("landing_x") is not None]
    n = len(rs)
    if n < 2 * min_n:
        return None
    won = np.array([bool(r["won"]) for r in rs])
    conds, names = _conditions(rs, kind)
    w3 = float(np.median([r["W"] for r in rs])) / 3
    on: Dict[str, np.ndarray] = {}
    for k, r in enumerate(rs):
        for p in r["at_kick"]:
            on.setdefault(p["player_id"], np.zeros(n, bool))[k] = True
    keys = [k for k, c in conds.items() if c["v"].sum() >= min_n]
    if not keys:
        return None
    C = np.array([conds[k]["v"] for k in keys])
    X = np.array([np.logical_and.reduce([on[p] for p in conds[k]["players"]]) if conds[k]["players"] else np.ones(n, bool)
                  for k in keys])
    S = _Search(C, X, min_n, min_rest)
    g1, g2, iu, g3, (pi, pj) = S.run(won)

    # the luck bar per pattern size: shuffle won/lost inside each match, same candidate sets
    mids = np.array([r["match_id"] for r in rs])
    groups = [np.where(mids == m)[0] for m in np.unique(mids)]
    rng = np.random.default_rng(seed)
    mx = {1: [], 2: [], 3: []}
    for _ in range(LUCK_RUNS):
        pw = won.copy()
        for ix in groups:
            pw[ix] = rng.permutation(pw[ix])
        a1, a2, _, a3, _ = S.run(pw)
        mx[1].append(float(np.abs(a1).max())); mx[2].append(float(np.abs(a2).max())); mx[3].append(float(np.abs(a3).max()) if a3.size else 0.0)
    bar = {s: float(np.quantile(v, LUCK_Q)) for s, v in mx.items()}
    bar[2] = max(bar[2], bar[1]); bar[3] = max(bar[3], bar[2])     # a bigger pattern never gets an easier bar

    cands = []
    for i in np.where(g1 != 0)[0]:
        cands.append(((int(i),), float(g1[i])))
    for t in np.where(g2 != 0)[0]:
        cands.append(((int(iu[0][t]), int(iu[1][t])), float(g2[t])))
    for a, b in zip(*np.where(g3 != 0)):
        cands.append((tuple(sorted((int(pi[a]), int(pj[a]), int(b)))), float(g3[a, b])))

    # ranked by how far past ITS OWN luck bar each pattern is, so a plain one-player pattern near its bar comes before a
    # three-part one that only looks bigger because threes have more chances to be lucky
    # a pattern only about where the kick landed is in kick_types below, not repeated here
    landing_only = {i for i, k in enumerate(keys) if conds[k]["type"].startswith("landing")}
    ranked = []
    for t, g in cands:
        if all(i in landing_only for i in t):
            continue
        ratio = abs(g) / max(bar[len(t)], 1e-6)
        if ratio < WATCH_FRAC:
            continue
        h = np.logical_and.reduce([C[i] for i in t])
        per_match = np.array([h[ix].sum() for ix in groups])
        spread_ok = (not spread) or (int((per_match > 0).sum()) >= SPREAD_MATCHES and per_match.max() <= SPREAD_SHARE * h.sum())
        ranked.append((ratio * (1.0 if spread_ok else 0.8), t, g, ratio, h, spread_ok))
    # the last 3 matches (by date), so every pattern also reads "lately" beside the season (the team v itself)
    mdate = {r["match_id"]: r["match_date"] for r in rs}
    last3 = set(sorted(mdate, key=lambda m: mdate[m])[-3:]) if len(mdate) > 3 else set()
    in3 = np.array([r["match_id"] in last3 for r in rs])
    out = {"win": [], "lose": []}
    listed = {"win": [], "lose": []}
    for _, t, g, ratio, h, spread_ok in sorted(ranked, key=lambda x: (-x[0], len(x[1]))):
        size = len(t)
        d = "win" if g > 0 else "lose"
        if len(out[d]) >= MAX_OUT:
            continue
        ctx = np.logical_and.reduce([X[i] for i in t])
        if any((h & o).sum() / max((h | o).sum(), 1) >= OVERLAP for o in listed[d]):
            continue
        listed[d].append(h)
        strength = "stands out" if ratio >= 1 and spread_ok else "worth a look"
        rest = ctx & ~h
        parts = [{"type": conds[keys[i]]["type"], "value": conds[keys[i]]["value"], "players": list(conds[keys[i]]["players"]),
                  "label": _label(conds[keys[i]], names, kind, w3), "role": _role(conds[keys[i]], names, kind)} for i in t]
        pids = sorted({p for c in parts for p in c["players"]})
        kicks = [rs[k] for k in np.where(h)[0]]
        rest_kicks = [rs[k] for k in np.where(rest)[0]]

        def avg_spot(kk, pid):
            pts = [(p["x"], p["y"]) for r in kk for p in r["at_kick"] if p["player_id"] == pid]
            return {"x": round(float(np.mean([a for a, _ in pts])), 1), "y": round(float(np.mean([b for _, b in pts])), 1), "n": len(pts)} if pts else None
        by_match = {}
        for r in kicks:
            bm = by_match.setdefault(r["match_id"], {"match_id": r["match_id"], "opponent": r["opponent"], "match_date": r["match_date"], "n": 0, "won": 0})
            bm["n"] += 1; bm["won"] += bool(r["won"])
        hw, hn, rw, rn = int(won[h].sum()), int(h.sum()), int(won[rest].sum()), int(rest.sum())
        setup = " + ".join(c["role"] for c in parts)
        l3 = {"n": int((h & in3).sum()), "won": int(won[h & in3].sum()), "rest_n": int((rest & in3).sum()),
              "rest_won": int(won[rest & in3].sum())} if last3 else None
        n_m = len(by_match)
        # the one line every surface uses (cards, match tab, agents, reports): Setup, won X of Y, the rest, last 3,
        # matches, strength. "Setup" for winning, "Losing setup" for losing; the strength word never upgrades.
        card = (f"{'Setup' if d == 'win' else 'Losing setup'}: {setup} - won {hw} of {hn}"
                + (f" · rest {rw} of {rn}" if rn else "")
                + (f" · last 3 matches {l3['won']} of {l3['n']}" if l3 and l3["n"] else (" · not seen in the last 3 matches" if l3 else ""))
                + f" · {n_m} match{'es' if n_m != 1 else ''} · {strength}")
        out[d].append({
            "setup": setup, "card": card, "last3": l3,
            "id": "|".join(keys[i] for i in t), "size": size, "strength": strength, "direction": d,
            "label": _join([c["label"] for c in parts]), "parts": parts,
            "n": hn, "won": hw, "rate": round(hw / hn, 3), "rest_n": rn, "rest_won": rw, "rest_rate": round(rw / rn, 3) if rn else None,
            "gap_pts": round(100 * (hw / hn - (rw / rn if rn else 0))), "score": round(g, 3), "luck_bar": round(bar[size], 3),
            "vs_luck": round(ratio, 2), "mostly_one_match": not spread_ok,
            "rest_is": "the other kicks with " + (", ".join(names.get(p, "?") for p in pids) + " on" if pids else "the other kicks"),
            "reads": (f"Won {hw} of {hn} ({100 * hw / hn:.0f}%) when {_join([c['label'] for c in parts])}; "
                      f"{rw} of {rn} ({100 * rw / rn:.0f}%) on the other kicks" + (f" with {', '.join(names.get(p, '?') for p in pids)} on" if pids else "")) if rn else "",
            "matches": sorted(by_match.values(), key=lambda m: m["match_date"]),
            "players": [{"player_id": p, "name": names.get(p, "?"), "here": avg_spot(kicks, p), "otherwise": avg_spot(rest_kicks, p)} for p in pids],
            "kicks": [{"match_id": r["match_id"], "opponent": r["opponent"], "match_date": r["match_date"], "video_ms": r["video_ms"],
                       "half": r["half"], "outcome": r["outcome"], "won": bool(r["won"]), "landing_x": r["landing_x"], "landing_y": r["landing_y"]}
                      for r in kicks],
        })
    # kick types: length x channel across every match (the plain answer to "which kickouts work")
    grid = {}
    for r in rs:
        dk = r["landing_x"] if kind == "own" else r["L"] - r["landing_x"]
        c = grid.setdefault((_band(dk), _chan(r["landing_y"], r["W"])), {"length": _band(dk), "channel": _chan(r["landing_y"], r["W"]), "n": 0, "won": 0})
        c["n"] += 1; c["won"] += bool(r["won"])
    over = [r for r in rows if r["kind"] == kind and r["outcome"] == "over the sideline"]
    # every kick in short form, so the screen can answer "where did X stand when we won them" with any filter
    mlist = sorted({(r["match_id"], r["opponent"], r["match_date"]) for r in rs}, key=lambda m: m[2])
    mix = {m[0]: i for i, m in enumerate(mlist)}
    explore = {"names": names, "matches": [{"match_id": a, "opponent": b, "match_date": c} for a, b, c in mlist], "kicks": []}
    for r in rs:
        dk = (lambda x: x) if kind == "own" else (lambda x: r["L"] - x)
        explore["kicks"].append({
            "m": mix[r["match_id"]], "ms": r["video_ms"], "half": r["half"], "won": bool(r["won"]), "outcome": r["outcome"],
            "len": _band(dk(r["landing_x"])), "ch": _chan(r["landing_y"], r["W"]), "lx": r["landing_x"], "ly": r["landing_y"],
            "p": [[p["player_id"], _band(dk(p["x"])), _chan(p["y"], r["W"]),
                   int(np.hypot(p["x"] - r["landing_x"], p["y"] - r["landing_y"]) <= DROP_M), round(p["x"], 1), round(p["y"], 1)]
                  for p in r["at_kick"]]})
    return {
        "explore": explore,
        "kind": kind, "n_kicks": n, "won": int(won.sum()), "rate": round(float(won.mean()), 3),
        "matches": len(groups), "conditions_tested": len(keys), "luck_bar": {str(k): round(v, 3) for k, v in bar.items()},
        "patterns": out,
        "kick_types": sorted(grid.values(), key=lambda c: ({"short": 0, "mid": 1, "long": 2}[c["length"]], {"left": 0, "centre": 1, "right": 2}[c["channel"]])),
        "over_sideline": {"n": len(over), "won": sum(bool(r["won"]) for r in over)},
    }


MATCH_MIN_N = 4    # one match: 4 kicks a side is the least worth describing (the luck bar is far higher on so few)


def match_kickout_patterns(res: dict) -> dict:
    """The same search on ONE match's kickouts (the match Kickouts tab): smaller groups allowed, the luck check shuffles
    inside this match only, no spread-over-matches rule. With ~20-35 kicks a side, expect leads, rarely anything that
    stands out."""
    return kickout_patterns(collect(res), min_n=MATCH_MIN_N, min_rest=MATCH_MIN_N, spread=False)


HOW_TO_READ = (
    "Every condition is read AT THE KICK (before anyone knows who wins it), in our attack frame: channels are thirds of the "
    "width as WE attack; bands are metres from the KICKING goal (short < 45, mid 45-65, long > 65). A player pattern is "
    "compared with the other kicks HE was on for, so it is about where he stood, not whether he played. 'stands out' = the "
    "gap beats what shuffling won/lost at random inside each match produces for patterns of that size (pure noise passes about 1 time in 20); "
    "'worth a look' = near the top but could be chance. Never call a 'worth a look' pattern a cause; say 'goes with'. "
    "Kicks over the sideline are left out (counted in over_sideline)."
)


def kickout_patterns(rows: List[dict], min_n: int = MIN_N, min_rest: int = MIN_REST, spread: bool = True) -> dict:
    sides = {k: mine(rows, k, min_n=min_n, min_rest=min_rest, spread=spread) for k in ("own", "opp")}
    return {"sides": {k: v for k, v in sides.items() if v}, "matches": [{"match_id": a, "opponent": b, "match_date": c} for a, b, c in sorted({(r["match_id"], r["opponent"], r["match_date"]) for r in rows}, key=lambda m: m[2])],
            "min_n": min_n, "how_to_read": HOW_TO_READ}
