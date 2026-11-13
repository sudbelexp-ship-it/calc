"""Exercise the real batch CLI on the interruption boundary: JSON saved, MD absent."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parents[1]


class BatchResume(unittest.TestCase):
    def test_cached_page_rebuilt_manual_review_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            doc=Path(temp)/'TEST_RESUME'
            (doc/'auto').mkdir(parents=True)
            (doc/'pages_md').mkdir()
            (doc/'progress.json').write_text(json.dumps({'pages':2,'done':[1]}),encoding='utf-8')
            (doc/'meta.json').write_text('{}',encoding='utf-8')
            for n in (1,2):
                (doc/'auto'/f'p{n:03d}.json').write_text(json.dumps(dict(page=n,source='text',w=1000,h=1000,
                    words=[dict(t='123.45',x0=100,y0=400,x1=200,y1=430,c=1,size=24,bold=False,it=False)],
                    tables=[],figures=[],fig_rich=[])),encoding='utf-8')
            page=doc/'pages_md/p001.md'
            page.write_text('<!-- стр. 1 -->\nReviewed original 987.6\n',encoding='utf-8')
            (doc/'pages_md/p001.manual').write_text('1',encoding='utf-8')
            (doc/'pages_md/p001.reviewed').write_text('1',encoding='utf-8')
            before={p.name:p.read_bytes() for p in (doc/'auto').glob('p*.json')}
            result=subprocess.run([sys.executable,str(HERE/'batch.py'),str(doc),'--mode','precise','--log',str(Path(temp)/'batch.log')],
                env=dict(os.environ,PYTHONUTF8='1'),capture_output=True,text=True,encoding='utf-8',timeout=45)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(before,{p.name:p.read_bytes() for p in (doc/'auto').glob('p*.json')})
            self.assertIn('Reviewed original 987.6',page.read_text(encoding='utf-8'))
            self.assertTrue((doc/'pages_md/p001.reviewed').exists())
            self.assertIn('[?123.45]',(doc/'pages_md/p002.md').read_text(encoding='utf-8'))
            self.assertEqual(json.loads((doc/'progress.json').read_text())['done'],[1,2])
            report=json.loads((doc/'quality.json').read_text(encoding='utf-8'))
            self.assertEqual(len(report['pages']),2)
            self.assertTrue(report['pages'][0]['reviewed'])
            self.assertEqual(report['pages'][1]['doubts'],1)
