"""A chat tool that hangs (a query that ignores cancellation) must not freeze the answer: the executor returns its
timeout error on time, abandons that session and hands the next tool a fresh one. Seen 2026-11-10: a 17-minute hang."""
import asyncio
import json
import time

from app.services.ai import chat_agent as C


class FakeSession:
    async def close(self):
        pass

    async def rollback(self):
        pass


def test_hanging_tool_returns_on_time_and_session_is_replaced(monkeypatch):
    async def stubborn(*a, **k):
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await asyncio.sleep(3600)     # ignores cancellation, like a stuck query
    monkeypatch.setattr(C, "execute_tool", stubborn)
    monkeypatch.setattr(C, "TOOL_EXECUTION_TIMEOUT_SECONDS", 0.3)

    first = FakeSession()
    sessions = C.ToolSessions(first)

    async def run():
        t0 = time.monotonic()
        out = await C._execute_tool_with_timeout("get_match_event_log", {}, sessions, club_id="x")
        return out, time.monotonic() - t0
    loop = asyncio.new_event_loop()
    try:
        out, took = loop.run_until_complete(run())
    finally:
        for t in asyncio.all_tasks(loop):
            t.cancel()
        loop.close()
    assert took < 2, took
    assert "timed out" in json.loads(out)["error"]
    assert sessions.db is None          # abandoned: the next get() opens a new one


def test_tool_error_becomes_a_result(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("bad query")
    monkeypatch.setattr(C, "execute_tool", boom)
    out = asyncio.run(C._execute_tool_with_timeout("get_match_event_log", {}, C.ToolSessions(FakeSession()), club_id="x"))
    assert "failed" in json.loads(out)["error"]
