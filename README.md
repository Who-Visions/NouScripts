# Nou Scripts

A desktop reader for Nou's NouGen News scripts. It is the review step between writing a script and
rendering it: nothing should be voiced or rendered until a version is approved here.

## What it shows

- Every story folder under `~/.nougen/nou_assets/stories/` that holds `script_v1.md`, `script_v2.md`, ...
- Each cue as a card: ON CAM (gold) or VO (purple), its words and estimated seconds, and its source note.
- Which cues changed since the previous version.
- Estimated runtime, spoken words, on-camera seconds, and how many OmniAvatar jobs the on-camera lines need
  (one free job covers about 4.6 s of audio).
- A teleprompter view: Space plays and pauses, the up and down arrows change speed, Esc exits.
- It reloads by itself when a script file changes on disk.

Set `NOU_STORIES` to read a different folder.

## The approval gate

**Approve vN** writes `approval.json` into the story folder:

```json
{ "version": 2, "file": "script_v2.md", "sha256": "…", "approved_at": "…", "approved_at_eastern": "Tue, Nov 10, 1:10 PM EST", "note": "…" }
```

The hash pins the exact bytes. If the script is edited after approval, the app shows the approval as stale,
and a render step should refuse it. A render step checks it like this:

```js
const S = require('./src/scripts');
if (!S.approvalIsCurrent(dir, S.readApproval(dir))) throw new Error('script not approved');
```

## Script format

```markdown
# Nou script v2: Story title (draft, not rendered)

**1. ON CAM (open, ~7 s)**
Spoken line.

**2. VO (~14 s)**
Spoken line.
*Source note, shown under the card.*

## Any notes heading
- notes are shown below the cues
```

## Run

```bash
npm install
npm start
```

`npm test` runs the parser and approval tests. `npm run capture` writes a screenshot of the window to
`out/capture.png` without showing it; add `--mode=prompt` after `--` for the teleprompter view.

## Android APK

The native Android companion is in `android/`. It uses the Android system folder picker to open a
story folder containing `script_v1.md`, `script_v2.md`, and (after approval) `approval.json`. It
works offline and stores the approval beside the script folder. The Android app bundles the same
short ban-list vocabulary for review flags; a flag is an editing prompt, not an AI-authorship test.

The `Android APK` GitHub Actions workflow builds an installable debug-signed APK on pull requests,
main pushes, and manual runs. Download it from the workflow run's **Artifacts** section. When a
GitHub Release is published, the workflow attaches `nou-scripts-android-<tag>.apk` to that release.
This local repository currently has no Git remote, so these downloads become available after the
repository is connected to GitHub and the workflow is run there.

Local build: `cd android && ./gradlew assembleDebug`. The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.
