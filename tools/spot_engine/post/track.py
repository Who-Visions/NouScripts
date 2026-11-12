#!/usr/bin/env python3
"""Track where each stall wheel goes: over the stalled person's head, then into the gesturing hand.

Runs with a Python that has PyObjC Vision (macOS):  ~/.nougen/venvs/spot-vision  (pyobjc-framework-Vision,
pyobjc-framework-Quartz). Kept out of the app-bridge venv on purpose: that one serves a live process.

Input: a folder of frames f_000.png ... (any width; positions are normalised) and the post profile.
Output: wheel_track.json  {frame: {span, x, y, r}} in 1920x1080 pixels, plus gesture_points.json.

Per span: pick the stalled person at mid-span by the profile's rule (only / rightmost / smallest face), follow
the nearest face frame to frame in both directions (so it cannot jump to the other person), smooth over 5 frames,
and sit the wheel ~0.8 face-heights above the crown (radius capped for close-ups). For spans with a clear frame,
find the raised hand (index and thumb tips) at the clear and glide the wheel into it over glide_frames, so the
burst lands where the gesture lands (AGY Argon round 1: hands were 264 to 564 px from the wheels).
"""
from __future__ import annotations

import json
import os
import sys

W, H = 1920, 1080


def pick(faces, rule):
    if rule == "only" or len(faces) == 1:
        return faces[0]
    if rule == "rightmost":
        return max(faces, key=lambda f: f["x"])
    return min(faces, key=lambda f: f["h"])


def follow(faces_by_frame, a, b, rule, jump=0.12):
    """Choose the target face per frame: seed at mid-span by `rule`, then nearest-neighbour both ways."""
    m = (a + b) // 2
    while not faces_by_frame.get(m) and m < b:
        m += 1
    if not faces_by_frame.get(m):
        return {}
    chosen = {m: pick(faces_by_frame[m], rule)}
    for rng in (range(m + 1, b + 1), range(m - 1, a - 1, -1)):
        prev = chosen[m]
        for f in rng:
            cand = faces_by_frame.get(f) or []
            near = min(cand, key=lambda c: (c["x"] - prev["x"]) ** 2 + (c["top"] - prev["top"]) ** 2) if cand else prev
            dist = ((near["x"] - prev["x"]) ** 2 + (near["top"] - prev["top"]) ** 2) ** 0.5
            chosen[f] = near if dist < jump else prev
            prev = chosen[f]
    return chosen


def wheel_positions(chosen, a, b, span_id, max_r):
    out, fr = {}, list(range(a, b + 1))
    for i, f in enumerate(fr):
        win = [chosen[fr[j]] for j in range(max(0, i - 2), min(len(fr), i + 3)) if fr[j] in chosen]
        if not win:
            continue
        x = sum(c["x"] for c in win) / len(win)
        top = sum(c["top"] for c in win) / len(win)
        h = sum(c["h"] for c in win) / len(win)
        r = min(max_r, max(28.0, 0.30 * h * H))
        out[f] = {"span": span_id, "x": round(x * W, 1), "y": round(max(r + 6, top * H - 0.8 * h * H), 1), "r": round(r, 1)}
    return out


def glide(track, span_id, clear, point, frames=10):
    """Ease the wheel from its head position into the gesture point over `frames`, and hold it there."""
    ease = lambda t: t * t * (3 - 2 * t)  # noqa: E731
    for f in range(clear - frames, clear + 4):
        if f not in track or track[f]["span"] != span_id:
            continue
        t = ease(min(1.0, max(0.0, (f - (clear - frames)) / frames)))
        track[f]["x"] = round(track[f]["x"] + (point[0] - track[f]["x"]) * t, 1)
        track[f]["y"] = round(track[f]["y"] + (point[1] - track[f]["y"]) * t, 1)
    if clear in track:
        track[clear]["x"], track[clear]["y"] = round(point[0], 1), round(point[1], 1)
    return track


def _vision():
    import Quartz
    import Vision
    from Foundation import NSURL

    def image(path):
        return Quartz.CGImageSourceCreateImageAtIndex(Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(path), None), 0, None)

    def faces(path):
        req = Vision.VNDetectFaceRectanglesRequest.alloc().init()
        Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image(path), None).performRequests_error_([req], None)
        out = []
        for r in (req.results() or []):
            b = r.boundingBox()
            out.append({"x": b.origin.x + b.size.width / 2, "top": 1 - (b.origin.y + b.size.height), "w": b.size.width, "h": b.size.height})
        return out

    def raised_hand(path):
        req = Vision.VNDetectHumanHandPoseRequest.alloc().init()
        req.setMaximumHandCount_(4)
        Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image(path), None).performRequests_error_([req], None)
        best = None
        for obs in (req.results() or []):
            pts, _ = obs.recognizedPointsForJointsGroupName_error_(Vision.VNHumanHandPoseObservationJointsGroupNameAll, None)
            tips = [pts[k] for k in (Vision.VNHumanHandPoseObservationJointNameIndexTip, Vision.VNHumanHandPoseObservationJointNameThumbTip)
                    if k in pts and pts[k].confidence() > 0.3]
            if tips:
                x = sum(t.location().x for t in tips) / len(tips) * W
                y = (1 - sum(t.location().y for t in tips) / len(tips)) * H
                if best is None or y < best[1]:
                    best = (x, y)
        return best

    return faces, raised_hand


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if len(argv) != 3:
        print("usage: track.py <frames_dir> <post_profile.json> <out_dir>", file=sys.stderr)
        return 2
    frames_dir, prof, out_dir = argv
    profile = json.load(open(prof))
    w = profile["wheels"]
    faces, raised_hand = _vision()
    frame = lambda f: os.path.join(frames_dir, f"f_{f:03d}.png")  # noqa: E731
    track, gestures = {}, {}
    for s in w["spans"]:
        a, b = s["frames"]
        fb = {f: faces(frame(f)) for f in range(a, b + 1)}
        track.update(wheel_positions(follow(fb, a, b, s["pick"]), a, b, s["id"], w.get("close_up_max_radius", 75)))
        if "clear" in s:
            c = s["clear"]
            pts = [p for p in (raised_hand(frame(f)) for f in range(c - 3, c + 1)) if p]
            if pts:
                point = min(pts, key=lambda p: p[1])
                gestures[c] = [round(point[0], 1), round(point[1], 1)]
                glide(track, s["id"], c, point, w.get("glide_frames", 10))
    os.makedirs(out_dir, exist_ok=True)
    json.dump(track, open(os.path.join(out_dir, "wheel_track.json"), "w"))
    json.dump(gestures, open(os.path.join(out_dir, "gesture_points.json"), "w"))
    print(f"tracked {len(track)} frames; gesture points {gestures}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
