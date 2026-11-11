# Nou script v1: Story title here (draft, not rendered)

Program: NouGen News
Slug: STORY-SLUG
Talent: Nou
Format: VO/SOT package
Writer: Dave
Air: 2026-11-11

One-line summary of the story and its angle. Everything above the first cue is the header block.

**1. ON CAM (open, ~7 s)**
VIDEO: Nou, medium close-up, studio.
SUPER: NOU | NouGen News
Spoken words for this cue go here, one paragraph, written for the ear.
*Source note: where every fact in this cue comes from.*

**2. VO (~15 s)**
VIDEO: B-roll of the thing being described.
SUPER: Name Surname | Title, Organisation
Spoken words over the pictures.
*Source note.*

**3. SOT (~12 s)**
VIDEO: Interview clip, Name Surname.
SOT: IN "First words of the clip" OUT "last words of the clip" RUNS 0:12
*Source note: clip origin and timecode in the original.*

**4. VO (~10 s)**
VIDEO: Graphic: the key number on screen.
MUSIC: Bed under, fade at end of cue.
Spoken words that land the point.
*Source note.*

**5. ON CAM (close, ~8 s)**
VIDEO: Nou, medium close-up.
Closing line. Sources at nougenai.com. I'm Nou.
*Source note.*

## Notes

- What changed in this version, and why.
- Open questions for the editor.

<!--
THE TEMPLATE, reverse-engineered from as-broadcast and TV news scripts
(two-column news scripts, as-broadcast tables with time code, voice-over and radio scripts).

Invariants every broadcast script shares, and how this file carries them:

 1. Header block        title line + Program / Slug / Talent / Format / Writer / Air.
 2. Ordered cues        **N. KIND (hint, ~S s)**. The number is the cue's identity across versions.
 3. Segment type        KIND = ON CAM | VO | SOT | VO/SOT | PKG | READER | NAT | MUSIC | SFX | GFX.
 4. What is SEEN        VIDEO: shot, B-roll, graphic (left column of a TV script).
                        SUPER: on-screen text / lower third, "Line one | Line two".
 5. What is HEARD       the plain paragraph = spoken copy (right column).
                        SOT: IN "..." OUT "..." RUNS m:ss for recorded sound; RUNS adds to the clock.
                        MUSIC: / SFX: / NAT: for non-spoken sound.
 6. Who speaks          TALENT: overrides the header talent for one cue.
 7. Time                each cue's start time code is computed (spoken words at ~2.8 words/s + SOT runs);
                        the total running time (TRT) is the last cue's end.
 8. Verification        *italic line* = the source note. Every fact in the spoken copy must trace to it.
 9. Breaks              ## headings end the cues; everything after is notes.

Write for the ear: short sentences, one idea each, numbers as words, no cliches (banlist.txt).
-->
