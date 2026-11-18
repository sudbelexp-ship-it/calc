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
function incompleteFraction(latex){
  const groups=/\\(?:[dt]?frac)\b/g;
  for(const match of latex.matchAll(groups)){
    let position=match.index+match[0].length;
    for(let part=0;part<2;part++){
      while(/\s/.test(latex[position]||''))position++;
      if(latex[position]!=='{')return true;
      const start=++position;
      let depth=1;
      while(position<latex.length&&depth){
        if(latex[position]==='{')depth++;
        if(latex[position]==='}')depth--;
        position++;
      }
      if(depth||!latex.slice(start,position-1).trim())return true;
    }
  }
  return false;
}
function formulaFocus(canvas,baseline,letterHeight,width){
  const {height}=canvas,{data}=canvas.getContext('2d').getImageData(0,0,canvas.width,height);
  const bands=[];
  for(let y=0;y<height;y++){
    let left=width,right=-1,ink=0;
    for(let x=0;x<width;x++){
      const offset=(y*canvas.width+x)*4;
      if(data[offset]+data[offset+1]+data[offset+2]<570){left=Math.min(left,x);right=x;ink++;}
    }
    if(ink<3)continue;
    const prior=bands.at(-1);
    if(prior&&y-prior.bottom<3){prior.bottom=y;prior.left=Math.min(prior.left,left);prior.right=Math.max(prior.right,right);}
    else bands.push({top:y,bottom:y,left,right});
  }
  const candidates=bands.filter(band=>band.right-band.left<width*.65&&band.bottom-band.top>=2);
  const distance=band=>Math.max(band.top-baseline,baseline-band.bottom,0);
  const anchor=candidates.reduce((best,band)=>!best||distance(band)<distance(best)?band:best,null);
  if(!anchor||distance(anchor)>letterHeight*.6)return null;
  let left=anchor.left,right=anchor.right,top=anchor.top,bottom=anchor.bottom;
  for(const direction of [-1,1]){
    for(let i=bands.indexOf(anchor)+direction;i>=0&&i<bands.length;i+=direction){
      const band=bands[i],gap=direction<0?top-band.bottom:band.top-bottom;
      if(gap>letterHeight*.65||band.right-band.left>width*.65||
        band.right<left-letterHeight||band.left>right+letterHeight)break;
      left=Math.min(left,band.left);right=Math.max(right,band.right);
      top=Math.min(top,band.top);bottom=Math.max(bottom,band.bottom);
    }
  }
  const margin=Math.round(letterHeight*.26);
  return imageCrop(canvas,Math.max(0,left-margin),Math.max(0,top-margin),Math.min(width,right+margin),Math.min(height,bottom+margin));
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
  if(ctx.tableRegion){const [x0,y0,x1,y1]=ctx.tableRegion;c.fillRect(x0,y0,x1-x0,y1-y0);}
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
      let latex,caseNote='',reference=patch;
      try{
        latex=(await glmRecognize(input,ctx)).replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
        if(incompleteFraction(latex)&&r.baseline!=null){
          const end=Math.min(canvas.height,regions[n+1]?.y0??canvas.height,r.y1+r.height*1.8);
          const {canvas:expanded}=await ctx.renderTablePatch(canvas,[r.x0,r.y0,r.x1,end]);
          try{
            const width=Math.floor(Math.min(expanded.width,(r.right-r.x0-r.height*5)*k));
            const focused=width>0?formulaFocus(expanded,(r.baseline-r.y0)*k,r.height*k,width):null;
            if(focused)try{
              const reading=(await glmRecognize(focused,ctx)).replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
              if(/\\[dt]?frac\b/.test(reading)&&!incompleteFraction(reading)&&!reading.includes('Генерация остановлена')){
                const tag=latex.match(/\\tag\s*\{[^{}]+\}/)?.[0]||'';
                latex=reading.replace(/\\tag\s*\{[^{}]+\}/g,'').trim()+(tag?' '+tag:'');
                reference=expanded;
              }
            }finally{focused.width=focused.height=1;}
          }finally{if(reference!==expanded)expanded.width=expanded.height=1;}
        }
        if(incompleteFraction(latex))ctx.pageIssue||='В формуле '+r.label+' не распознана часть дроби';
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
      const name='img/p'+String(pageIndex).padStart(3,'0')+'_formula_'+(n+1)+'.jpg';
      try{ctx.assets[name]=await canvasBlob(reference);}finally{if(reference!==patch)reference.width=reference.height=1;}
      latex=latex.replace(/^\s*\$\$|\$\$\s*$/g,'').trim();
      const inferred=latex.match(/\\tag\s*\{\s*(\d+\s*\.\s*\d+)\s*\}/);
      const label=inferred?'('+inferred[1].replace(/\s/g,'')+')':r.label;
      const conflict=r.label.replace(/[(),.\s]/g,'')!==label.replace(/[(),.\s]/g,'');
      text+='\n\n$$'+latex+'$$ '+label+'\n\n![Формула '+label+']('+name+')\n\n[?LaTeX не сверен с вырезкой]'+(conflict?'\n\n[?Номер по тексту: '+r.label+']':'')+caseNote;
    }finally{patch.width=patch.height=1;}
  }
  return text;
}
