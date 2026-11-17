function formulaRegions(items,viewport,w,h){
  const found=[];
  for(const it of items){const match=it.str.match(/\(\s*\d+[. ]\d+\s*\)\s*$/);if(!match)continue;const label=match[0].trim();
    const m=pdfjsLib.Util.transform(viewport.transform,it.transform);const fh=Math.max(8,Math.hypot(m[2],m[3]));
    const tagX=m[4]+(it.width||0)*viewport.scale*match.index/it.str.length;if(tagX<w*.70)continue;
    found.push({label,x0:w*.12,x1:w*.98,y0:Math.max(0,m[5]-fh*2.0),y1:Math.min(h,m[5]+fh*1.5)});
  }
  return found.sort((a,b)=>a.y0-b.y0).filter((r,i,a)=>!i||r.y0-a[i-1].y0>5);
}
async function recognizeFormulaPage(page,canvas,viewport,items,ctx,pageIndex){
  const regions=formulaRegions(items,viewport,canvas.width,canvas.height);if(!regions.length)return null;
  const detector=await getOcr(ctx.lang||'rus+eng');await detector.setParameters({tessedit_pageseg_mode:'3'});
  const detected=await detector.recognize(canvas);
  for(const word of detected.data.words||[]){const b=word.bbox;if(!b||b.x0<canvas.width*.70||!/^\(\s*\d+[.,]\d+\s*\)$/.test(word.text))continue;const y=(b.y0+b.y1)/2,fh=Math.max(8,b.y1-b.y0);if(regions.some(r=>y>=r.y0&&y<=r.y1))continue;regions.push({label:word.text,x0:canvas.width*.12,x1:canvas.width*.98,y0:Math.max(0,b.y1-fh*2),y1:Math.min(canvas.height,b.y1+fh*1.5)});}
  regions.sort((a,b)=>a.y0-b.y0);
  ctx.formulaStats={count:regions.length};
  const body=imageCrop(canvas,0,0,canvas.width,canvas.height);const c=body.getContext('2d');c.fillStyle='#fff';for(const r of regions)c.fillRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);
  let text;try{text=await ocrImage(body,ctx);}finally{body.width=body.height=1;}
  ctx.assets??={};
  for(let n=0;n<regions.length;n++){
    await waitResume(ctx);const r=regions[n];const vp=page.getViewport({scale:400/72});const k=vp.width/viewport.width;
    const patch=document.createElement('canvas');patch.width=Math.ceil((r.x1-r.x0)*k);patch.height=Math.ceil((Math.min(canvas.height,r.y1+canvas.height*.012)-r.y0)*k);
    if(patch.width*patch.height>4000000)throw new Error('Вырезка формулы превышает лимит 4 Мп');
    try{
      await page.render({canvasContext:patch.getContext('2d'),viewport:vp,transform:[1,0,0,1,-r.x0*k,-r.y0*k],intent:'print'}).promise;
      ctx.status('Формула '+r.label+' · 400 dpi');const task=ctx.task;ctx.task='Formula Recognition:';
      // Keep extra margins in the human reference, but exclude the next prose
      // line from the model input: it can otherwise paraphrase it as mathematics.
      const input=imageCrop(patch,0,0,patch.width,Math.ceil((r.y1-r.y0)*k));
      let latex;try{latex=await glmRecognize(input,ctx);}finally{ctx.task=task;input.width=input.height=1;}
      const name='img/p'+String(pageIndex).padStart(3,'0')+'_formula_'+(n+1)+'.jpg';ctx.assets[name]=await canvasBlob(patch);
      latex=latex.replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
      text+='\n\n$$'+latex+'$$ '+r.label+'\n\n![Формула '+r.label+']('+name+')\n\n[?LaTeX не сверен с вырезкой]';
    }finally{patch.width=patch.height=1;}
  }
  return text;
}
