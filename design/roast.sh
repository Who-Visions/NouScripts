#!/bin/zsh
# One roast round: build the React UI, capture Read / As Broadcast / Write in a visible window over DevTools,
# then AGY (headless, --dangerously-skip-permissions) roasts them against the brief and the Stitch reference.
# usage: design/roast.sh NN      output: design/roast/rNN_*.png, rNN_agy.txt (only the verdict lines are printed)
set -e
cd "$(dirname "$0")/.."
N=$1; R=design/roast; S="$PWD/$R"
npx vite build >/dev/null 2>&1
STORIES=${NOU_STORIES:-$HOME/.nougen/nou_assets/stories}
(NOU_STORIES="$STORIES" ./node_modules/.bin/electron . --remote-debugging-port=9334 >/dev/null 2>&1 &)
for i in {1..15}; do curl -s -o /dev/null localhost:9334/json && break; sleep 1; done
node design/roast_capture.mjs 9334 "$S" "r$N" > $R/r${N}_scan.txt 2>&1 || true
node design/roast_align.mjs "$S/r${N}_align.png" "$S/align_probe.js" > $R/r${N}_align.txt 2>&1 || true
pkill -f "remote-debugging-port=9334" || true
cat > $R/r${N}_prompt.txt <<P
You are the most demanding principal product designer alive, reviewing a premium enterprise SaaS desktop app.
Roast it hard. No compliments, no softening. Dark-roast it to hell, then be exact.

Open and inspect these images carefully:
- CURRENT Read view:        $S/r${N}_read.png
- CURRENT As Broadcast view: $S/r${N}_broadcast.png
- CURRENT Write view:        $S/r${N}_write.png
- STITCH REFERENCE (target quality bar, not a pixel spec): $S/stitch_reference.png
Brief: $PWD/design/premium_brief.md. The UI is React + Tailwind v4 + shadcn/ui in $PWD/ui/src/components/*.jsx (read them; do NOT edit any file).
Layout is fixed by the owner (top band, icon rail + panel + script + right rail, three-module bottom dock); attack everything else.

What changed since the previous round (judge whether it worked, and let the SCORE move when it did):
$(cat $R/changes_r${N}.txt 2>/dev/null || echo 'first round')

Every "old" string you quote MUST be copied exactly from the current file (it will be checked with grep; an invented
class name voids the fix). Alignment is measured each round and is currently exact; do not ask to re-align columns.
Judge ONLY what is visible in the CURRENT screenshots. Never repeat a fix that is already visible. Prefer hierarchy, alignment,
rhythm, density, legibility, affordance and polish over token pedantry. Each fix must name the component file and the exact
Tailwind className change (old -> new) or the exact JSX change.

Reply in this exact plain-text format, nothing else:
SCORE: <1-10>
ROAST: <one brutal sentence>
FIX 1: <file> :: <visible problem> :: <exact change>
FIX 2: <file> :: <visible problem> :: <exact change>
FIX 3: <file> :: <visible problem> :: <exact change>
BRIEF: <one new rule so this class of problem cannot recur>
P
agy -p "$(cat $R/r${N}_prompt.txt)" --dangerously-skip-permissions --print-timeout 600s > $R/r${N}_agy.txt 2>$R/r${N}_agy.err || true
grep -E "^(SCORE|ROAST|FIX|BRIEF)" $R/r${N}_agy.txt | cut -c1-420
grep -E "overflow|error" $R/r${N}_scan.txt | head -3
echo "ALIGN: $(cat $R/r${N}_align.txt)"
