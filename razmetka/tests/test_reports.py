import json
import sys
from pathlib import Path
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine as E
import quality


class Reports(unittest.TestCase):
    def test_doubts_on_late_pages_are_not_dropped_after_400(self):
        with tempfile.TemporaryDirectory() as temp:
            from unittest.mock import patch
            with patch.object(E,'NORMY',Path(temp)):
                d=E.docdir('REPORT_TEST');(d/'pages_md').mkdir(parents=True)
                E.save_json(d/'progress.json',{'pages':2,'done':[1,2]})
                (d/'pages_md/p001.md').write_text('<!-- стр. 1 -->\n'+'[?1] '*450,encoding='utf-8')
                (d/'pages_md/p002.md').write_text('<!-- стр. 2 -->\n[?2]',encoding='utf-8')
                E.assemble('REPORT_TEST')
                text=(d/'document.md').read_text(encoding='utf-8')
                self.assertIn('- Стр. 2:',text.split('## Сомнительные места')[1])
                self.assertEqual(json.loads((d/'quality.json').read_text(encoding='utf-8'))['pages'][0]['doubts'],450)

    def test_relation_discrepancy_keeps_printed_value(self):
        vals=['0']*17
        for col,val in {6:'10',7:'40',9:'2',10:'60',12:'20',17:'9'}.items(): vals[col-1]=val
        text='---\nобозначение: ГОСТ 8509-93\n---\n<!-- стр. 4 -->\nТаблица 1\n<table><tbody><tr>'+''.join('<td>'+v+'</td>' for v in vals)+'</tr></tbody></table>'
        issues=quality.relation_checks(text)
        self.assertEqual(len(issues),1)
        self.assertEqual(issues[0]['row'],1)
        self.assertAlmostEqual(issues[0]['expected'],7.85)
        self.assertIn('<td>9</td>',text)
