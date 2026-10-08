"""Tenant guard: an endpoint that takes a data id (path/query or body) must reference the caller's club."""
import ast
import pathlib
import re

ROUTES = pathlib.Path(__file__).resolve().parents[1] / "app" / "routes"
ID_PARAM = re.compile(
    r"(^|_)(match|session|player|event|segment|snapshot|tag|report|clip|presentation|compilation|fixture|"
    r"training|gps|note|insight|drill|routine|member|team|user|club)_?id$|^(id|item_id)$"
)
CLUB = re.compile(r"club_id|_verify_match_club|_get_session_for_club|require_club|organization|org_id|\.club\b|assert_\w+_in_club")
HTTP = {"get", "post", "put", "delete", "patch"}
PUBLIC = ("/health", "/auth", "login", "callback", "webhook", "public", "shared/", "invite", "join", "sleep-reminder", "/{token}/info")


def _endpoints():
    for f in sorted(ROUTES.glob("*.py")):
        src = f.read_text(encoding="utf-8", errors="ignore")
        for node in ast.walk(ast.parse(src)):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            path = None
            for d in node.decorator_list:
                if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in HTTP:
                    path = d.args[0].value if d.args and isinstance(d.args[0], ast.Constant) else "?"
            if path is not None:
                yield f.name, path, node, src


def test_id_endpoints_check_club():
    bad = []
    for fn, path, node, src in _endpoints():
        if fn == "auth.py" or any(w in path for w in PUBLIC):
            continue
        params = [a.arg for a in node.args.args + node.args.kwonlyargs]
        if not any(ID_PARAM.search(p) for p in params):
            continue
        if not CLUB.search(ast.get_source_segment(src, node) or ""):
            bad.append(f"{fn}:{node.name} {path}")
    assert not bad, "Endpoints taking an id with no club check:\n" + "\n".join(bad)


def test_endpoints_require_auth():
    bad = []
    for fn, path, node, src in _endpoints():
        if fn == "auth.py" or any(w in path for w in PUBLIC):
            continue
        seg = ast.get_source_segment(src, node) or ""
        sig = seg.split(":\n", 1)[0] if ":\n" in seg else seg[:600]
        if not re.search(r"Depends\((get_current_user|require_\w+|get_\w*user\w*)", sig) and not re.search(r"AuthenticatedUser", sig):
            bad.append(f"{fn}:{node.name} {path}")
    assert not bad, "Endpoints without authentication:\n" + "\n".join(bad)
