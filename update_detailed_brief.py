from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

def add_new_feature(doc, heading_text, content_text):
    """Add a section with 'NEW:' prefix in green"""
    p = doc.add_paragraph()
    new_run = p.add_run('NEW: ')
    new_run.bold = True
    new_run.font.color.rgb = RGBColor(0, 128, 0)
    heading_run = p.add_run(heading_text)
    heading_run.bold = True
    heading_run.font.size = Pt(12)

    doc.add_paragraph(content_text)

# Load the original document
original_doc = Document('C:/Users/owen_/Downloads/OneStat-Platform-Brief-Detailed (1).docx')

# The original has 13 numbered sections. We'll add new sections before the footer.
# Find the last paragraph before the footer
footer_start_idx = None
for i, para in enumerate(original_doc.paragraphs):
    if 'OneStat — Turning GAA data into decisions' in para.text:
        footer_start_idx = i
        break

# If we found the footer, insert new sections before it
if footer_start_idx:
    # We need to work with the document structure to insert at the right place
    # For simplicity, let's just append to the end before creating new footer
    pass

# Actually, let's just add sections at the end (before manually adding footer)
add_new_feature(original_doc, 'Simple Scoring Mode',
    """A streamlined recording interface optimized for phone use when full tactical tracking is not required. """
    """Records scores, wides, fouls, cards, and substitutions via tap-only interaction without continuous """
    """ball position tracking. Suitable for underage matches, training games, or situations where a single """
    """analyst needs to cover multiple pitches. All core stats and AI post-match reports remain available."""
)

add_new_feature(original_doc, 'Assist Tracking',
    """Primary assists are explicitly captured during live recording. When a score is logged, a prompt """
    """appears asking who provided the assist. Assists are tracked in season leaderboards, player profiles, """
    """and included in AI analysis of playmaking patterns."""
)

add_new_feature(original_doc, 'Per-Match Pitch Dimensions',
    """Optional real pitch measurements can be set at match creation for non-standard pitches. GAA regulation """
    """allows 130-145m × 80-90m, and club grounds vary significantly. When set, all distance-based calculations """
    """(Team Volume, Orchestrator carry distance, xP, ball-carrier chains) use the actual pitch dimensions """
    """instead of the default 145×90m assumption."""
)

add_new_feature(original_doc, 'Half-Time Enhancements',
    """Screenshot Sharing — A "Share to Coaching Staff" button instantly captures the half-time stats display """
    """as an image, ready to send via WhatsApp or other messaging apps.\n\n"""
    """Voice Notes — A mic button allows quick audio observations to be recorded during the match. Notes are """
    """stored against the match timeline and can be reviewed post-match.\n\n"""
    """45m-Line Explicit Placement — When logging a 45-metre kick, the analyst taps the exact landing spot """
    """on the pitch for accurate positioning."""
)

add_new_feature(original_doc, 'Video Compilations',
    """AI-powered creation of downloadable MP4 compilations from tagged video events. The AI analyst can be """
    """asked "show me all Conor Greene's wides this season" and will generate a real video file combining """
    """those clips. Uses HTTP range-seeking against R2 source videos — clips are extracted directly without """
    """downloading full source files. The concat step re-encodes (not stream-copy) since clips may span """
    """different matches/devices with different codecs. Cap: 20 clips per compilation. Status tracking and """
    """download available through /video-compilations page. Notifications sent when ready."""
)

add_new_feature(original_doc, 'Presentations',
    """Full coaching presentation toolkit for squad meetings and player feedback sessions.\n\n"""
    """Slide Deck Builder — Create presentations with clip/animation/text slides. Clips reference existing """
    """tagged video events; animations reference existing set piece routines; text slides are title/body cards """
    """for narration breaks. Drag-reorder via dnd-kit.\n\n"""
    """Freeze-Frame Annotation — Pause any video clip and annotate the frame with: select/move tool, arrows, """
    """straight lines, circles, spotlight (inverted mask highlighting a zone), freehand pencil, text boxes, """
    """color picker, undo/redo. Annotations saved as JSON coordinates (% of frame) and rendered via shared """
    """SVG overlay component.\n\n"""
    """Moving Tracking Graphics — Coach clicks on a player at several points while scrubbing a clip, dropping """
    """keyframes. Present mode linearly interpolates a glowing tracking ring between keyframes during playback. """
    """Single-point tracking only (multi-player link-lines not yet implemented).\n\n"""
    """Per-Slide Voiceover — Record audio narration for any slide (not just animations). Uses same MediaRecorder """
    """pattern as playbook voiceover. Mic-only, not full screen+mic recording.\n\n"""
    """Player Clip Tagging — Tag specific players on any slide. Tagged players receive push + in-portal """
    """notifications deep-linking to that slide. New "My Clips" tab in player portal shows all slides where """
    """they've been tagged.\n\n"""
    """Present Mode — Full-screen arrow-key/tap step-through. Clips auto-play their trimmed range and hold """
    """on last frame (no auto-advance — coach controls progression while narrating live)."""
)

add_new_feature(original_doc, 'Player Privacy Controls',
    """Players can opt out of leaderboard visibility via a self-service toggle on the player portal's """
    """Leaderboards page. Their own dashboard still shows their own rank; admins/managers always see everyone. """
    """Addresses GDPR data minimization and player consent preferences."""
)

add_new_feature(original_doc, 'Orchestrator Leaderboard',
    """New leaderboard category tracking playmakers by carry distance and progressive passes. Identifies """
    """the players who advance possession most effectively through ball-carrying and forward passing."""
)

add_new_feature(original_doc, 'Compliance Enhancements',
    """Opposition player data is automatically restricted to surname-only (enforced server-side in """
    """match_prep.py's save_opposition_roster via _last_name_only function). Both Match Prep roster textarea """
    """and Select Lineup inline copy honor this restriction.\n\n"""
    """Weather logging now supports multi-select — multiple conditions (e.g., "windy + light rain") can be """
    """recorded per match. The weather_conditions JSON field stores the full set; weather_condition (singular) """
    """is kept in sync as the first entry for backward compatibility with existing single-icon badges."""
)

original_doc.save('C:/Users/owen_/Downloads/OneStat-Platform-Brief-Detailed-UPDATED-Oct2026.docx')
print('✓ Detailed document updated and saved to Downloads')
print('\nBoth documents updated!')
print('  - OneStat-Platform-Brief-Overview-UPDATED-Oct2026.docx')
print('  - OneStat-Platform-Brief-Detailed-UPDATED-Oct2026.docx')
