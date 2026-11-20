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
function pdfPatchGeometry(box,preferredScale){
  const width=box[2]-box[0],height=box[3]-box[1];
  const pixels=(length,scale)=>Math.max(1,Math.ceil(length*scale));
  const fits=scale=>pixels(width,scale)*pixels(height,scale)<=MAX_PX;
  let scale=preferredScale;
  const reduced=!fits(scale);
  if(reduced){
    // Account for both rounded dimensions so the entire crop fits in the budget.
    let lo=0,hi=Math.min(scale,Math.sqrt(MAX_PX/(width*height)));
    for(let step=0;step<24;step++){
      const middle=(lo+hi)/2;
      if(fits(middle))lo=middle;
      else hi=middle;
    }
    scale=lo;
  }
  return {width:pixels(width,scale),height:pixels(height,scale),scale,reduced};
}
async function renderPdfPatch(page,viewport,aligned,box,fullResolutionOnly=false){
  const targetDpiScale=400/72;
  const target=page.getViewport({scale:targetDpiScale});
  const preferredScale=target.width/viewport.width;
  const {width,height,scale,reduced}=pdfPatchGeometry(box,preferredScale);
  if(fullResolutionOnly&&reduced)return null;
  const detail=reduced?page.getViewport({scale:targetDpiScale*scale/preferredScale}):target;
  const m=aligned.pageMatrix||[1,0,0,1,0,0];
  const patch=document.createElement('canvas');patch.width=width;patch.height=height;
  try{
    await page.render({canvasContext:patch.getContext('2d'),viewport:detail,
      transform:[m[0],m[1],m[2],m[3],(m[4]-box[0])*scale,(m[5]-box[1])*scale],intent:'print'}).promise;
    return {canvas:patch,scale};
  }catch(e){patch.width=patch.height=1;throw e;}
}
async function convPdf(buf, ctx){
  await initPdf();
  const pdf=await pdfjsLib.getDocument({data:buf,isEvalSupported:false}).promise;
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
      ctx.tableStats=null;ctx.formulaStats=null;ctx.tableRegions=[];ctx.assets={};ctx.pageIssue='';ctx.glmSkippedOnPage=false;
      let cv=null;
      try{
        const base=page.getViewport({scale:1});
        const math=mathSet?.has(i);
        const scale=Math.min(3,Math.sqrt((math?GLM_PX:MAX_PX)/(base.width*base.height)));
        let vp=page.getViewport({scale});cv=document.createElement('canvas');cv.width=Math.max(1,Math.floor(vp.width));cv.height=Math.max(1,Math.floor(vp.height));
        ctx.renderTablePatch=(aligned,box,fullResolutionOnly)=>renderPdfPatch(page,vp,aligned,box,fullResolutionOnly);
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp,intent:'print'}).promise;
        const content=await page.getTextContent();const items=content.items;
        ctx.positionedTokens=aligned=>items.flatMap(item=>{
          const text=item.str?.trim();
          if(!text)return [];
          const m=pdfjsLib.Util.transform(vp.transform,item.transform);
          const direction=Math.hypot(m[0],m[1]);
          if(!direction)return [];
          const halfWidth=(item.width||0)*vp.scale/2;
          const x=m[4]+m[0]/direction*halfWidth+m[2]*.35;
          const y=m[5]+m[1]/direction*halfWidth+m[3]*.35;
          const height=Math.hypot(m[2],m[3]);
          const a=aligned.pageMatrix;
          const token={text,height,width:halfWidth*2,x,y};
          return [a?{...token,x:a[0]*x+a[2]*y+a[4],y:a[1]*x+a[3]*y+a[5]}:token];
        });
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
        const needsGrid=ctx.ocr&&(math||(!ctx.ocrAll&&!foreignLayer&&text.trim()));
        const grid=needsGrid?lineGrid(cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,cv.width,cv.height)):null;
        const structuredLayer=Boolean(grid&&grid.columns.length>=4);
        const captionedTable=math&&!structuredLayer&&tableCaptionLines(ctx.positionedTokens(cv)).length>0;
        if(math&&(captionedTable||structuredLayer&&grid.columns.length<7)){
          const detailScale=Math.min(3,Math.sqrt(MAX_PX/(base.width*base.height)));
          if(detailScale>scale){
            vp=page.getViewport({scale:detailScale});
            cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);delete cv.pageMatrix;
            await page.render({canvasContext:cv.getContext('2d'),viewport:vp,intent:'print'}).promise;
            const upright=rotatePageCanvas(cv,items,vp);if(upright!==cv){cv.width=cv.height=1;cv=upright;}
          }
        }
        const formulaFirst=math&&formulaRegions(items,vp,cv.width,cv.height,cv.pageMatrix).length>0;
        const needsOcr=ctx.ocr&&(ctx.ocrAll||foreignLayer||structuredLayer||formulaFirst||text.replace(/\s/g,'').length<20);
        if(needsOcr){
          ctx.assets={};
          const previousMath=ctx.math;ctx.math=!!math;
          let formulas,table;
          try{
            if(formulaFirst){
              table=await recognizeCellTable(cv,ctx,i,true);
              formulas=await recognizeFormulaPage(page,cv,vp,items,ctx,i);
              if(!formulas&&!table)table=await recognizeCellTable(cv,ctx,i);
            }else table=await recognizeCellTable(cv,ctx,i);
          }finally{ctx.math=previousMath;}
          if(math&&!formulaFirst&&!table&&!formulas)formulas=await recognizeFormulaPage(page,cv,vp,items,ctx,i);
          if(table||formulas){text=[formulas,table].filter(Boolean).join('\n\n');ctx.ocrPages=(ctx.ocrPages||0)+1;}
          else if(math){text=await glmPageText(cv,ctx);if(/\$\$/.test(text))ctx.pageIssue||='Выносные формулы без отдельных вырезок';ctx.ocrPages=(ctx.ocrPages||0)+1;}
          else {text=await ocrImage(cv,ctx);ctx.ocrPages=(ctx.ocrPages||0)+1;}
          if(!table&&(tableCaptionLines(ctx.positionedTokens(cv)).length||!formulas&&(tableCaption(ctx.sourceText)||tableCaption(text)))){
            ctx.pageIssue||='Не удалось восстановить ячейки таблицы';
          }
        }
        if(ctx.pageIssue)text+='\n\n[?НЕПОЛНАЯ СТРАНИЦА: '+ctx.pageIssue+']';
        if(!text.trim())text='[нечитаемо]';
        text=markGlmMemoryLimit(text,ctx);
        await savePage(ctx,i,text,await canvasBlob(cv));
        parts.push(pageMarkdown(text,i));
        ctx.pageProgress?.(i,pdf.numPages);
        if(ctx.dir)await writeFile(ctx.dir,'document.md',parts.join('\n\n'));
      }finally{if(cv)cv.width=cv.height=1;page.cleanup();}
    }
    ctx.progress(1);return parts.join('\n\n');
  }finally{await pdf.destroy();}
}
