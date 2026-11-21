const MAX_PX=4000000, PIPELINE='browser-3.4-tables.15';
const TABLE_LAYOUT_VERSION=3, FORMULA_LAYOUT_VERSION=1;
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
function pageAssetName(ctx,index,kind){
  const prefix='img/p'+String(index).padStart(3,'0')+'_'+kind+'_';
  const count=Object.keys(ctx.assets||{}).filter(path=>path.startsWith(prefix)).length;
  return prefix+(count+1)+'.jpg';
}
async function writeFile(dir,name,data){const h=await dir.getFileHandle(name,{create:true});const w=await h.createWritable();try{await w.write(data);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
function flagNumbers(text){
  // OCR is untrusted. Only explicit doubt wrappers and narrowly validated
  // generated markup may bypass flags; arbitrary <...> and $...$ may not.
  return String(text).split(/(\[\?[^\]\n]*\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|!\[[^\]\n]*\]\((?:pages|img)\/p\d+[\w.-]*\.(?:jpg|png)\)|<!--\s*стр\.\s*\d+\s*-->|<!--\s*таблица\s+(?:[A-Za-zА-Яа-яЁё]\.)?\d+(?:\.\d+)*:\s*строк\s+\d+,\s*столбцов\s+\d+\s*-->|<\/?(?:table|thead|tbody|tr|th|td|br)(?:\s+(?:rowspan|colspan)="\d+")*\s*\/?\s*>)/g).map((part,i)=>i%2?(part.startsWith('$')?'[?'+part+']':part):part.replace(/[−+-]?\d+(?:[.,]\d+)*/g,'[?$&]')).join('');
}
function pageComplete(text){return typeof text==='string'&&!!text.trim()&&!/Генерация остановлена|\[нечитаемо\]|непрочитанная ячейка|непрочитанная шапка|\[\?НЕПОЛНАЯ СТРАНИЦА/.test(text);}
function hasUnplacedTableRow(page){
  if(!page.table||!page.text.includes('</table>'))return false;
  const remainder=page.text.slice(page.text.lastIndexOf('</table>')+8);
  return remainder.split('\n').some(line=>line.split('|').length>=6&&
    (line.match(/\d+[.,]\d+/g)||[]).length>=5);
}
function pageAssetsComplete(page,index){
  if(!page?.image?.size||hasUnplacedTableRow(page))return false;
  if(page.table&&page.table.layout!==TABLE_LAYOUT_VERSION)return false;
  if(page.formulas&&page.formulas.layout!==FORMULA_LAYOUT_VERSION)return false;
  const references=Array.from(page.text.matchAll(/!\[[^\]]*\]\((img\/[^)]+)\)/g),match=>match[1]);
  const prefix='img/p'+String(index).padStart(3,'0')+'_';
  const belongs=path=>path.startsWith(prefix)&&/^img\/p\d+_(?:tabl|formula|cell)_\d+\.jpg$/.test(path);
  const assets=Object.keys(page.assets||{});
  if(!assets.every(path=>belongs(path)&&page.assets[path]?.size>0))return false;
  if(page.table&&new Set(references.filter(path=>path.includes('_tabl_'))).size!==(page.table.tables?.length||1))return false;
  if(page.formulas&&references.filter(path=>path.includes('_formula_')).length!==page.formulas.count)return false;
  return references.every(path=>belongs(path)&&page.assets?.[path]?.size>0);
}
function pageMarkdown(text,i){return '<!-- стр. '+i+' -->\n\n'+flagNumbers(text)+'\n\n![Оригинал страницы '+i+'](pages/p'+String(i).padStart(3,'0')+'.jpg)\n\n> Числа [?…], таблицы и LaTeX этой страницы не сверены.\n';}
async function savePage(ctx,i,text,image){const p={version:PIPELINE,text,image,assets:ctx.assets||{},table:ctx.tableStats||null,formulas:ctx.formulaStats||null,complete:pageComplete(text)};p.complete=p.complete&&pageAssetsComplete(p,i);await dbPut(ctx.key+':'+i,p);if(!p.complete){
    ctx.incomplete=(ctx.incomplete||0)+1;
    const reason=text.match(/НЕПОЛНАЯ СТРАНИЦА: ([^\]]+)/)?.[1]||
      (hasUnplacedTableRow(p)?'За границей таблицы остались числовые ячейки':text.includes('Генерация остановлена')?'Оборвалась генерация текста':
       text.includes('непрочитанная')?'Остались непрочитанные ячейки':'Требуется проверка текста и вырезок');
    (ctx.issues??=[]).push({page:i,reason});
  }await ctx.observePage?.(text,i);await exportPage(ctx,i,p);}
