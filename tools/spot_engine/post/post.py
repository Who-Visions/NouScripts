#!/usr/bin/env python3
"""Post pass for a spot built by the spot engine: captions, the stall-wheel track, overlays, cut 7 from a still.

  python3 post.py run <build_dir> post/profiles/<spot>_post.json <lines.tsv>       # the whole pass, picture and type
  python3 post.py captions <build_dir> post/profiles/<spot>_post.json <lines.tsv>  # just captions.json
  python3 post.py hud-still <build_dir> post/profiles/<spot>_post.json <plate.jpg> # rebuild cut 7 (07_hud_lattice.mp4)

`run` needs, in <build_dir>: the engine's *_assemble.sh, the nine clips, *_mix.wav (from voices.py) and
voices/plan.json. It assembles the voiced picture, extracts frames, tracks the wheels (track.py, in the Vision
venv), writes overlay_data.json, renders the overlays with Electron (true alpha), and composites them into
<slug>_MASTER_744F.mp4 with the audio copied untouched, then a phone copy under 30 MiB.

Environment: NOUGEN_VISION_PY (default ~/.nougen/venvs/spot-vision/bin/python), NOUGEN_ELECTRON (default the
Nou Scripts node_modules/.bin/electron).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOUSCRIPTS = HERE.parents[2]
VISION_PY = os.environ.get("NOUGEN_VISION_PY", str(Path.home() / ".nougen/venvs/spot-vision/bin/python"))
ELECTRON = os.environ.get("NOUGEN_ELECTRON", str(NOUSCRIPTS / "node_modules/.bin/electron"))


# ---------- captions (pure, tested) ----------

def split_caption(text: str, max_chars: int = 55) -> list[str]:
    """Split at sentence and clause breaks into cues of at most ~max_chars (graded: a 109-char cue was unreadable)."""
    chunks, cur, out = [], "", []
    for piece in text.replace(". ", ".|").replace(", to ", ",| to ").replace(", with ", ",| with ").split("|"):
        chunks.append(piece)
    for c in chunks:
        if cur and len(cur) + len(c) > max_chars:
            out.append(cur.strip())
            cur = c
        else:
            cur += c
    out.append(cur.strip())
    return [o for o in out if o]


def cut_end(frame: int, cuts: list[list[int]]) -> int:
    """Exclusive end frame of the cut that contains `frame`."""
    return next((b for a, b in cuts if a <= frame < b), cuts[-1][1])


def build_captions(plan: list[dict], texts: dict[str, str], profile: dict) -> list[dict]:
    """Timed caption cues from the voice plan. A cue that runs only a little past its cut (up to
    clamp_to_cut_frames) is clamped to the cut; a line that truly carries over (a J or L cut) keeps its time."""
    fps, cuts = profile["fps"], profile["cuts"]
    lay = profile.get("caption_layout", {})
    max_chars, clamp = lay.get("max_chars", 55), lay.get("clamp_to_cut_frames", 16)
    cues = []
    for p in plan:
        parts = split_caption(texts[p["id"]], max_chars)
        total = sum(len(x) for x in parts) or 1
        t0 = p["start"]
        for i, x in enumerate(parts):
            t1 = t0 + (p["end"] - p["start"]) * len(x) / total
            f_from = round(t0 * fps)
            f_to = round(t1 * fps) + (2 if i == len(parts) - 1 else 0)
            end = cut_end(f_from, cuts) - 1
            if 0 < f_to - end <= clamp:
                f_to = end
            cues.append({"from": f_from, "to": f_to, "text": x})
            t0 = t1
    return cues


def written_texts(lines_tsv: Path, profile: dict) -> dict[str, str]:
    """Captions read the way the script is written, not the way the voice is told to say it."""
    swap = profile.get("caption_spoken_to_written", {})
    out = {}
    for raw in Path(lines_tsv).read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        lid, _voice, _a, _b, text = raw.split("\t")
        for k, v in swap.items():
            text = text.replace(k, v)
        out[lid] = text.strip()
    return out


# ---------- steps ----------

def _run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd[:6]), "..." if len(cmd) > 6 else "")
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def captions(build: Path, profile: dict, lines: Path) -> list[dict]:
    plan = json.loads((build / "voices" / "plan.json").read_text())
    cues = build_captions(plan, written_texts(lines, profile), profile)
    (build / "captions.json").write_text(json.dumps(cues, indent=1) + "\n")
    return cues


def hud_still(build: Path, profile: dict, plate: Path) -> Path:
    """Cut 7 from a designed still: dimmed base, feathered masks reveal each cluster on its beat, a unison
    pulse, a slow push-in."""
    h = profile["hud_still"]
    work = build / "hud_still"
    work.mkdir(exist_ok=True)
    fps, n = profile["fps"], h["frames"]
    base = work / "plate.png"
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", plate, "-vf",
          "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", base])
    masks = []
    for m in h["always_lit"] + h["reveals"]:
        x, y, w, hh = m["box"]
        p = work / f"mask_{m['name']}.png"
        _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:s=1920x1080:d=1", "-vf",
              f"drawbox=x={x}:y={y}:w={w}:h={hh}:color=white:t=fill,gblur=sigma={m['blur']},format=gray", "-frames:v", "1", p])
        masks.append((m, p))
    k = len(masks)
    inputs = ["-loop", "1", "-framerate", str(fps), "-t", f"{n / fps:.4f}", "-i", base]
    for _, p in masks:
        inputs += ["-loop", "1", "-i", p]
    d = h["dim"]
    fc = [f"[0:v]format=yuv444p,split={k + 1}[b0]" + "".join(f"[b{i + 1}]" for i in range(k)),
          f"[b0]eq=brightness={d['brightness']}:saturation={d['saturation']}[s0]"]
    for i, (m, _) in enumerate(masks):
        fade = f",fade=t=in:st={(m['at'] - h['first_frame']) / fps:.3f}:d={10 / fps:.3f}:alpha=1" if "at" in m else ""
        fc.append(f"[{i + 1}:v]format=gray,scale=1920:1080[m{i}]")
        fc.append(f"[b{i + 1}][m{i}]alphamerge{fade}[l{i}]")
        fc.append(f"[s{i}][l{i}]overlay=shortest=1[s{i + 1}]")
    pl = h["pulse"]
    a, b = (pl["from"] - h["first_frame"]) / fps, (pl["to"] - h["first_frame"]) / fps
    z = 1 + h["push_in"]
    fc.append(f"[s{k}]eq=brightness='{pl['gain']}*sin(PI*(t-{a:.3f})/{b - a:.3f})*between(t,{a:.3f},{b:.3f})':eval=frame,"
              f"scale={int(1920 * 1.1)}:{int(1080 * 1.1)},zoompan=z='1+{h['push_in']}*on/{n - 1}':d=1:"
              f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps={fps},format=yuv420p[v]")
    out = build / "07_hud_lattice.mp4"
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]",
          "-frames:v", str(n), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out])
    return out


def run(build: Path, profile_path: Path, lines: Path) -> Path:
    profile = json.loads(profile_path.read_text())
    sh = next(build.glob("*_assemble.sh"))
    slug = sh.name[: -len("_assemble.sh")]
    master = build / f"{slug}_MASTER_{profile['frames']}F.mp4"
    voiced = build / "voiced_master_no_overlays.mp4"
    _run(["bash", sh, "1920x1080"], stdin=subprocess.DEVNULL)
    shutil.copy(master, voiced)
    frames = build / "track"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir()
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", voiced, "-vf", "scale=960:-2", "-start_number", "0",
          frames / "f_%03d.png"])
    _run([VISION_PY, HERE / "track.py", frames, profile_path, frames])
    cues = captions(build, profile, lines)
    data = {k: profile[k] for k in ("fps", "wheels", "wordmark", "supers", "terminal", "end_card", "caption_layout") if k in profile}
    data["track"] = json.loads((frames / "wheel_track.json").read_text())
    data["captions"] = cues
    data_path = build / "overlay_data.json"
    data_path.write_text(json.dumps(data) + "\n")
    ov = build / "overlay_frames"
    if ov.exists():
        shutil.rmtree(ov)
    _run([ELECTRON, HERE / "render_frames.js", HERE / "overlay_rig.html", ov, 0, profile["frames"] - 1, "canvas", data_path])
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", voiced, "-framerate", str(profile["fps"]), "-start_number", "0",
          "-i", ov / "o_%03d.png", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]",
          "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-c:a", "copy",
          "-frames:v", str(profile["frames"]), "-movflags", "+faststart", master])
    phone = build / f"{slug}_MASTER_{profile['frames']}F_phone.mp4"
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", master, "-c:v", "libx264", "-preset", "slow", "-crf", "23",
          "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", phone])
    print(f"wrote {master.name} and {phone.name}")
    return master


def main(argv=None) -> int:
    a = argv or sys.argv[1:]
    if len(a) == 4 and a[0] == "run":
        run(Path(a[1]), Path(a[2]), Path(a[3]))
    elif len(a) == 4 and a[0] == "captions":
        print(len(captions(Path(a[1]), json.loads(Path(a[2]).read_text()), Path(a[3]))), "caption cues")
    elif len(a) == 4 and a[0] == "hud-still":
        print(hud_still(Path(a[1]), json.loads(Path(a[2]).read_text()), Path(a[3])))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
