from types import SimpleNamespace

from app.services.ai._shared import _cache_conversation, call_cost, text_of


def test_one_moving_breakpoint_and_caller_list_untouched():
    msgs = [
        {"role": "user", "content": "Write the report"},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "a", "name": "t", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "a", "content": "x" * 10,
                                      "cache_control": {"type": "ephemeral"}}]},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "b", "name": "t", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "b", "content": "y"}]},
    ]
    out = _cache_conversation(msgs)
    marks = [b for m in out if isinstance(m["content"], list) for b in m["content"] if isinstance(b, dict) and "cache_control" in b]
    assert len(marks) == 1 and marks[0]["tool_use_id"] == "b"
    assert "cache_control" in msgs[2]["content"][0] and "cache_control" not in msgs[4]["content"][0]   # caller's list unchanged
    single = _cache_conversation([{"role": "user", "content": "hello"}])
    assert single[0]["content"][0]["cache_control"] == {"type": "ephemeral"}


def test_cost_and_text():
    u = SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000, cache_creation_input_tokens=0, cache_read_input_tokens=1_000_000)
    assert round(call_cost("claude-sonnet-5-5", u), 2) == 3.2     # $2 + $1 + $0.20
    r = SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text="hi")])
    assert text_of(r) == "hi"
