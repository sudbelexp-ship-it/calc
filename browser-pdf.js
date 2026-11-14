async function convPdf(buf, ctx){
  await initPdf();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  ctx.total=pdf.numPages;
  const parts=[];
  const mathSet=ctx.math?parsePages(ctx.pages,pdf.numPages):null;
  try {
    for(let i=1;i<=pdf.numPages;i++){
      await waitResume(ctx);
      ctx.status('Страница '+i+' из '+pdf.numPages);ctx.progress((i-1)/pdf.numPages);
      const cached=await loadPage(ctx,i);
      if(cached?.version===PIPELINE&&cached.image&&typeof cached.text==='string'){
        ctx.cached=(ctx.cached||0)+1;
        await exportPage(ctx,i,cached);parts.push(pageMarkdown(cached.text,i));continue;
      }
      const page=await pdf.getPage(i);
      let cv=null;
      try{
        const base=page.getViewport({scale:1});
        const math=mathSet?.has(i);
        const scale=Math.min(3,Math.sqrt((math?GLM_PX:MAX_PX)/(base.width*base.height)));
        const vp=page.getViewport({scale});cv=document.createElement('canvas');cv.width=Math.max(1,Math.floor(vp.width));cv.height=Math.max(1,Math.floor(vp.height));
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        let text=pageToMarkdown((await page.getTextContent()).items);
        if(math){text=await glmRecognize(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;}
        else if(ctx.ocr&&(ctx.ocrAll||text.replace(/\s/g,'').length<20)){
          ctx.status('OCR страницы '+i+' из '+pdf.numPages);
          text=await ocrImage(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;
        }
        if(!text.trim())text='[нечитаемо]';
        await savePage(ctx,i,text,await canvasBlob(cv));
        parts.push(pageMarkdown(text,i));
        if(ctx.dir)await writeFile(ctx.dir,'document.md',parts.join('\n\n'));
      }finally{if(cv)cv.width=cv.height=1;page.cleanup();}
      await new Promise(r=>setTimeout(r,100));
    }
    ctx.progress(1);return parts.join('\n\n');
  }finally{await pdf.destroy();}
}
