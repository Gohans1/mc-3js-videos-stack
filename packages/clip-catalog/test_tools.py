import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import catalog
import catalog_review as review


class Tools(unittest.TestCase):
    def test_sheets_reject_old_render_after_sheet_failure(self):
        from batch import run_batch
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "renders").mkdir()
            (root / "renders/sheet_mixamo__Idle.jpg").write_bytes(b"old sheet")
            with self.assertRaises(RuntimeError):
                run_batch([sys.executable, "-c", 'print("SHEET FAIL mixamo/Idle: load error")'],
                          root, root / "catalog/mixamo.jsonl", "sheets", "mixamo", ["Idle"], 15)
            self.assertFalse((root / "catalog/sheets/mixamo__Idle.jpg").exists())

    def test_sheets_can_move_from_another_volume(self):
        from batch import run_batch
        import os
        other_volume = "E:/" if os.name == "nt" and Path("E:/").is_dir() else None
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory(dir=other_volume) as dest:
            root = Path(d)
            (root / "renders").mkdir()
            code = 'from pathlib import Path; Path("renders/sheet_mixamo__Idle.jpg").write_bytes(b"new sheet")'
            run_batch([sys.executable, "-c", code], root, Path(dest) / "catalog/mixamo.jsonl", "sheets", "mixamo", ["Idle"], 15)
            self.assertEqual((Path(dest) / "catalog/sheets/mixamo__Idle.jpg").read_bytes(), b"new sheet")

    def test_review_builds_available_pages_without_requiring_all_sheets(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as d:
            cat = Path(d)
            sheets, pages = cat / "sheets", cat / "review_pages"
            sheets.mkdir()
            rows = [dict(ref="mixamo/" + name, dur=1, start="stand", end="stand", seq=["stand"], reach=0, turn=0)
                    for name in ["Idle", "Walk"]]
            (cat / "mixamo.jsonl").write_text('\n'.join(json.dumps(r) for r in rows), encoding="utf8")
            Image.new("RGB", (640, 360)).save(sheets / "mixamo__Idle.jpg")
            with patch.multiple(review, CAT=cat, REVIEW=cat / "review.json", SHEETS=sheets, OUT=pages):
                review.pages()
            self.assertEqual(json.loads((pages / "pages.json").read_text(encoding="utf8")), {"0": ["mixamo/Idle"]})

    def test_eval_resumes_completed_scenes_and_retries_failures(self):
        import catalog_eval
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            scenes, out = root / "scenes.txt", root / "out.txt"
            scenes.write_text("  # comment\nHe walks\nHe sits\n", encoding="utf8")
            args = ["eval", str(out), "--scenes", str(scenes)]
            success = __import__("subprocess").CompletedProcess([], 0, "mixamo/Walk\n", "")
            failure = __import__("subprocess").CompletedProcess([], 1, "", "offline")
            with patch.object(sys, "argv", args), patch.object(catalog_eval.subprocess, "run", side_effect=[success, failure]):
                self.assertEqual(catalog_eval.main(), 1)
            self.assertIn("ERROR offline", out.read_text(encoding="utf8"))
            with patch.object(sys, "argv", args + ["--resume"]), patch.object(catalog_eval.subprocess, "run", return_value=success) as remote:
                self.assertEqual(catalog_eval.main(), 0)
                self.assertEqual(remote.call_count, 1)
            self.assertNotIn("ERROR", out.read_text(encoding="utf8"))

    def test_review_page_saves_complete_notes_and_partial_fix_keeps_them(self):
        with tempfile.TemporaryDirectory() as d:
            cat = Path(d)
            (cat / "mixamo.jsonl").write_text('{"ref":"mixamo/Idle","start":"stand"}\n', encoding="utf8")
            (cat / "pages.json").write_text('{"0":["mixamo/Idle"]}', encoding="utf8")
            note = {"desc": "stands still", "mood": ["calm"], "prop": ["none"], "style": ["natural"]}
            with patch.multiple(review, CAT=cat, REVIEW=cat / "review.json", OUT=cat):
                with patch.object(sys, "argv", ["review", "--page", "0"]), patch.object(sys, "stdin", io.StringIO(json.dumps({"1": note}))):
                    review.main()
                with patch.object(sys, "argv", ["review", "--fix", "mixamo/Idle", '{"start":"kneel"}']):
                    review.main()
            self.assertEqual(json.loads((cat / "review.json").read_text(encoding="utf8"))["mixamo/Idle"], {**note, "start": "kneel"})

    def test_search_skips_failed_rows_before_reading_postures(self):
        with tempfile.TemporaryDirectory() as d, patch.object(catalog, "ROOT", Path(d)):
            cat = Path(d) / "catalog"
            cat.mkdir()
            (cat / "mixamo.jsonl").write_text('{"ref":"mixamo/bad","error":"failed"}\n', encoding="utf8")
            self.assertEqual(list(catalog.rows(["mixamo"])), [])

    def test_review_rejects_unknown_ref_and_fields_without_writing(self):
        with tempfile.TemporaryDirectory() as d:
            cat = Path(d)
            (cat / "mixamo.jsonl").write_text('{"ref":"mixamo/Idle","seq":["stand"]}\n', encoding="utf8")
            with patch.multiple(review, CAT=cat, REVIEW=cat / "review.json"):
                for ref, value in [("mixamo/Typo", '{"desc":"idle"}'), ("mixamo/Idle", '{"ref":"ual1/Other"}'), ("mixamo/Idle", '{"seq":[3]}')]:
                    with self.subTest(ref=ref), patch.object(sys, "argv", ["catalog_review.py", "--fix", ref, value]):
                        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
                            review.main()
                        self.assertEqual(raised.exception.code, 2)
                        self.assertFalse((cat / "review.json").exists())

    def test_review_page_requires_exact_slots_and_typed_tags(self):
        with tempfile.TemporaryDirectory() as d:
            cat = Path(d)
            (cat / "mixamo.jsonl").write_text('{"ref":"mixamo/Idle"}\n', encoding="utf8")
            (cat / "pages.json").write_text('{"0":["mixamo/Idle"]}', encoding="utf8")
            good = {"desc": "stands still", "mood": ["calm"], "prop": ["none"], "style": ["natural"]}
            with patch.multiple(review, CAT=cat, REVIEW=cat / "review.json", OUT=cat):
                for notes in [{"1": good, "2": good}, {"1": {**good, "mood": "calm"}}]:
                    with patch.object(sys, "argv", ["review", "--page", "0"]), patch.object(sys, "stdin", io.StringIO(json.dumps(notes))):
                        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
                            review.main()
                        self.assertEqual(raised.exception.code, 2)
                        self.assertFalse((cat / "review.json").exists())

    def test_batch_preserves_success_on_failure_and_does_not_split_names(self):
        from batch import run_batch
        with tempfile.TemporaryDirectory(prefix="catalog space ") as d:
            root = Path(d)
            out = root / "mixamo.jsonl"
            code = 'import json,os,sys; print("ROW " + json.dumps({"ref":"mixamo/Walk Forward","clips":os.environ["LAB_CLIPS"]}), flush=True); sys.exit(1)'
            with self.assertRaises(RuntimeError):
                run_batch([sys.executable, "-c", code], root, out, "catalog", "mixamo", ["Walk Forward", "Idle"], 15)
            row = json.loads(out.read_text(encoding="utf8"))
            self.assertEqual(row["clips"], "Walk Forward,Idle")
            self.assertEqual(row["ref"], "mixamo/Walk Forward")

    def test_batch_times_out_but_keeps_completed_rows(self):
        from batch import run_batch
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            out = root / "mixamo.jsonl"
            code = 'import time; print(\'ROW {"ref":"mixamo/Idle"}\', flush=True); time.sleep(30)'
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                run_batch([sys.executable, "-c", code], root, out, "catalog", "mixamo", ["Idle", "Walk"], 5)
            self.assertEqual(json.loads(out.read_text(encoding="utf8"))["ref"], "mixamo/Idle")

    def test_batch_retries_error_rows_and_retains_last_success(self):
        from batch import completed
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "mixamo.jsonl"
            out.write_text('\n'.join(json.dumps(r) for r in [
                {"ref": "mixamo/Idle", "dur": 1},
                {"ref": "mixamo/Bad", "error": "load"},
                {"ref": "mixamo/Bad", "dur": 2},
                {"ref": "mixamo/Again", "error": "load"},
            ]), encoding="utf8")
            self.assertEqual(completed(out, "catalog"), {"Idle", "Bad"})


if __name__ == "__main__":
    unittest.main()
