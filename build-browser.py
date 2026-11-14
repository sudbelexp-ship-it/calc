from pathlib import Path
import re

root=Path(__file__).parent
s=(root/'browser-source-before.html').read_text(encoding='utf-8')
s=re.sub(r'<section class="card" style="margin-bottom:16px">.*?</section>', '', s, count=1)
s=s.replace('Документы в Markdown —', 'Разметка документов и OCR —')
s=s.replace('<main>', '''<main>
<section class="card"><b>Только браузер · версия 3.0</b>
<p>Без установки программ, Python и локального сервера. При первом запуске браузер загружает библиотеки и модели из интернета. Документы обрабатываются на вашем устройстве. Для формул нужна видеокарта с WebGPU; обычный OCR работает на процессоре в Worker.</p>
<p>Числа автоматически помечаются [?…]. Таблицы и LaTeX — черновик, сверяйте по сохранённым страницам. Фото с перспективой и тенями не поддерживаются: нужен скан.</p>
<div class="acts"><button class="btn sec" id="sourceFolder">Выбрать папку документов</button><button class="btn sec" id="outputFolder">Папка результата</button><button class="btn sec" id="pause">Пауза после страницы</button></div>
<p id="storageInfo" role="status">Результат сохраняется по страницам в браузере. Для продолжения после закрытия выберите исходный файл повторно с тем же режимом. При выборе папки внутри неё создаётся «Распознанные документы».</p>
<p>За один раз обрабатывается одна страница; максимум 4 млн пикселей, один OCR Worker. Видеопамять управляется браузером: режим формул может быть тяжёлым. Закрытая вкладка не продолжает распознавание.</p></section>''',1)
s=s.replace('Один лист занимает 20–60 с.', 'Скорость зависит от устройства; при нехватке видеопамяти выберите обычный OCR.')
s=s.replace('формулы Word (OMML) переводятся в LaTeX без потерь', 'формулы Word (OMML) переводятся в LaTeX для ручной сверки')
s=s.replace('>c.bit-exp.ru</a>', '>bit-exp.ru/c/</a>')
s=s.replace("const done = []; // {name, md}", "const done = []; // {name, md}\n"+(root/'browser-storage.js').read_text(encoding='utf-8'))
# Mark numeric tokens outside image links and math: preserve valid LaTeX and paths.
s=s.replace('return fixUnits(text.replace', 'return (text.replace')
s=s.replace("const bad = await gpuSupport();\n    if (bad) throw", "if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; ocrLang = null; }\n    const bad = await gpuSupport();\n    if (bad) throw")
s=s.replace("const w = await getOcr($('lang').value);", "const w = await getOcr(ctx.lang || $('lang').value);")
s=s.replace("  const { data } = await w.recognize(src);\n  ocrCb = null;", "  let cancel; const abort=new Promise((_,reject)=>cancel=reject);ctx.abort=()=>{w.terminate();ocrWorker=null;ocrLang=null;cancel(new Error('Распознавание отменено'));};\n  let data;try{({data}=await Promise.race([w.recognize(src),abort]));}finally{ctx.abort=null;ocrCb=null;}")
s=s.replace("const cb = e => { if (e.status === 'progress_total' && glmDl) glmDl(e.progress); };", "const cb = e => { if (e.progress != null && glmDl) glmDl(e.progress); };")
# GLM inference lives in a separate Worker, not the interface thread.
gstart=s.index("const GLM_ID =")
gend=s.index('\nfunction fitCanvas',gstart)
worker=s[gstart:gend].replace('window.isSecureContext','self.isSecureContext').replace('location.host','self.location.host').replace('location.pathname','self.location.pathname')
worker=worker.replace("if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; ocrLang = null; }",'')
worker=worker.replace("const c2 = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);",'const c2 = canvas;')
worker=worker.replace('const out = await model.generate(', 'let out;try { out = await model.generate(')
worker=worker.replace("return (text.replace(/^<think>[\\s\\S]*?<\\/think>/, '').trim());", "return (text.replace(/^<think>[\\s\\S]*?<\\/think>/, '').trim()) + (cut!==-1 || end-pl>=4096 ? '\\n\\n[?Генерация остановлена: возможен пропуск текста, сверьте страницу]' : '');} finally {out?.dispose?.();for(const v of Object.values(inputs))v?.dispose?.();}")
worker += '''
self.onmessage=async e=>{const {pixels,width,height}=e.data;try{const text=await glmRecognize({data:pixels,width,height},{status:s=>self.postMessage({status:s})});self.postMessage({text});}catch(err){self.postMessage({error:err.message});}};
'''
(root/'browser-glm-worker.js').write_text(worker,encoding='utf-8')
s=s[:gstart]+'''const GLM_PX=2200000;
let glmWorker=null;
async function gpuSupport(){if(!window.isSecureContext)return 'Нужен HTTPS';if(!navigator.gpu)return 'WebGPU недоступен. Выберите обычный OCR.';try{const a=await navigator.gpu.requestAdapter();return !a?'Видеокарта недоступна':!a.features.has('shader-f16')?'Нет shader-f16: выберите обычный OCR.':'';}catch(e){return e.message;}}
async function glmRecognize(cv,ctx){
  const bad=await gpuSupport();if(bad)throw new Error(bad);
  if(ocrWorker){await ocrWorker.terminate();ocrWorker=null;ocrLang=null;}
  if(!glmWorker)glmWorker=new Worker('browser-glm-worker.js?v=3.0');
  const img=cv.getContext('2d').getImageData(0,0,cv.width,cv.height);
  return new Promise((res,rej)=>{ctx.abort=()=>{glmWorker?.terminate();glmWorker=null;ctx.abort=null;rej(new Error('Распознавание отменено'));};glmWorker.onmessage=e=>{if(e.data.status)ctx.status(e.data.status);else if(e.data.error){ctx.abort=null;glmWorker.terminate();glmWorker=null;rej(new Error(e.data.error));}else {ctx.abort=null;res(e.data.text);}};glmWorker.onerror=e=>{ctx.abort=null;glmWorker.terminate();glmWorker=null;rej(new Error(e.message||'Ошибка WebGPU Worker'));};glmWorker.postMessage({pixels:img.data,width:cv.width,height:cv.height},[img.data.buffer]);});
}
''' +s[gend:]
s=s.replace("if (ocrWorker && ocrLang === lang) return ocrWorker;", "if(glmWorker){glmWorker.terminate();glmWorker=null;}\n  if (ocrWorker && ocrLang === lang) return ocrWorker;")
start=s.index('async function convPdf(buf, ctx){')
end=s.index('\nasync function convImage',start)
s=s[:start]+(root/'browser-pdf.js').read_text(encoding='utf-8')+s[end:]
s=s.replace("if (ctx.math) { ctx.ocrPages = 1; return glmImage(file, ctx); }", "if (ctx.math) { ctx.ocrPages = 1; return glmImage(file, ctx); }")
# Safe image decode, render cap shared by all raster inputs.
start=s.index('async function convImage(file, ctx){')
end=s.index('\nasync function convert', start)
s=s[:start]+'''async function convImage(file, ctx){
  if (!ctx.ocr) throw new Error('Для изображения включите OCR.');
  const cached=await loadPage(ctx,1);
  if(cached?.version===PIPELINE&&cached.image&&typeof cached.text==='string'){await exportPage(ctx,1,cached);ctx.cached=1;return pageMarkdown(cached.text,1);}
  const bmp = await createImageBitmap(file);
  const cv = fitCanvas(bmp, bmp.width, bmp.height, ctx.math ? GLM_PX : MAX_PX); bmp.close();
  try {
    const text = ctx.math ? await glmRecognize(cv,ctx) : await ocrImage(cv,ctx);
    const blob=await canvasBlob(cv);
    await savePage(ctx,1,text,blob);
    ctx.ocrPages=1;
    return pageMarkdown(text,1);
  } finally {cv.width=cv.height=1;}
}
''' +s[end:]
s=s.replace("math: $('mode').value === 'math', pages: $('pages').value,", "math: $('mode').value === 'math', pages: $('pages').value, lang: $('lang').value,")
s=s.replace("  ctx.status('Конвертация…');\n  try {\n    const md = await convert(file, ctx);", """  let removed=false;
  const remove=document.createElement('button');remove.className='btn sm sec';remove.textContent='Удалить из списка';
  card.querySelector('.fhead').appendChild(remove);
  remove.onclick=()=>{removed=true;ctx.abort?.();card.remove();const j=done.findIndex(x=>x.card===card);if(j>=0)done.splice(j,1);};
  ctx.isRemoved=()=>removed;
  ctx.status('Конвертация…');
  try {
    if(file.size>250*1024*1024)throw new Error('Лимит файла 250 МБ. Разделите PDF.');
    await waitResume(ctx);
    ctx.key=await fileKey(file,ctx);
    ctx.output=outputHandle;
    ctx.label=await resultLabel(file,ctx.key);
    if(ctx.output)ctx.dir=await ctx.output.getDirectoryHandle(ctx.label,{create:true});
    const raw = await convert(file, ctx);
    const md = ['---','обозначение:','название:','редакция:','дата_введения:','источник_скана: '+JSON.stringify(file.name),'страниц: '+(ctx.total||1),'распознано: '+new Date().toISOString().slice(0,10),'---','','> Автоматический черновик. Числа [?…] и формулы не сверены.','',ctx.total ? raw : flagNumbers(raw)].join('\\n');
    if(ctx.dir)await writeFile(ctx.dir,'document.md',md);
    if(removed)return;""")
