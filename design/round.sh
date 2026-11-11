#!/bin/zsh
# One design round: capture read + broadcast views, then AGY reviews them against the brief.
# usage: design/round.sh NN
set -e
cd "$(dirname "$0")/.."
N=$1; L=design/loop
./node_modules/.bin/electron . --capture=$L/r${N}_read.png --mode=read >/dev/null 2>&1
./node_modules/.bin/electron . --capture=$L/r${N}_broadcast.png --mode=broadcast >/dev/null 2>&1
cat > $L/r${N}_prompt.txt <<P
You are a principal product designer reviewing a desktop app against a design brief. Look at the two screenshots
(open the image files and inspect them carefully): $PWD/$L/r${N}_read.png and $PWD/$L/r${N}_broadcast.png.
The brief is $PWD/design/premium_brief.md. The CSS is $PWD/src/renderer/style.css (read-only for you: do NOT edit any file).

Judge ONLY what is visible in the two screenshots. The CSS cascades: the "Premium design loop" block at the END of
style.css overrides earlier rules, so a rule near the top may no longer apply. Never report a problem you cannot point
to in a screenshot, and never repeat a fix that is already visible. Prefer problems of hierarchy, alignment, spacing,
legibility and density over token pedantry.

Reply in this exact plain-text format, nothing else:
SCORE: <1-10 against the brief>
FIX 1: <one concrete visual problem you can SEE, where it is, and the exact CSS change (selector + property: value)>
FIX 2: ...
FIX 3: ...
BRIEF: <one new rule to add to the brief so this class of problem cannot recur>
P
agy -p "$(cat $L/r${N}_prompt.txt)" --dangerously-skip-permissions --print-timeout 600s > $L/r${N}_agy.txt 2>$L/r${N}_agy.err || true
cat $L/r${N}_agy.txt | grep -E "^(SCORE|FIX|BRIEF)" | cut -c1-400
