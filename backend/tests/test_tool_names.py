"""Agent tool names: every tool is wired up, every tool list an agent uses names real tools, old names still route,
and prompts do not refer the model to a tool name that does not exist (tool names were made descriptive 2026-11-10)."""
import asyncio
import json
import re
from pathlib import Path

from app.services.ai import _shared
from app.services.ai._shared import TOOLS, OLD_TOOL_NAMES, execute_tool

NAMES = [t["name"] for t in TOOLS]
AI_DIR = Path(_shared.__file__).parent


def test_names_unique_and_valid():
    assert len(NAMES) == len(set(NAMES)), [n for n in NAMES if NAMES.count(n) > 1]
    for n in NAMES:
        assert re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", n), n


def test_every_tool_is_dispatched():
    """Calling each tool with no club must hit the club guard or its own branch - never 'Unknown tool'."""
    async def run(name):
        return await execute_tool(name, {}, db=None, club_id=None)
    for n in NAMES:
        out = asyncio.run(run(n)) if n not in ("search_web_gaa_news", "display_starting_lineup", "create_data_table") else None
        if out is not None:
            assert "Unknown tool" not in out, n


def test_dispatch_branches_match_definitions():
    src = (AI_DIR / "_shared.py").read_text(encoding="utf-8")
    body = src[src.index("async def execute_tool("):]
    branches = set(re.findall(r'tool_name == "([a-z0-9_]+)"', body))
    assert set(NAMES) <= branches, sorted(set(NAMES) - branches)


def test_agent_tool_lists_name_real_tools():
    from app.services.ai import season_agent, match_agent
    lists = {"SEASON_TOOLS": season_agent.SEASON_TOOLS, "PLAYER_TOOLS": season_agent.PLAYER_TOOLS,
             "TRAINING_TOOLS": season_agent.TRAINING_TOOLS, "LIVE_TOOLS": match_agent.LIVE_TOOLS}
    for label, names in lists.items():
        missing = [n for n in names if n not in NAMES]
        assert not missing, (label, missing)


def test_old_names_route_to_new():
    for old, new in OLD_TOOL_NAMES.items():
        assert new in NAMES, new
        assert old not in NAMES, old
    out = asyncio.run(execute_tool("get_match_events", {}, db=None, club_id=None))
    assert "No club context" in json.loads(out)["error"]


def test_prompts_do_not_name_retired_tools():
    """The model must never be told to call a name that is no longer a tool. Code identifiers (the Python functions
    keep their names) are fine; only string literals are checked."""
    import io
    import tokenize
    for f in AI_DIR.glob("*.py"):
        src = f.read_text(encoding="utf-8")
        skip = range(0)
        if f.name == "_shared.py":     # the alias table itself names the old tools
            lines = src.splitlines()
            a = next(i for i, l in enumerate(lines, 1) if l.startswith("OLD_TOOL_NAMES = {"))
            b = next(i for i, l in enumerate(lines[a:], a + 1) if l.startswith("}"))
            skip = range(a, b + 1)
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type != tokenize.STRING or tok.start[0] in skip:
                continue
            for old in OLD_TOOL_NAMES:
                assert not re.search(rf"\b{old}\b", tok.string), f"{f.name}:{tok.start[0]} still says {old}"
