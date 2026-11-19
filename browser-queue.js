// Explicit document queue. A paused job releases the lane at a page checkpoint.
const jobs=[];
let laneBusy=false;
let metadataQueue=Promise.resolve();
function jobButton(text,fn){const b=document.createElement('button');b.className='btn sm sec';b.textContent=text;b.onclick=fn;return b;}
function updateJob(job){
  job.start.textContent=job.state==='paused'||job.state==='error'?'Продолжить':'Старт';
  job.start.disabled=['running','pausing','queued','done'].includes(job.state);
  job.pause.disabled=!['running','queued'].includes(job.state);
  const n=job.complete||0,t=job.total;
  job.count.textContent='Обработано страниц: '+n+' / '+(t??'—')+(t?' · '+Math.floor(n/t*100)+'%':'');
  job.bar.style.width=(t?Math.floor(n/t*100):0)+'%';
  job.bar.parentNode.setAttribute('aria-valuenow',String(n));
  job.bar.parentNode.setAttribute('aria-valuemax',String(t||1));
}
function pauseJob(job){if(job.state==='queued'){job.state='paused';job.badge.textContent='Пауза';}else if(job.state==='running'){job.state='pausing';job.badge.textContent='Пауза после текущей страницы…';}updateJob(job);}
function startJob(job){if(['ready','paused','error'].includes(job.state)){job.state='queued';job.badge.textContent='В очереди';updateJob(job);void pumpJobs();}}
function removeJob(job){job.state='removed';job.ctx?.abort?.();job.card.remove();const i=done.findIndex(x=>x.card===job.card);if(i>=0)done.splice(i,1);bulk.hidden=!done.length;}
function settings(){const policy=$('ocrPolicy').value;return {policy,math:policy!=='off'&&$('mode').value==='math',pages:$('pages').value,lang:$('lang').value,ocr:policy!=='off',ocrAll:policy==='all'};}
function addFiles(files){
  for(const file of files){
    const card=document.createElement('section');card.className='card';
    card.innerHTML='<div class="fhead"><h2>'+esc(file.name)+'</h2><span class="badge">Добавлен · нажмите Старт</span></div><div class="acts"></div><p class="page-count" role="status"></p><div class="bar" role="progressbar" aria-label="Готовые страницы"><i></i></div><div class="job-result"></div>';
    results.appendChild(card);
    const job={file,card,state:'ready',complete:0,total:null,badge:card.querySelector('.badge'),count:card.querySelector('.page-count'),bar:card.querySelector('.bar i'),result:card.querySelector('.job-result')};
    job.start=jobButton('Старт',()=>startJob(job));job.pause=jobButton('Пауза',()=>pauseJob(job));job.remove=jobButton('Удалить',()=>removeJob(job));
    card.querySelector('.acts').append(job.start,job.pause,job.remove);
    const label=document.createElement('label');label.textContent='Короткое название папки: ';job.shortName=document.createElement('input');job.shortName.type='text';job.shortName.style.cssText='font:inherit;width:min(100%,600px);padding:6px';job.shortName.value=shortDocumentName(file.name);job.shortName.placeholder='Авто по первым страницам, либо введите вручную';job.shortName.oninput=()=>{job.customName=true;};label.append(job.shortName);card.querySelector('.acts').after(label);jobs.push(job);updateJob(job);
    metadataQueue=metadataQueue.then(()=>job.state==='removed'?null:countPages(job)).catch(console.error);
  }
}
async function countPages(job){
  if(['djvu','djv'].includes(extOf(job.file.name))){let worker;try{worker=await openDjvu(job.file);job.total=await worker.doc.getPagesQuantity().run();}catch(e){if(job.state==='ready')job.badge.textContent=e.message;}finally{worker?.terminate();updateJob(job);}return;}
  if(extOf(job.file.name)!=='pdf'){job.total=1;updateJob(job);return;}
  if(job.file.size>250*1024*1024){job.badge.textContent='Лимит файла: 250 МБ';return;}
  let pdf;try{await initPdf();pdf=await pdfjsLib.getDocument({data:await job.file.arrayBuffer(),isEvalSupported:false}).promise;job.total=pdf.numPages;}catch(e){if(job.state==='ready')job.badge.textContent='Не удалось прочитать PDF: '+e.message;}finally{await pdf?.destroy();updateJob(job);}
}
function header(file,total){return ['---','обозначение:','название:','редакция:','дата_введения:','источник_скана: '+JSON.stringify(file.name),'страниц: '+(total||1),'распознано: '+new Date().toISOString().slice(0,10),'---','','> Автоматический черновик. Числа [?…] и формулы не сверены.',''].join('\n');}
async function runJob(job){
  if(!job.options)job.options=settings();
  job.state='running';job.badge.className='badge';job.result.replaceChildren();updateJob(job);
  job.shortName.disabled=true;
  const ctx={...job.options,cached:0,ocrPages:0,
    status:s=>{if(job.state!=='removed')job.badge.textContent=s;},
    progress:()=>{},onProgress:null,
    pageProgress:(n,t)=>{job.complete=n;job.total=t;updateJob(job);},
    isRemoved:()=>job.state==='removed',shouldPause:()=>job.state==='pausing'};
  job.ctx=ctx;
  try{
    if(job.file.size>250*1024*1024)throw new Error('Лимит файла 250 МБ. Разделите PDF.');
    await waitResume(ctx);
    ctx.file=job.file;ctx.key=await fileKey(job.file,ctx);await waitResume(ctx);ctx.output=outputHandle;ctx.label=await resultLabel(job.file,ctx.key);
    ctx.observePage=async(text,i)=>{if(!job.shortName.value&&!job.customName&&i<=3)job.shortName.value=inferDocumentName(text);if(!ctx.dir&&(job.shortName.value||i>=3)){await ensureDocumentDir(ctx,job.shortName.value);if(ctx.dir)for(let n=1;n<i;n++){const p=await dbGet(ctx.key+':'+n);if(p)await exportPage(ctx,n,p);}}};
    if(job.shortName.value)await ensureDocumentDir(ctx,job.shortName.value);
    const raw=await convert(job.file,ctx);
    if(!ctx.dir){await ensureDocumentDir(ctx,job.shortName.value);if(ctx.dir)for(let i=1;i<=(ctx.total||1);i++){const p=await dbGet(ctx.key+':'+i);if(p)await exportPage(ctx,i,p);}}
    if(job.shortName.value)ctx.label=cleanDocumentName(job.shortName.value);
    const md=header(job.file,ctx.total)+'\n'+(ctx.total?raw:flagNumbers(raw));
    if(ctx.dir)await writeFile(ctx.dir,'document.md',md);
    if(job.state==='removed')return;
    job.state=ctx.incomplete?'error':'done';job.complete=job.total=ctx.total||1;job.badge.className='badge '+(ctx.incomplete?'bad':'ok');
    const partial=ctx.glmMemoryExhausted?' · GLM‑OCR не хватило памяти':' — повторите распознавание';
    job.badge.textContent=(ctx.incomplete?'Неполный результат: '+ctx.incomplete+' стр.'+partial:'Готово')+(ctx.cached?' · из сохранения: '+ctx.cached+' стр.':'');
    const ta=document.createElement('textarea');ta.value=md;ta.spellcheck=false;ta.setAttribute('aria-label','Markdown для '+job.file.name);
    const acts=document.createElement('div');acts.className='acts';
    const copy=jobButton('Копировать',()=>navigator.clipboard.writeText(ta.value).catch(e=>alert(e.message)));
    const dl=jobButton('Скачать .md',()=>download(safeName(job.file.name)+'.md',ta.value));
    const zip=jobButton('Скачать с изображениями (.zip)',async()=>{zip.disabled=true;try{const z=new JSZip();z.file('document.md',ta.value);z.file('Промпт для ИИ.txt',AI_PROMPT);for(let i=1;i<=(ctx.total||1);i++){const p=await dbGet(ctx.key+':'+i);if(p?.image)z.file('pages/p'+String(i).padStart(3,'0')+'.jpg',p.image);for(const [path,blob]of Object.entries(p?.assets||{}))z.file(path,blob);}const a=document.createElement('a');a.href=URL.createObjectURL(await z.generateAsync({type:'blob',compression:'STORE'}));a.download=ctx.label+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}catch(e){alert(e.message);}finally{zip.disabled=false;}});
    const prompt=jobButton('Промпт для ИИ',()=>navigator.clipboard.writeText(AI_PROMPT).catch(e=>alert(e.message)));
    acts.append(copy,dl,zip,prompt);job.result.append(ta,acts);done.push({name:job.file.name,ta,card:job.card});bulk.hidden=false;
  }catch(e){if(job.state!=='removed'){job.state=e.name==='PauseError'?'paused':'error';job.badge.className='badge '+(job.state==='error'?'bad':'');job.badge.textContent=e.message;}}
  finally{job.ctx=null;job.shortName.disabled=job.state==='done';updateJob(job);}
}
async function pumpJobs(){
  if(laneBusy)return;laneBusy=true;
  try{let job;while((job=jobs.find(j=>j.state==='queued')))await runJob(job);}
  finally{laneBusy=false;}
}
$('analyzeAll').onclick=()=>{for(const j of jobs)if(['ready','paused','error'].includes(j.state)){j.state='queued';j.badge.textContent='В очереди';updateJob(j);}void pumpJobs();};
$('pause').onclick=()=>jobs.forEach(pauseJob);
$('clear').onclick=()=>jobs.forEach(removeJob);
document.addEventListener('visibilitychange',()=>{$('backgroundNote').textContent=document.hidden?'Вкладка скрыта. Обработка продолжится, пока Chrome не заморозит её; скорость в фоне может снижаться.':'Для долгого прогона исключите bit-exp.ru из экономии памяти Chrome. Сворачивание/заморозку браузера сайт полностью не контролирует.';});
// Persistence is best effort: Chrome may decline. It never grants filesystem access.
$('keepCache').onclick=async()=>{try{const granted=await navigator.storage?.persist?.();const e=await navigator.storage?.estimate?.();$('cacheInfo').textContent=(granted?'Хранилище защищено от автоматической очистки. ':'Chrome не предоставил постоянное хранение. ')+(e?'Занято на сайте: '+Math.round((e.usage||0)/1048576)+' МБ. ':'')+'Кеш удаляется при очистке данных сайта.';}catch(e){$('cacheInfo').textContent=e.message;}};
