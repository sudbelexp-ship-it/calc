import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import layout
import numpy as np


def word(text,x,y):
    return dict(t=text,x0=x,y0=y-6,x1=x+35,y1=y+6,c=1,size=10,bold=False,it=False)


class LogicalRows(unittest.TestCase):
    def test_aligned_body_recovers_a_truncated_outer_rule(self):
        xs=list(range(0,1100,100))
        a=dict(xs=xs,ys=[0,50,140],bbox=(0,0,1000,140),cells=[])
        b=dict(xs=xs[:-1]+[1035],ys=[220,300,400],bbox=(0,220,1035,400),cells=[])
        ws=[word(str(c+1),c*100+10,y) for y in (160,190) for c in range(10)]
        result=layout.aligned_fragments([a,b],ws,np.zeros((800,1200),np.uint8))
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['xs'][-1],1035)
        self.assertTrue(all(isinstance(v,int) for v in result[0]['bbox']))

    def test_normalized_table_is_not_split_into_rows_again(self):
        import engine as E
        cells=[]
        for r in range(3):
            for c in range(10):
                ws=[word('header' if r==0 else str(i+1),c*100+10,r*100+10+i*20) for i in range(1 if r==0 else 3)]
                cells.append(dict(r=r,c=c,rs=1,cs=1,bbox=(c*100,r*100,(c+1)*100,(r+1)*100),words=ws))
        _,rows,cols=E.render_table(dict(xs=list(range(0,1100,100)),ys=[0,100,200,300],nr=3,nc=10,header_rows=1,cells=cells))
        self.assertEqual((rows,cols),(2,10))

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
        self.assertTrue(all(isinstance(v,int) for v in table['bbox']))
        self.assertEqual(sum(c['cs']==10 and c['r']>=1 for c in table['cells']),1)
        self.assertFalse(any('words' in c for c in table['cells']))
