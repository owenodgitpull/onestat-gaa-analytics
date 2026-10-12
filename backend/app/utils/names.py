"""Name helpers shared by the opposition roster and the opposition lineup."""

_NAME_SUFFIXES = {"jr", "sr", "jnr", "snr", "ii", "iii", "iv", "v"}


def clean_player_name(name: str, max_len: int = 100) -> str:
    """Opposition player name as entered: whitespace collapsed, kept in full ("Conor Cox"). Full names are what lets two
    players who share a surname ("Chris O'Donnell" / "Ryan O'Donnell") stay distinct on the pitch and in the analysis."""
    return " ".join(str(name or "").split())[:max_len]


def surname_only(name: str) -> str:
    """Data-minimisation pass for opposition player names — these are people who have never used OneStat and never
    consented to anything, so we keep only the surname. Enforced server-side so it holds whatever a client sends.
    Last whitespace-separated token ("Conor Cox" -> "Cox"); a generational suffix stays attached
    ("C O'Donnell Jr" -> "O'Donnell Jr") so a Jr/Sr pair does not collapse to just "Jr"."""
    parts = name.strip().split()
    if not parts:
        return name.strip()
    if len(parts) >= 2 and parts[-1].lower().rstrip(".") in _NAME_SUFFIXES:
        return f"{parts[-2]} {parts[-1]}"
    return parts[-1]


def their_player_label(name, our_surnames) -> str:
    """An opposition player's name as entered. When it shares a surname with one of OUR players in the same match, say
    whose it is - the analysis names our players by surname, so a bare "O'Donnell" would be ambiguous."""
    def norm(t: str) -> str:
        return str(t).replace("’", "'").strip().lower()
    n = (name or "").strip()
    parts = n.split()
    if parts and norm(parts[-1]) in {norm(s) for s in our_surnames}:
        return f"{n} (their player)"
    return n

