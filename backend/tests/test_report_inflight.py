import asyncio
from app.services.ai import match_agent as MA


def test_regenerate_does_not_join_a_plain_read(monkeypatch):
    calls = []

    async def fake_impl(db, match_id, force, exclude):
        calls.append(force)
        await asyncio.sleep(0.05)
        return {"force": force}

    monkeypatch.setattr(MA.MatchAgent, "_generate_post_match_report_impl", staticmethod(fake_impl))

    async def run():
        read = asyncio.ensure_future(MA.MatchAgent.generate_post_match_report(None, "m1"))
        await asyncio.sleep(0.01)
        regen = await MA.MatchAgent.generate_post_match_report(None, "m1", force_regenerate=True)
        # a second read arriving during the forced run joins it (one generation, not two)
        r2 = asyncio.ensure_future(MA.MatchAgent.generate_post_match_report(None, "m1", force_regenerate=True))
        await asyncio.sleep(0.01)
        r3 = await MA.MatchAgent.generate_post_match_report(None, "m1")
        return await read, regen, await r2, r3

    read, regen, r2, r3 = asyncio.run(run())
    assert regen == {"force": True} and read == {"force": False}
    assert r2 == r3 == {"force": True}
    assert calls == [False, True, True]
