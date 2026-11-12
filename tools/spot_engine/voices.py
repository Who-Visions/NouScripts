#!/usr/bin/env python3
"""Voice a compiled spot: synthesize each line with Kokoro, place it on its frame, mix over the guide track.

Input is a tab-separated lines file, one line per row:  id  voice  start_frame  end_frame  text
(see profiles/nougenshards_lines.tsv). Output is <slug>_mix.wav (48 kHz, 24-bit, stereo, 31.0 s) in the build
folder, which the engine's _assemble.sh picks up instead of the guide track and masters to -14 LUFS.

Why the scheduler exists (measured 2026-11-12): the spec's lip-sync windows assume clipped reads; real lines ran
1.6 to 2.7x longer than their windows. Squeezing them in would mean double-speed audio. Instead each line starts
at its planned frame, or just after the previous line if that is later, and is sped up only when it would run
into the next line's start, never past MAX_SPEED. The plan reports each line's drift in frames.

Pronunciation: the fleet's kokoro_tts.py applies the brand lock (NouGen = "Noo-ghen", hard G). Write acronyms
the way they are said (S Q Lite, F T S five, wall mode).

Run:  python3 voices.py <build_dir> <lines.tsv>
Env:  NOUGEN_KOKORO_PY (a Python with kokoro + torch; default the NouGenVoice venv),
      NOUGEN_KOKORO_TTS (default nougenai-next/backend/ai_news/kokoro_tts.py)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

FPS = 24
TOTAL_SECONDS = 744 / FPS
GAP = 0.10            # seconds of air between lines
MAX_SPEED = 1.25      # never speed a line up more than this
BASE_SPEED = 1.12     # Kokoro speed: a brisk commercial read
BED_GAIN_DB = -4      # the guide track under the dialogue
OBS = Path.home() / "The Observatory"
KOKORO_PY = os.environ.get("NOUGEN_KOKORO_PY", str(OBS / "NouGen/NouGenVoice/backend/venv/bin/python3"))
KOKORO_TTS = os.environ.get("NOUGEN_KOKORO_TTS", str(OBS / "nougenai-next/backend/ai_news/kokoro_tts.py"))


def read_lines(path: Path) -> list[dict]:
    rows = []
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip() or raw.startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) != 5:
            raise ValueError(f"line {n}: want 5 tab-separated fields (id voice start end text), got {len(parts)}")
        lid, voice, a, b, text = parts
        rows.append({"id": lid, "voice": voice, "start_frame": int(a), "end_frame": int(b), "text": text.strip()})
    starts = [r["start_frame"] for r in rows]
    if starts != sorted(starts):
        raise ValueError("lines must be in start-frame order")
    return rows


def schedule(rows: list[dict], durations: dict[str, float], total=TOTAL_SECONDS) -> list[dict]:
    """Place each line at its planned start, or after the previous one; speed up only to clear the next start."""
    plan, prev_end = [], 0.0
    for i, r in enumerate(rows):
        want = r["start_frame"] / FPS
        nxt = rows[i + 1]["start_frame"] / FPS if i + 1 < len(rows) else total - 0.25
        d = durations[r["id"]]
        start = max(want, prev_end + GAP)
        room = max(0.3, nxt - start - GAP)
        speed = min(MAX_SPEED, max(1.0, d / room))
        end = start + d / speed
        plan.append({"id": r["id"], "voice": r["voice"], "start": round(start, 3), "speed": round(speed, 3),
                     "seconds": round(d / speed, 3), "end": round(end, 3),
                     "drift_frames": round((start - want) * FPS),
                     "overrun_frames": round(max(0.0, end + GAP - nxt) * FPS)})
        prev_end = end
    return plan


def _run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def duration(path: Path) -> float:
    return float(_run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout)


def synthesize(rows: list[dict], work: Path) -> dict[str, float]:
    out = {}
    for r in rows:
        raw, trim = work / f"raw_{r['id']}.wav", work / f"line_{r['id']}.wav"
        subprocess.run([KOKORO_PY, KOKORO_TTS, r["voice"], str(BASE_SPEED), str(raw)], input=r["text"], text=True,
                       check=True, capture_output=True)
        # trim the leading and trailing silence Kokoro adds, so timing is the speech itself
        _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(raw), "-af",
              "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,"
              "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,aresample=48000",
              str(trim)])
        out[r["id"]] = duration(trim)
    return out


def mix(plan: list[dict], work: Path, guide: Path, dest: Path, total=TOTAL_SECONDS) -> None:
    inputs, chains = [], []
    for i, p in enumerate(plan):
        inputs += ["-i", str(work / f"line_{p['id']}.wav")]
        tempo = f"atempo={p['speed']}," if p["speed"] > 1.0001 else ""
        chains.append(f"[{i}:a]{tempo}aformat=sample_rates=48000:channel_layouts=mono,"
                      f"adelay={int(round(p['start'] * 1000))}:all=1[d{i}]")
    n = len(plan)
    inputs += ["-i", str(guide)]
    fc = (";".join(chains) + ";" + "".join(f"[d{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest[dlg];"
          f"[{n}:a]aformat=sample_rates=48000:channel_layouts=mono,volume={BED_GAIN_DB}dB[bed];"
          f"[dlg][bed]amix=inputs=2:normalize=0:duration=longest,apad=whole_dur={total},atrim=0:{total},"
          "pan=stereo|c0=c0|c1=c0[out]")
    _run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[out]",
          "-c:a", "pcm_s24le", str(dest)])


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if len(argv) != 2:
        print(__doc__.split("\n\n")[0] + "\nusage: voices.py <build_dir> <lines.tsv>", file=sys.stderr)
        return 2
    build, lines = Path(argv[0]), Path(argv[1])
    guide = next(build.glob("*_sfx_guide.wav"))
    slug = guide.name[: -len("_sfx_guide.wav")]
    work = build / "voices"
    work.mkdir(exist_ok=True)
    rows = read_lines(lines)
    plan = schedule(rows, synthesize(rows, work))
    (work / "plan.json").write_text(json.dumps(plan, indent=1) + "\n", encoding="utf-8")
    dest = build / f"{slug}_mix.wav"
    mix(plan, work, guide, dest)
    worst = max(plan, key=lambda p: abs(p["drift_frames"]))
    print(f"wrote {dest.name}: {len(plan)} lines, last ends at {plan[-1]['end']} s, "
          f"largest drift {worst['drift_frames']} frames ({worst['id']}), "
          f"{sum(p['speed'] >= MAX_SPEED for p in plan)} line(s) at the {MAX_SPEED}x cap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
