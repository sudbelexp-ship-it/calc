import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import formulas


class FormulaSafety(unittest.TestCase):
    def test_missing_model_fails_without_implicit_download(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(formulas,'MODELS',Path(temp)):
            with self.assertRaisesRegex(RuntimeError,'install-formulas'):
                formulas.ready()

    def test_formula_output_is_never_marked_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'formula.png'
            img=Image.new('RGB',(100,40),'white');ImageDraw.Draw(img).text((10,10),'x = -5',fill='black');img.save(path)
            with patch.object(formulas,'ready',return_value=[]), patch.object(formulas,'_model',return_value=('-5+x',.1)):
                result=formulas.recognize.__wrapped__(path)
            self.assertEqual(result['latex'],'-5+x')
            self.assertFalse(result['verified'])
