import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import resources as R
import subprocess
import os


class Resources(unittest.TestCase):
    def test_worker_lock_reentrant_and_released_after_process_death(self):
        code="import resources; lock=resources.worker(); lock.__enter__(); print('locked',flush=True); input()"
        proc=subprocess.Popen([sys.executable,'-c',code],cwd=Path(R.__file__).parent,
            env=dict(os.environ,PYTHONUTF8='1'),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            self.assertEqual(proc.stdout.readline().strip(),'locked')
            with self.assertRaises(RuntimeError):
                with R.worker():
                    pass
        finally:
            proc.terminate();proc.communicate(timeout=10)
        with R.worker():
            with R.worker():
                pass

    def test_thread_budget(self):
        self.assertGreaterEqual(R.THREADS, 1)
        self.assertLessEqual(R.THREADS, 4)
        self.assertEqual(R.onnx_params()['EngineConfig.onnxruntime.inter_op_num_threads'], 1)

    def test_low_memory_stops_without_work(self):
        with patch.object(R, 'memory', return_value={'total': 8*1024**3, 'available': 1024**3}):
            with self.assertRaises(RuntimeError):
                R.checkpoint()

    def test_huge_page_rejected_before_allocation(self):
        with patch.object(R, 'memory', return_value=None):
            with self.assertRaises(RuntimeError):
                R.check_pixels(10000, 10000)

    def test_page_estimate_preserves_reserve(self):
        with patch.object(R, 'memory', return_value={'total': 8*1024**3, 'available': 2*1024**3}):
            with self.assertRaises(RuntimeError):
                R.check_pixels(4000, 4000)
