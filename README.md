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

## Broadcast script template

`templates/broadcast_script_template.md` is the universal format, reverse-engineered from as-broadcast scripts
(time code + speaker + dialogue tables) and two-column TV news scripts (video left, audio right).
Copy it into a story folder as `script_v1.md`. What it carries:

| Invariant | In the file |
|---|---|
| Header block | `Program:` `Slug:` `Talent:` `Format:` `Writer:` `Air:` above the first cue |
| Ordered cues, segment type | `**N. KIND (hint, ~S s)**`: ON CAM, VO, SOT, VO/SOT, PKG, READER, NAT, MUSIC, SFX, GFX |
| What is seen | `VIDEO:` shot or B-roll · `SUPER:` lower third (`Line one \| Line two`) · `GFX:` graphic |
| What is heard | the plain paragraph is spoken copy · `SOT: IN "…" OUT "…" RUNS m:ss` · `MUSIC:` `SFX:` `NAT:` |
| Who speaks | `TALENT:` per cue, else the header |
| Time | each cue's time code and the total running time are computed (words at 2.8/s + SOT runs) |
| Verification | the `*italic*` line under a cue is its source note |

**As Broadcast** in the app shows any script in this two-column form with running time code.

## Producer line lanes

The bottom input has three lanes and a **Digest** button. Model calls use `NVIDIA_API_KEY` (Nemotron 3 Ultra by
default); search uses `EXA_API_KEY_2`/`_3`, then `TAVILY_API_KEY`. Keys are read from the Keymaker in the main process only.

- **Edit**: suggestions open in Write; nothing saves until you do.
- **Web fetch**: paste links; each is read and saved to the story's `sources/`, then attached.
- **Research**: a question becomes 3-4 searches; up to 10 sources are saved and a cited `research_*.md` brief is written.
- **Digest**: works out what each link is at runtime (`tools/digest_resolve.py`): YouTube captions, audio or video
  transcribed locally with faster-whisper (no paid API), PDFs, or web pages. Writes `digest_*.md` with timestamps.
  Needs `~/.nougen/venvs/digest` (`faster-whisper yt-dlp youtube-transcript-api pypdf`); without it, links are read as pages.

## Media sources

Web fetch and Digest also collect the media a link points to: a page's preview image, inline photos (largest
`srcset` entry), `<video>`/`<audio>` sources and posters, YouTube/Vimeo/X/TikTok/Loom embeds, and linked media
files or PDFs. A video or audio link keeps its thumbnail. Photos are downloaded to the story's `media/` folder
(icons, trackers and anything under 6 KB skipped); everything is listed in `media.json`. The **Media sources** panel
in the right rail filters by type, and each item can be opened, sent to Digest (video, audio, PDF), attached
(downloaded photos), or copied as a `VIDEO:` line for a cue. Check the rights to any third-party picture before air.

## React renderer (ui/)

The window is a React 19 app built with Vite, Tailwind v4 and shadcn/ui (`ui/`, built to `src/renderer-dist/`,
which `src/main.js` loads; the old vanilla renderer in `src/renderer/` stays as a fallback when no build exists).
`npm start` builds first. `ui/src/lib/useNou.js` holds all state and talks to the main process only through
`window.nou`; the main process and its IPC did not change.

Layout: top band (hamburger menu with story actions and shortcuts, title with a version dropdown, the four view
modes, a View menu for Changes / Source notes / Side panel, then telemetry); middle (icon rail, panel column with
Stories, Media sources, Desk and Sources grouped in collapsible sections, the script, and a right rail with the
approval gate and notes as accordions); bottom dock (lane dropdown and model, the producer input with + and
Digest, the last reply).

Component drafts were requested from free NouGenOpen lanes (`design/draft_component.py`, `design/draft_all.sh`,
contract in `design/react_spec.md`); `IconRail.jsx` was kept from a draft, the rest were rewritten in review.

## Live jobs over MessagePorts

Fetch, Digest, Research and Edit each open their own `MessageChannelMain` (`withJob` in `src/main.js`). One port
goes to the window (`src/preload.js` forwards it into the page, as the Electron MessagePorts guide shows for
context-isolated pages; `ui/src/lib/jobs.js` picks it up by job id). The job streams named steps, which the dock
shows live with elapsed time, and the dock's Stop button sends `{type: 'cancel'}`: every network call in the job
and the local transcription process are aborted through one `AbortSignal` carried by `AsyncLocalStorage`.

## Auto-updates

`src/updater.js` wraps Electron's `autoUpdater` (Squirrel.Mac and Squirrel.Windows). It is inert until both are true:
the app is packaged (`app.isPackaged`) and `NOU_UPDATE_URL` points at a feed. The feed is read per platform and
version: `$NOU_UPDATE_URL/<platform>-<arch>/<version>`.

Before updates can install for real, two things must exist and neither is in this repo yet:
1. A signed macOS build. Electron's docs say Squirrel.Mac only applies updates to a signed app.
2. A feed server with the release artifacts (zip for macOS, Squirrel for Windows) and an endpoint that answers the update check.

An update is never installed on its own. When one is downloaded the top bar offers "Restart to install the update", and
that refuses while a job is running (`isBusy` counts the MessagePort jobs). Tests: `node --test test/updater.test.js`.
