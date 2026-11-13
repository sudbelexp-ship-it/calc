import json
import sys
from pathlib import Path
import tempfile
import unittest
import subprocess
import os
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import engine as E
import library as L


class Library(unittest.TestCase):
    def test_empty_source_does_not_import_current_working_directory(self):
        with self.assertRaisesRegex(ValueError,'Выберите'):L.register('')

    def test_failed_atomic_markdown_save_retains_previous_result(self):
        path=self.root/'page.md';path.write_text('previous result',encoding='utf-8')
        with patch.object(E.os,'replace',side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):E.save_text(path,'replacement')
        self.assertEqual(path.read_text(encoding='utf-8'),'previous result')
        self.assertEqual(list(self.root.glob('*.tmp')),[])

    def test_real_process_exit_after_extraction_resumes_without_reextracting_page(self):
        source=self.pdf(self.root/'source/restart.pdf',3)
        name=L.register(source)['ids'][0]
        here=Path(E.__file__).parent
        setup="import sys; from pathlib import Path; import library as L; import engine as E; L.CATALOG=Path(sys.argv[1]); name=sys.argv[2]; "
        first=setup+"L.initialize(name,L.state()['documents'][name]); E.extract(name,1,'text'); import os; os._exit(73)"
        env=dict(os.environ,PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',RZ_WORKER_LOCK=str(self.root/'restart.lock'))
        a=subprocess.run([sys.executable,'-c',first,str(L.CATALOG),name],cwd=here,env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
        self.assertEqual(a.returncode,73,a.stdout+a.stderr)
        d=E.docdir(name);cache=d/'auto/p001.json';stamp=cache.stat().st_mtime_ns
        self.assertFalse((d/'pages_md/p001.md').exists())
        b=subprocess.run([sys.executable,'-c',setup+"L.run([name],'text')",str(L.CATALOG),name],cwd=here,env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
        self.assertEqual(b.returncode,0,b.stdout+b.stderr)
        self.assertEqual(cache.stat().st_mtime_ns,stamp)
        self.assertEqual(E.load_json(d/'progress.json')['done'],[1,2,3])
        self.assertTrue(all((d/'pages_md'/f'p{n:03d}.md').exists() for n in (1,2,3)))
        self.assertTrue((d/'document.md').exists())

    def test_custom_output_and_corrupt_page_are_processed_again(self):
        pdf=self.pdf(self.root/'source/doc.pdf',1)
        target=self.root/'custom-output'
        name=L.register(pdf,str(target))['ids'][0]
        L.initialize(name,L.state()['documents'][name])
        self.assertTrue(E.docdir(name).is_relative_to(target))
        E.save_json(E.docdir(name)/'auto/p001.json',{'page':1,'words':[{}],'tables':[],'figures':[],'w':100,'h':100,'source':'ocr'})
        with patch.object(E,'recognize',side_effect=self.fake_page) as recognize:
            L.run([name],'ocr')
            self.assertEqual(recognize.call_count,1)
        self.assertEqual(L.state()['last_mode'],'ocr')

    def test_corrupt_catalog_recovers_backup_without_losing_outputs(self):
        source=self.pdf(self.root/'doc.pdf',1)
        name=L.register(source)['ids'][0]
        L.initialize(name,L.state()['documents'][name])
        data=L.state();data['last_mode']='ocr';L.save(data)
        L.CATALOG.write_text('{interrupted',encoding='utf-8')
        recovered=L.state()
        self.assertIn(name,recovered['documents'])
        self.assertIn('warning',recovered)
        self.assertTrue(E.docdir(name).exists())

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        for obj,attr,value in [(L,'CATALOG',self.root/'library.json'),(E.OCR.RES,'LOCK_PATH',self.root/'worker.lock')]:
            p=patch.object(obj,attr,value);p.start();self.addCleanup(p.stop)

    def pdf(self,path,pages=3):
        path.parent.mkdir(parents=True,exist_ok=True)
        with E.fitz.open() as pdf:
            for i in range(pages):pdf.new_page().insert_text((70,100),f'Value {i+1}')
            pdf.save(path)
        return path

    def fake_page(self,name,pages,mode,cancel=None):
        d=E.docdir(name)
        for n in pages:
            E.save_json(d/'auto'/f'p{n:03d}.json',dict(page=n,words=[],tables=[],figures=[],fig_rich=[],w=100,h=100,source='text'))
            (d/'pages_md'/f'p{n:03d}.md').write_text(f'<!-- стр. {n} -->\n[?{n}]',encoding='utf-8')
            E.assemble(name)

    def test_default_folder_and_collision_free_names(self):
        a=self.pdf(self.root/'source/a/same.PDF');b=self.pdf(self.root/'source/b/same.pdf')
        result=L.register(self.root/'source',recursive=True)
        self.assertEqual(result['count'],2)
        self.assertEqual(Path(result['output']),self.root/'source'/L.RESULTS)
        self.assertEqual(len(set(result['ids'])),2)
        for name in result['ids']:
            e=L.state()['documents'][name];L.initialize(name,e)
            self.assertTrue((Path(e['output'])/'progress.json').exists())
            self.assertFalse((Path(e['output'])/'pages/p001.jpg').exists())

    def test_cancel_resume_skips_saved_json_and_preserves_manual(self):
        pdf=self.pdf(self.root/'source/doc.pdf')
        name=L.register(pdf)['ids'][0]
        with patch.object(E,'recognize',side_effect=self.fake_page) as recognize:
            with self.assertRaises(E.Cancelled):
                L.run([name],cancel=lambda:(E.docdir(name)/'auto/p001.json').exists())
            self.assertEqual(recognize.call_count,1)
        d=E.docdir(name)
        self.assertTrue((d/'document.md').exists())
        (d/'pages_md/p001.md').unlink() # crash after JSON commit, before Markdown
        (d/'pages_md/p002.md').write_text('<!-- стр. 2 -->\nManually verified 99',encoding='utf-8')
        (d/'pages_md/p002.manual').write_text('1')
        (d/'pages_md/p002.reviewed').write_text('1')
        with patch.object(E,'recognize',side_effect=self.fake_page) as recognize:
            L.run([name])
            self.assertEqual([c.args[1] for c in recognize.call_args_list],[[3]])
        self.assertIn('Manually verified 99',(d/'document.md').read_text(encoding='utf-8'))
        self.assertEqual(E.load_json(d/'progress.json')['done'],[1,2,3])
        self.assertTrue((d/'pages_md/p001.md').exists())
        self.assertTrue((d/'report.md').exists())

    def test_remove_and_reimport_retain_files_and_restart_recovers_folder(self):
        source=self.pdf(self.root/'source/doc.pdf')
        name=L.register(source,label='CUSTOM')['ids'][0]
        L.initialize(name,L.state()['documents'][name]);d=E.docdir(name)
        (d/'keep.txt').write_text('saved')
        original=source.read_bytes()
        L.remove(name)
        self.assertNotIn(name,dict(L.entries()))
        self.assertTrue((d/'keep.txt').exists());self.assertEqual(source.read_bytes(),original)
        self.assertEqual(L.register(source)['ids'],[name])
        self.assertEqual(E.docdir(name),d)
        L.CATALOG.unlink() # reinstall/restart: discover existing output by identity
        L.CATALOG.with_suffix('.bak.json').unlink(missing_ok=True)
        L.register(source)
        self.assertEqual(E.docdir(name),d)

    def test_changed_source_gets_new_version_and_never_reuses_old_pages(self):
        source=self.pdf(self.root/'doc.pdf',1)
        old=L.register(source)['ids'][0];L.initialize(old,L.state()['documents'][old])
        original=E.docdir(old);(original/'keep.txt').write_text('old result')
        source.write_bytes(source.read_bytes()+b'\n% revision\n')
        with self.assertRaisesRegex(ValueError,'изменился'):L.run([old])
        new=L.register(source)['ids'][0]
        self.assertNotEqual(old,new);self.assertNotEqual(E.docdir(old),E.docdir(new))
        self.assertTrue((original/'keep.txt').exists())
