// Geometry only: no document-specific dimensions or reference values.
function clusterPositions(values,tolerance=3){const out=[];for(const v of values.sort((a,b)=>a-b)){const p=out.at(-1);if(p&&v-p.at(-1)<=tolerance)p.push(v);else out.push([v]);}return out.map(a=>a.reduce((x,y)=>x+y,0)/a.length);}
function scanSkew(image){
  const {width:w,height:h,data}=image,points=[];
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x+=3){const k=(y*w+x)*4;if(data[k+3]>100&&data[k]+data[k+1]+data[k+2]<600)points.push(x,y);}
  let best=0,bestScore=0,zero=0;
  for(let step=-15;step<=15;step++){const slope=Math.tan(step*Math.PI/1800),hist=new Uint32Array(h+100);
    for(let p=0;p<points.length;p+=2){const row=Math.round(points[p+1]+slope*(points[p]-w/2))+50;if(row>=0&&row<hist.length)hist[row]++;}
    let score=0;for(let y=1;y<hist.length-1;y++){const n=hist[y-1]+hist[y]+hist[y+1];score+=n*n;}if(!step)zero=score;if(score>bestScore){bestScore=score;best=step/10;}
  }
  return bestScore>zero*1.025?best:0;
}
function deskewCanvas(canvas){
  const angle=scanSkew(canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height));
  if(Math.abs(angle)<=.1)return canvas;
  const cv=document.createElement('canvas');cv.width=canvas.width;cv.height=canvas.height;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.translate(cv.width/2,cv.height/2);c.rotate(angle*Math.PI/180);c.drawImage(canvas,-canvas.width/2,-canvas.height/2);return cv;
}
function lineGrid(image){
  const {width:w,height:h,data}=image;const xs=[],ys=[];const horizontal=[],vertical=[];
  const dark=(x,y)=>{const k=(y*w+x)*4;return data[k]+data[k+1]+data[k+2]<660&&data[k+3]>100;};
  const dh=(x,y)=>dark(x,y)||y>1&&dark(x,y-2)||y<h-2&&dark(x,y+2);
  const dv=(x,y)=>dark(x,y)||x>1&&dark(x-2,y)||x<w-2&&dark(x+2,y);
  const minH=Math.max(70,w*.12),minV=Math.max(60,h*.08);
  for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){if(x<w&&dh(x,y)){if(start<0)start=x;}else if(start>=0){if(x-start>=minH){ys.push(y);horizontal.push([start,y,x]);}start=-1;}}}
  for(let x=0;x<w;x++){let start=-1;for(let y=0;y<=h;y++){if(y<h&&dv(x,y)){if(start<0)start=y;}else if(start>=0){if(y-start>=minV){xs.push(x);vertical.push([x,start,y]);}start=-1;}}}
  const longest=Math.max(0,...horizontal.map(r=>r[2]-r[0]));const major=horizontal.filter(r=>r[2]-r[0]>longest*.7);
  if(!major.length)return null;
  const tableTop=Math.min(...major.map(r=>r[1]));
  const useVertical=vertical.filter(r=>r[2]>tableTop+minV*.7);vertical.splice(0,vertical.length,...useVertical);
  let columns=clusterPositions(vertical.map(r=>r[0]),4);const lines=clusterPositions(ys.filter(y=>y>=tableTop-3),4);
  const gaps=columns.slice(1).map((v,i)=>v-columns[i]).sort((a,b)=>a-b);
  if(gaps.length){const tolerance=gaps[Math.floor(gaps.length/2)]*.30;columns=clusterPositions(columns,tolerance);}
  if(columns.length<4||lines.length<3)return null;
  let left=Math.min(columns[0],...major.map(r=>r[0])),right=Math.max(columns.at(-1),...major.map(r=>r[2]));
  const yt=Math.min(...vertical.map(r=>r[1])),yb=Math.max(...vertical.map(r=>r[2]));
  const coverage=x=>{let ink=0,total=0;for(let y=Math.ceil(yt+(yb-yt)*.12);y<yb-5;y+=3){total++;if([-4,-2,0,2,4].some(dx=>x+dx>=0&&x+dx<w&&dark(Math.round(x+dx),y)))ink++;}return ink/Math.max(1,total);};
  const compact=[];const close=(gaps[Math.floor(gaps.length/2)]||20)*.36;
  for(const x of columns){if(compact.length&&x-compact.at(-1)<close&&Math.abs(coverage(x)-coverage(compact.at(-1)))>.15){if(coverage(x)>coverage(compact.at(-1)))compact[compact.length-1]=x;}else compact.push(x);}columns=compact;
  const typical=gaps[Math.floor(gaps.length/2)]||20;
  if(columns[0]-left>typical*.3)columns.unshift(left);else left=columns[0];
  if(right-columns.at(-1)>typical*.3)columns.push(right);else right=columns.at(-1);
  const valid=horizontal.filter(r=>r[2]-r[0]>(right-left)*.65);
  if(!valid.length)return null;
  const starts=vertical.map(r=>r[1]).sort((a,b)=>a-b);
  const fullLines=clusterPositions(horizontal.filter(r=>r[2]-r[0]>(right-left)*.9).map(r=>r[1]),4);
  const ends=columns.map(x=>vertical.filter(r=>Math.abs(r[0]-x)<10).sort((a,b)=>(b[2]-b[1])-(a[2]-a[1]))[0]?.[2]).filter(Number.isFinite).sort((a,b)=>a-b);
  return {columns,lines,horizontal,fullLines,headerStart:starts[Math.floor(starts.length/2)],top:tableTop,bottom:ends[Math.floor(ends.length*.6)]||Math.max(...vertical.map(r=>r[2])),left,right};
}
function pixelRows(canvas,grid,first,height){
  const {width:w,height:h,data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);const active=[];
  const intervals=grid.columns.slice(1).map((v,i)=>[Math.ceil(grid.columns[i]+6),Math.floor(v-6)]);
  const mask=new Uint8Array(w*h);
  for(const [a,y,b]of grid.horizontal||[])for(let dy=-2;dy<=2;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;mask.fill(1,yy*w+Math.max(0,a),yy*w+Math.min(w,b));}
  for(let y=Math.ceil(first+4);y<Math.min(h,grid.bottom-3);y++){
    let ink=0,occupied=0;for(const [a,b]of intervals){let count=0;for(let x=a;x<b;x+=2){let k=(y*w+x)*4;if(!mask[y*w+x]&&data[k+3]>100&&data[k]+data[k+1]+data[k+2]<510)count++;}ink+=count;if(count>2)occupied++;}
    if(ink>(grid.right-grid.left)*.018&&occupied>=Math.max(3,intervals.length*.35))active.push(y);
  }
  const groups=[];for(const y of active){const g=groups.at(-1);if(g&&y-g.at(-1)<=2)g.push(y);else groups.push([y]);}
  const usable=groups.filter(g=>g.length>=4);const sizes=usable.map(g=>g.at(-1)-g[0]+1).sort((a,b)=>a-b);const glyph=sizes[Math.floor(sizes.length/2)]||height;
  return clusterPositions(usable.map(g=>(g[0]+g.at(-1))/2),Math.min(height,glyph)*.75);
}
function rotatePageCanvas(canvas,items,viewport){
  const votes=[0,0,0,0];
  for(const it of items){if(!it.str?.trim())continue;const m=pdfjsLib.Util.transform(viewport.transform,it.transform);const a=((Math.round(Math.atan2(m[1],m[0])*2/Math.PI)%4)+4)%4;votes[a]+=it.str.length;}
  const turn=votes.indexOf(Math.max(...votes));if(!turn)return canvas;
  const cv=document.createElement('canvas');cv.width=turn%2?canvas.height:canvas.width;cv.height=turn%2?canvas.width:canvas.height;
  const c=cv.getContext('2d');c.translate(cv.width/2,cv.height/2);c.rotate(-turn*Math.PI/2);c.drawImage(canvas,-canvas.width/2,-canvas.height/2);return cv;
}
function imageCrop(canvas,x0,y0,x1,y1,scale=1){const cv=document.createElement('canvas');cv.width=Math.max(1,Math.ceil((x1-x0)*scale));cv.height=Math.max(1,Math.ceil((y1-y0)*scale));const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.drawImage(canvas,x0,y0,x1-x0,y1-y0,0,0,cv.width,cv.height);return cv;}
function htmlEscape(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function recognizeCellTable(canvas,ctx,pageIndex){
  const aligned=deskewCanvas(canvas);
  try{return await recognizeAlignedTable(aligned,ctx,pageIndex);}finally{if(aligned!==canvas)aligned.width=aligned.height=1;}
}
async function recognizeAlignedTable(canvas,ctx,pageIndex){
  ctx.status('Поиск сетки таблицы…');
  const grid=lineGrid(canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height));
  if(!grid){ctx.status('Сетка не найдена');return null;}
  const worker=await getOcr(ctx.lang||'rus+eng');
  // Whole-page OCR supplies row locations only, never primary cell values.
  await worker.setParameters({tessedit_pageseg_mode:'3'});
  const whole=await worker.recognize(canvas);
  const words=whole.data.words||[];
  const candidates=[];
  for(const word of words){const b=word.bbox;if(b&&/^[−+-]?\d+(?:[.,]\d+)?[*%]?$/.test(word.text)&&b.x0>=grid.left&&b.x1<=grid.right&&b.y0>grid.top&&b.y1<grid.bottom)candidates.push({y:(b.y0+b.y1)/2,x:(b.x0+b.x1)/2,h:b.y1-b.y0});}
  const height=candidates.length?candidates.map(v=>v.h).sort((a,b)=>a-b)[Math.floor(candidates.length/2)]:10;
  const bands=clusterPositions(candidates.map(v=>v.y),Math.max(3,height*.5)).filter(y=>new Set(candidates.filter(v=>Math.abs(v.y-y)<height*.6).map(v=>grid.columns.findIndex(x=>x>v.x))).size>=Math.max(3,(grid.columns.length-1)*.35));
  ctx.status('Сетка: '+grid.columns.length+' границ; слов '+words.length+'; полос '+bands.length);
  if(grid.columns.length<7)return null;
  // Header rows are retained as headers, not silently interpreted as data.
  const first=grid.fullLines.find(y=>y>grid.top+height*2&&(!bands.length||y<bands[0]-height*.4))||(bands.length?grid.lines.filter(y=>y<bands[0]-height*.4).at(-1):grid.lines[1])||grid.top;
  const body=pixelRows(canvas,grid,first,height);
  if(body.length<2||body.length*(grid.columns.length-1)>1400)return null;
  ctx.tableStats={rows:body.length,columns:grid.columns.length-1};
  const crop=imageCrop(canvas,grid.left,grid.top,grid.right,grid.bottom);
  const name='img/p'+String(pageIndex).padStart(3,'0')+'_tabl_1.jpg';
  ctx.assets??={};ctx.assets[name]=await canvasBlob(crop);crop.width=crop.height=1;
  const match=((ctx.sourceText||'')+'\n'+(whole.data.text||'')).match(/т\s*а\s*б\s*л(?:\s*и\s*ц\s*а|\.)\s*(\d+(?:\.\d+)?)/i);
  const id=match?match[1]:'[?номер не распознан]';
  let out='Таблица '+id+'\n\n![Таблица]('+name+')\n\n<table><thead><tr>';
  for(let c=0;c<grid.columns.length-1;c++)out+='<th>Столбец '+(c+1)+' [?шапка не сверена]</th>';
  out+='</tr></thead><tbody>';
  await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
  const matrix=[];
  try{for(let r=0;r<body.length;r++){
    await waitResume(ctx);matrix.push([]);
    const y0=r?(body[r-1]+body[r])/2:first+2;
    const y1=r+1<body.length?(body[r]+body[r+1])/2:Math.min(grid.bottom,body[r]+height);
    for(let c=0;c<grid.columns.length-1;c++){
      ctx.status('Таблица: строка '+(r+1)+'/'+body.length+', ячейка '+(c+1)+'/'+(grid.columns.length-1));
      const patch=imageCrop(canvas,grid.columns[c]+3,y0+1,grid.columns[c+1]-3,y1-1,2);
      const pixels=patch.getContext('2d').getImageData(0,0,patch.width,patch.height).data;let ink=0;for(let k=0;k<pixels.length;k+=4)if(pixels[k]+pixels[k+1]+pixels[k+2]<420)ink++;
      let result;try{result=await worker.recognize(patch);}finally{patch.width=patch.height=1;}
      const value=(result.data.text||'').replace(/\s+/g,' ').trim();
      const alt=words.filter(w=>w.bbox&&(w.bbox.x0+w.bbox.x1)/2>grid.columns[c]&&(w.bbox.x0+w.bbox.x1)/2<grid.columns[c+1]&&(w.bbox.y0+w.bbox.y1)/2>y0&&(w.bbox.y0+w.bbox.y1)/2<y1).map(w=>w.text).join(' ');
      matrix[r].push({text:value,blank:!value&&ink<Math.max(3,pixels.length/4*.01),alt,confidence:result.data.confidence,bbox:[grid.columns[c],y0,grid.columns[c+1],y1],span:1});
    }
  }}finally{await worker.setParameters({tessedit_pageseg_mode:'3'});}
  for(let r=1;r<matrix.length;r++)for(let c=0;c<matrix[r].length;c++){
    const cell=matrix[r][c];if(!cell.blank)continue;
    const y=cell.bbox[1];const border=grid.horizontal.some(s=>Math.abs(s[1]-y)<height*.6&&s[0]<=grid.columns[c]+5&&s[2]>=grid.columns[c+1]-5);if(border)continue;
    let root=r-1;while(root>=0&&matrix[root][c].skip)root--;
    if(root>=0&&matrix[root][c].text){matrix[root][c].span++;cell.skip=true;matrix[root][c].merged=true;}
  }
  for(const row of matrix){out+='<tr>';for(const cell of row){if(cell.skip)continue;const value=cell.blank?'':cell.text?'[?'+cell.text+']':'[?непрочитанная ячейка]';out+='<td'+(cell.span>1?' rowspan="'+cell.span+'"':'')+'>'+htmlEscape(value)+'</td>';}out+='</tr>';}
  ctx.tableStats.cells=matrix;
  const remainder=imageCrop(canvas,0,0,canvas.width,canvas.height);const rc=remainder.getContext('2d');rc.fillStyle='#fff';rc.fillRect(grid.left,grid.top,grid.right-grid.left,Math.min(grid.bottom,body.at(-1)+height)-grid.top);
  let prose;try{prose=(await worker.recognize(remainder)).data.text||'';}finally{remainder.width=remainder.height=1;}
  return out+'</tbody></table>\n\n<!-- таблица '+id+': строк '+body.length+', столбцов '+(grid.columns.length-1)+' -->\n\n[?Границы, шапка и объединения ячеек требуют сверки по вырезке]\n\n'+prose;
}
