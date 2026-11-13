import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import layout


def word(text,x,y):
    return dict(t=text,x0=x,y0=y-6,x1=x+35,y1=y+6,c=1,size=10,bold=False,it=False)


class LogicalRows(unittest.TestCase):
    def test_printed_merged_value_is_not_cut_into_two_row_crops(self):
        xs=list(range(0,1100,100))
        table=dict(xs=xs,ys=[0,60,140,220,280],bbox=(0,0,1000,280),cells=[
            dict(r=0,c=0,rs=1,cs=10,bbox=(0,0,1000,60)),
            dict(r=1,c=0,rs=1,cs=1,bbox=(0,60,100,140))])
        ws=[word(str(c+1),c*100+10,y) for y in (100,130,160,190,230,260) for c in range(1,10)]
        ws.append(word('7',10,115))
        layout.normalize(table,ws)
        merged=[c for c in table['cells'] if c['c']==0 and c['r']==table['header_rows']]
        self.assertEqual(len(merged),1)
        self.assertEqual(merged[0]['rs'],2)

    def test_open_bottom_keeps_numeric_rows_and_section_but_not_footer(self):
        xs=list(range(0,1100,100))
        table=dict(xs=xs,ys=[0,60,140],bbox=(0,0,1000,140),cells=[
            dict(r=0,c=0,rs=1,cs=10,bbox=(0,0,1000,60)),
            dict(r=1,c=0,rs=1,cs=10,bbox=(0,60,1000,140))])
        ws=[word(str(c+1),c*100+10,y) for y in (100,130,160,190) for c in range(10)]
        ws += [word('Нормальные двутавры',300,75),word('212',490,240)]
        layout.normalize(table,ws)
        self.assertEqual(table['header_rows'],1)
        self.assertEqual(len(table['ys'])-1-table['header_rows'],5)
        self.assertLess(table['bbox'][3],220)
        self.assertEqual(sum(c['cs']==10 and c['r']>=1 for c in table['cells']),1)
        self.assertFalse(any('words' in c for c in table['cells']))
