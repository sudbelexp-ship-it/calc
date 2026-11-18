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
  const cv=document.createElement('canvas');cv.width=canvas.width;cv.height=canvas.height;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.translate(cv.width/2,cv.height/2);c.rotate(angle*Math.PI/180);c.drawImage(canvas,-canvas.width/2,-canvas.height/2);
  const a=angle*Math.PI/180,co=Math.cos(a),si=Math.sin(a);cv.pageMatrix=pdfjsLib.Util.transform([co,si,-si,co,cv.width/2-co*cv.width/2+si*cv.height/2,cv.height/2-si*cv.width/2-co*cv.height/2],canvas.pageMatrix||[1,0,0,1,0,0]);return cv;
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
  const useVertical=vertical.filter(r=>r[2]>tableTop+minV*.7&&r[1]<tableTop+minV*2);vertical.splice(0,vertical.length,...useVertical);
  let columns=clusterPositions(vertical.map(r=>r[0]),4);const lines=clusterPositions(ys.filter(y=>y>=tableTop-3),4);
  const gaps=columns.slice(1).map((v,i)=>v-columns[i]).sort((a,b)=>a-b);
  if(gaps.length){const tolerance=gaps[Math.floor(gaps.length/2)]*.30;columns=clusterPositions(columns,tolerance);}
  if(columns.length<3||lines.length<3)return null;
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
  return {columns,lines,horizontal,vertical,fullLines,headerTop:Math.min(...starts),headerStart:starts[Math.floor(starts.length/2)],top:tableTop,bottom:ends[Math.floor(ends.length*.6)]||Math.max(...vertical.map(r=>r[2])),left,right};
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
  const c=cv.getContext('2d');c.translate(cv.width/2,cv.height/2);c.rotate(-turn*Math.PI/2);c.drawImage(canvas,-canvas.width/2,-canvas.height/2);const a=-turn*Math.PI/2,co=Math.cos(a),si=Math.sin(a);cv.pageMatrix=[co,si,-si,co,cv.width/2-co*canvas.width/2+si*canvas.height/2,cv.height/2-si*canvas.width/2-co*canvas.height/2];return cv;
}
function imageCrop(canvas,x0,y0,x1,y1,scale=1){const cv=document.createElement('canvas');cv.width=Math.max(1,Math.ceil((x1-x0)*scale));cv.height=Math.max(1,Math.ceil((y1-y0)*scale));const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.drawImage(canvas,x0,y0,x1-x0,y1-y0,0,0,cv.width,cv.height);return cv;}
function htmlEscape(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function ruleCoverage(image,x0,y0,x1,y1){
  const {width:w,height:h,data}=image;const vertical=Math.abs(x1-x0)<Math.abs(y1-y0);
  if(vertical){let best=0;for(let dx=-8;dx<=8;dx++){let n=0,count=0;for(let y=Math.ceil(y0+2);y<y1-2;y+=2){count++;let ink=false;for(let d=-1;d<=1;d++){const x=Math.round(x0+dx+d);if(x<0||x>=w||y<0||y>=h)continue;const k=(y*w+x)*4;if(data[k]+data[k+1]+data[k+2]<660){ink=true;break;}}if(ink)n++;}best=Math.max(best,n/Math.max(1,count));}return best>=.75?best:0;}
  {let best=0;for(let dy=-3;dy<=3;dy++){let n=0,count=0;for(let x=Math.ceil(x0+2);x<x1-2;x+=2){count++;let ink=false;for(let d=-1;d<=1;d++){const y=Math.round(y0+dy+d);if(x<0||x>=w||y<0||y>=h)continue;const k=(y*w+x)*4;if(data[k]+data[k+1]+data[k+2]<660){ink=true;break;}}if(ink)n++;}best=Math.max(best,n/Math.max(1,count));}return best>=.75?best:0;}
}
function regionLines(image,box,height){
  const {width:w,data}=image,active=[];
  const inset=Math.min(8,(box[2]-box[0])*.22);
  for(let y=Math.ceil(box[1]+3);y<Math.floor(box[3]-3);y++){let count=0;for(let x=Math.ceil(box[0]+inset);x<Math.floor(box[2]-inset);x++){const k=(y*w+x)*4;if(data[k+3]>100&&data[k]+data[k+1]+data[k+2]<550)count++;}if(count>=2)active.push(y);}
  const groups=[];for(const y of active){const g=groups.at(-1);if(g&&y-g.at(-1)<=1)g.push(y);else groups.push([y]);}
  return groups.filter(g=>g.at(-1)-g[0]>=Math.max(3,height*.35));
}
function bodyCells(image,grid,body,first,height,words=[],ruledEdges=null){
  const edges=ruledEdges||[first+1,...body.slice(1).map((y,i)=>{const mid=(body[i]+y)/2,inside=grid.lines.filter(v=>v>body[i]+height*.35&&v<y-height*.35),near=inside.reduce((a,b)=>Math.abs(b-mid)<Math.abs(a-mid)?b:a,Infinity);return Number.isFinite(near)?near:mid;}),Math.min(grid.bottom,body.at(-1)+height)];
  const matrix=body.map((_,r)=>grid.columns.slice(1).map((x,c)=>({r,c,span:1,colspan:1,bbox:[grid.columns[c],edges[r],x,edges[r+1]],skip:false})));
  for(let c=0;c<grid.columns.length-1;c++){
    let start=0;
    for(let end=1;end<=body.length;end++){
      if(end<body.length&&ruleCoverage(image,grid.columns[c]+3,edges[end],grid.columns[c+1]-3,edges[end])<.9)continue;
      const box=[grid.columns[c],edges[start],grid.columns[c+1],edges[end]];
      // A single line printed anywhere in a ruled group belongs to the entire
      // physical cell, including rows above its visual baseline.
      const bands=regionLines(image,box,height);
      const groupWords=words.filter(w=>w.bbox&&(w.bbox.x0+w.bbox.x1)/2>box[0]&&(w.bbox.x0+w.bbox.x1)/2<box[2]&&(w.bbox.y0+w.bbox.y1)/2>box[1]&&(w.bbox.y0+w.bbox.y1)/2<box[3]);
      const proseWords=groupWords.filter(w=>/^[А-Яа-яЁё]{3,}$/.test(w.text)).length;
      const textual=proseWords>=2&&proseWords>groupWords.length/2;
      const sparseBands=!ruledEdges&&!textual&&bands.length>1&&bands.length<end-start
        &&bands.every((band,i)=>band.length>=height*.55&&(!i||band[0]-bands[i-1].at(-1)>height*.85));
      if(sparseBands){
        const centers=bands.map(band=>(band[0]+band.at(-1))/2);
        const matchNeighbor=[c-1,c+1].some(neighbor=>{
          if(neighbor<0||neighbor>=grid.columns.length-1)return false;
          const other=regionLines(image,[grid.columns[neighbor],box[1],grid.columns[neighbor+1],box[3]],height);
          return other.length===centers.length&&other.every((band,i)=>Math.abs((band[0]+band.at(-1))/2-centers[i])<height*.45);
        });
        if(matchNeighbor){
          const boundaries=[start];
          for(let i=1;i<centers.length;i++){
            const midpoint=(centers[i-1]+centers[i])/2;
            let nearest=-1;
            for(let row=boundaries.at(-1)+1;row<end;row++){
              if(edges[row]<=centers[i-1]||edges[row]>=centers[i])continue;
              if(nearest<0||Math.abs(edges[row]-midpoint)<Math.abs(edges[nearest]-midpoint))nearest=row;
            }
            if(nearest>=0)boundaries.push(nearest);
          }
          boundaries.push(end);
          if(boundaries.length===centers.length+1){
            for(let i=0;i<centers.length;i++){
              const from=boundaries[i],to=boundaries[i+1],root=matrix[from][c];
              root.span=to-from;
              root.bbox=[box[0],edges[from],box[2],edges[to]];
              for(let r=from+1;r<to;r++)matrix[r][c].skip=true;
            }
            start=end;
            continue;
          }
        }
      }
      if(end-start>1&&(ruledEdges||bands.length<=1||textual)){const root=matrix[start][c];root.span=end-start;root.bbox=box;root.multiline=Boolean(ruledEdges)||textual;for(let r=start+1;r<end;r++)matrix[r][c].skip=true;}
      else if((ruledEdges||textual)&&end-start===1)matrix[start][c].multiline=true;
      start=end;
    }
  }return matrix;
}
function headerCells(image,grid,first,minRuleRun=18){
  const top=Math.max(0,grid.headerTop??grid.top),bottom=first; if(bottom-top<12)return {rows:[],cells:[]};
  const {width:w,data}=image,minRun=Math.max(minRuleRun,Math.min(...grid.columns.slice(1).map((x,i)=>x-grid.columns[i]))*.7),yy=[];
  for(let y=Math.ceil(top+5);y<bottom-5;y++){let run=0,best=0;for(let x=Math.ceil(grid.left);x<grid.right;x++){const k=(y*w+x)*4;if(data[k]+data[k+1]+data[k+2]<660){run++;best=Math.max(best,run);}else run=0;}if(best>=minRun)yy.push(y);}
  const rows=[top,...clusterPositions(yy,4).filter(y=>y>top+6&&y<bottom-6),bottom];
  const n=grid.columns.length-1,m=rows.length-1,parent=Array.from({length:n*m},(_,i)=>i);
  const find=i=>parent[i]===i?i:parent[i]=find(parent[i]);const join=(a,b)=>{parent[find(a)]=find(b);};
  for(let r=0;r<m;r++)for(let c=0;c<n;c++){
    if(c+1<n&&ruleCoverage(image,grid.columns[c+1],rows[r]+3,grid.columns[c+1],rows[r+1]-3)<.55)join(r*n+c,r*n+c+1);
    if(r+1<m&&ruleCoverage(image,grid.columns[c]+3,rows[r+1],grid.columns[c+1]-3,rows[r+1])<.9)join(r*n+c,(r+1)*n+c);
  }
  const groups=new Map();for(let r=0;r<m;r++)for(let c=0;c<n;c++){const k=find(r*n+c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push([r,c]);}
  const cells=[];for(const group of groups.values()){const r0=Math.min(...group.map(p=>p[0])),r1=Math.max(...group.map(p=>p[0]))+1,c0=Math.min(...group.map(p=>p[1])),c1=Math.max(...group.map(p=>p[1]))+1;
    if(group.length!==(r1-r0)*(c1-c0)){for(const [r,c]of group)cells.push({r,c,span:1,colspan:1,bbox:[grid.columns[c],rows[r],grid.columns[c+1],rows[r+1]],uncertain:true});}
    else cells.push({r:r0,c:c0,span:r1-r0,colspan:c1-c0,bbox:[grid.columns[c0],rows[r0],grid.columns[c1],rows[r1]]});
  }
  const compact=rows.filter((y,i)=>!i||i===rows.length-1||cells.some(c=>c.bbox[1]===y||c.bbox[3]===y));
  for(const cell of cells){cell.r=compact.indexOf(cell.bbox[1]);cell.span=compact.indexOf(cell.bbox[3])-cell.r;}
  return {rows:compact,cells};
}
function trimCell(canvas){
  const {width:w,height:h}=canvas,im=canvas.getContext('2d').getImageData(0,0,w,h);let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(im.data[k]+im.data[k+1]+im.data[k+2]<570){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  if(x1<0)return null;
  const cv=document.createElement('canvas'),pad=12;cv.width=x1-x0+1+pad*2;cv.height=y1-y0+1+pad*2;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,cv.width,cv.height);c.drawImage(canvas,x0,y0,x1-x0+1,y1-y0+1,pad,pad,x1-x0+1,y1-y0+1);return cv;
}
function cellInk(canvas){
  const {width,height}=canvas;
  const image=canvas.getContext('2d').getImageData(0,0,width,height).data;
  const topMargin=Math.min(6,Math.ceil(height*.05));
  const groups=[];
  let group=null;
  for(let x=0;x<width;x++){
    let top=height,bottom=-1,ink=0;
    for(let y=topMargin;y<height;y++){
      const offset=(y*width+x)*4;
      if(image[offset]+image[offset+1]+image[offset+2]<570){top=Math.min(top,y);bottom=y;ink++;}
    }
    if(!ink){group=null;continue;}
    if(!group){group={top,bottom,left:x,right:x,ink:0};groups.push(group);}
    group.top=Math.min(group.top,top);group.bottom=Math.max(group.bottom,bottom);group.right=x;group.ink+=ink;
  }
  return groups.filter(part=>part.ink>=4);
}
function decimalPosition(glyphs,digitCount){
  if(glyphs.length!==digitCount+1||digitCount<2)return -1;
  const heights=glyphs.map(part=>part.bottom-part.top+1);
  const typical=heights.slice().sort((a,b)=>a-b)[Math.floor(heights.length/2)];
  const baseline=Math.max(...glyphs.map(part=>part.bottom));
  const short=heights.reduce((found,h,i)=>h<typical*.65?[...found,i]:found,[]);
  if(typical<8||short.length!==1||short[0]===0||short[0]===heights.length-1)return -1;
  const separator=glyphs[short[0]];
  return heights[short[0]]<typical*.55&&separator.top>baseline-typical*.45
    &&Math.abs(separator.bottom-baseline)<typical*.4?short[0]:-1;
}
function decimalInk(canvas,decimal){
  const [whole,fraction]=decimal.split(/[.,]/);
  const glyphs=cellInk(canvas);
  if(glyphs.length!==whole.length+fraction.length+1)return false;
  const separator=glyphs[whole.length];
  const digits=glyphs.filter((_,i)=>i!==whole.length);
  const heights=digits.map(part=>part.bottom-part.top+1).sort((a,b)=>a-b);
  const typical=heights[Math.floor(heights.length/2)];
  const baseline=Math.max(...digits.map(part=>part.bottom));
  return typical>=8&&heights[0]>=typical*.65&&separator.bottom-separator.top+1<typical*.55
    &&separator.top>baseline-typical*.45&&Math.abs(separator.bottom-baseline)<typical*.4;
}
function restoreWordDecimals(canvas,result){
  const words=result.words||[];
  let text=result.text,cursor=0;
  if(words.length<2)return text;
  for(const word of words){
    const start=text.indexOf(word.text,cursor);
    if(start<0)continue;
    cursor=start+word.text.length;
    if(!/^\d{2,}$/.test(word.text)||!word.bbox)continue;
    const {x0,y0,x1,y1}=word.bbox;
    const patch=imageCrop(canvas,Math.max(0,x0-2),Math.max(0,y0-2),Math.min(canvas.width,x1+2),Math.min(canvas.height,y1+4));
    try{
      const position=decimalPosition(cellInk(patch),word.text.length);
      if(position>0){text=text.slice(0,start+position)+','+text.slice(start+position);cursor++;}
    }finally{patch.width=patch.height=1;}
  }
  return text;
}
function clearCellRules(canvas){
  const {width,height}=canvas,c=canvas.getContext('2d',{willReadFrequently:true}),im=c.getImageData(0,0,width,height),data=im.data;
  const dark=(x,y)=>{const k=(y*width+x)*4;return data[k]+data[k+1]+data[k+2]<570;};
  const blank=(x,y)=>data.fill(255,(y*width+x)*4,(y*width+x)*4+4);
  let changed=false;
  // Only remove rules along the crop boundary. A dash or minus in the cell's
  // interior is data. A serif on the first digit never spans the cell height.
  const horizontal=Math.min(7,Math.ceil(height*.12));
  const vertical=Math.min(12,Math.ceil(width*.16));
  for(let y=0;y<height;y++){
    if(y>=horizontal&&y<height-horizontal)continue;
    let ink=0;for(let x=0;x<width;x++)if(dark(x,y))ink++;
    if(ink<width*.57)continue;
    for(let x=0;x<width;x++)blank(x,y);changed=true;
  }
  for(let x=0;x<width;x++){
    if(x>=vertical&&x<width-vertical)continue;
    let ink=0;for(let y=0;y<height;y++)if(dark(x,y))ink++;
    if(ink<height*.63)continue;
    for(let y=0;y<height;y++)blank(x,y);changed=true;
  }
  if(changed)c.putImageData(im,0,0);
  return changed;
}
function printedDash(canvas){
  const glyphs=cellInk(canvas);
  if(glyphs.length!==1)return false;
  const [g]=glyphs,width=g.right-g.left+1,height=g.bottom-g.top+1;
  return width>=8&&width>=height*3&&width<canvas.width*.85&&g.top>canvas.height*.12
    &&g.bottom<canvas.height*.88&&g.ink>=width*height*.36;
}
function edgeStroke(canvas){
  const [first]=cellInk(canvas);
  if(!first)return null;
  const strokeHeight=first.bottom-first.top+1,strokeWidth=first.right-first.left+1;
  return first.left<canvas.width*.14&&first.right<canvas.width*.24&&strokeHeight>=canvas.height*.60&&strokeWidth<=strokeHeight*.32&&
    (first.top<=Math.min(8,canvas.height*.16)||first.bottom>=canvas.height*.9)?first:null;
}
function binaryGlyph(canvas,slant,threshold=500){
  const {width,height}=canvas;
  const c=canvas.getContext('2d'),im=c.getImageData(0,0,width,height);
  for(let n=0;n<im.data.length;n+=4){
    const value=im.data[n]+im.data[n+1]+im.data[n+2]<threshold?0:255;
    im.data[n]=im.data[n+1]=im.data[n+2]=value;
  }
  const source=document.createElement('canvas');source.width=width;source.height=height;
  source.getContext('2d').putImageData(im,0,0);
  const wc=width+Math.ceil(Math.abs(slant)*height),result=document.createElement('canvas');
  result.width=wc;result.height=height;
  const out=result.getContext('2d');out.fillStyle='#fff';out.fillRect(0,0,wc,height);
  out.imageSmoothingEnabled=false;out.transform(1,0,slant,1,(wc-width-slant*height)/2,0);
  out.drawImage(source,0,0);source.width=source.height=1;return result;
}
function plusMinusLines(canvas){
  const {width,height}=canvas,im=canvas.getContext('2d').getImageData(0,0,width,height);
  const dark=(x,y)=>{const n=(y*width+x)*4;return im.data[n]+im.data[n+1]+im.data[n+2]<570;};
  const bands=[];
  for(let y=1;y<height-1;y++){
    let ink=0;for(let x=1;x<width-1;x++)if(dark(x,y))ink++;
    if(ink<3)continue;
    const prev=bands.at(-1);
    if(prev&&y-prev[1]<=3)prev[1]=y;else bands.push([y,y]);
  }
  return bands.filter(([top,bottom])=>bottom-top>=7).map(([top,bottom])=>{
    let first=-1,last=-1;
    for(let x=1;x<width-1;x++){
      let ink=0;for(let y=top;y<=bottom;y++)if(dark(x,y))ink++;
      if(ink&&first<0)first=x;
      if(ink)last=x;
      if(first>=0&&x-last>=2)break;
    }
    const w=last-first+1;
    if(first<0||w<6||w>bottom-top+1)return false;
    const strokes=[];
    for(let y=top;y<=bottom;y++){
      let ink=0;for(let x=first;x<=last;x++)if(dark(x,y))ink++;
      if(!ink)continue;
      const prev=strokes.at(-1);
      if(prev&&y===prev.end+1){prev.end=y;prev.max=Math.max(prev.max,ink);prev.min=Math.min(prev.min,ink);}
      else strokes.push({start:y,end:y,min:ink,max:ink});
    }
    if(strokes.length!==2)return false;
    const [cross,bar]=strokes;
    return cross.end-cross.start>=4&&cross.min<w*.52&&cross.max>=w*.7
      &&bar.max>=w*.7&&bar.end-bar.start<=(cross.end-cross.start)*.65;
  });
}
function cleanedCellReading(value){
  return value.trim().replace(/^```\w*\s*|```\s*$/g,'').trim().replace(/\s+/g,' ');
}
function localBoundaryX(image,x,y0,y1){
  const {width:w,height:h,data}=image;let best=x,score=0;
  for(let xx=Math.max(0,Math.round(x)-8);xx<=Math.min(w-1,Math.round(x)+8);xx++){let n=0,total=0;for(let y=Math.max(0,Math.ceil(y0+2));y<Math.min(h,Math.floor(y1-2));y++){total++;const k=(y*w+xx)*4;if(data[k]+data[k+1]+data[k+2]<660)n++;}const s=n/Math.max(1,total);if(s>score||s===score&&Math.abs(xx-x)<Math.abs(best-x)){score=s;best=xx;}}
  return score>.7?best:x;
}
function tableCaption(text){
  const match=String(text).match(/((?:п\s*р\s*о\s*д\s*о\s*л\s*ж\s*е\s*н\s*и\s*е|о\s*к\s*о\s*н\s*ч\s*а\s*н\s*и\s*е)\s*)?т\s*а\s*б\s*л(?:\s*и\s*ц\s*[аы]|\.)\s*(?:№\s*)?(\d+(?:\s*\.\s*\d+)*)/i);
  return match?{id:match[2].replace(/\s/g,''),continued:Boolean(match[1])}:null;
}
async function recognizeCellTable(canvas,ctx,pageIndex){
  const aligned=deskewCanvas(canvas);
  try{return await recognizeAlignedTable(aligned,ctx,pageIndex);}finally{if(aligned!==canvas)aligned.width=aligned.height=1;}
}
async function recognizeAlignedTable(canvas,ctx,pageIndex){
  ctx.status('Поиск сетки таблицы…');
  const image=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height),grid=lineGrid(image);
  if(!grid||grid.columns.length<4)return null;
  const worker=await getOcr(ctx.lang||'rus+eng');await worker.setParameters({tessedit_pageseg_mode:'3'});
  const whole=await worker.recognize(canvas),words=whole.data.words||[],candidates=[];
  for(const word of words){const b=word.bbox;if(b&&/^[−+-]?\d+(?:[.,]\d+)?[*%]?$/.test(word.text)&&b.x0>=grid.left&&b.x1<=grid.right&&b.y0>grid.top&&b.y1<grid.bottom)candidates.push({y:(b.y0+b.y1)/2,x:(b.x0+b.x1)/2,h:b.y1-b.y0});}
  const height=candidates.length?candidates.map(v=>v.h).sort((a,b)=>a-b)[Math.floor(candidates.length/2)]:10;
  const bands=clusterPositions(candidates.map(v=>v.y),Math.max(3,height*.5)).filter(y=>new Set(candidates.filter(v=>Math.abs(v.y-y)<height*.6).map(v=>grid.columns.findIndex(x=>x>v.x))).size>=Math.max(3,(grid.columns.length-1)*.35));
  const first=grid.fullLines.find(y=>y>grid.top+height*2&&(!bands.length||y<bands[0]-height*.4))||(bands.length?grid.lines.filter(y=>y<bands[0]-height*.4).at(-1):grid.lines[1])||grid.top;
  let caption=tableCaption(ctx.sourceText)||tableCaption(whole.data.text);
  const top=Math.min(grid.top,grid.headerTop);
  if(!caption&&top>12){
    const captionImage=imageCrop(canvas,Math.max(0,grid.left-30),Math.max(0,top-canvas.height*.09),Math.min(canvas.width,grid.right+30),top-1,2);
    try{
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      caption=tableCaption((await worker.recognize(captionImage)).data.text);
    }finally{
      captionImage.width=captionImage.height=1;
      await worker.setParameters({tessedit_pageseg_mode:'3'});
    }
  }
  const narrow=grid.columns.length<=6;
  const dividers=narrow?clusterPositions(grid.horizontal
    .filter(([left,y,right])=>y>first+5&&y<grid.bottom-5&&left<=grid.columns[1]+6&&right>=grid.right-6)
    .map(line=>line[1]),4):[];
  const ruledEdges=dividers.length>=2?[first,...dividers,grid.bottom]:null;
  const body=ruledEdges?ruledEdges.slice(1).map((edge,i)=>(ruledEdges[i]+edge)/2):pixelRows(canvas,grid,first,height);
  if(body.length<2||body.length*(grid.columns.length-1)>1400){
    if(caption)ctx.pageIssue='Не удалось восстановить ячейки таблицы '+caption.id;
    return null;
  }
  const matrix=bodyCells(image,grid,body,first,height,words,ruledEdges);
  const headerGrid=caption?.continued?{...grid,headerTop:grid.top}:grid;
  const headers=headerCells(image,headerGrid,first,caption?.continued?(grid.right-grid.left)*.075:18);
  ctx.tableStats={rows:body.length,columns:grid.columns.length-1,headerRows:headers.rows.length-1,headers:headers.cells};
  const crop=imageCrop(canvas,grid.left,Math.min(grid.top,grid.headerTop),grid.right,grid.bottom),name='img/p'+String(pageIndex).padStart(3,'0')+'_tabl_1.jpg';
  ctx.assets??={};ctx.assets[name]=await canvasBlob(crop);crop.width=crop.height=1;
  const id=caption?.id||'[?номер не распознан]';
  if(caption)ctx.tableStats.caption=caption;
  else ctx.pageIssue='Не определён номер таблицы';
  const positionedTokens=ctx.positionedTokens?.(canvas)||[];
  const tokensInCell=box=>positionedTokens.filter(word=>word.x>box[0]+3&&word.x<box[2]-3&&word.y>box[1]+2&&word.y<box[3]-2);
  const render=async box=>ctx.renderTablePatch?ctx.renderTablePatch(canvas,box):{canvas:imageCrop(canvas,...box,2),scale:2};
  const numeric=/^[±−+-]?\s*\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/;
  const same=s=>String(s||'').replace(/\s/g,'').replace(/,/g,'.');
  const read=async(patch,header=false,body=false)=>{
    const tight=trimCell(patch);if(!tight)return {text:'',confidence:100,empty:true};
    try{
      await worker.setParameters({tessedit_pageseg_mode:header?'6':'7',preserve_interword_spaces:'1',user_defined_dpi:'400'});
      let result=(await worker.recognize(tight)).data,variants=[],turnChosen=0;variants.push({text:result.text.trim(),confidence:result.confidence});
      if(header&&tight.height>tight.width*1.3){for(const sign of [-1,1]){const turn=document.createElement('canvas');turn.width=tight.height;turn.height=tight.width;const c=turn.getContext('2d');c.translate(turn.width/2,turn.height/2);c.rotate(sign*Math.PI/2);c.drawImage(tight,-tight.width/2,-tight.height/2);try{const r=(await worker.recognize(turn)).data;variants.push({text:r.text.trim(),confidence:r.confidence});if(r.confidence>result.confidence){result=r;turnChosen=sign;}}finally{turn.width=turn.height=1;}}}
      if(!header&&(result.confidence<85||!/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/.test(result.text.trim()))){
        await worker.setParameters({tessedit_pageseg_mode:'8'});const r=(await worker.recognize(tight)).data;variants.push({text:r.text.trim(),confidence:r.confidence});if(!/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/.test(result.text.trim())&&/\d/.test(r.text))result=r;
      }
      const text=body&&header&&!ctx.math&&!turnChosen?restoreWordDecimals(tight,result):result.text;
      return {text:text.trim().replace(/\s+/g,' '),confidence:result.confidence,variants,turn:turnChosen,empty:false};
    }finally{tight.width=tight.height=1;}
  };
  const readSingleHeader=async patch=>{
    const center=imageCrop(patch,patch.width*.15,patch.height*.1,patch.width*.85,patch.height*.9);
    const tight=trimCell(center);center.width=center.height=1;
    if(!tight)return null;
    try{
      const width=tight.width-24,height=tight.height-24;
      if(height<8||height>55||width>height*1.25)return null;
      await worker.setParameters({tessedit_pageseg_mode:'10',tessedit_char_whitelist:'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',user_defined_dpi:'400'});
      const readings=[];
      for(const [slant,threshold] of [[0,500],[0,345],[0,625],[.25,500]]){
        const glyph=binaryGlyph(tight,slant,threshold);
        try{
          const reading=(await worker.recognize(glyph)).data;
          readings.push({text:reading.text.trim(),confidence:reading.confidence});
        }finally{glyph.width=glyph.height=1;}
      }
      return readings;
    }finally{
      tight.width=tight.height=1;
      await worker.setParameters({tessedit_char_whitelist:''});
    }
  };
  const retryNumber=async(patch,expected)=>{
    const tight=trimCell(patch);
    if(!tight)return [];
    try{
      const readings=[];
      const glyph=binaryGlyph(tight,0);
      try{
        await worker.setParameters({tessedit_pageseg_mode:expected.length===1?'10':'13',tessedit_char_whitelist:'0123456789±−+.,/-'});
        for(const image of [tight,glyph]){
          const result=(await worker.recognize(image)).data;
          readings.push({text:result.text.trim(),confidence:result.confidence});
        }
      }finally{glyph.width=glyph.height=1;}
      return readings;
    }finally{
      tight.width=tight.height=1;
      await worker.setParameters({tessedit_char_whitelist:''});
    }
  };
  try{
    const headerRetries=[];
    for(let n=0;n<headers.cells.length;n++){
      await waitResume(ctx);const cell=headers.cells[n];ctx.status('Шапка: ячейка '+(n+1)+'/'+headers.cells.length);
      const box=[localBoundaryX(image,cell.bbox[0],cell.bbox[1],cell.bbox[3])+3,cell.bbox[1]+3,localBoundaryX(image,cell.bbox[2],cell.bbox[1],cell.bbox[3])-3,cell.bbox[3]-3];
      if(box[2]<=box[0]||box[3]<=box[1])continue;
      const patch=await render(box);
      try{
        Object.assign(cell,await read(patch.canvas,true));
        if(!ctx.math&&!cell.empty&&(!/[\p{L}\d]/u.test(cell.text)||cell.text.length<2&&cell.confidence<70)){
          headerRetries.push({cell,box});
        }
      }finally{patch.canvas.width=patch.canvas.height=1;}
    }
    if(headerRetries.length){
      const lang=ctx.lang||'rus+eng',latin=lang==='rus+eng';
      if(latin)await worker.reinitialize('eng',1);
      try{
        for(const {cell,box} of headerRetries){
          await waitResume(ctx);
          const patch=await render(box);
          let readings;
          try{readings=await readSingleHeader(patch.canvas);}finally{patch.canvas.width=patch.canvas.height=1;}
          if(readings){
            cell.variants.push(...readings);
            const layer=tokensInCell(cell.bbox);
            const reading=readings.filter(candidate=>/^[a-z]$/.test(candidate.text)&&candidate.confidence>=45&&
              (candidate.confidence>=88||layer.length===1&&layer[0].text===candidate.text||
                readings.filter(other=>other.text===candidate.text).length>=2||
                /^[|~]$/.test(cell.text)&&readings.every(other=>!other.text||other.text===candidate.text)))
              .sort((a,b)=>b.confidence-a.confidence)[0];
            if(reading){
              cell.text=reading.text;cell.confidence=reading.confidence;cell.turn=0;
            }
          }
        }
      }finally{if(latin)await worker.reinitialize(lang,1);}
    }
    for(let r=0;r<matrix.length;r++){
      await waitResume(ctx);const roots=matrix[r].filter(c=>!c.skip),box=[grid.left,Math.min(...roots.map(c=>c.bbox[1])),grid.right,Math.max(...roots.map(c=>c.bbox[3]))];if(!roots.length)continue;
      const strip=await render(box);
      try{for(const cell of roots){
        ctx.status('Таблица: строка '+(r+1)+'/'+body.length+', ячейка '+(cell.c+1)+'/'+(grid.columns.length-1));
        const b=cell.bbox,k=strip.scale,l=localBoundaryX(image,b[0],b[1],b[3]),right=localBoundaryX(image,b[2],b[1],b[3]),patch=imageCrop(strip.canvas,(l-box[0]+3)*k,(b[1]-box[1]+2)*k,(right-box[0]-3)*k,(b[3]-box[1]-2)*k);
        cell.alt=words.filter(w=>w.bbox&&(w.bbox.x0+w.bbox.x1)/2>b[0]&&(w.bbox.x0+w.bbox.x1)/2<b[2]&&(w.bbox.y0+w.bbox.y1)/2>b[1]&&(w.bbox.y0+w.bbox.y1)/2<b[3]).map(w=>w.text).join(' ');
        try{
          Object.assign(cell,cell.empty?{text:'',confidence:100,empty:true}:await read(patch,cell.multiline,true));
          const positioned=tokensInCell(b);
          const values=positioned.map(item=>item.text);
          const alt=cell.alt.replace(/^[|\s]+|[|\s]+$/g,'');
          const layer=values.length===1&&numeric.test(values[0])?values[0]:'';
          if(!ctx.math&&!cell.empty&&clearCellRules(patch)){
            const clean=await read(patch,cell.multiline,true);
            const originalDigits=same(cell.text).replace(/[.,]/g,'');
            const agreesWithLayer=layer&&originalDigits===same(layer).replace(/[.,]/g,'');
            const removedRule=!agreesWithLayer&&/^[1|]\s*/.test(cell.text)&&same(cell.text.replace(/^[1|]\s*/,''))===same(clean.text);
            const variants=[...cell.variants,...clean.variants];
            if(numeric.test(clean.text)&&(removedRule||[alt,layer].some(other=>other&&same(clean.text)===same(other)&&same(cell.text)!==same(other))||!numeric.test(cell.text)&&clean.confidence>=65)){
              cell.withGrid=cell.text;Object.assign(cell,clean);
            }
            cell.variants=variants;
          }
          if(/^\d{2,}$/.test(cell.text)){
            const candidates=new Set([...values,cell.alt.replace(/[|\s]/g,'')]
              .filter(value=>/^\d+[.,]\d+$/.test(value)&&value.replace(/[.,]/,'')===cell.text));
            if(candidates.size===1){
              const decimal=candidates.values().next().value;
              if(decimalInk(patch,decimal)){
                cell.beforeSeparator=cell.text;
                cell.text=decimal;
                cell.separatorVerified=true;
              }
            }
          }
          if(ctx.math&&!cell.multiline&&!cell.separatorVerified&&/^\d+[.,]\d+$/.test(layer)&&/^\d+[.,]\d+$/.test(cell.text)){
            const text=same(cell.text),source=same(layer);
            const oneDigitDiff=text.length===source.length&&text.indexOf('.')===source.indexOf('.')&&
              Array.from(text,(char,i)=>char!==source[i]).filter(Boolean).length===1;
            if(oneDigitDiff){
              const readings=await retryNumber(patch,layer);
              cell.variants.push(...readings);
              if(readings.length===2&&readings.every(reading=>reading.confidence>=75&&same(reading.text)===source)){
                cell.firstReading=cell.text;cell.text=layer;cell.numberVerified=true;
              }
            }
          }
          const dash=/^[-–—−]$/;
          const cpuDash=dash.test(cell.text),altDash=cell.alt.replace(/[|\s]/g,'');
          if(cpuDash||(!/\d/.test(cell.text)&&(dash.test(altDash)||!cell.text))){
            if(cpuDash||printedDash(patch)){
              cell.dash=true;cell.text=cpuDash?cell.text:dash.test(altDash)?altDash:'—';cell.empty=false;
            }
          }
          if(!ctx.math&&!cell.empty&&!cell.dash&&!cell.separatorVerified){
            if(layer&&same(layer)!==same(cell.text))cell.positioned=layer;
            const profile=values.length===1?values[0].match(/^(\d+)([Бб])([\dЗзОо]+)$/):null;
            const profileEnd=profile?.[3].replace(/[Зз]/g,'3').replace(/[Оо]/g,'0');
            if(profile&&new RegExp('^'+profile[1]+'(?:[56Бб]|56)'+profileEnd+'$').test(same(cell.text))){
              cell.firstReading=cell.text;cell.text=profile[1]+profile[2]+profileEnd;cell.cellAgreement='Б / 5 / 6';
            }else if(layer&&numeric.test(alt)&&same(layer)===same(alt)&&same(cell.text)!==same(layer)){
              cell.firstReading=cell.text;cell.text=layer;cell.cellAgreement='PDF + OCR страницы';
            }else if(/^[±−+-]?\s*\d+(?:[.,]\d+)?$/.test(layer)&&same(layer)!==same(cell.text)&&!cell.multiline){
              const matches=readings=>readings.some(reading=>reading.confidence>=52&&
                [reading.text,reading.text.replace(/^\s*(?:\|\s*|1\s+)|\s+(?:\||[-–—])\s*$/g,'')].some(value=>same(value)===same(layer)));
              let numberRetry=[];
              if(!matches(cell.variants)){
                const mid=(positioned[0].y-b[1]-2)*k;
                const focused=b[3]-b[1]>height*2.1?imageCrop(patch,0,Math.max(0,mid-height*k),patch.width,Math.min(patch.height,mid+height*k)):patch;
                try{numberRetry=await retryNumber(focused,layer);}finally{if(focused!==patch)focused.width=focused.height=1;}
                if(!matches(numberRetry)&&same(cell.text)==='1'+same(layer)){
                  const edge=edgeStroke(patch);
                  if(edge){
                    const inner=imageCrop(patch,edge.right+1,0,patch.width,patch.height);
                    try{numberRetry.push(...await retryNumber(inner,layer));}finally{inner.width=inner.height=1;}
                  }
                }
              }
              cell.variants.push(...numberRetry);
              if(matches(cell.variants)){
                cell.firstReading=cell.text;cell.text=layer;cell.cellAgreement='PDF + повторное OCR';
              }
            }
            if(/^\d{2,}$/.test(cell.text)&&!cell.multiline){
              const position=decimalPosition(cellInk(patch),cell.text.length);
              if(position>0){cell.firstReading=cell.text;cell.text=cell.text.slice(0,position)+','+cell.text.slice(position);}
              else if(/^\d+[.,]\d+$/.test(layer)&&layer.replace(/[.,]/,'')===cell.text&&cell.variants.some(reading=>{
                const number=reading.text.trim().match(/^\d+[.,]\d+(?=\s|$)/);
                return number&&reading.confidence>=52&&same(number[0])===same(layer);
              })){
                cell.firstReading=cell.text;cell.text=layer;cell.cellAgreement='PDF + разделитель в OCR вырезки';
              }
            }
            const numbers=cell.text.trim().match(/[+±]\s*\d+(?:[.,]\d+)?/g)||[];
            if(numbers.length&&same(numbers.join(''))===same(cell.text)){
              const signs=plusMinusLines(patch);
              if(signs.length===numbers.length&&signs.includes(true)){
                cell.beforeSigns=cell.text;
                cell.text=numbers.map((number,i)=>signs[i]?number.replace(/^\+/,'±'):number).join(' ');
              }
            }
            cell.text=cell.text.replace(/(^|\s)[–—](?=\s*\d)/g,'$1−');
          }
        }finally{patch.width=patch.height=1;}
      }}finally{strip.canvas.width=strip.canvas.height=1;}
    }
  }finally{await worker.setParameters({tessedit_pageseg_mode:'3'});}
  const remainder=imageCrop(canvas,0,0,canvas.width,canvas.height),rc=remainder.getContext('2d');rc.fillStyle='#fff';rc.fillRect(grid.left,Math.min(grid.top,grid.headerTop),grid.right-grid.left,grid.bottom-Math.min(grid.top,grid.headerTop));
  let prose;try{prose=(await worker.recognize(remainder)).data.text||'';}finally{remainder.width=remainder.height=1;}
  // Finish CPU work before starting the GPU phase: the browser keeps only the
  // one model needed for the current phase rather than both resident engines.
  if(ctx.math){for(let n=0;n<headers.cells.length;n++){
    await waitResume(ctx);const cell=headers.cells[n];if(cell.empty||cell.confidence==null)continue;
    ctx.status('Нейросеть: шапка '+(n+1)+'/'+headers.cells.length);
    const b=cell.bbox,box=[localBoundaryX(image,b[0],b[1],b[3])+3,b[1]+3,localBoundaryX(image,b[2],b[1],b[3])-3,b[3]-3],patch=await render(box);let input=patch.canvas;
    try{
      if(cell.turn){input=document.createElement('canvas');input.width=patch.canvas.height;input.height=patch.canvas.width;const c=input.getContext('2d');c.translate(input.width/2,input.height/2);c.rotate(cell.turn*Math.PI/2);c.drawImage(patch.canvas,-patch.canvas.width/2,-patch.canvas.height/2);}
      if(Math.max(input.width,input.height)>100*Math.min(input.width,input.height))continue;
      const task=ctx.task,limit=ctx.maxTokens;ctx.task='Text Recognition:';ctx.maxTokens=384;
      let text;
      try{
        text=await glmRecognize(input,ctx);
        const compact=cleanedCellReading(text).replace(/[$\s]/g,'');
        if(!compact){
          const source=patch.canvas;
          const center=imageCrop(source,source.width*.15,source.height*.1,source.width*.85,source.height*.9);
          const tight=trimCell(center);
          center.width=center.height=1;
          if(tight)try{
            ctx.maxTokens=64;
            cell.neuralTight=await glmRecognize(tight,ctx);
            if(!cleanedCellReading(cell.neuralTight).replace(/[$\s]/g,'')){
              ctx.task='Formula Recognition:';
              cell.neuralTight=await glmRecognize(tight,ctx);
            }
            if(cleanedCellReading(cell.neuralTight).replace(/[$\s]/g,''))text=cell.neuralTight;
          }finally{tight.width=tight.height=1;}
        }else if(compact.length<8&&!/[A-Za-zА-Яа-яЁё]/.test(compact)){
          ctx.task='Formula Recognition:';ctx.maxTokens=64;
          const math=await glmRecognize(input,ctx);
          cell.neuralMath=math;
          if(cleanedCellReading(math).replace(/[$\s]/g,'')&&!/Генерация остановлена/.test(math))text=math.trim().replace(/^\$\$?|\$\$?$/g,'');
        }
      }finally{ctx.task=task;ctx.maxTokens=limit;}
      cell.tesseract=cell.text;cell.neural=text;
      const cleaned=cleanedCellReading(text);
      const reading=cleaned.replace(/[$\s]/g,'')?cleaned:'';
      if(reading&&!/Генерация остановлена/.test(text)&&text.length<1500&&!(cell.confidence>=90&&/[А-Яа-яЁё]{4,}/.test(cell.tesseract)&&!/[|]/.test(cell.tesseract))){cell.text=reading;cell.engine='GLM';}
      else if(!reading&&!/[A-Za-zА-Яа-яЁё\d]/.test(cell.text)){cell.text='';}
    }finally{if(input!==patch.canvas)input.width=input.height=1;patch.canvas.width=patch.canvas.height=1;}
  }
    const number=/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/;
    const review=matrix.flat().filter(cell=>!cell.skip&&!cell.empty&&!cell.dash&&!cell.separatorVerified&&!cell.numberVerified&&(cell.c===0||cell.span>1||cell.confidence<88||!number.test(cell.text)||number.test(cell.alt)&&same(cell.text)!==same(cell.alt)));
    ctx.tableStats.reviewedCells=review.length;
    for(let n=0;n<review.length;n++){
      await waitResume(ctx);const cell=review[n],b=cell.bbox,box=[localBoundaryX(image,b[0],b[1],b[3])+3,b[1]+2,localBoundaryX(image,b[2],b[1],b[3])-3,b[3]-2];
      if(box[2]<=box[0]||box[3]<=box[1])continue;
      const patch=await render(box);
      if(Math.max(patch.canvas.width,patch.canvas.height)>100*Math.min(patch.canvas.width,patch.canvas.height)){patch.canvas.width=patch.canvas.height=1;continue;}
      ctx.status('Нейросеть: проверка ячейки '+(n+1)+'/'+review.length);const task=ctx.task,limit=ctx.maxTokens;ctx.task='Text Recognition:';ctx.maxTokens=128;
      try{
        const text=await glmRecognize(patch.canvas,ctx);cell.tesseract=cell.text;cell.neural=text;
        if(!text.trim()||/Генерация остановлена/.test(text)||text.length>=400)continue;
        const clean=value=>value.replace(/^```\w*\s*|```\s*$/g,'').trim().replace(/^\$\$?|\$\$?$/g,'').trim().replace(/\s+/g,' ');
        cell.text=clean(text);cell.engine='GLM';
        const ambiguous=cell.text.match(/^(\d+)[eE](\d+)$/);
        if(ambiguous&&same(cell.tesseract)!==same(cell.text)){
          const tight=trimCell(patch.canvas);
          if(tight)try{
            cell.neuralTight=clean(await glmRecognize(tight,ctx));
            const candidate=cell.neuralTight.match(/^(\d+)[А-Яа-яЁё](\d+)$/);
            if(candidate&&candidate[1]===ambiguous[1]&&candidate[2]===ambiguous[2])cell.text=cell.neuralTight;
          }finally{tight.width=tight.height=1;}
          if(cell.text===clean(text)){
            const inCell=tokensInCell(b).filter(word=>/^\d+[А-Яа-яЁё]\d+$/.test(word.text));
            if(inCell.length===1){
              const candidate=inCell[0].text.match(/^(\d+)[А-Яа-яЁё](\d+)$/);
              if(candidate&&candidate[1]===ambiguous[1]&&candidate[2]===ambiguous[2]){
                cell.sourceLayer=inCell[0].text;
                cell.text=cell.sourceLayer;
                cell.engine='GLM + PDF';
              }
            }
          }
        }
      }finally{ctx.task=task;ctx.maxTokens=limit;patch.canvas.width=patch.canvas.height=1;}
    }
  }
  let out='Таблица '+id+'\n\n'+(caption?.continued?'Продолжение таблицы '+id+'\n\n':'')+'![Таблица]('+name+')\n\n<table><thead>';
  for(let r=0;r<headers.rows.length-1;r++){out+='<tr>';for(const cell of headers.cells.filter(c=>c.r===r).sort((a,b)=>a.c-b.c))out+='<th'+(cell.span>1?' rowspan="'+cell.span+'"':'')+(cell.colspan>1?' colspan="'+cell.colspan+'"':'')+'>'+htmlEscape(cell.text?'[?'+cell.text+']':cell.empty?'':'[?непрочитанная шапка]')+'</th>';out+='</tr>';}
  out+='</thead><tbody>';
  for(const row of matrix){out+='<tr>';for(const cell of row){if(cell.skip)continue;out+='<td'+(cell.span>1?' rowspan="'+cell.span+'"':'')+'>'+htmlEscape(cell.empty?'':cell.text?'[?'+cell.text+']':'[?непрочитанная ячейка]')+'</td>';}out+='</tr>';}
  ctx.tableStats.cells=matrix;
  return out+'</tbody></table>\n\n<!-- таблица '+id+': строк '+body.length+', столбцов '+(grid.columns.length-1)+' -->\n\n[?Границы и объединения ячеек требуют сверки по вырезке]\n\n'+prose;
}
