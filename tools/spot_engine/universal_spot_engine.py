#!/usr/bin/env python3
"""Universal three-pillar commercial compiler: the 744-frame, 31.00 s, 24 fps archetype.

Feed it a brand profile (JSON, see profiles/) and it writes five deliverables in one pass:

  1. <slug>.edl              CMX 3600 edit list for DaVinci Resolve or Premiere
  2. <slug>_veo_flow.json    Veo 3.1 / Flow prompt manifest, one clip per cut
  3. <slug>_hud_rig.html     WebGL HUD for cut 7 (F561-F652), deterministic window.renderFrame(f)
  4. <slug>_sfx_guide.wav    24-bit, 48 kHz frame-locked guide: pulse, impact, three clear chimes, HUD pings, chord
  5. <slug>_assemble.sh      FFmpeg conform: trims every clip to its cut, muxes audio, loudnorm to -14 LUFS

Zero dependencies (standard library only). Changes from the spec it came from:
  - EDL reel names are "AX" (CMX 3600 allows 8 characters; 16-character reels break Resolve). The clip
    name rides in the FROM CLIP NAME comment, which Resolve matches on.
  - The HUD page takes three.js from a URL you pass (--three-url), so it renders offline; it does not
    autoplay unless ?play=1; the orbit is 3.2 m (2.4 m cropped the lattice); opacity is capped at 1.
  - The WAV really is 24-bit, the 116 BPM pulse is placed in seconds (rounding to 12 frames made it 120 BPM),
    and the impact is 55 Hz as specified.
  - The assembler trims each clip to its cut by frame count and joins them with the concat filter, so a 4, 6
    or 8 second generated clip lands frame-exact (measured: first and last frame of all nine cuts). Loudness
    is two-pass loudnorm.
  - Every cut boundary, the frame total and the pillar frames are checked before anything is written.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import struct
import wave
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Dict, List

FPS = 24
TOTAL_FRAMES = 744
SAMPLE_RATE = 48000
HUD_FIRST, HUD_LAST = 561, 652
IMPACT_FRAME = 264
CHORD_FRAME = 712
PULSE_BPM = 116.0

# The invariant nine-cut topology. End frames are exclusive, so the cuts sum to exactly 744.
TIMELINE_TOPOLOGY = [
    ("001", "01_hook",          0,  83, "35mm T2.2", "Dolly push-in +18 cm"),
    ("002", "02_stall_p1",     83, 185, "50mm T2.0", "Static over-the-shoulder medium close-up"),
    ("003", "03a_walk_in",    185, 253, "35mm T2.8", "Steadicam backward lead, 1.1 m/s"),
    ("004", "03b_macro_drop", 253, 315, "85mm T4.0", "Low-angle tabletop macro, impact at F264"),
    ("005", "04_clear_p1",    315, 385, "50mm T2.4", "Low-angle two-shot, clear at F338"),
    ("006", "05_clear_p2",    385, 485, "35mm T2.8", "Whip-pan two-shot, clear at F439"),
    ("007", "06_clear_p3",    485, 561, "35mm T2.2", "Steadicam 30 degree counter-clockwise arc, clear at F519"),
    ("008", "07_hud_lattice", 561, 653, "50mm virtual", "35 degree clockwise orbit, 3D HUD"),
    ("009", "08_end_card",    653, 744, "85mm T5.6", "Studio packshot, +3% push-in"),
]


@dataclass
class PillarSpec:
    id: str
    name: str
    hud_label: str
    hex_color: str
    hud_trigger_frame: int
    clear_frame: int
    clear_gesture: str
    chime_freq_hz: float
    actor_role: str
    setting_zone: str
    stall_question: str
    spokesperson_cue: str
    resolved_answer: str
    camera_rig: str
    lens_spec: str
    hud_xyz: List[float]


@dataclass
class BrandCommercialSpec:
    project_slug: str
    brand_name: str
    product_title: str
    tagline: str
    header_sub: str
    spokesperson_role: str
    wardrobe_spec: str
    studio_setting: str
    hero_prop_hook: str
    hero_artifact: str
    hook_line: str
    intervention_line: str
    hud_vo_line: str
    outro_vo_line: str
    legal_disclaimer: str
    footer_disclaimer: str
    palette: Dict[str, str]
    sku_lineup: List[str]
    ecosystem_badges: List[str]
    pillars: List[PillarSpec] = field(default_factory=list)
    end_card_address: str = ""          # where to get it; shown on the end card when set
    claims_verified: bool = False       # set true only once every on-screen claim is checked
    claims_notes: List[str] = field(default_factory=list)
    accent_name: str = ""               # the accent in words, for picture models (they ignore hex codes)
    spokesperson_look: str = ""         # one fixed description, repeated in every shot, so it is the same person

    @classmethod
    def from_dict(cls, d: dict) -> "BrandCommercialSpec":
        known = {f.name for f in fields(cls)}
        unknown = set(d) - known
        if unknown:
            raise ValueError(f"unknown profile keys: {sorted(unknown)}")
        d = dict(d)
        d["pillars"] = [PillarSpec(**p) for p in d.get("pillars", [])]
        return cls(**d)


def frame_to_tc(frame: int, fps: int = FPS) -> str:
    s, f = divmod(frame, fps)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def validate(spec: BrandCommercialSpec) -> None:
    """Refuse to compile a spot that cannot cut together."""
    pos = 0
    for _, cid, a, b, _, _ in TIMELINE_TOPOLOGY:
        if a != pos or b <= a:
            raise ValueError(f"cut {cid} runs {a}-{b}; expected to start at {pos}")
        pos = b
    if pos != TOTAL_FRAMES:
        raise ValueError(f"cuts total {pos} frames, expected {TOTAL_FRAMES}")
    if len(spec.pillars) != 3:
        raise ValueError(f"the archetype has three pillars; profile has {len(spec.pillars)}")
    clear_cuts = [c for c in TIMELINE_TOPOLOGY if c[1].startswith(("04_", "05_", "06_"))]
    for p, (_, cid, a, b, _, _) in zip(spec.pillars, clear_cuts):
        if not a <= p.clear_frame < b:
            raise ValueError(f"pillar {p.id} clears at F{p.clear_frame}, outside its cut {cid} (F{a}-F{b - 1})")
        if not HUD_FIRST <= p.hud_trigger_frame <= HUD_LAST:
            raise ValueError(f"pillar {p.id} lights at F{p.hud_trigger_frame}, outside the HUD cut")
    for key in ("primary_accent", "hud_bg_inner", "hud_bg_outer"):
        if key not in spec.palette:
            raise ValueError(f"palette is missing {key}")


class CommercialCompiler:
    def __init__(self, spec: BrandCommercialSpec, out_dir: Path, three_url: str = "https://unpkg.com/three@0.160.0/build/three.module.js"):
        validate(spec)
        self.spec = spec
        self.out_dir = out_dir
        self.three_url = three_url
        self.out_dir.mkdir(parents=True, exist_ok=True)

    def compile_all(self) -> Dict[str, Path]:
        return {
            "edl": self.build_edl(),
            "veo_manifest": self.build_veo_manifest(),
            "hud_html": self.build_webgl_hud(),
            "sfx_wav": self.build_procedural_audio(),
            "ffmpeg_sh": self.build_ffmpeg_assembler(),
        }

    # 1. CMX 3600 edit list
    def build_edl(self) -> Path:
        s = self.spec
        lines = [f"TITLE: {s.project_slug.upper()}_744F", "FCM: NON-DROP FRAME", ""]
        for idx, cid, a, b, lens, rig in TIMELINE_TOPOLOGY:
            dur = b - a
            lines.append(f"{idx}  AX       V     C        {frame_to_tc(0)} {frame_to_tc(dur)} {frame_to_tc(a)} {frame_to_tc(b)}")
            lines.append(f"* FROM CLIP NAME: {cid}.mp4")
            lines.append(f"* COMMENT: {lens} | {rig} ({dur} frames)")
            lines.append("")
        path = self.out_dir / f"{s.project_slug}.edl"
        path.write_text("\n".join(lines), encoding="utf-8")
        return path

    # 2. Veo 3.1 / Flow manifest
    def prompts(self, visual: bool = False) -> Dict[str, str]:
        """Clip prompts. visual=True drops every spoken line and VO and every piece of on-screen copy: a picture
        model cannot say lines, and it renders quoted text badly. Voices and type go on in post."""
        s = self.spec
        p1, p2, p3 = s.pillars
        accent = (s.accent_name or s.palette["primary_accent"]) if visual else s.palette["primary_accent"]
        who = f"{s.spokesperson_role} ({s.spokesperson_look})" if visual and s.spokesperson_look else s.spokesperson_role

        def say(lead: str, line: str, silent: str = "") -> str:
            # Spoken: "<lead>'<line>'". Visual: the silent action, so the shot still reads as speech.
            if visual:
                return silent
            return f"{lead}'{line}'" if line else silent

        def copy(text: str, blank: str) -> str:
            return blank if visual else text

        end = copy(f" A monospace address line reads '{s.end_card_address}'.", "") if s.end_card_address else ""
        out = {
            "01_hook": (f"35mm T2.2 medium shot, slow dolly in, {s.studio_setting}. {who} in {s.wardrobe_spec} "
                        f"lowers {s.hero_prop_hook} and looks into the lens" + say(", and says: ", s.hook_line, ", speaking to camera") + "."),
            "02_stall_p1": (f"{p1.lens_spec} over-the-shoulder shot at {p1.setting_zone}. {p1.actor_role}"
                            + say(" asks: ", p1.stall_question, " looks up, searching their memory") + ". "
                            f"A glossy 3D white 12-spoke loading wheel pops in six inches above their head."),
            "03a_walk_in": (f"35mm T2.8 Steadicam backward tracking shot in {s.studio_setting}. {who} walks "
                            f"toward the lens, facing the camera, holding {s.hero_artifact}" + say(", saying: ", s.intervention_line, ", talking to camera") + "."),
            "03b_macro_drop": (f"85mm T4.0 tabletop macro. A hand sets {s.hero_artifact} with {accent} accents firmly on the "
                               f"desk centre at frame 11, releasing cleanly as a specular sweep crosses the bevel."),
            "04_clear_p1": (f"{p1.lens_spec} low-angle two-shot. {who}" + say(" says ", p1.spokesperson_cue) +
                            f" {p1.clear_gesture} the 3D wheel above {p1.actor_role}, shattering it into {accent} sparks. "
                            f"{p1.actor_role}" + say(" exclaims: ", p1.resolved_answer, "'s face lights up") + "."),
            "05_clear_p2": (f"{p2.lens_spec} {p2.camera_rig} to {p2.setting_zone}. {p2.actor_role}, under a spinning 3D wheel,"
                            + say(" asks: ", p2.stall_question, " squints") + f". {who}"
                            + say(" says ", p2.spokesperson_cue, " steps in") + f", {p2.clear_gesture} the wheel away, and "
                            f"{p2.actor_role}" + say(" replies: ", p2.resolved_answer, " grins") + "."),
            "06_clear_p3": (f"{p3.lens_spec} {p3.camera_rig} around {p3.actor_role} stalled at {p3.setting_zone} under a 3D wheel. "
                            f"{who} walks past" + say(" saying ", p3.spokesperson_cue) + f", {p3.clear_gesture} the wheel "
                            f"into {accent} motes; {p3.actor_role} goes back to work."),
            "07_hud_lattice": (f"50mm orbital camera inside a dark HUD ({s.palette['hud_bg_inner']}). A rotating 3D lattice at centre. "
                               f"Three callouts lock on one after another in {p1.hex_color}" + copy(f" ('{p1.hud_label}')", "") +
                               f", {p2.hex_color}" + copy(f" ('{p2.hud_label}')", "") + f" and {p3.hex_color}" + copy(f" ('{p3.hud_label}')", "") +
                               "." + say(" VO: ", s.hud_vo_line) +
                               f" Prefer the deterministic render from {s.project_slug}_hud_rig.html for this cut."),
            "08_end_card": (f"85mm packshot, 3 percent push-in. " + copy(f"Top banner '{s.brand_name} | {s.tagline}'.", "A plain dark banner across the top.") +
                            f" Centre lineup of {len(s.sku_lineup)} matte-obsidian hardware modules with {accent} light strips, on a bright seamless sweep" + copy(f": {', '.join(s.sku_lineup)}", "") + "." +
                            copy(f" Footer in plain text: Works with {', '.join(s.ecosystem_badges)}.", " A clean white footer bar.") +
                            end + say(" VO: ", s.outro_vo_line)),
        }
        # Roles start lower case ("a senior engineer"); capitalise them where they open a sentence.
        return {k: re.sub(r"(^|\. )([a-z])", lambda m: m.group(1) + m.group(2).upper(), v) for k, v in out.items()}

    def build_veo_manifest(self) -> Path:
        s = self.spec
        prompts, visual = self.prompts(), self.prompts(visual=True)
        manifest = {
            "project": s.project_slug, "fps": FPS, "total_frames": TOTAL_FRAMES,
            "status": "NOT RUN. Generation costs money and needs an explicit go-ahead. Composite on-screen text in post.",
            "claims_verified": s.claims_verified, "claims_notes": s.claims_notes,
            "brand_metadata": asdict(s),
            "clips": [{"index": idx, "clip_id": cid, "frame_in": a, "frame_out": b, "duration_frames": b - a,
                       "duration_sec": round((b - a) / FPS, 3), "lens": lens, "rig": rig, "prompt": prompts[cid], "visual_prompt": visual[cid]}
                      for idx, cid, a, b, lens, rig in TIMELINE_TOPOLOGY],
        }
        path = self.out_dir / f"{s.project_slug}_veo_flow.json"
        path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return path

    # 3. WebGL HUD for cut 7
    def build_webgl_hud(self) -> Path:
        s = self.spec
        esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
        clusters = json.dumps([{"id": p.id, "label": p.hud_label, "color": p.hex_color,
                                "triggerFrame": p.hud_trigger_frame, "pos": p.hud_xyz} for p in s.pillars])
        c = [p.hex_color for p in s.pillars]
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{esc(s.brand_name)}: cut 7 HUD (F{HUD_FIRST}-F{HUD_LAST})</title>
<style>
  html, body {{ margin:0; width:100%; height:100%; background:{s.palette['hud_bg_outer']}; overflow:hidden; font-family: system-ui, sans-serif; }}
  #hud {{ position:relative; width:100vw; height:100vh; background: radial-gradient(circle, {s.palette['hud_bg_inner']} 0%, {s.palette['hud_bg_outer']} 100%); }}
  canvas {{ position:absolute; inset:0; display:block; width:100%; height:100%; }}
  .header {{ position:absolute; top:5%; width:100%; text-align:center; color:#fff; letter-spacing:0.22em; font-size:2.2vw; font-weight:700; z-index:2; }}
  .callout {{ position:absolute; z-index:2; color:#fff; font-size:1.1vw; letter-spacing:0.14em; padding:0.5vw 1vw; border-left:3px solid #fff; opacity:0; background:rgba(0,0,0,0.45); }}
  .callout.right {{ border-left:none; border-right:3px solid #fff; text-align:right; }}
  #c0 {{ border-color:{c[0]}; }}
  #c1 {{ border-color:{c[1]}; }}
  #c2 {{ border-color:{c[2]}; }}
</style>
</head>
<body>
<div id="hud">
  <canvas id="gl"></canvas>
  <div class="header">{esc(s.brand_name)} &nbsp;|&nbsp; {esc(s.product_title)}</div>
  <div id="c0" class="callout">{esc(s.pillars[0].hud_label)}</div>
  <div id="c1" class="callout">{esc(s.pillars[1].hud_label)}</div>
  <div id="c2" class="callout">{esc(s.pillars[2].hud_label)}</div>
</div>
<script type="module">
import * as THREE from '{self.three_url}';
const CLUSTERS = {clusters};
const FIRST = {HUD_FIRST}, LAST = {HUD_LAST}, RADIUS = 3.2;
const q = new URLSearchParams(location.search);
const W = Number(q.get('w')) || window.innerWidth, H = Number(q.get('h')) || window.innerHeight;
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({{ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
const idle = new THREE.Color(0x1a362e);
const geo = new THREE.OctahedronGeometry(0.085, 1);
// The lattice sits a little low so the top cluster clears the header.
const root = new THREE.Group();
root.position.y = -0.1;
scene.add(root);
const nodes = CLUSTERS.map((c, idx) => {{
  const g = new THREE.Group();
  g.position.set(...c.pos);
  for (let i = 0; i < 52; i++) {{
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({{ color: idle.clone(), wireframe: true, transparent: true, opacity: 0.4 }}));
    m.position.set(Math.sin(i * 1.7) * 0.4, Math.cos(i * 2.3) * 0.34, Math.sin(i * 3.1) * 0.36);
    g.add(m);
  }}
  root.add(g);
  return {{ cfg: c, group: g, color: new THREE.Color(c.color), dom: document.getElementById('c' + idx) }};
}});

window.renderFrame = function (globalFrame) {{
  const t = Math.max(0, Math.min(LAST - FIRST, globalFrame - FIRST)) / (LAST - FIRST);
  const ang = THREE.MathUtils.degToRad(-17.5 + 35.0 * t);
  camera.position.set(Math.sin(ang) * RADIUS, 0.15, Math.cos(ang) * RADIUS);
  camera.lookAt(0, 0, 0);
  const pulse = globalFrame >= 635 ? 1.0 + 0.35 * Math.sin(((globalFrame - 635) / 17.0) * Math.PI) : 1.0;
  for (const {{ cfg, group, color, dom }} of nodes) {{
    const p = THREE.MathUtils.clamp((globalFrame - cfg.triggerFrame) / 10.0, 0.0, 1.0);
    dom.style.opacity = String(p);
    // Each label follows its own cluster: project the cluster centre and sit outside it, on the near side.
    const v = new THREE.Vector3();
    group.getWorldPosition(v);
    v.project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const left = x < innerWidth / 2;
    dom.classList.toggle('right', !left);
    dom.style.top = (y - dom.offsetHeight / 2) + 'px';
    dom.style.left = left ? Math.max(8, x - innerWidth * 0.13 - dom.offsetWidth) + 'px' : '';
    dom.style.right = left ? '' : Math.max(8, innerWidth - x - innerWidth * 0.13 - dom.offsetWidth) + 'px';
    for (const m of group.children) {{
      m.material.color.lerpColors(idle, color, p);
      m.material.opacity = Math.min(1, THREE.MathUtils.lerp(0.35, 0.95, p) * pulse);
    }}
  }}
  renderer.render(scene, camera);
}};
window.hudRange = [FIRST, LAST];
window.renderFrame(FIRST);
window.hudReady = true;
if (q.get('play') === '1') {{
  let f = FIRST;
  setInterval(() => {{ window.renderFrame(f); f = f >= LAST ? FIRST : f + 1; }}, 1000 / 24);
}}
</script>
</body>
</html>
"""
        path = self.out_dir / f"{s.project_slug}_hud_rig.html"
        path.write_text(html, encoding="utf-8")
        return path

    # 4. Frame-locked 24-bit guide track
    def sfx_events(self) -> List[dict]:
        """Every guide event with its frame, so tests and the edit can check the sync."""
        ev = []
        beat_s = 60.0 / PULSE_BPM
        k = 0
        while k * beat_s < TOTAL_FRAMES / FPS:
            ev.append({"kind": "pulse", "sec": k * beat_s, "dur": 0.08, "freq": 220.0, "amp": 0.10, "decay": 25.0})
            k += 1
        ev.append({"kind": "impact", "frame": IMPACT_FRAME, "dur": 0.35, "freq": 55.0, "amp": 0.75, "decay": 10.0})
        for p in self.spec.pillars:
            ev.append({"kind": "chime", "frame": p.clear_frame, "dur": 0.45, "freq": p.chime_freq_hz, "amp": 0.45, "decay": 6.0})
            ev.append({"kind": "chime5th", "frame": p.clear_frame, "dur": 0.30, "freq": p.chime_freq_hz * 1.5, "amp": 0.25, "decay": 9.0})
            ev.append({"kind": "hud_ping", "frame": p.hud_trigger_frame, "dur": 0.15, "freq": 2400.0, "amp": 0.22, "decay": 20.0})
        for f in (261.63, 329.63, 392.00, 523.25):
            ev.append({"kind": "chord", "frame": CHORD_FRAME, "dur": 1.25, "freq": f, "amp": 0.18, "decay": 2.5})
        for e in ev:
            e.setdefault("sec", e.get("frame", 0) / FPS)
        return ev

    def build_procedural_audio(self) -> Path:
        n = TOTAL_FRAMES * SAMPLE_RATE // FPS          # exactly 31.0 s
        buf = [0.0] * n
        for e in self.sfx_events():
            start = round(e["sec"] * SAMPLE_RATE)
            w = 2.0 * math.pi * e["freq"] / SAMPLE_RATE
            for i in range(min(int(e["dur"] * SAMPLE_RATE), n - start)):
                buf[start + i] += e["amp"] * math.exp(-e["decay"] * i / SAMPLE_RATE) * math.sin(w * i)
        pcm = bytearray()
        for v in buf:
            x = int(max(-0.98, min(0.98, v)) * 8388607)
            pcm += struct.pack("<i", x)[:3]                 # 24-bit little-endian
        path = self.out_dir / f"{self.spec.project_slug}_sfx_guide.wav"
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(3)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(bytes(pcm))
        return path

    # 5. FFmpeg conform
    def build_ffmpeg_assembler(self) -> Path:
        """Each clip is trimmed by frame count and joined with the concat filter, which is frame-exact. (The
        concat demuxer with outpoints, tried first, repeated the previous clip's last frame at every cut.)
        Loudness is two-pass loudnorm: measure, then apply with the measured values."""
        s = self.spec
        concat = ["ffconcat version 1.0"]   # for editors and NLE import; the master below does not use it
        for _, cid, a, b, _, _ in TIMELINE_TOPOLOGY:
            concat += [f"file '{cid}.mp4'", "inpoint 0", f"outpoint {(b - a) / FPS:.6f}"]
        concat_path = self.out_dir / f"{s.project_slug}_concat.txt"
        concat_path.write_text("\n".join(concat) + "\n", encoding="utf-8")
        cids = [cid for _, cid, *_ in TIMELINE_TOPOLOGY]
        inputs = " ".join(f'-i "{cid}.mp4"' for cid in cids)
        chains = ";".join(
            f"[{i}:v]fps={FPS},tpad=stop_mode=clone:stop_duration=10,trim=start_frame=0:end_frame={b - a},setpts=PTS-STARTPTS,"
            f"scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]"
            for i, (_, _, a, b, _, _) in enumerate(TIMELINE_TOPOLOGY))
        joins = "".join(f"[v{i}]" for i in range(len(cids)))
        n = len(cids)
        sh = f"""#!/usr/bin/env bash
# Conform and master for {s.project_slug}: {TOTAL_FRAMES} frames, {TOTAL_FRAMES / FPS:.2f} s at {FPS} fps.
# Put the nine clips ({cids[0]}.mp4 ... {cids[-1]}.mp4) next to this script; each is trimmed to its cut by frame
# count, so a 4, 6 or 8 second generated clip is fine; a clip shorter than its cut holds its last frame. Audio is {s.project_slug}_mix.wav when it exists,
# otherwise the guide track. Usage: bash {s.project_slug}_assemble.sh [WIDTHxHEIGHT]   (default 3840x2160)
set -euo pipefail
cd "$(dirname "$0")"
SIZE="${{1:-3840x2160}}"; W="${{SIZE%x*}}"; H="${{SIZE#*x}}"
AUDIO="{s.project_slug}_mix.wav"; [ -f "$AUDIO" ] || AUDIO="{s.project_slug}_sfx_guide.wav"
for c in {' '.join(cids)}; do
  [ -f "$c.mp4" ] || {{ echo "missing $c.mp4" >&2; exit 1; }}
done
# Pass 1: measure loudness.
MEASURED=$(ffmpeg -nostdin -hide_banner -i "$AUDIO" -af loudnorm=I=-14:TP=-2.0:LRA=7:print_format=json -f null - 2>&1 | python3 -c 'import sys, json; t = sys.stdin.read(); d = json.loads(t[t.rindex("{{"):t.rindex("}}") + 1]); print("measured_I={{input_i}}:measured_TP={{input_tp}}:measured_LRA={{input_lra}}:measured_thresh={{input_thresh}}:offset={{target_offset}}".format(**d))')
LN="loudnorm=I=-14:TP=-2.0:LRA=7:$MEASURED"
# Pass 2: conform the picture frame-exactly and apply the measured loudness.
ffmpeg -nostdin -hide_banner -loglevel error -y {inputs} -i "$AUDIO" \\
  -filter_complex "{chains};{joins}concat=n={n}:v=1:a=0[v];[{n}:a]$LN,aresample=48000[a]" \\
  -map "[v]" -map "[a]" -frames:v {TOTAL_FRAMES} -t {TOTAL_FRAMES / FPS:.3f} \\
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 320k \\
  "{s.project_slug}_MASTER_{TOTAL_FRAMES}F.mp4"
echo "wrote {s.project_slug}_MASTER_{TOTAL_FRAMES}F.mp4"
"""
        path = self.out_dir / f"{s.project_slug}_assemble.sh"
        path.write_text(sh, encoding="utf-8")
        path.chmod(0o755)
        return path


def load_profile(path: Path) -> BrandCommercialSpec:
    return BrandCommercialSpec.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def main(argv: List[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("profiles", nargs="*", type=Path, help="brand profile JSON files (default: profiles/*.json)")
    ap.add_argument("--out", type=Path, default=Path("build_spots"))
    ap.add_argument("--three-url", default="https://unpkg.com/three@0.160.0/build/three.module.js",
                    help="three.module.js URL for the HUD page (a file:// URL renders offline)")
    a = ap.parse_args(argv)
    profiles = a.profiles or sorted((here / "profiles").glob("*.json"))
    for prof in profiles:
        spec = load_profile(prof)
        out = CommercialCompiler(spec, a.out / prof.stem, a.three_url).compile_all()
        flag = "" if spec.claims_verified else "  (claims NOT verified)"
        print(f"[{prof.stem}] {len(out)} deliverables -> {a.out / prof.stem}{flag}")
        for k, v in out.items():
            print(f"  {k}: {v.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
