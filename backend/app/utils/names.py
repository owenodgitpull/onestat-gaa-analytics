"""Name helpers shared by the opposition roster and the opposition lineup."""

_NAME_SUFFIXES = {"jr", "sr", "jnr", "snr", "ii", "iii", "iv", "v"}


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