s=s.replace("const rec = {name: file.name, ta};", """const zipBtn=document.createElement('button');zipBtn.className='btn sm sec';zipBtn.textContent='Скачать с изображениями (.zip)';acts.appendChild(zipBtn);
    zipBtn.onclick=async()=>{zipBtn.disabled=true;try{const z=new JSZip();z.file('document.md',ta.value);for(let i=1;i<=(ctx.total||1);i++){const p=await dbGet(ctx.key+':'+i);if(p?.image)z.file('pages/p'+String(i).padStart(3,'0')+'.jpg',p.image);}const a=document.createElement('a');a.href=URL.createObjectURL(await z.generateAsync({type:'blob',compression:'STORE'}));a.download=ctx.label+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}catch(e){alert('Не удалось собрать архив: '+e.message);}finally{zipBtn.disabled=false;}};
    const rec = {name: file.name, ta,card};""")
s=s.replace("badge.textContent = 'Ошибка';", "badge.textContent = removed ? 'Удалено' : 'Прервано / ошибка';")
s=s.replace('async function handle(file){','async function handle(file,previous){')
s=s.replace("  ctx.status('Конвертация…');\n  try {", "  ctx.status('В очереди…');\n  await previous;\n  try {")
s=s.replace("    if (ctx.warn)", "    if(ctx.cached)badge.textContent += ' · из сохранения: '+ctx.cached+' стр.';\n    if (ctx.warn)")
s=s.replace("function addFiles(files){\n  for (const f of files) queue = queue.then(() => handle(f));\n}", "function addFiles(files){\n  for (const f of files){let release;const previous=queue;queue=new Promise(r=>release=r);handle(f,previous).catch(e=>console.error(e)).finally(release);}\n}")
s=s.replace("$('clear').onclick = () => { results.innerHTML = ''; done.length = 0; bulk.hidden = true; };", "$('clear').onclick = () => { for(const b of results.querySelectorAll('.fhead button'))b.click(); done.length = 0; bulk.hidden = true; };")
(root/'markitdown.html').write_text(s,encoding='utf-8')
