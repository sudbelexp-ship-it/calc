from pathlib import Path
import re
import hashlib

root=Path(__file__).parent
s=(root/'browser-source-before.html').read_text(encoding='utf-8')
s=re.sub(r'<section class="card" style="margin-bottom:16px">.*?</section>', '', s, count=1)
s=s.replace('Документы в Markdown —', 'Разметка документов и OCR —')
s=s.replace('<main>', '''<main>
<section class="card"><b>Только браузер · версия 3.1</b>
<p>Без установки программ, Python и локального сервера. При первом запуске браузер загружает библиотеки и модели из интернета. Документы обрабатываются на вашем устройстве. Для формул нужна видеокарта с WebGPU; обычный OCR работает на процессоре в Worker.</p>
<p>Числа вне LaTeX автоматически помечаются [?…]. Формулы целиком считаются несверенными. Таблицы и LaTeX — черновик, сверяйте по сохранённым страницам. Фото с перспективой и тенями не поддерживаются: нужен скан.</p>
<div class="acts"><button class="btn" id="analyzeAll">Анализ всех</button><button class="btn sec" id="pause">Пауза всех</button><button class="btn sec" id="sourceFolder">Выбрать папку документов</button><button class="btn sec" id="outputFolder">Папка результата</button><button class="btn sec" id="keepCache">Сохранять модель на устройстве</button></div>
<p id="cacheInfo" role="status">Модель загружается только после Старт. Чтение кеша и подготовка GPU тоже занимают время.</p>
<p id="backgroundNote">Для долгого прогона исключите bit-exp.ru из экономии памяти Chrome. Сворачивание/заморозку браузера сайт полностью не контролирует.</p>
<p id="storageInfo" role="status"></p>
<p>За один раз обрабатывается одна страница; максимум 4 млн пикселей, один OCR Worker. Видеопамять управляется браузером: режим формул может быть тяжёлым. Закрытая вкладка не продолжает распознавание.</p></section>''',1)
s=s.replace('Один лист занимает 20–60 с.', 'Скорость зависит от устройства; при нехватке видеопамяти выберите обычный OCR.')
s=s.replace('формулы Word (OMML) переводятся в LaTeX без потерь', 'формулы Word (OMML) переводятся в LaTeX для ручной сверки')
s=s.replace('>c.bit-exp.ru</a>', '>bit-exp.ru/c/</a>')
s=s.replace('С формулами → LaTeX (нейросеть GLM-OCR)', 'Нейросетевой OCR: текст и формулы (GLM-OCR)')
s=s.replace('Формулы выходят в LaTeX ($…$), но нейросеть иногда искажает слова — сверяйте с оригиналом.', 'Формулы могут вернуться в LaTeX или обычными символами. Нейросеть может искажать текст и числа — сверяйте с оригиналом.')
s=s.replace('и выдаёт текст с формулами в LaTeX.', 'выдаёт черновой текст; LaTeX для каждой формулы не гарантируется.')
s=s.replace("const done = []; // {name, md}", "const done = []; // {name, md}\n"+(root/'browser-storage.js').read_text(encoding='utf-8'))
s=s.replace('/* ---------- утилиты ---------- */',(root/'browser-names.js').read_text(encoding='utf-8')+'\n/* ---------- утилиты ---------- */')
# Mark numeric tokens outside image links and math: preserve valid LaTeX and paths.
s=s.replace('return fixUnits(text.replace', 'return (text.replace')
s=s.replace("const bad = await gpuSupport();\n    if (bad) throw", "if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; ocrLang = null; }\n    const bad = await gpuSupport();\n    if (bad) throw")
s=s.replace("const w = await getOcr($('lang').value);", "const w = await getOcr(ctx.lang || $('lang').value);\n  await w.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});")
s=s.replace("  const { data } = await w.recognize(src);\n  ocrCb = null;", "  let cancel; const abort=new Promise((_,reject)=>cancel=reject);ctx.abort=()=>{w.terminate();ocrWorker=null;ocrLang=null;cancel(new Error('Распознавание отменено'));};\n  let data;try{({data}=await Promise.race([w.recognize(src),abort]));}finally{ctx.abort=null;ocrCb=null;}")
s=s.replace("const cb = e => { if (e.status === 'progress_total' && glmDl) glmDl(e.progress); };", "const cb = e => { if (e.progress != null && glmDl) glmDl(e.progress); };")
# GLM inference lives in a separate Worker, not the interface thread.
gstart=s.index("const GLM_ID =")
gend=s.index('\nfunction fitCanvas',gstart)
worker=s[gstart:gend].replace('window.isSecureContext','self.isSecureContext').replace('location.host','self.location.host').replace('location.pathname','self.location.pathname')
worker=worker.replace("if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; ocrLang = null; }",'')
worker=worker.replace("const c2 = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);",'const c2 = canvas;')
worker=worker.replace('glmDl(e.progress);','glmDl(e.progress,e.file);')
worker=worker.replace("glmDl = p => ctx.status('Загрузка модели GLM-OCR: ' + Math.round(p) + '%');", "glmDl = (p,file) => ctx.status('Подготовка '+(file||'GLM-OCR')+': ' + Math.round(p) + '%');")
worker=worker.replace("const cb = e =>", "await configureModelCache(TX);\n    const cb = e =>")
worker=worker.replace("ctx.status('Загрузка модели…');", "ctx.status(glm?'Модель в памяти · распознавание…':'Чтение модели / подготовка GPU…');")
worker=worker.replace('if (n % 8 === 0)', 'if (n % 64 === 0)')
worker=worker.replace("text: 'Text Recognition:'", "text: ctx.task || 'Text Recognition:'")
worker=worker.replace('max_new_tokens: 4096', 'max_new_tokens: ctx.maxTokens || 4096')
worker=(root/'browser-model-cache.js').read_text(encoding='utf-8')+'\n'+worker
worker=worker.replace('const out = await model.generate(', 'let out;try { out = await model.generate(')
worker=worker.replace("return (text.replace(/^<think>[\\s\\S]*?<\\/think>/, '').trim());", "return (text.replace(/^<think>[\\s\\S]*?<\\/think>/, '').trim()) + (cut!==-1 || end-pl>=4096 ? '\\n\\n[?Генерация остановлена: возможен пропуск текста, сверьте страницу]' : '');} finally {out?.dispose?.();for(const v of Object.values(inputs))v?.dispose?.();}")
worker=worker.replace('end-pl>=4096', 'end-pl>=(ctx.maxTokens||4096)')
worker += '''
self.onmessage=async e=>{const {pixels,width,height,task,maxTokens}=e.data;try{const text=await glmRecognize({data:pixels,width,height},{task,maxTokens,status:s=>self.postMessage({status:s})});self.postMessage({text});}catch(err){self.postMessage({error:err.message});}};
'''
(root/'browser-glm-worker.js').write_text(worker,encoding='utf-8')
s=s[:gstart]+'''const GLM_PX=2200000;
let glmWorker=null;
async function gpuSupport(){if(!window.isSecureContext)return 'Нужен HTTPS';if(!navigator.gpu)return 'WebGPU недоступен. Выберите обычный OCR.';try{const a=await navigator.gpu.requestAdapter();return !a?'Видеокарта недоступна':!a.features.has('shader-f16')?'Нет shader-f16: выберите обычный OCR.':'';}catch(e){return e.message;}}
async function runGlm(cv,ctx,maxPixels,maxTokens){
  const bad=await gpuSupport();if(bad)throw new Error(bad);
  if(ocrWorker){await ocrWorker.terminate();ocrWorker=null;ocrLang=null;}
  if(!glmWorker)glmWorker=new Worker('browser-glm-worker.js?v=3.0');
  // A PDF crop can fit the CPU budget while exceeding the GLM page budget.
  const input=cv.width*cv.height>maxPixels?fitCanvas(cv,cv.width,cv.height,maxPixels):cv;
  let img;
  try{img=input.getContext('2d').getImageData(0,0,input.width,input.height);}
  finally{if(input!==cv)input.width=input.height=1;}
  return new Promise((resolve,reject)=>{
    const fail=error=>{ctx.abort=null;glmWorker?.terminate();glmWorker=null;reject(error);};
    ctx.abort=()=>fail(new Error('Распознавание отменено'));
    glmWorker.onmessage=({data})=>{
      if(data.status)ctx.status(data.status);
      else if(data.cacheInfo)$('cacheInfo').textContent=data.cacheInfo;
      else if(data.error)fail(new Error(data.error));
      else {ctx.abort=null;resolve(data.text);}
    };
    glmWorker.onerror=e=>fail(new Error(e.message||'Ошибка WebGPU Worker'));
    try{glmWorker.postMessage({pixels:img.data,width:img.width,height:img.height,task:ctx.task,maxTokens},[img.data.buffer]);}
    catch(e){fail(e);}
  });
}
function isGlmMemoryError(error){
  return /std::bad_alloc|out of memory|memory access out of bounds|failed to allocate/i.test(error.message);
}
async function glmRecognize(cv,ctx){
  const retryPixels=GLM_PX/2,retryTokens=Math.min(ctx.maxTokens||4096,2048);
  if(!ctx.glmMemoryExhausted){
    try{
      return await runGlm(cv,ctx,ctx.glmLowMemory?retryPixels:GLM_PX,ctx.glmLowMemory?retryTokens:ctx.maxTokens);
    }catch(error){
      if(!isGlmMemoryError(error))throw error;
      if(!ctx.glmLowMemory){
        await waitResume(ctx);
        ctx.glmLowMemory=true;
        ctx.status('GLM‑OCR: повтор с меньшим расходом памяти…');
        const pixels=Math.min(retryPixels,Math.max(65536,Math.floor(cv.width*cv.height/2)));
        try{return await runGlm(cv,ctx,pixels,retryTokens);}
        catch(retryError){if(!isGlmMemoryError(retryError))throw retryError;}
      }
      ctx.glmMemoryExhausted=true;
      ctx.status('GLM‑OCR: не хватило памяти. Продолжаем обычным OCR…');
    }
  }
  ctx.glmSkippedOnPage=true;
  return '';
}
async function glmPageText(cv,ctx){
  const text=await glmRecognize(cv,ctx);
  return ctx.glmSkippedOnPage?ocrImage(cv,ctx):text;
}
function markGlmMemoryLimit(text,ctx){
  return ctx.glmSkippedOnPage?text+'\\n\\n[?НЕПОЛНАЯ СТРАНИЦА: GLM‑OCR не хватило памяти. Сохранён результат обычного OCR.]':text;
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
  if(cached?.version===PIPELINE&&cached.image&&typeof cached.text==='string'){await ctx.observePage?.(cached.text,1);await exportPage(ctx,1,cached);ctx.cached=1;return pageMarkdown(cached.text,1);}
  const bmp = await createImageBitmap(file);
  const cv = fitCanvas(bmp, bmp.width, bmp.height, ctx.math ? GLM_PX : MAX_PX); bmp.close();
  try {
    const text = ctx.math ? await glmPageText(cv,ctx) : await ocrImage(cv,ctx);
    const blob=await canvasBlob(cv);
    const marked=markGlmMemoryLimit(text,ctx);
    await savePage(ctx,1,marked,blob);
    ctx.ocrPages=1;
    return pageMarkdown(marked,1);
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
worker_name='browser-glm-worker-'+hashlib.sha256(worker.encode()).hexdigest()[:12]+'.js'
(root/worker_name).write_text(worker,encoding='utf-8')
s=s.replace("browser-glm-worker.js?v=3.0",worker_name)
s=s.replace('async function convPdf(buf, ctx){',(root/'browser-layout.js').read_text(encoding='utf-8')+'\n'+(root/'browser-formulas.js').read_text(encoding='utf-8')+'\nasync function convPdf(buf, ctx){',1)
# Replace the legacy Promise chain with an explicit, user-controlled queue.
start=s.index('async function handle(')
end=s.index('\ndrop.onclick',start)
s=s[:start]+(root/'browser-queue.js').read_text(encoding='utf-8')+s[end:]
s=s.replace("$('clear').onclick = () => { for(const b of results.querySelectorAll('.fhead button'))b.click(); done.length = 0; bulk.hidden = true; };", "$('clear').onclick = () => jobs.forEach(removeJob);")
s=s.replace('async function convert(file, ctx){','async function convert(file, ctx){\n  if([\'djvu\',\'djv\'].includes(extOf(file.name)))return convDjvu(file,ctx);')
s=s.replace('/* ---------- интерфейс ---------- */',(root/'browser-djvu.js').read_text(encoding='utf-8')+'\n'+(root/'browser-ai-prompt.js').read_text(encoding='utf-8')+'\n/* ---------- интерфейс ---------- */')
s=s.replace('\\.(pdf|png|jpe?g|webp|bmp)', '\\.(pdf|djvu|djv|png|jpe?g|webp|bmp)')
s=s.replace('accept=".pdf,','accept=".pdf,.djvu,.djv,')
s=s.replace('PDF · DOCX','PDF · DJVU/DJV · DOCX')
s=s.replace('Страницы PDF','Страницы PDF / DJVU')
s=s.replace('Без OCR — извлечь текст PDF','Без OCR — извлечь текстовый слой')
s=s.replace(',.tif,.tiff','')
# Mutually exclusive policy controls WHERE to OCR; engine controls HOW.
s=re.sub(r'<label><input type="checkbox" id="ocr" checked>.*?</label>', '<label>Страницы для OCR <select id="ocrPolicy"><option value="off">Без OCR — извлечь текст PDF</option><option value="scans" selected>Только сканы — без текстового слоя</option><option value="all">Все страницы — перепроверить текстовый слой</option></select></label>',s,count=1)
s=re.sub(r'<label><input type="checkbox" id="ocrAll">.*?</label>', '',s,count=1)
s=s.replace('Язык OCR','Язык Tesseract')
s=s.replace("$('mode').onchange = async () => {", "$('ocrPolicy').onchange=()=>{$('mode').disabled=$('ocrPolicy').value==='off';$('lang').disabled=$('ocrPolicy').value==='off'||$('mode').value==='math';};\n$('mode').onchange = async () => {\n  $('ocrPolicy').onchange();")
start=s.index('<div class="acts"><button class="btn" id="analyzeAll">')
end=s.index('</p>',s.index('<p id="storageInfo"',start))+len('</p>')
controls=s[start:end]
controls+=(root/'browser-background-help.html').read_text(encoding='utf-8')
s=s[:start]+s[end:]
s=s.replace('<div id="results"','<section class="card" aria-label="Управление анализом">'+controls+'</section>\n  <div id="results"',1)
# Keep the primary flow compact; details remain available on demand.
s=re.sub(r'(<header>[\s\S]*?<h1>.*?</h1>)\s*<p>[\s\S]*?</p>',r'\1<p>PDF, DJVU/DJV, DOCX, PPTX, XLSX/XLS, CSV/TSV, HTML, TXT/MD, JSON/XML; JPG, PNG, WEBP, BMP, GIF. Обработка на вашем компьютере в браузере.</p>',s,count=1)
s=re.sub(r'<meta name="description" content="[^"]*">','<meta name="description" content="OCR и Markdown в браузере: PDF, DJVU, документы Office и изображения. Локальная обработка на вашем устройстве.">',s,count=1)
s=re.sub(r'<section class="card"><b>Только браузер[\s\S]*?</section>', '<p class="info">Числа [?…] и формулы требуют сверки. DJVU — один файл; фото с перспективными искажениями не поддерживаются.</p>',s,count=1)
s=re.sub(r'<section class="card info">[\s\S]*?</section>','',s,count=1)
s=re.sub(r'<footer>[\s\S]*?</footer>','<footer><a href="index.html">← Все инструменты</a> · DjVu.js: <a href="vendor/DJVU-LICENSE.txt">лицензия</a>, <a href="vendor/GNU-GPL-v2.txt">GPLv2</a>, <a href="vendor/djvu-0.5.4-source.zip">исходники</a></footer>',s,count=1)
prompt_html='<details class="card info"><summary style="cursor:pointer;font-weight:600">Промпт для ИИ — анализ любого результата OCR+Markdown</summary><p>Сначала Markdown, изображения — только для проверки нужных мест. Добавьте свою задачу в первой строке.</p><textarea id="aiPrompt" aria-label="Промпт для анализа OCR и Markdown" readonly style="min-height:220px"></textarea><button class="btn sec" id="copyAiPrompt">Копировать промпт</button><p id="promptStatus" role="status"></p></details>'
s=s.replace('<div id="results"',prompt_html+'\n<div id="results"',1)
(root/'markitdown.html').write_text(s,encoding='utf-8')
