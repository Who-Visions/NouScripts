"""Tests for universal_spot_engine.py. Run: python3 -m unittest tools/spot_engine/test_spot_engine.py"""
import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import universal_spot_engine as E  # noqa: E402


def profile(name="nougenshards"):
    return E.load_profile(HERE / "profiles" / f"{name}.json")


class SpotEngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_every_profile_compiles_five_deliverables(self):
        for prof in sorted((HERE / "profiles").glob("*.json")):
            out = E.CommercialCompiler(E.load_profile(prof), self.tmp / prof.stem).compile_all()
            self.assertEqual(sorted(out), ["edl", "ffmpeg_sh", "hud_html", "sfx_wav", "veo_manifest"])
            for p in out.values():
                self.assertTrue(p.exists() and p.stat().st_size > 0, p)

    def test_edl_reels_fit_cmx_and_cuts_total_744(self):
        edl = E.CommercialCompiler(profile(), self.tmp).build_edl().read_text()
        events = [line for line in edl.splitlines() if line[:3].isdigit()]
        self.assertEqual(len(events), 9)
        for line in events:
            reel = line.split()[1]
            self.assertLessEqual(len(reel), 8)
        self.assertIn("00:00:31:00", events[-1])
        self.assertEqual(sum(b - a for _, _, a, b, _, _ in E.TIMELINE_TOPOLOGY), 744)

    def test_wav_is_24_bit_48k_exactly_31_seconds(self):
        path = E.CommercialCompiler(profile(), self.tmp).build_procedural_audio()
        with wave.open(str(path)) as w:
            self.assertEqual((w.getsampwidth(), w.getframerate(), w.getnchannels()), (3, 48000, 1))
            self.assertEqual(w.getnframes(), 744 * 48000 // 24)

    def test_impact_and_chimes_land_on_their_frames(self):
        c = E.CommercialCompiler(profile(), self.tmp)
        path = c.build_procedural_audio()
        with wave.open(str(path)) as w:
            raw = w.readframes(w.getnframes())
        samples = [struct.unpack("<i", raw[i:i + 3] + (b"\xff" if raw[i + 2] & 0x80 else b"\x00"))[0] for i in range(0, len(raw), 3)]

        def onset(frame):
            # The first sample, from one frame early, whose level jumps well above the frame before it.
            start = (frame - 1) * 2000
            base = max(abs(s) for s in samples[start - 2000:start]) + 1
            for i in range(start, start + 4000):
                if abs(samples[i]) > base * 3 + 200000:
                    return i / 2000.0                         # in frames (2000 samples per frame)
            return None
        for f in (E.IMPACT_FRAME, 338, 439, 519):
            got = onset(f)
            self.assertIsNotNone(got, f"no onset near F{f}")
            self.assertAlmostEqual(got, f, delta=0.25)

    def test_pulse_is_116_bpm_not_rounded_to_whole_frames(self):
        pulses = [e["sec"] for e in E.CommercialCompiler(profile(), self.tmp).sfx_events() if e["kind"] == "pulse"]
        gaps = {round(b - a, 6) for a, b in zip(pulses, pulses[1:])}
        self.assertEqual(gaps, {round(60 / 116, 6)})
        self.assertEqual(len(pulses), math.ceil(31 / (60 / 116)))

    def test_concat_trims_every_clip_to_its_cut(self):
        c = E.CommercialCompiler(profile(), self.tmp)
        c.build_ffmpeg_assembler()
        txt = (self.tmp / f"{c.spec.project_slug}_concat.txt").read_text()
        outs = [float(line.split()[1]) for line in txt.splitlines() if line.startswith("outpoint")]
        self.assertEqual(len(outs), 9)
        self.assertAlmostEqual(sum(outs), 31.0, places=4)

    def test_hud_page_takes_three_from_the_given_url_and_does_not_autoplay(self):
        html = E.CommercialCompiler(profile(), self.tmp, three_url="file:///x/three.module.js").build_webgl_hud().read_text()
        self.assertIn("from 'file:///x/three.module.js'", html)
        self.assertIn("RADIUS = 3.2", html)
        self.assertIn("Math.min(1,", html)
        self.assertIn("q.get('play') === '1'", html)

    def test_nougenshards_profile_keeps_the_verified_claims(self):
        on_screen = json.loads((HERE / "profiles" / "nougenshards.json").read_text())
        on_screen.pop("claims_notes")                     # the notes explain the corrections, so they name them
        blob = json.dumps(on_screen)
        for wrong in ("8080", "Blade", "OPEN-SOURCE", "ZERO CLOUD", "Shard 925"):
            self.assertNotIn(wrong, blob)
        manifest = json.loads(E.CommercialCompiler(profile(), self.tmp).build_veo_manifest().read_text())
        self.assertTrue(manifest["claims_verified"])
        self.assertIn("github.com/Who-Visions/NouGenShards", manifest["clips"][-1]["prompt"])

    def test_unverified_profile_says_so(self):
        manifest = json.loads(E.CommercialCompiler(profile("omnijobs"), self.tmp).build_veo_manifest().read_text())
        self.assertFalse(manifest["claims_verified"])
        self.assertTrue(manifest["claims_notes"])

    def test_validate_rejects_a_clear_outside_its_cut_and_unknown_keys(self):
        d = json.loads((HERE / "profiles" / "nougenshards.json").read_text())
        d["pillars"][0]["clear_frame"] = 400
        with self.assertRaisesRegex(ValueError, "outside its cut"):
            E.CommercialCompiler(E.BrandCommercialSpec.from_dict(d), self.tmp)
        d = json.loads((HERE / "profiles" / "nougenshards.json").read_text())
        d["tagline_typo"] = "x"
        with self.assertRaisesRegex(ValueError, "unknown profile keys"):
            E.BrandCommercialSpec.from_dict(d)

    def test_visual_prompts_carry_no_spoken_lines_or_copy(self):
        for name in ("nougenshards", "omnijobs"):
            spec = profile(name)
            visual = E.CommercialCompiler(spec, self.tmp / name).prompts(visual=True)
            lines = [spec.hook_line, spec.intervention_line, spec.hud_vo_line, spec.outro_vo_line, spec.tagline,
                     spec.end_card_address] + [x for p in spec.pillars for x in (p.stall_question, p.spokesperson_cue,
                                                                                  p.resolved_answer, p.hud_label)]
            for cid, text in visual.items():
                self.assertNotIn("'", text.replace("'s ", " "), f"{name} {cid}: a quote is left: {text}")
                for line in filter(None, lines):
                    self.assertNotIn(line, text, f"{name} {cid} still says {line!r}")
                self.assertNotIn("wheel", text, f"{name} {cid}: the stall wheel is a VFX asset, not a prompt")
            spoken = E.CommercialCompiler(spec, self.tmp / name).prompts()
            self.assertIn("wheel", spoken["02_stall_p1"])
            self.assertIn(spec.hook_line, spoken["01_hook"])

    def test_keyframe_lanes_fall_back_in_order_and_record_failures(self):
        import free_lanes as F
        calls = []

        def boom(prompt, dst, tmp):
            calls.append("a")
            raise RuntimeError("quota")

        def ok(prompt, dst, tmp):
            calls.append("b")
            dst.write_bytes(b"png")

        saved = dict(F.KEYFRAME_LANES)
        try:
            F.KEYFRAME_LANES.update({"a": boom, "b": ok})
            lane, failed = F.make_keyframe("p", self.tmp / "k.png", ["a", "b"], self.tmp)
        finally:
            F.KEYFRAME_LANES.clear()
            F.KEYFRAME_LANES.update(saved)
        self.assertEqual((lane, calls), ("b", ["a", "b"]))
        self.assertTrue(failed and failed[0].startswith("a: RuntimeError"))
        self.assertNotIn("pollinations", F.DEFAULT_KEYFRAME_LANES)

    def test_a_lane_out_of_quota_is_dropped_for_the_rest_of_the_run(self):
        import free_lanes as F

        def spent(prompt, dst, tmp):
            raise RuntimeError("code 429 RESOURCE_EXHAUSTED")

        def ok(prompt, dst, tmp):
            dst.write_bytes(b"png")

        saved = dict(F.KEYFRAME_LANES)
        try:
            F.KEYFRAME_LANES.update({"a": spent, "b": ok})
            lanes = ["a", "b"]
            F.make_keyframe("p", self.tmp / "k1.png", lanes, self.tmp)
            self.assertEqual(lanes, ["b"])
        finally:
            F.KEYFRAME_LANES.clear()
            F.KEYFRAME_LANES.update(saved)


    def test_voice_schedule_never_overlaps_and_caps_speed(self):
        import voices as Vo
        rows = Vo.read_lines(HERE / "profiles" / "nougenshards_lines.tsv")
        self.assertEqual(len(rows), 11)
        self.assertEqual(rows[-1]["voice"], "af_sky")
        # trimmed Kokoro durations measured 2026-11-12 (seconds, at speed 1.12)
        dur = dict(zip([r["id"] for r in rows], [3.49, 3.00, 6.82, 1.21, 1.51, 0.86, 2.08, 1.70, 1.03, 4.39, 3.32]))
        plan = Vo.schedule(rows, dur)
        for a, b in zip(plan, plan[1:]):
            self.assertLessEqual(a["end"] + Vo.GAP - 1e-6, b["start"], (a, b))
        self.assertTrue(all(1.0 <= p["speed"] <= Vo.MAX_SPEED for p in plan))
        self.assertLessEqual(max(abs(p["drift_frames"]) for p in plan), 10)
        self.assertLessEqual(plan[-1]["end"], 31.0)

    def test_voice_lines_file_is_strict(self):
        import voices as Vo
        bad = self.tmp / "bad.tsv"
        bad.write_text("01\tam_michael\t4\tHello\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "5 tab-separated"):
            Vo.read_lines(bad)
        bad.write_text("02\tv\t50\t60\tB\n01\tv\t4\t10\tA\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "start-frame order"):
            Vo.read_lines(bad)

    def test_assembler_writes_stereo_faststart_and_warns_without_a_mix(self):
        sh = E.CommercialCompiler(profile(), self.tmp).build_ffmpeg_assembler().read_text()
        self.assertIn("-ac 2 -movflags +faststart", sh)
        self.assertIn("WARNING: no", sh)

    def test_hud_labels_stay_inside_title_safe(self):
        html = E.CommercialCompiler(profile(), self.tmp).build_webgl_hud().read_text()
        self.assertIn("const safe = innerWidth * 0.05;", html)
        self.assertIn("innerHeight * 0.95 - dom.offsetHeight", html)

    def test_lines_say_sqlite_the_way_its_author_does(self):
        text = (HERE / "profiles" / "nougenshards_lines.tsv").read_text()
        self.assertIn("S Q L ite", text)
        self.assertNotIn("S Q Lite", text)


    # ---------- post pass (pure parts) ----------
    def _post(self):
        sys.path.insert(0, str(HERE / "post"))
        import post as P
        import track as Tr
        return P, Tr

    def test_captions_split_at_clauses_and_stay_short(self):
        P, _ = self._post()
        parts = P.split_caption("Every session loses context. And that's why we built NouGenShards, to power three dimensions of agent memory.")
        self.assertEqual(parts[0], "Every session loses context.")
        self.assertTrue(all(len(x) <= 55 for x in parts), parts)
        self.assertEqual(" ".join(parts).replace("  ", " "), "Every session loses context. And that's why we built NouGenShards, to power three dimensions of agent memory.")

    def test_captions_clamp_small_overruns_to_the_cut_but_keep_real_carryovers(self):
        P, _ = self._post()
        prof = json.loads((HERE / "post" / "profiles" / "nougenshards_post.json").read_text())
        plan = [{"id": "a", "start": 0.167, "end": 3.48},      # ends F86 in a cut that ends F82: clamp
                {"id": "b", "start": 19.1, "end": 20.67}]      # ends F498 in a cut ending F484: 14 frames, clamp
        cues = P.build_captions(plan, {"a": "Short line.", "b": "Eighty-seven sixty-six."}, prof)
        self.assertEqual(cues[0]["to"], 82)
        self.assertEqual(cues[1]["to"], 484)
        far = P.build_captions([{"id": "c", "start": 7.0, "end": 9.5}], {"c": "Carried over."}, prof)   # J-cut, 46 frames over
        self.assertGreater(far[0]["to"], 184)

    def test_written_captions_undo_the_spoken_spellings(self):
        P, _ = self._post()
        prof = json.loads((HERE / "post" / "profiles" / "nougenshards_post.json").read_text())
        t = P.written_texts(HERE / "profiles" / "nougenshards_lines.tsv", prof)
        self.assertIn("SQLite", t["02"])
        self.assertEqual(t["05"], "FTS5, WAL mode!")

    def test_track_picks_follows_and_glides_into_the_hand(self):
        _, Tr = self._post()
        faces = {f: [{"x": 0.3, "top": 0.2, "w": 0.1, "h": 0.2}, {"x": 0.7 + f * 0.001, "top": 0.4, "w": 0.1, "h": 0.15}] for f in range(10, 31)}
        chosen = Tr.follow(faces, 10, 30, "rightmost")
        self.assertTrue(all(c["x"] > 0.6 for c in chosen.values()))
        self.assertEqual(Tr.pick(faces[20], "smallest")["h"], 0.15)
        track = Tr.wheel_positions(chosen, 10, 30, "w", 75)
        self.assertTrue(all(v["r"] <= 75 for v in track.values()))
        Tr.glide(track, "w", 28, (100.0, 50.0), 10)
        self.assertEqual((track[28]["x"], track[28]["y"]), (100.0, 50.0))
        self.assertNotEqual(track[18]["x"], 100.0)


if __name__ == "__main__":
    unittest.main()
