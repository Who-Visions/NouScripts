#!/usr/bin/env python3
"""Free-lane renderer for a spot compiled by universal_spot_engine.py: keyframes, then image-to-video, at $0.

Lanes (all measured from phoebus on 2026-11-12). Keyframes try each lane in --keyframe-lanes order and
record which one answered; every keyframe is normalised to 1024x576 PNG.
  agy         Antigravity CLI image tool, headless. Best image (true 16:9, holds wardrobe). ~100 s each.
  cloudflare  Workers AI @cf/black-forest-labs/flux-1-schnell, Keymaker CLOUDFLARE_*. ~2 s, 1024x1024 (cropped).
  hf          FLUX.1-schnell Space on ZeroGPU. Shares the account's small daily allowance with the video lane.
  pollinations  no key, ~5 s, but stamps a watermark: opt-in only, never in the default order.
Not lanes: NVIDIA NIM flux.1-schnell (answers validation errors, timed out twice generating, 90 s and 200 s);
Codex on phoebus (every model refused for this ChatGPT account); Gemini image key (invalid).
  video       zerogpu-aoti/wan2-2-fp8da-aoti-faster  (Hugging Face Space, ZeroGPU, /generate_video)
  cut 7      not here: render the HUD page locally (the engine's _hud_rig.html), never on ZeroGPU

Why this shape, measured on phoebus:
  - The Hugging Face account is a free user (not PRO, cannot be billed), so cost is $0 and the limit is the
    daily ZeroGPU allowance. The run is resumable: finished clips are skipped, and a quota refusal stops the
    run cleanly with the state written to free_lanes_status.json. Run it again the next day to finish.
  - No LLM rewrites the prompts. They come from the engine's manifest, which carries the verified claims; a
    rewrite pass could put back what was corrected, and a small local model on a 16 GB Intel mini is slow.
  - Images cannot speak: the engine's visual_prompt carries no spoken lines or on-screen copy. Voices and
    type are separate passes.

Run with the nougenshards venv (it has gradio_client and the Keymaker):
  NOUGENSHARDS_SRC=<nougenshards>/src <nougenshards>/.venv/bin/python free_lanes.py <dir with *_veo_flow.json> [--clips 01_hook,02_stall_p1]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

FLUX_SPACE = "black-forest-labs/FLUX.1-schnell"
WAN_SPACE = "zerogpu-aoti/wan2-2-fp8da-aoti-faster"
KEYFRAME_W, KEYFRAME_H = 1024, 576          # 16:9, multiples of 64
SEED = 42                                    # one seed for every keyframe keeps the look consistent
HUD_CLIP = "07_hud_lattice"
QUOTA_RX = re.compile(r"quota|zerogpu|exceeded|daily|rate limit|429", re.I)
DEFAULT_KEYFRAME_LANES = "agy,cloudflare,hf"


def normalise_keyframe(src: Path, dst: Path) -> None:
    """Any lane's image -> 1024x576 PNG: scale to cover, centre crop."""
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-vf",
                    f"scale={KEYFRAME_W}:{KEYFRAME_H}:force_original_aspect_ratio=increase,crop={KEYFRAME_W}:{KEYFRAME_H}",
                    "-frames:v", "1", str(dst)], check=True)


def lane_agy(prompt: str, dst: Path, tmp: Path) -> None:
    raw = tmp / f"{dst.stem}_agy.png"
    ask = (f"Generate one photorealistic 16:9 image with your image tool: {prompt} "
           f"Save it as {raw} and reply with only the path.")
    p = subprocess.run(["agy", "-p", ask, "--dangerously-skip-permissions"], capture_output=True, text=True, timeout=360, cwd=tmp)
    if not raw.exists():
        raise RuntimeError(f"agy wrote no image: {' '.join((p.stdout + p.stderr).split())[-200:]}")
    normalise_keyframe(raw, dst)


def lane_cloudflare(prompt: str, dst: Path, tmp: Path) -> None:
    import base64
    import requests
    acct = keymaker_secret("CLOUDFLARE_ACCOUNT_ID")
    r = requests.post(f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/black-forest-labs/flux-1-schnell",
                      headers={"Authorization": f"Bearer {keymaker_secret('CLOUDFLARE_API_TOKEN')}"},
                      json={"prompt": prompt, "steps": 8, "seed": SEED}, timeout=90)
    img = r.json().get("result", {}).get("image") if r.ok else None
    if not img:
        raise RuntimeError(f"cloudflare {r.status_code}: {r.text[:200]}")
    raw = tmp / f"{dst.stem}_cf.jpg"
    raw.write_bytes(base64.b64decode(img))
    normalise_keyframe(raw, dst)


def lane_hf(prompt: str, dst: Path, tmp: Path) -> None:
    from gradio_client import Client
    img, _seed = Client(FLUX_SPACE, token=keymaker_secret("HF_TOKEN"), verbose=False).predict(
        prompt=prompt, seed=SEED, randomize_seed=False, width=KEYFRAME_W, height=KEYFRAME_H,
        num_inference_steps=4, api_name="/infer")
    normalise_keyframe(Path(img if isinstance(img, str) else img["path"]), dst)


def lane_pollinations(prompt: str, dst: Path, tmp: Path) -> None:
    import requests
    r = requests.get("https://image.pollinations.ai/prompt/" + requests.utils.quote(prompt),
                     params={"width": KEYFRAME_W, "height": KEYFRAME_H, "seed": SEED, "model": "flux"}, timeout=120)
    if not (r.ok and r.headers.get("content-type", "").startswith("image")):
        raise RuntimeError(f"pollinations {r.status_code}")
    raw = tmp / f"{dst.stem}_pollinations.jpg"
    raw.write_bytes(r.content)
    normalise_keyframe(raw, dst)


