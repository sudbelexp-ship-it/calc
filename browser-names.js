const designationPattern=/(?:СП\s+\d+\.\d+\.\d{4}|ГОСТ(?:\s+Р)?(?:\s+ИСО)?\s+[\d.]+(?:[−–-]\d{2,4})?|СНиП\s+[\d.]+[−–-]\d{2,4}|СТО\s+[\d.−–-]+)/i;
function cleanDocumentName(text){
  return String(text).replace(/\.(pdf|djvu|djv|png|jpe?g|webp|bmp)$/i,'').replace(/\[\?([^\]]*)\]/g,'$1')
    .replace(/\s*\((?:с\s+)?(?:измен|изм\.|поправ)[\s\S]*$/iu,'')
    .replace(/\s*(?:[.。]\s*)?(?:Актуализированная редакция|с изменениями|с изменением|Изменения?\s*№|Поправки?|поправка)[\s\S]*$/iu,'')
    .replace(/\s*\((?:с\s+)?(?:измен|изм\.|поправ)[\s\S]*$/iu,'')
    .replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').replace(/^[ ._-]+|[ ._-]+$/g,'').slice(0,160);
}
function shortDocumentName(text){
  const clean=cleanDocumentName(text);const match=clean.match(designationPattern);
  return match?clean.slice(match.index):'';
}
function inferDocumentName(text){
  const lines=String(text).split(/\r?\n/).map(x=>x.replace(/^[#>\s]+/,'').trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(designationPattern);if(!m||m.index>3)continue;
    let title=lines[i].slice(m.index+m[0].length).trim();
    for(let j=i+1;!title&&j<Math.min(i+4,lines.length);j++){
      if(/^(Издание|Дата|Введ|Утвержд|Приказ|Москва|Санкт|Федеральн|Национальн|Межгосударств|Свод правил)/i.test(lines[j]))break;
      if(!designationPattern.test(lines[j])&&!/^\d+$/.test(lines[j]))title=lines[j];
    }
    if(title)return cleanDocumentName(m[0]+' '+title);
  }
  return '';
}
async function ensureDocumentDir(ctx,title){
  if(ctx.dir||!ctx.output)return;
  const root=ctx.output;let index={};
  try{index=JSON.parse(await(await(await root.getFileHandle('.ocr-index.json')).getFile()).text());}
  catch(e){if(e.name!=='NotFoundError'&&!(e instanceof SyntaxError))throw e;}
  // Keep old folders as read-only recovery sources; new output uses the short name.
  let name=index[ctx.key];
  if(!name){const old=await resultLabel(ctx.file,ctx.key);try{ctx.legacyDir=await root.getDirectoryHandle(old);}catch(e){if(e.name!=='NotFoundError')throw e;}}
  if(!name){const base=cleanDocumentName(title)||'Документ '+ctx.key.slice(0,12);name=base;let n=2;
    while(true){try{await root.getDirectoryHandle(name);name=base+' ('+(n++)+')';}catch(e){if(e.name==='NotFoundError')break;throw e;}}
    ctx.dir=await root.getDirectoryHandle(name,{create:true});index[ctx.key]=name;await writeFile(root,'.ocr-index.json',JSON.stringify(index));
  }else ctx.dir=await root.getDirectoryHandle(name,{create:true});
  ctx.label=name;
}
