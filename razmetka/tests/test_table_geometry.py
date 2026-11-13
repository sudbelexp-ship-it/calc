import sys
from pathlib import Path
import unittest
import cv2
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tables


class TableGeometry(unittest.TestCase):
    def test_missing_outer_vertical_rules_keep_outer_columns(self):
        img=np.full((600,900),255,np.uint8)
        for y in (100,250,400,500):
            cv2.line(img,(50,y),(850,y),0,2)
        for x in (200,350,500,650,800):
            cv2.line(img,(x,100),(x,500),0,2)
        ts=tables.find_tables(img)
        self.assertEqual(len(ts),1)
        self.assertEqual(len(ts[0]['xs'])-1,6)
        self.assertLess(abs(ts[0]['xs'][0]-50),5)
        self.assertLess(abs(ts[0]['xs'][-1]-850),5)

    def test_only_aligned_header_body_are_joined(self):
        mask=np.zeros((1000,500),np.uint8)
        header=dict(xs=[20,100,200,300],ys=[20,80,150],bbox=(20,20,300,150),cells=[dict(cs=2)])
        body=dict(xs=[20,100,200,300],ys=list(range(190,600,50)),bbox=(20,190,300,590),cells=[])
        self.assertEqual(len(tables._join_header_body([header,body],mask,mask,1000)),1)
        separate=dict(xs=[50,120,220,320],ys=list(range(190,600,50)),bbox=(50,190,320,590),cells=[])
        header=dict(xs=[20,100,200,300],ys=[20,80,150],bbox=(20,20,300,150),cells=[dict(cs=2)])
        self.assertEqual(len(tables._join_header_body([header,separate],mask,mask,1000)),2)
