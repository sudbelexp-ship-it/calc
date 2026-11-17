const MAX_PX=4000000, PIPELINE='browser-3.3-cells.10';
let outputHandle=null, paused=false;
const dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('bitexp-browser-ocr',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('pages');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
dbPromise.catch(()=>{});
async function dbGet(key){const db=await dbPromise;return new Promise((res,rej)=>{const q=db.transaction('pages').objectStore('pages').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}
async function dbPut(key,value){const db=await dbPromise;return new Promise((res,rej)=>{const tx=db.transaction('pages','readwrite');tx.objectStore('pages').put(value,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('Не удалось сохранить страницу'));});}
function safeName(name){return name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_.-]+/gu,'_').slice(0,100)||'document';}
async function fileKey(file,ctx){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const h=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');return h+':'+[PIPELINE,ctx.math,ctx.ocr,ctx.ocrAll,ctx.lang,ctx.pages].join(':')+(ctx.policy==='scans'&&ctx.math?':glm-scans-v1':'');}
async function resultLabel(file,key){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return safeName(file.name)+'_'+Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);}
function canvasBlob(cv){return new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('Не удалось сохранить изображение')),'image/jpeg',0.92));}
async function writeFile(dir,name,data){const h=await dir.getFileHandle(name,{create:true});const w=await h.createWritable();try{await w.write(data);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
function flagNumbers(text){
  // OCR is untrusted. Only explicit doubt wrappers and narrowly validated
  // generated markup may bypass flags; arbitrary <...> and $...$ may not.
  return String(text).split(/(\[\?[^\]\n]*\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|!\[[^\]\n]*\]\((?:pages|img)\/p\d+[\w.-]*\.(?:jpg|png)\)|<!--\s*стр\.\s*\d+\s*-->|<!--\s*таблица\s+\d+(?:\.\d+)*:\s*строк\s+\d+,\s*столбцов\s+\d+\s*-->|<\/?(?:table|thead|tbody|tr|th|td|br)(?:\s+(?:rowspan|colspan)="\d+")*\s*\/?\s*>)/g).map((part,i)=>i%2?(part.startsWith('$')?'[?'+part+']':part):part.replace(/[−+-]?\d+(?:[.,]\d+)*/g,'[?$&]')).join('');
}
function pageComplete(text){return typeof text==='string'&&!!text.trim()&&!/Генерация остановлена|\[нечитаемо\]|непрочитанная ячейка|\[\?НЕПОЛНАЯ СТРАНИЦА/.test(text);}
function pageMarkdown(text,i){return '<!-- стр. '+i+' -->\n\n'+flagNumbers(text)+'\n\n![Оригинал страницы '+i+'](pages/p'+String(i).padStart(3,'0')+'.jpg)\n\n> Числа [?…], таблицы и LaTeX этой страницы не сверены.\n';}
async function savePage(ctx,i,text,image){const p={version:PIPELINE,text,image,assets:ctx.assets||{},table:ctx.tableStats||null,formulas:ctx.formulaStats||null,complete:pageComplete(text)};await dbPut(ctx.key+':'+i,p);if(!p.complete)ctx.incomplete=(ctx.incomplete||0)+1;await ctx.observePage?.(text,i);await exportPage(ctx,i,p);}
async function exportPage(ctx,i,p){
  if(!ctx.dir)return;
  const n='p'+String(i).padStart(3,'0');const pages=await ctx.dir.getDirectoryHandle('pages',{create:true});
  await writeFile(pages,n+'.jpg',p.image);await writeFile(ctx.dir,n+'.md',pageMarkdown(p.text,i));
  const names=[];
  for(const [path,blob] of Object.entries(p.assets||{})){
    if(!/^img\/p[0-9]+_(?:tabl|formula)_[0-9]+\.jpg$/.test(path))throw new Error('Недопустимое имя вырезки');
    const dir=await ctx.dir.getDirectoryHandle('img',{create:true});await writeFile(dir,path.slice(4),blob);names.push(path);
  }
  const auto=await ctx.dir.getDirectoryHandle('auto',{create:true});
  await writeFile(auto,n+'.json',JSON.stringify({version:PIPELINE,key:ctx.key,page:i,text:p.text,complete:p.complete!==false,assets:names,table:p.table||null,formulas:p.formulas||null}));
}
async function loadPage(ctx,i){
  let p=await dbGet(ctx.key+':'+i);
  if(p?.version===PIPELINE&&p.image&&pageComplete(p.text)&&p.complete!==false)return p;
  for(const dir of [ctx.dir,ctx.legacyDir].filter(Boolean)){
    try{const n='p'+String(i).padStart(3,'0');const auto=await dir.getDirectoryHandle('auto');const f=await(await auto.getFileHandle(n+'.json')).getFile();const j=JSON.parse(await f.text());
      if(j.key!==ctx.key||j.page!==i||j.version!==PIPELINE||!pageComplete(j.text)||j.complete===false)continue;
      const pages=await dir.getDirectoryHandle('pages');const image=await(await pages.getFileHandle(n+'.jpg')).getFile();if(!image.size)continue;
      const assets={};for(const path of j.assets||[]){if(!/^img\/p[0-9]+_(?:tabl|formula)_[0-9]+\.jpg$/.test(path))throw new Error('Недопустимое имя вырезки');const img=await dir.getDirectoryHandle('img');assets[path]=await(await img.getFileHandle(path.slice(4))).getFile();}p={version:PIPELINE,text:j.text,image,assets,table:j.table||null,formulas:j.formulas||null,complete:true};await dbPut(ctx.key+':'+i,p);return p;
    }catch(e){if(e.name!=='NotFoundError'&&!(e instanceof SyntaxError))throw e;}
  }return null;
}
async function waitResume(ctx){if(ctx.isRemoved())throw new Error('Документ удалён из очереди');if(ctx.shouldPause?.()){const e=new Error('Пауза: готовые страницы сохранены');e.name='PauseError';throw e;}}
$('outputFolder').onclick=async()=>{try{if(!window.showDirectoryPicker)throw new Error('Выбор папки доступен в Chrome/Edge. Используйте скачивание ZIP.');outputHandle=await showDirectoryPicker({mode:'readwrite'});$('storageInfo').textContent='Сохранение в папку: '+outputHandle.name;}catch(e){if(e.name!=='AbortError')alert(e.message);}};
$('sourceFolder').onclick=async()=>{try{if(!window.showDirectoryPicker)throw new Error('Для выбора папки используйте Chrome/Edge. Файлы можно выбрать кнопкой ниже.');const source=await showDirectoryPicker({mode:'readwrite'});outputHandle=await source.getDirectoryHandle('Распознанные документы',{create:true});const files=[];for await(const h of source.values()){if(h.kind==='file'&&/\.(pdf|png|jpe?g|webp|bmp)$/i.test(h.name))files.push(await h.getFile());}files.sort((a,b)=>a.name.localeCompare(b.name,'ru'));$('storageInfo').textContent='Найдено документов: '+files.length+'. Результат: '+source.name+'/Распознанные документы';addFiles(files);}catch(e){if(e.name!=='AbortError')alert(e.message);}};
