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