KEYFRAME_LANES = {"agy": lane_agy, "cloudflare": lane_cloudflare, "hf": lane_hf, "pollinations": lane_pollinations}


def make_keyframe(prompt: str, dst: Path, lanes: list[str], tmp: Path) -> tuple[str, list[str]]:
    """Try each lane in order; return the lane that answered and the failures before it."""
    failures = []
    for name in lanes:
        try:
            KEYFRAME_LANES[name](prompt, dst, tmp)
            return name, failures
        except Exception as e:
            failures.append(f"{name}: {type(e).__name__}: {str(e)[:160]}")
    raise RuntimeError("every keyframe lane failed: " + " | ".join(failures))


def visual_prompt(clip: dict) -> str:
    """The engine writes a visual_prompt with no spoken lines or on-screen copy; add the photographic finish."""
    return clip["visual_prompt"].rstrip(". ") + ". Photorealistic, natural skin texture, cinematic lighting, no text."


def keymaker_secret(name: str) -> str:
    sys.path.insert(0, os.environ.get("NOUGENSHARDS_SRC", str(Path.home() / "The Observatory/NouGen/nougenshards/src")))
    from nougen_shards import keymaker  # noqa: E402
    v = keymaker.get_secret(name)
    if not v:
        raise SystemExit(f"{name} is not in the Keymaker on this node")
    return v


def load_status(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"clips": {}}


def save_status(path: Path, status: dict) -> None:
    status["updated"] = time.strftime("%Y-%m-%d %I:%M %p %Z")
    path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")


def run(build_dir: Path, only: list[str] | None = None, keyframes_only: bool = False,
        keyframe_lanes: str = DEFAULT_KEYFRAME_LANES) -> dict:
    from gradio_client import Client, handle_file  # noqa: E402

    manifest_path = next(build_dir.glob("*_veo_flow.json"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    status_path = build_dir / "free_lanes_status.json"
    status = load_status(status_path)
    status.update({"project": manifest["project"], "keyframe_space": FLUX_SPACE, "video_space": WAN_SPACE})
    token = keymaker_secret("HF_TOKEN")
    wan = None
    lanes = [x.strip() for x in keyframe_lanes.split(",") if x.strip()]
    unknown = [x for x in lanes if x not in KEYFRAME_LANES]
    if unknown:
        raise SystemExit(f"unknown keyframe lanes: {unknown}; known: {sorted(KEYFRAME_LANES)}")
    tmp = build_dir / "lane_raw"
    tmp.mkdir(exist_ok=True)

    for clip in manifest["clips"]:
        cid = clip["clip_id"]
        if cid == HUD_CLIP or (only and cid not in only):
            continue
        st = status["clips"].setdefault(cid, {})
        key_png = build_dir / f"{cid}_keyframe.png"
        out_mp4 = build_dir / f"{cid}.mp4"
        prompt = visual_prompt(clip)
        st["prompt"] = prompt
        try:
            if not key_png.exists():
                t = time.time()
                lane, failed = make_keyframe(prompt, key_png, lanes, tmp)
                st.update({"keyframe": key_png.name, "keyframe_lane": lane, "keyframe_seconds": round(time.time() - t, 1),
                           "keyframe_lane_failures": failed, "seed": SEED})
                print(f"[{cid}] keyframe via {lane} in {st['keyframe_seconds']} s")
            if keyframes_only or out_mp4.exists():
                save_status(status_path, status)
                continue
            wan = wan or Client(WAN_SPACE, token=token, verbose=False)
            # Ask for the cut's length (rounded up to a half second, at least 2 s); the assembler trims or holds.
            want = max(2.0, min(5.0, (int(clip["duration_sec"] * 2) + 1) / 2))
            t = time.time()
            video, _seed = wan.predict(input_image=handle_file(str(key_png)), prompt=prompt, steps=6,
                                       duration_seconds=want, seed=SEED, randomize_seed=False, api_name="/generate_video")
            src = video["video"] if isinstance(video, dict) else video
            shutil.copy(src, out_mp4)
            st.update({"video": out_mp4.name, "requested_seconds": want, "video_seconds": round(time.time() - t, 1), "state": "done"})
            print(f"[{cid}] video {want} s requested, {st['video_seconds']} s wall")
        except Exception as e:  # a refusal is data: record it and stop, so the next run resumes here
            msg = f"{type(e).__name__}: {str(e)[:300]}"
            st.update({"state": "quota" if QUOTA_RX.search(msg) else "error", "error": msg})
            save_status(status_path, status)
            print(f"[{cid}] stopped: {msg}")
            if st["state"] == "quota":
                break
            continue
        save_status(status_path, status)

    live = [c["clip_id"] for c in manifest["clips"] if c["clip_id"] != HUD_CLIP]
    status["done"] = sorted(c for c in live if (build_dir / f"{c}.mp4").exists())
    status["remaining"] = [c for c in live if c not in status["done"]]
    save_status(status_path, status)
    return status


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("build_dir", type=Path)
    ap.add_argument("--clips", help="comma-separated clip ids (default: every live-action clip)")
    ap.add_argument("--keyframes-only", action="store_true")
    ap.add_argument("--keyframe-lanes", default=DEFAULT_KEYFRAME_LANES,
                    help=f"comma-separated, tried in order (default {DEFAULT_KEYFRAME_LANES}; also: pollinations)")
    a = ap.parse_args()
    st = run(a.build_dir, a.clips.split(",") if a.clips else None, a.keyframes_only, a.keyframe_lanes)
    print(f"done {len(st['done'])}: {', '.join(st['done']) or '-'}; remaining: {', '.join(st['remaining']) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
