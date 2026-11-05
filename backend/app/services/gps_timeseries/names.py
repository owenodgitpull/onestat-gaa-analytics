"""Device display name -> player.

STATSports names look like "EB. Gallagher", "CC. O'Donnell", "S. O'Donnell", "D. O'Baoill", "E. McGeehan":
initials (one or two letters) + dot + surname, with the club's accents and spellings not always matching the
roster ("Dáire Ó Baoill", "Eoin McGeehin"). Rules, in order:
  1. gps_alias on the player (exact, folded)
  2. surname matches (folded; the whole of the name after the first word, or the last word; 5-letter prefix
     tolerance for spellings like McGeehan/McGeehin) AND the initials are a prefix of the player's first-name
     initials (Eoghan Bán -> "EB"; "CC" accepts "C")
  3. the existing summary-upload matcher (first name, abbreviations, substrings)
Ambiguous (two players tie) -> None, so the user picks.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Optional, Tuple


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z]", "", s.lower())


def split_device_name(device_name: str) -> Tuple[str, str]:
    g = (device_name or "").strip().strip('"')
    if "." in g:
        initials, surname = g.split(".", 1)
        return fold(initials), fold(surname)
    parts = g.split()
    if len(parts) >= 2:
        return fold(parts[0][:1]), fold(" ".join(parts[1:]))
    return "", fold(g)


def match_device_name(device_name: str, players: Iterable) -> Tuple[Optional[object], str]:
    """players: objects with .id, .name and optional .gps_alias. Returns (player, how)."""
    players = list(players)
    initials, surname = split_device_name(device_name)
    target = fold(device_name)
    for p in players:
        aliases = [fold(a) for a in (getattr(p, "gps_alias", None) or "").split(",") if a.strip()]
        if target in aliases:
            return p, "alias"
    cands = []
    for p in players:
        clean = re.sub(r"\(.*?\)", "", p.name).strip()
        words = clean.split()
        if len(words) < 2 or not surname:
            continue
        sur_full = fold(" ".join(words[1:])); sur_last = fold(words[-1])
        exact = surname in (sur_full, sur_last)
        fuzzy = len(surname) >= 5 and (sur_full.startswith(surname[:5]) or surname.startswith(sur_full[:5]) or sur_last.startswith(surname[:5]))
        if not (exact or fuzzy):
            continue
        first_initials = fold("".join(w[0] for w in words[:-1]))
        if initials and not (first_initials.startswith(initials) or initials.startswith(first_initials[:1])):
            continue
        score = (2 if first_initials == initials else 1) + (0 if exact else -0.5)
        cands.append((score, p))
    if cands:
        cands.sort(key=lambda c: -c[0])
        if len(cands) > 1 and cands[0][0] == cands[1][0]:
            return None, "ambiguous"
        return cands[0][1], ("initials_surname" if cands[0][0] >= 2 else "fuzzy_surname")
    try:
        from app.routes.match_gps import _match_gps_player
        p, how = _match_gps_player(device_name, players)
        return p, how
    except Exception:
        return None, "none"
