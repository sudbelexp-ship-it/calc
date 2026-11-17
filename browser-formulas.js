function formulaRegions(items,viewport,w,h,alignment){
  const found=[];
  for(const it of items){const match=it.str?.match(/\(\s*\d+\s*[. ,]\s*\d+\s*\)[.,]?\s*$/);if(!match)continue;const label=match[0].match(/\([^)]+\)/)[0];
    const base=pdfjsLib.Util.transform(viewport.transform,it.transform);
    const m=alignment?pdfjsLib.Util.transform(alignment,base):base;const fh=Math.max(8,Math.hypot(m[2],m[3]));
    const tagX=m[4]+(it.width||0)*viewport.scale*match.index/it.str.length;if(tagX<w*.70)continue;
    found.push({label,right:m[4]+(it.width||0)*viewport.scale,baseline:m[5],height:fh,x0:w*.12,x1:w*.98,y0:Math.max(0,m[5]-fh*2.0),y1:Math.min(h,m[5]+fh*1.5)});
  }
  const cluster=found.map(candidate=>found.filter(other=>Math.abs(candidate.right-other.right)<w*.014))
    .sort((a,b)=>b.length-a.length||b[0].right-a[0].right)[0];
  const aligned=cluster?.length>=2?cluster:found;
  return aligned.sort((a,b)=>a.y0-b.y0).filter((r,i,a)=>!i||r.y0-a[i-1].y0>5);
}
async function recognizeFormulaPage(page,canvas,viewport,items,ctx,pageIndex){
  const regions=formulaRegions(items,viewport,canvas.width,canvas.height,canvas.pageMatrix);
  const detector=await getOcr(ctx.lang||'rus+eng');await detector.setParameters({tessedit_pageseg_mode:'3'});
  const detected=await detector.recognize(canvas);
  const words=detected.data.words||[];
  const inline=(right,baseline,height)=>words.some(word=>{
    const box=word.bbox;
    return box&&/[А-Яа-яЁё]{3,}/.test(word.text)&&Math.abs(box.y1-baseline)<height*.65
      &&box.x1>right-height*7&&box.x0<right+height*4;
  });
  for(let n=regions.length-1;n>=0;n--){
    const region=regions[n];
    if(inline(region.right,region.baseline,region.height))regions.splice(n,1);
  }
  const alignedRight=regions.length>=2?regions[0].right:null;
  const nearRight=x=>alignedRight===null||Math.abs(x-alignedRight)<canvas.width*.02;
  for(const word of words){const b=word.bbox;if(!b||b.x0<canvas.width*.70||!nearRight(b.x1)||!/^\(\s*\d+[.,]\d+\s*\)$/.test(word.text))continue;const y=(b.y0+b.y1)/2,fh=Math.max(8,b.y1-b.y0);if(inline(b.x1,b.y1,fh)||regions.some(r=>y>=r.y0&&y<=r.y1))continue;regions.push({label:word.text,x0:canvas.width*.12,x1:canvas.width*.98,y0:Math.max(0,b.y1-fh*2),y1:Math.min(canvas.height,b.y1+fh*1.5)});}
  if(regions.length<4){
    const left=Math.floor(canvas.width*.86);
    const margin=imageCrop(canvas,left,0,canvas.width,canvas.height,2);
    try{
      await detector.setParameters({tessedit_pageseg_mode:'11'});
      const result=await detector.recognize(margin);
      for(const word of result.data.words||[]){
        const b=word.bbox;
        if(!b||!nearRight(left+b.x1/2)||!/^\(\d+[.,]\d+\)$/.test(word.text))continue;
        const y=b.y1/2,fh=Math.max(8,(b.y1-b.y0)/2);
        if(inline(left+b.x1/2,y,fh)||regions.some(r=>y>=r.y0&&y<=r.y1))continue;
        regions.push({label:word.text,x0:canvas.width*.12,x1:canvas.width*.98,y0:Math.max(0,y-fh*2),y1:Math.min(canvas.height,y+fh*1.5)});
      }
    }finally{
      margin.width=margin.height=1;
      await detector.setParameters({tessedit_pageseg_mode:'3'});
    }
  }
  if(!regions.length)return null;
  regions.sort((a,b)=>a.y0-b.y0);
  ctx.formulaStats={count:regions.length};
  const body=imageCrop(canvas,0,0,canvas.width,canvas.height);const c=body.getContext('2d');c.fillStyle='#fff';for(const r of regions)c.fillRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);
  let text;try{text=await ocrImage(body,ctx);}finally{body.width=body.height=1;}
  ctx.assets??={};
  for(let n=0;n<regions.length;n++){
    await waitResume(ctx);const r=regions[n];
    const {canvas:patch,scale:k}=await ctx.renderTablePatch(canvas,[r.x0,r.y0,r.x1,Math.min(canvas.height,r.y1+canvas.height*.012)]);
    try{
      ctx.status('Формула '+r.label+' · 400 dpi');const task=ctx.task;ctx.task='Formula Recognition:';
      // Keep extra margins in the human reference, but exclude the next prose
      // line from the model input: it can otherwise paraphrase it as mathematics.
      const input=imageCrop(patch,0,0,patch.width,Math.ceil((r.y1-r.y0)*k));
      let latex,caseNote='';
      try{
        latex=(await glmRecognize(input,ctx)).replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
        const variable=latex.match(/^\s*([A-Z])\s*=/)?.[1];
        if(variable&&r.baseline!=null){
          const positions=items.filter(item=>item.str?.trim()).map(item=>{
            const base=pdfjsLib.Util.transform(viewport.transform,item.transform);
            const m=canvas.pageMatrix?pdfjsLib.Util.transform(canvas.pageMatrix,base):base;
            return {text:item.str.trim(),x:m[4],y:m[5]};
          });
          const head=positions.filter(item=>item.x>=r.x0&&item.x<canvas.width*.72&&Math.abs(item.y-r.baseline)<r.height*.45).sort((a,b)=>a.x-b.x).slice(0,2).map(item=>item.text).join(' ');
          const printed=head.match(/^([a-zа-я])\s*=/)?.[1];
          const lookalikes={а:'a',с:'c',е:'e',о:'o',р:'p',х:'x',у:'y',к:'k',м:'m',т:'t',в:'b',н:'h'};
          if(printed&&(lookalikes[printed]||printed)===variable.toLowerCase()){
            const alternate=imageCrop(canvas,r.x0,r.y0,r.x1,r.y1,2);
            try{
              const reading=(await glmRecognize(alternate,ctx)).replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
              if(reading.match(/^([a-z])\s*=/)?.[1]===variable.toLowerCase()){
                latex=variable.toLowerCase()+latex.slice(1);
                caseNote='\n\n[?Первое чтение начиналось с '+variable+' =]';
              }else{
                caseNote='\n\n[?Проверьте регистр первой переменной по вырезке]';
              }
            }finally{alternate.width=alternate.height=1;}
          }
        }
      }finally{ctx.task=task;input.width=input.height=1;}
      const name='img/p'+String(pageIndex).padStart(3,'0')+'_formula_'+(n+1)+'.jpg';ctx.assets[name]=await canvasBlob(patch);
      latex=latex.replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
      const inferred=latex.match(/\\tag\s*\{\s*(\d+\s*\.\s*\d+)\s*\}/);
      const label=inferred?'('+inferred[1].replace(/\s/g,'')+')':r.label;
      const conflict=r.label.replace(/[(),.\s]/g,'')!==label.replace(/[(),.\s]/g,'');
      text+='\n\n$$'+latex+'$$ '+label+'\n\n![Формула '+label+']('+name+')\n\n[?LaTeX не сверен с вырезкой]'+(conflict?'\n\n[?Номер по тексту: '+r.label+']':'')+caseNote;
    }finally{patch.width=patch.height=1;}
  }
  return text;
}
