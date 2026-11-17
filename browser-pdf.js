function hasScanLayer(ops,area,styles={}){
  const O=pdfjsLib.OPS;let matrix=[1,0,0,1,0,0];const stack=[];
  if(Object.values(styles).some(s=>/glyphless/i.test(s.fontFamily||'')))return true;
  for(let n=0;n<ops.fnArray.length;n++){
    const fn=ops.fnArray[n],a=ops.argsArray[n];
    if(fn===O.save)stack.push(matrix.slice());
    else if(fn===O.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(fn===O.transform)matrix=pdfjsLib.Util.transform(matrix,a);
    else if(fn===O.setTextRenderingMode&&[3,7].includes(a?.[0]))return true;
    else if([O.paintImageXObject,O.paintInlineImageXObject,O.paintJpegXObject].filter(Number.isFinite).includes(fn)&&Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])>area*.60)return true;
  }return false;
}
async function convPdf(buf, ctx){
  await initPdf();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  ctx.total=pdf.numPages;
  ctx.pageProgress?.(0,pdf.numPages);
  const parts=[];
  const mathSet=ctx.math?parsePages(ctx.pages,pdf.numPages):null;
  try {
    for(let i=1;i<=pdf.numPages;i++){
      await waitResume(ctx);
      ctx.status('Страница '+i+' из '+pdf.numPages);ctx.progress((i-1)/pdf.numPages);
      const cached=await loadPage(ctx,i);
      if(cached?.version===PIPELINE&&cached.image&&typeof cached.text==='string'){
        ctx.cached=(ctx.cached||0)+1;
        await ctx.observePage?.(cached.text,i);
        await exportPage(ctx,i,cached);parts.push(pageMarkdown(cached.text,i));ctx.pageProgress?.(i,pdf.numPages);continue;
      }
      const page=await pdf.getPage(i);
      ctx.tableStats=null;ctx.formulaStats=null;
      let cv=null;
      try{
        const base=page.getViewport({scale:1});
        const math=mathSet?.has(i);
        const scale=Math.min(3,Math.sqrt((math?GLM_PX:MAX_PX)/(base.width*base.height)));
        const vp=page.getViewport({scale});cv=document.createElement('canvas');cv.width=Math.max(1,Math.floor(vp.width));cv.height=Math.max(1,Math.floor(vp.height));
        ctx.renderTablePatch=async(aligned,box)=>{
          const high=page.getViewport({scale:400/72}),k=high.width/vp.width,m=aligned.pageMatrix||[1,0,0,1,0,0];
          const patch=document.createElement('canvas');patch.width=Math.max(1,Math.ceil((box[2]-box[0])*k));patch.height=Math.max(1,Math.ceil((box[3]-box[1])*k));
          if(patch.width*patch.height>MAX_PX)throw new Error('Вырезка таблицы превышает лимит 4 Мп');
          try{await page.render({canvasContext:patch.getContext('2d'),viewport:high,transform:[m[0],m[1],m[2],m[3],(m[4]-box[0])*k,(m[5]-box[1])*k],intent:'print'}).promise;return {canvas:patch,scale:k};}catch(e){patch.width=patch.height=1;throw e;}
        };
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp,intent:'print'}).promise;
        const content=await page.getTextContent();const items=content.items;
        let text=pageToMarkdown(items);
        ctx.sourceText=text;
        let foreignLayer=false;
        if(ctx.ocr&&!ctx.ocrAll&&text.trim()){
          const ops=await page.getOperatorList();
          foreignLayer=hasScanLayer(ops,base.width*base.height,content.styles);
        }
        if(ctx.ocr){const upright=rotatePageCanvas(cv,items,vp);if(upright!==cv){cv.width=cv.height=1;cv=upright;}}
        // Native text can still lose table positions. Detect the structure before
        // deciding that a readable layer is sufficient.
        const structuredLayer=ctx.ocr&&!ctx.ocrAll&&!foreignLayer&&text.trim()&&(lineGrid(cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,cv.width,cv.height))?.columns.length||0)>=7;
        const needsOcr=ctx.ocr&&(ctx.ocrAll||foreignLayer||structuredLayer||text.replace(/\s/g,'').length<20);
        if(needsOcr){
          ctx.assets={};
          const formulaFirst=math&&formulaRegions(items,vp,cv.width,cv.height).length>1;
          const formulas=formulaFirst?await recognizeFormulaPage(page,cv,vp,items,ctx,i):null;
          const table=!formulas?await recognizeCellTable(cv,ctx,i):null;
          if(table||formulas){text=table||formulas;ctx.ocrPages=(ctx.ocrPages||0)+1;}
          else if(math){text=await glmRecognize(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;}
          else {text=await ocrImage(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;}
        }
        if(!text.trim())text='[нечитаемо]';
        await savePage(ctx,i,text,await canvasBlob(cv));
        parts.push(pageMarkdown(text,i));
        ctx.pageProgress?.(i,pdf.numPages);
        if(ctx.dir)await writeFile(ctx.dir,'document.md',parts.join('\n\n'));
      }finally{if(cv)cv.width=cv.height=1;page.cleanup();}
    }
    ctx.progress(1);return parts.join('\n\n');
  }finally{await pdf.destroy();}
}
