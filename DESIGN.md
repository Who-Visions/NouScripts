---
name: "nou-scripts"
version: "0.2.1"
description: "Precision editorial cue-sheet reader, teleprompter, and cryptographic approval gate for Nou's news scripts."
colors: {
  "--bg": "#141414",
  "--panel": "#202020",
  "--panel-solid": "#202020",
  "--panel-2": "#282828",
  "--panel-hover": "#333333",
  "--line": "#2f2f3a",
  "--line-subtle": "#24242e",
  "--text": "#f2eee6",
  "--muted": "#bdb8ad",
  "--faint": "#827d73",
  "--accent-gold": "#e8b86d",
  "--accent-iris": "#bc8cff",
  "--accent-green": "#a9c79b",
  "--status-verified-text": "#a9c79b",
  "--status-verified-bg": "rgba(169, 199, 155, 0.12)",
  "--status-verified-border": "#a9c79b",
  "--status-pending-text": "#e8b86d",
  "--status-pending-bg": "rgba(232, 184, 109, 0.12)",
  "--status-pending-border": "#e8b86d",
  "--status-conflict-text": "#ffb4ab",
  "--status-conflict-bg": "rgba(255, 180, 171, 0.12)",
  "--status-conflict-border": "#ffb4ab",
  "--danger": "#ffb4ab",
  "--warn": "#e8b86d",
  "--focus": "#e8b86d",
  "--control-ink": "#141414"
}
---

# Nou Scripts · Design Specification

## referenceWorld

Precision broadcast instrument, television newsroom prompter rig, editorial technical publishing workbench, and cryptographic content sign-off console.

## antiPatterns

Reject decorative glassmorphism, multi-stop neon gradients, floating blur halos, cartoonish bubble pill buttons, bouncy physics, and noisy decorative waveforms. Every line and surface exists to serve readability under pressure.

## materiality

Opaque graphite surfaces (`#141414`, `#202020`, `#282828`), micro-fine dividers (`#2f2f3a`), warm matte amber (`#e8b86d`) for on-camera anchors, electric iris (`#bc8cff`) for voice-over cues, and verified sage green (`#a9c79b`) for cryptographic approvals.

## density & spatialComposition

- **Workbench & Layout**: Max reading measure clamped to 65ch to 75ch for spoken prose. Cards retain 0.75rem (12px) separation.
- **Cue Cards**: Opaque graphite cards with 1px border. Left anchor stripe indicates camera state (Amber for ON CAM, Iris for VO).
- **Tabular Alignment**: All metrics (words, seconds, cue numbers, versions, SHA-256 digests) use tabular monospace alignment (`font-variant-numeric: tabular-nums`).
- **Touch Targets**: All mobile and tablet touch targets meet or exceed 48px × 48px (`--target-touch: 2.75rem`), avoiding crowded controls during live takes.

## motionGrammar

- Strict 120ms ease-out transitions for interactive hovers and state toggles.
- Zero non-essential animations.
- When `prefers-reduced-motion` is active, all transitions and smooth scrolls collapse immediately.

## teleprompterPhysics

- Smooth continuous frame-synced auto-scroll (`withFrameNanos` / `requestAnimationFrame`) with zero jitter.
- Mirror mode support (`transform: scaleX(-1)` / `Modifier.graphicsLayer(scaleX = -1f)`) to accommodate 45-degree beam splitter glass rigs on physical cameras.
- Clean high-contrast typography (46px on desktop, 24sp–54sp on mobile) with 1.45 line-height for instant glanceability from 6–10 feet.
- Center reticle guidance indicator across viewport.
- Single tap / Spacebar cleanly toggles play/pause without leaving the reading flow.

## accessibility & contrast

- Body text on background: 15.9:1 contrast ratio (`#f2eee6` on `#141414`).
- Muted labels on panels: 8.2:1 contrast ratio (`#bdb8ad` on `#202020`).
- Touch targets: Minimum 48dp on Android, 40px on Desktop.
- Active focus outlines: `2px solid var(--focus)` with `3px` offset.

## brandVoice & wordingLint

- Voice tone: Direct, authoritative, active-voice news reporting.
- Wording linter actively detects and highlights AI clichés (`delve`, `tapestry`, `testament`, `vibrant realm`, `groundbreaking`).
- Flags appear as high-contrast warnings with interactive diagnostic modals providing active-voice replacements.
