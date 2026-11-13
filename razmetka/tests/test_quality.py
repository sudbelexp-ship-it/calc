import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from numeric import tokens, values
from eval_core import score_page, evaluate_text
from table_data import shape, tables_in, caption_id
from strict_review import mark_numbers
from quality import expression
import engine
import cells
import ocr


def word(text, y=0):
    return dict(t=text, c=1., x0=10., x1=100., y0=float(y), y1=float(y+30), size=24., bold=False, it=False)


class NumericSafety(unittest.TestCase):
    def test_plus_minus_and_spaced_signs_are_not_discarded(self):
        self.assertEqual(values('− 0,5'),['-0.5'])
        self.assertEqual(tokens('± [?1,0]'),[('±1.0',True)])
        self.assertNotEqual(values('±1'),values('1'))
        ref='Таблица 1\n<table><tr><td>± 1,0</td></tr></table>'
        actual=ref.replace('± 1,0','1,0')
        self.assertEqual(score_page(ref,actual)['wrong_unflagged'],1)

    def test_table_metric_is_separate_from_prose_numbers(self):
        ref='<!-- стр. 1 -->\nText 2020\nТаблица 1\n| x |\n| --- |\n| 5 |'
        score=evaluate_text(ref,ref.replace('| 5 |','| 6 |'))
        self.assertEqual(score['table_total']['wrong_unflagged'],1)
        self.assertEqual(score['table_total']['correct'],0)
        self.assertEqual(score['prose_total']['wrong_unflagged'],0)
        self.assertGreater(score['prose_total']['correct'],0)

    def test_digits_in_multilevel_header_do_not_create_data_rows(self):
        xs=[100*i for i in range(17)]
        def cell(r,c,text,rs=1,cs=1,y=10):
            w=word(text,y);w.update(x0=c*100+10,x1=c*100+70,y1=y+12,size=10)
            return dict(r=r,c=c,rs=rs,cs=cs,bbox=[xs[c],r*30,xs[c+cs],(r+rs)*30],words=[w])
        cc=[cell(0,0,'2',4),cell(0,1,'Размеры',1,6),cell(0,7,'2',4),
            cell(0,8,'Масса',4),cell(0,9,'Справочные значения',1,7)]
        for c in range(16):
            b=cell(4,c,'10',y=140);b['bbox']=[xs[c],120,xs[c+1],700];b['words']=[]
            for i in range(17):
                w=word(str(10+i),140+i*30);w.update(x0=c*100+10,x1=c*100+70,y1=152+i*30,size=10)
                b['words'].append(w)
            cc.append(b)
        html,rows,cols=engine.render_table(dict(xs=xs,ys=[0,30,60,90,120,700],nr=5,nc=16,cells=cc))
        self.assertEqual((rows,cols),(17,16))
        self.assertIn('<thead>',html)

    def test_caption_spacing_does_not_guess_digits(self):
        self.assertEqual(caption_id('Продолжениетаблицы А. [?1]'), 'А.1')
        self.assertEqual(caption_id('Та б л и ца [?2]'), '2')
        self.assertIsNone(caption_id('Окончание таблицы АЛ'))

    def test_partial_doubt_table_number_does_not_inherit_previous(self):
        text = 'Таблица 3\n| x |\n| --- |\n| 5 |\n\nТаблица А.[?1]\n| x |\n| --- |\n| 7 |'
        tables = tables_in(text)
        self.assertEqual([t['name'] for t in tables], ['3', 'А.1'])
        self.assertEqual([t['start'] for t in tables], [0, 0])

    def test_table_check_comment_identifies_caption_fragment(self):
        text = 'Таблица a\n<table><tr><td>7</td></tr></table>\n<!-- таблица А.1: строк 1, столбцов 1 -->'
        self.assertEqual(tables_in(text)[0]['name'], 'А.1')

    def test_unknown_table_never_shifts_named_table_rows(self):
        text = 'Таблица 3\n| x |\n| --- |\n| 5 |\n\n<table><tr><td>8</td></tr></table>'
        self.assertNotEqual(tables_in(text)[0]['name'], tables_in(text)[1]['name'])

    def test_partial_doubt_retains_decimal(self):
        self.assertEqual(tokens('1,[?3]'), [('1.3', True)])
        self.assertNotEqual(values('-5'), values('5'))

    def test_sign_difference_is_flagged(self):
        ws = [word('-5')]
        with patch.object(ocr, 'ocr_words', return_value=[word('5')]):
            stats = engine.crosscheck(ws, None, [], strict=True)
        self.assertEqual(stats['flagged'], 1)
        self.assertEqual(ws[0]['t'], '-5')
        self.assertEqual(ws[0]['alt'], '5')

    def test_vote_never_replaces_value(self):
        ws = [word('1,3')]
        with patch.object(ocr, 'ocr_words', return_value=[word('1,8')]):
            ocr.vote_numbers(None, ws)
        self.assertEqual(ws[0]['t'], '1,3')
        self.assertLess(ws[0]['c'], .85)

    def test_page_detection_is_restored_after_cell_recognition(self):
        class Stateful:
            det = True
            def __call__(self, img, **kwargs):
                self.det = kwargs.get('use_det', self.det)
                return SimpleNamespace(txts=('123',), scores=(1.,),
                    boxes=[[[0, 0], [100, 0], [100, 30], [0, 30]]], word_results=None)
        model = Stateful()
        ocr.set_precise(False)
        with patch.object(ocr, '_engine', return_value=model):
            ocr.recognize_line(None)
            self.assertFalse(model.det)
            ocr.ocr_words(None)
            self.assertTrue(model.det)

    def test_cell_order_matters(self):
        ws = [word('1'), word('2', 40)]
        cells.compare_cell(ws, [word('2'), word('1', 40)])
        self.assertTrue(all(w['c'] < .85 for w in ws))

    def test_empty_thead_continuation_not_data(self):
        html = '<table><thead><tr><th rowspan="2">n</th><th>x</th></tr><tr></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
        self.assertEqual(shape(html), (1, 2, False))
        self.assertEqual(engine.html_shape(html), (1, 2))

    def test_cell_swap_is_two_errors(self):
        ref = '| a | b |\n|---|---|\n|10|20|'
        auto = '| a | b |\n|---|---|\n|20|10|'
        self.assertEqual(score_page(ref, auto)['wrong_unflagged'], 2)

    def test_expanded_rowspan_has_correct_position(self):
        s = '<!-- стр. 1 -->\nТаблица 1\n<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td rowspan="2">5</td><td>10</td></tr><tr><td>20</td></tr></tbody></table>'
        row = tables_in(s)[0]['rows'][1]
        self.assertEqual([x['text'] for x in row], ['5', '20'])

    def test_strict_markers_do_not_change_values_or_links(self):
        s = '<!-- стр. 1 -->\nТаблица 1\n| a | b |\n|---|---|\n|-5|1,3|\n![Таблица 1](img/p001_tabl_1.png)'
        marked = mark_numbers(s)
        self.assertIn('(img/p001_tabl_1.png)', marked)
        self.assertIn('<!-- стр. 1 -->', marked)
        scored = score_page(s, marked)
        self.assertEqual(scored['wrong'], 0)
        self.assertEqual(scored['correct'], scored['found'])
        self.assertEqual(scored['flagged'], scored['found'])

    def test_relation_expression_not_python_execution(self):
        self.assertEqual(expression('sqrt(c1/c2)', {'c1': 16, 'c2': 4}), 2)
        with self.assertRaises(ValueError):
            expression("__import__('os').system('echo bad')", {})

    def test_inequalities_are_not_html_tags(self):
        marked = mark_numbers('h < 120; 120 < h < 380; h > 680')
        self.assertTrue(all(flagged for value, flagged in tokens(marked)))
        self.assertEqual(score_page('h < 120; h > 680', 'h < 121; h > 681')['wrong_unflagged'], 2)


if __name__ == '__main__':
    unittest.main()
