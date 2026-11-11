from app.services.ai.phase_facts import when_label
from app.services.ai.report_check import check_report

FACTS = {"opponent": "Dublin", "half_duration_mins": 35, "our_missed_total": 14, "opp_missed_total": 17,
         "our_missed_parts": "8 wides, 3 shorts, 1 hit posts, 1 saved, 1 missed 45s", "opp_scores": 25,
         "max_speed": ("Finnbarr Roarty", 8.99), "pitch_width_m": 90.0,
         "pass_links": {("o'donnell", "mogan"): 9, ("mogan", "o'donnell"): 7},
         "two_pointers": {"ours": {"from_play": ["Shane O'Donnell (2nd half 53')", "Jason McGee (2nd half 61')"],
                                   "from_frees": ["Michael Murphy (2nd half 70+1')", "Gavin Mulreany (extra time 1 80')"]}}}


def test_two_pointer_split_and_tool_talk_are_caught():
    p = _problems("Two-pointers: we scored 4, 2 from play (Michael Murphy, Jason McGee) and 2 from frees.")
    assert any("murphy listed as a two-pointer from play" in x for x in p)
    assert any("talks about the tools" in x for x in _problems("The tool flags Langan as high load."))
    assert any("inside_45_center" in x for x in _problems("Most scoring came from there (inside_45_center: 16 scores)."))


def test_when_label_writes_added_time():
    assert when_label(2, 71, 35) == "2nd half 70+1'"
    assert when_label(3, 70, 35) == "extra time 1 70'"
    assert when_label(3, 82, 35) == "extra time 1 80+2'"
    assert when_label(1, 20, 35) == "1st half 20'"


def _problems(text):
    return [i["problem"] for i in check_report(text, FACTS)[2]]


def test_review_errors_are_caught():
    assert any("13, not 14" in p for p in _problems("We had 8 wides, 3 shorts, 1 hit post and 1 save, 14 missed shots in all."))
    assert any("3-point gap" in p for p in _problems("We led by 4 points at 11-20 minutes (1-02 to 0-02)."))
    assert any("not the highest" in p for p in _problems("Top speed of 8.92 m/s, the highest in the squad."))
    assert any("wider than the pitch" in p for p in _problems("Our shape was stretched (width 97.5 m at 70:46)."))
    assert any("22 Dublin scores" in p for p in _problems("Of 22 Dublin scores, nobody was close on 13."))
    assert any("7 passes, not 9" in p for p in _problems("Mogan-to-O'Donnell was the most frequent connection (9 passes)."))
    assert any("no period" in p for p in _problems("Murphy and McGee both took black cards at 70'."))


def test_true_sentences_pass_and_mechanical_fixes_apply():
    ok = ("Of their 25 scores, 22 had a GPS frame. 9 passes from O'Donnell to Mogan. Guiden scored at extra time 1 71', 75' "
          "and 77'. We had 8 wides, 3 shorts, 1 hit post, 1 save and 1 missed 45, 14 missed shots in all.")
    assert _problems(ok) == []
    text, fixed, _ = check_report("Campbell's stray pass at extra time 1 81'. His impact_points is 27.", FACTS)
    assert "extra time 1 80+1'" in text and "impact score" in text and len(fixed) == 2


def test_parts_and_player_wides_and_period_nearby():
    f = dict(FACTS, player_wides={"gallen": 1, "o'donnell": 2})
    p = [i["problem"] for i in check_report("We won only 7 of 33 contested kickouts: 4 of 13 in the first half, 1 of 10 in the "
                                           "second, 0 of 1 in extra time 1 and 2 of 3 in extra time 2.", f)[2]]
    assert any("parts add to 7 of 27" in x for x in p)
    p = [i["problem"] for i in check_report("Conor O'Donnell had 2 wides, Gallen 2 wides plus a short.", f)[2]]
    assert any("Gallen had 1" in x for x in p)
    assert _problems("He moved to midfield in extra time 1 at 71'.") == []
    assert _problems("Guiden scored at extra time 1 71', 75' (a two-pointer) and 77'.") == []
    assert _problems("The extra time 1 changes at 71' are too early to judge.") == []


def test_player_score_and_mean():
    f = dict(FACTS, player_scores={"o'callaghan": "1-6", "murphy": "0-4"}, means=[1.4])
    p = [i["problem"] for i in check_report("C. O'Callaghan (impact score 27) scored 1-3 including a two-pointer.", f)[2]]
    assert any("scored 1-6, not 1-3" in x for x in p)
    assert [i for i in check_report("Murphy scored 0-4 in all.", f)[2]] == []
    p = [i["problem"] for i in check_report("From 223 passes, a median of 1.4 team-mates were within 15 m.", f)[2]]
    assert any("mean" in x for x in p)