async function exportPage(ctx,i,p){
  if(!ctx.dir)return;
  const n='p'+String(i).padStart(3,'0');const pages=await ctx.dir.getDirectoryHandle('pages',{create:true});
  await writeFile(pages,n+'.jpg',p.image);await writeFile(ctx.dir,n+'.md',pageMarkdown(p.text,i));
  const names=[];
  for(const [path,blob] of Object.entries(p.assets||{})){
    if(!/^img\/p[0-9]+_(?:tabl|formula|cell)_[0-9]+\.jpg$/.test(path))throw new Error('Недопустимое имя вырезки');
    const dir=await ctx.dir.getDirectoryHandle('img',{create:true});await writeFile(dir,path.slice(4),blob);names.push(path);
  }
  const auto=await ctx.dir.getDirectoryHandle('auto',{create:true});
  await writeFile(auto,n+'.json',JSON.stringify({version:PIPELINE,key:ctx.key,page:i,text:p.text,complete:p.complete!==false,assets:names,table:p.table||null,formulas:p.formulas||null}));
}
async function loadPage(ctx,i){
  let p=await dbGet(ctx.key+':'+i);
  ctx.wasTruncated=Boolean(p?.version===PIPELINE&&p.complete===false&&p.text?.includes('Генерация остановлена'));
  if(p?.version===PIPELINE&&pageComplete(p.text)&&p.complete!==false&&pageAssetsComplete(p,i))return p;
  for(const dir of [ctx.dir,ctx.legacyDir].filter(Boolean)){
    try{const n='p'+String(i).padStart(3,'0');const auto=await dir.getDirectoryHandle('auto');const f=await(await auto.getFileHandle(n+'.json')).getFile();const j=JSON.parse(await f.text());
      if(j.key===ctx.key&&j.page===i&&j.version===PIPELINE&&j.complete===false&&j.text?.includes('Генерация остановлена'))ctx.wasTruncated=true;
      if(j.key!==ctx.key||j.page!==i||j.version!==PIPELINE||!pageComplete(j.text)||j.complete===false)continue;
      const pages=await dir.getDirectoryHandle('pages');const image=await(await pages.getFileHandle(n+'.jpg')).getFile();if(!image.size)continue;
      const assets={};for(const path of j.assets||[]){if(!/^img\/p[0-9]+_(?:tabl|formula|cell)_[0-9]+\.jpg$/.test(path))throw new Error('Недопустимое имя вырезки');const img=await dir.getDirectoryHandle('img');assets[path]=await(await img.getFileHandle(path.slice(4))).getFile();}p={version:PIPELINE,text:j.text,image,assets,table:j.table||null,formulas:j.formulas||null,complete:true};if(!pageAssetsComplete(p,i))continue;await dbPut(ctx.key+':'+i,p);return p;
    }catch(e){if(e.name!=='NotFoundError'&&!(e instanceof SyntaxError))throw e;}
  }return null;
}
async function waitResume(ctx){if(ctx.isRemoved())throw new Error('Документ удалён из очереди');if(ctx.shouldPause?.()){const e=new Error('Пауза: готовые страницы сохранены');e.name='PauseError';throw e;}}
function showStorageInfo(message){
  const status=$('storageInfo');
  if(status)status.textContent=message;
}
function showFolderError(error,missingMessage){
  if(error.name==='AbortError')return;
  if(error.name==='NotFoundError'){
    showStorageInfo(missingMessage);
    return;
  }
  alert(error.message);
}
$('outputFolder').onclick=async()=>{
  try{
    if(!window.showDirectoryPicker)throw new Error('Выбор папки доступен в Chrome/Edge. Используйте скачивание ZIP.');
    outputHandle=await showDirectoryPicker({mode:'readwrite'});
    showStorageInfo('Сохранение в папку: '+outputHandle.name);
  }catch(e){showFolderError(e,'Папка результата недоступна. Выберите папку ещё раз.');}
};
$('sourceFolder').onclick=async()=>{
  try{
    if(!window.showDirectoryPicker)throw new Error('Для выбора папки используйте Chrome/Edge. Файлы можно выбрать кнопкой ниже.');
    const source=await showDirectoryPicker({mode:'readwrite'});
    const files=[];
    let missing=0;
    for await(const entry of source.values()){
      if(entry.kind!=='file'||!/\.(pdf|png|jpe?g|webp|bmp)$/i.test(entry.name))continue;
      try{
        files.push(await entry.getFile());
      }catch(e){
        if(e.name!=='NotFoundError')throw e;
        missing++;
      }
    }
    files.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    outputHandle=await source.getDirectoryHandle('Распознанные документы',{create:true});
    addFiles(files);
    let message='Найдено документов: '+files.length+'. Результат: '+source.name+'/Распознанные документы';
    if(missing)message+='. Недоступно файлов: '+missing+'. Их можно добавить отдельно, когда они снова будут доступны.';
    showStorageInfo(message);
  }catch(e){showFolderError(e,'Папка документов недоступна. Выберите папку ещё раз.');}
};
