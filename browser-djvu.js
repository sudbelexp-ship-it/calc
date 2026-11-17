let djvuLoading=null;
function cleanDjvuText(text){return String(text||'').replace(/\u001f/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001e]/g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
async function initDjvu(){if(window.DjVu)return;if(!djvuLoading)djvuLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/djvu-0.5.4.js';script.onload=resolve;script.onerror=()=>{djvuLoading=null;reject(new Error('Не удалось загрузить модуль DJVU. Проверьте интернет.'));};document.head.appendChild(script);});await djvuLoading;}
async function openDjvu(file){await initDjvu();const worker=new DjVu.Worker();try{await worker.createDocument(await file.arrayBuffer(),{memoryLimit:128*1024*1024});if(!await worker.doc.isBundled().run())throw new Error('Нужен однофайловый DJVU. Многофайловый документ сначала объедините в один файл.');return worker;}catch(e){worker.terminate();throw e;}}
async function convDjvu(file,ctx){
  const worker=await openDjvu(file);const parts=[];
  try{
    ctx.total=await worker.doc.getPagesQuantity().run();ctx.pageProgress?.(0,ctx.total);
    const selected=ctx.math?parsePages(ctx.pages,ctx.total):null;
    for(let i=1;i<=ctx.total;i++){
      await waitResume(ctx);ctx.status('Страница '+i+' из '+ctx.total);
      const cached=await loadPage(ctx,i);
      if(cached?.image&&typeof cached.text==='string'){
        cached.text=cleanDjvuText(cached.text);ctx.cached=(ctx.cached||0)+1;await ctx.observePage?.(cached.text,i);await exportPage(ctx,i,cached);parts.push(pageMarkdown(cached.text,i));ctx.pageProgress?.(i,ctx.total);continue;
      }
      let raw=null,cv=null;
      try{
        const [width,height]=await worker.run(worker.doc.getPage(i).getWidth(),worker.doc.getPage(i).getHeight());
        if(width*height>45000000)throw new Error('Страница DJVU больше 45 млн пикселей. Уменьшите разрешение исходника.');
        let text=cleanDjvuText(await worker.doc.getPage(i).getText().run());
        const image=await worker.doc.getPage(i).getImageData().run();
        raw=document.createElement('canvas');raw.width=image.width;raw.height=image.height;raw.getContext('2d').putImageData(image,0,0);
        cv=fitCanvas(raw,raw.width,raw.height,ctx.math&&selected.has(i)?GLM_PX:MAX_PX);raw.width=raw.height=1;
        if(ctx.ocr&&(ctx.ocrAll||text.replace(/\s/g,'').length<20)){
          text=ctx.math&&selected.has(i)?await glmRecognize(cv,ctx):await ocrImage(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;
        }
        if(!text.trim())text='[нечитаемо]';
        await savePage(ctx,i,text,await canvasBlob(cv));parts.push(pageMarkdown(text,i));ctx.pageProgress?.(i,ctx.total);
        if(ctx.dir)await writeFile(ctx.dir,'document.md',parts.join('\n\n'));
      }finally{if(raw)raw.width=raw.height=1;if(cv)cv.width=cv.height=1;}
    }
    return parts.join('\n\n');
  }finally{worker.terminate();}
}