def test_overall_return_and_more_tool_talk():
    f = dict(FACTS, our_points_total=28, our_shots_total=34)
    p = [i["problem"] for i in check_report("Our overall return was 24 points from 34 shots, about 0.71 per shot.", f)[2]]
    assert any("we scored 28 points" in x for x in p)
    assert any("talks about the tools" in x for x in _problems("He lost no turnovers in the impact data."))
    assert any("talks about the tools" in x for x in _problems("GPS data was not matched to him in the list returned."))
    assert _problems("From the logged carries, Mogan gained 10.0 m per carry.") == []


def test_distance_superlative_and_empty_heading():
    f = dict(FACTS, max_distance=("Caolan McGonagle", 12.8))
    p = [i["problem"] for i in check_report("Shane O'Donnell covered 12.4 km (the most of any player in the match).", f)[2]]
    assert any("not the most" in x for x in p)
    t, fixed, _ = check_report("## A\n\ntext\n\n## Match Charts\n\n*Knowledge base passages consulted: x.*", f)
    assert "Match Charts" not in t and "## A" in t


def test_impact_number_flagged():
    assert any("impact-score" in x for x in _problems("Mogan had the highest impact score on our side (23) with 1-1."))
    assert any("impact-score" in x for x in _problems("C. O'Callaghan (impact score 27) scored 1-5."))
    assert not any("impact-score" in x for x in _problems("Mogan made the biggest all-round contribution on our side: 1-1 and two assists."))


def test_side_and_sprint_superlative_false_alarms():
    f = dict(FACTS, max_distance=("Caolan McGonagle", 12.8))
    assert _problems("Of 17 missed shots, nobody of ours was within 5 m on 7.") == []
    assert [i for i in check_report("Roarty: 10.9 km over 84 minutes, 15 sprints (the most on the team).", f)[2]] == []
    assert any("14 missed shots" in x or "13" in x for x in _problems("We had 13 missed shots in all."))


# ---- review round 3 (Dublin v4/v5) ----
from app.services.ai.report_check import fix_added_time, add_missing_scorers, find_issues


def test_late_minute_goes_to_the_next_period_when_the_score_was_there():
    # McHugh's points were at extra time 2 81' and 82' (written as extra time 1); other events were logged at 81' in both
    ev = {(3, 81), (4, 81), (4, 82)}
    sc = {(4, 81), (4, 82)}
    out, fixed = fix_added_time("He scored 0-3 including points in extra time 1 at 81' and 82'.", 35, ev, sc)
    assert "extra time 2 at 81'" in out and fixed
    # a stray pass in extra time 1 added time stays added time
    out2, _ = fix_added_time("A stray pass at extra time 1 81'.", 35, {(3, 81)}, sc)
    assert "extra time 1 80+1'" in out2


def test_half_level_by_points_to_and_empty_target():
    f = {"half_duration_mins": 35, "half_scores": {2: (11, 13)}}
    probs = [i["problem"] for i in find_issues(
        "The second half was level. Dublin won extra time by 4 points to 1. A target to aim for is better than this match's median.", f)]
    assert any("not level" in p for p in probs)
    assert any("mixes a margin" in p for p in probs)
    assert any("no target figure" in p for p in probs)


def test_missing_scorers_named_as_scorers_not_just_mentioned():
    text = ("## 2. Top Performers\n\n**Gavin Mulreany (goalkeeper), 6/10.** He scored the two-point free in extra time 1 80'.\n\n"
            "Roarty 1 stray pass (extra time 2 85'). Max Campbell came on for Finnbarr Roarty: in the next ten minutes we scored 2 points.\n\n"
            "**Dublin's standouts:**\n- C. Basquel 0-7\n")
    f = {"opponent": "Dublin", "own_scorers": [("Gavin Mulreany", "0-2"), ("Finnbarr Roarty", "0-1")]}
    out, fixed = add_missing_scorers(text, f)
    assert "Finnbarr Roarty 0-1" in out and "Mulreany 0-2" not in out.split("Also on the scoresheet")[1]
    assert out.index("Also on the scoresheet") < out.index("Dublin's standouts")


def test_returned_player_described_only_as_replaced():
    f = {"returned": {"campbell": ["1st half 0' - 1st half 35'", "extra time 1 72' - extra time 2 90+1' (full time)"]}}
    probs = [i["problem"] for i in find_issues("Ryan McHugh replaced Max Campbell at half-time.", f)]
    assert any("went back on" in p for p in probs)
