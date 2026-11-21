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
function lineGrid(image,captionHasNotes=false,closedCaption=false,appendix=false){
  const {width:w,height:h,data}=image;const xs=[],ys=[];const horizontal=[],vertical=[];
  const dark=(x,y)=>{const k=(y*w+x)*4;return data[k]+data[k+1]+data[k+2]<660&&data[k+3]>100;};
  const dh=(x,y)=>dark(x,y)||y>1&&dark(x,y-2)||y<h-2&&dark(x,y+2);
  const dv=(x,y)=>dark(x,y)||x>1&&dark(x-2,y)||x<w-2&&dark(x+2,y);
  const minH=Math.max(70,w*.12),minV=closedCaption?24:Math.max(60,h*.08);
  for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){if(x<w&&dh(x,y)){if(start<0)start=x;}else if(start>=0){if(x-start>=minH){ys.push(y);horizontal.push([start,y,x]);}start=-1;}}}
  for(let x=0;x<w;x++){let start=-1;for(let y=0;y<=h;y++){if(y<h&&dv(x,y)){if(start<0)start=y;}else if(start>=0){if(y-start>=minV){xs.push(x);vertical.push([x,start,y]);}start=-1;}}}
  const longest=Math.max(0,...horizontal.map(r=>r[2]-r[0]));const major=horizontal.filter(r=>r[2]-r[0]>longest*.7);
  if(!major.length)return null;
  const tableTop=Math.min(...major.map(r=>r[1]));
  if(closedCaption)return closedCaptionGrid(image,major,horizontal,vertical,tableTop,appendix);
  if(captionHasNotes){
    const ruled=ruledGridAboveNotes(major,vertical,tableTop);
    if(ruled)return ruled;
  }
  // Follow repeated full-width rules through scan gaps in individual verticals.
  const outline=major.find(rule=>rule[1]===tableTop);
  const alignedRules=major.filter(([x,,end])=>Math.abs(x-outline[0])<10&&Math.abs(end-outline[2])<10);
  const edges=clusterPositions(alignedRules.map(rule=>rule[1]),4);
  if(edges.length>=7){
    const gaps=edges.slice(1).map((edge,i)=>edge-edges[i]);
    const pitch=gaps.slice().sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
    const regular=gaps.filter(gap=>Math.abs(gap-pitch)<=pitch*.12);
    const left=outline[0],right=outline[2],bottom=edges.at(-1);
    if(regular.length>=gaps.length*.7&&pitch>10){
      const inner=vertical.filter(([x,start,end])=>x>left+8&&x<right-8&&start<bottom&&
        end>edges[2]&&edges.filter(y=>start-4<=y&&end+4>=y).length>=3);
      const columns=[left,...clusterPositions(inner.map(rule=>rule[0]),5),right];
      if(columns.length>=9&&columns.every((x,i)=>!i||x-columns[i-1]>10)){
        return {columns,lines:edges,horizontal,vertical,fullLines:edges,headerTop:tableTop,
          headerStart:tableTop,top:tableTop,bottom,left,right,regularEdges:edges};
      }
    }
  }
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
function closedCaptionGrid(image,major,horizontal,vertical,top,appendix){
  const outline=major.filter(([,y])=>y<=top+5).sort((a,b)=>(b[2]-b[0])-(a[2]-a[0]))[0];
  const [left,,right]=outline,width=right-left;
  const candidates=clusterPositions(horizontal.filter(([x,y,end])=>y>=top&&x<right&&end>left&&end-x>width*.15)
    .map(([,y])=>y),5);
  const full=candidates.filter(y=>ruleCoverage(image,left,y,right-1,y)&&
    ruleCoverage(image,left+4,y,left+width*.12,y)&&ruleCoverage(image,right-width*.12,y,right-5,y));
  const bottom=full.slice(2).filter(y=>ruleCoverage(image,left,top,left,y)&&ruleCoverage(image,right-1,top,right-1,y)).at(-1);
  if(!bottom)return null;
  const edges=full.filter(y=>y<=bottom);
  const joints=vertical.filter(([x,start,end])=>x>left+9&&x<right-9&&
    edges.filter(y=>y>=start-5&&y<=end+5).length>=2);
  const columns=[left,...clusterPositions(joints.map(([x])=>x),5),right];
  if(columns.length<3||columns.some((x,i)=>i&&x-columns[i-1]<10))return null;
  const first=edges[1];
  const partial=appendix?candidates.filter(y=>y>first+6&&y<bottom-6&&columns.slice(1).filter((x,i)=>
    ruleCoverage(image,columns[i]+4,y,x-4,y)).length>=2):[];
  const bodyEdges=clusterPositions([...edges.slice(1),...partial],5);
  return {closed:true,columns,lines:edges,fullLines:edges,horizontal,vertical,headerTop:top,top,bottom,left,right,bodyEdges};
}
function ruledGridAboveNotes(horizontal,vertical,top){
  const tolerance=5;
  const outline=horizontal.filter(([,y])=>y<=top+tolerance).sort((a,b)=>(b[2]-b[0])-(a[2]-a[0]))[0];
  const [left,,right]=outline;
  const width=right-left;
  const full=clusterPositions(horizontal.filter(([x,,end])=>x<left+width*.04&&end>right-width*.04)
    .map(([,y])=>y),tolerance);
  if(full.length<4)return null;
  const bottom=full.at(-1),lastRowsStart=full.at(-3);
  const through=vertical.filter(([x,start,end])=>x>left+2*tolerance&&x<right-2*tolerance&&
    start<=lastRowsStart+tolerance&&end>=bottom-tolerance);
  const columns=[left,...clusterPositions(through.map(([x])=>x),tolerance),right];
  if(columns.length<4||columns.some((x,i)=>i&&x-columns[i-1]<2*tolerance))return null;
  const starts=columns.slice(1,-1).map(x=>Math.min(...through.filter(rule=>Math.abs(rule[0]-x)<=tolerance).map(rule=>rule[1])));
  const levels=clusterPositions(starts.filter(y=>y>top+2*tolerance),tolerance);
  const deepest=levels.filter(y=>starts.filter(start=>Math.abs(start-y)<=tolerance).length>=2).at(-1);
  if(deepest==null)return null;
  const bodyEdges=full.filter(y=>y>=deepest-tolerance);
  if(bodyEdges.length<3)return null;
  return {columns,lines:full,fullLines:full,horizontal,vertical,headerTop:top,top,bottom,left,right,bodyEdges};
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
function isDiagramCrop(image){
  const {width,height,data}=image;
  let longHorizontal=0,longVertical=0;
  for(let y=8;y<height-8;y+=2){
    let run=0;
    for(let x=8;x<width-8;x++){
      run=data[(y*width+x)*4]<150?run+1:0;
      if(run>width*.22){longHorizontal++;break;}
    }
  }
  for(let x=8;x<width-8;x+=2){
    let run=0;
    for(let y=8;y<height-8;y++){
      run=data[(y*width+x)*4]<150?run+1:0;
      if(run>height*.2){longVertical++;break;}
    }
  }
  return longHorizontal>=2&&longVertical>=2;
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
function sparseBodyCells(image,grid,first,height,positioned,denseRows){
  const columns=grid.columns;
  if(columns.length<10)return null;
  const inBody=positioned.filter(t=>t.y>first+height*.45&&t.y<grid.bottom-height*.4);
  const lines=positionedLines(inBody.filter(t=>t.x>grid.left+2&&t.x<columns[1]-3));
  const labelBands=regionLines(image,[grid.left,first,columns[1],grid.bottom],height*.65);
  const hasLabelInk=y=>labelBands.some(band=>band[0]<=y+height*.5&&band.at(-1)>=y-height*.5);
  const labels=lines.filter(line=>hasLabelInk(line.y));
  const families=new Map();
  for(const line of labels){
    const title=line.tokens.map(token=>token.text).join('').replace(/\s/g,'');
    const family=title.match(/^(\p{L})\d{2,5}$/u)?.[1]?.toUpperCase();
    if(family)families.set(family,(families.get(family)||0)+1);
  }
  if(Math.max(0,...families.values())<4)return null;
  const values=inBody.flatMap(t=>{
    if(t.x<=columns[1]+2||t.x>=grid.right-2||!/^(?:[−+–—-]?\d+(?:[.,]\d+)?|[−–—-])$/.test(t.text))return [];
    const right=columns.findIndex(x=>x>t.x);
    return regionLines(image,[columns[right-1],t.y-height,columns[right],t.y+height],height*.6).length?[t.y]:[];
  });
  const rows=[];
  for(const line of labels){
    const data=values.some(y=>Math.abs(y-line.y)<height*.63);
    const previous=rows.at(-1);
    if(!data&&previous?.section){previous.last=line.y;continue;}
    rows.push({first:line.y,last:line.y,section:!data});
  }
  if(rows.filter(row=>!row.section).length<denseRows+3)return null;
  const edges=[first,...rows.slice(1).map((row,i)=>{
    const before=rows[i].last,mid=(before+row.first)/2;
    return (grid.lines||[]).filter(y=>y>before+height*.55&&y<row.first-height*.55)
      .reduce((best,y)=>best===null||Math.abs(y-mid)<Math.abs(best-mid)?y:best,null)??mid;
  }),grid.bottom];
  return {
    centers:rows.map(row=>(row.first+row.last)/2),
    sections:rows.map(row=>row.section),
    matrix:rows.map((row,r)=>columns.slice(1).map((right,c)=>({
      r,c,span:1,colspan:row.section&&!c?columns.length-1:1,
      bbox:[columns[c],edges[r],right,edges[r+1]],skip:row.section&&c>0,
      multiline:row.section||!c
    })))
  };
}
function mergeBodyColumns(matrix,image){
  for(const row of matrix){
    let prior=null;
    for(const cell of row){
      if(cell.skip||cell.span!==1){prior=null;continue;}
      const [x,top,,bottom]=cell.bbox;
      if(prior&&prior.bbox[1]===top&&prior.bbox[3]===bottom&&!ruleCoverage(image,x,top,x,bottom)){
        prior.colspan+=cell.colspan;
        prior.bbox[2]=cell.bbox[2];
        cell.skip=true;
      }else prior=cell;
    }
  }
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
function fractionBar(canvas,letterHeight){
  const {width,height}=canvas,{data}=canvas.getContext('2d').getImageData(0,0,width,height);
  const lines=[];
  for(let y=Math.ceil(height*.24);y<height*.77;y++){
    let start=-1;
    for(let x=0;x<=width;x++){
      const offset=(y*width+x)*4;
      if(x<width&&data[offset]+data[offset+1]+data[offset+2]<570){if(start<0)start=x;continue;}
      if(start>letterHeight&&x<width-letterHeight/2&&x-start>=letterHeight*1.9&&x-start<width*.78){
        const previous=lines.at(-1);
        if(previous&&previous.bottom===y-1&&Math.abs(previous.left-start)<4&&Math.abs(previous.right-x)<4){
          previous.bottom=y;
        }else lines.push({left:start,right:x,top:y,bottom:y});
      }
      start=-1;
    }
  }
  return lines.filter(bar=>bar.bottom-bar.top+1<letterHeight*.23)
    .sort((a,b)=>(b.right-b.left)-(a.right-a.left))[0];
}
function glyphPixels(source){
  const tight=trimCell(source);
  if(!tight)return null;
  const small=document.createElement('canvas');small.width=20;small.height=28;
  const ctx=small.getContext('2d');ctx.drawImage(tight,12,12,tight.width-24,tight.height-24,0,0,20,28);
  const {data}=ctx.getImageData(0,0,20,28);
  tight.width=tight.height=small.width=small.height=1;
  return Array.from({length:560},(_,i)=>data[i*4]/255);
}
let variableTemplates;
function mathVariable(source){
  const ink=glyphPixels(source);
  if(!ink)return '';
  if(!variableTemplates){
    const canvas=document.createElement('canvas');canvas.width=136;canvas.height=124;
    const ctx=canvas.getContext('2d');
    variableTemplates=[];
    for(const font of ['82px "Times New Roman", serif','italic 82px "Times New Roman", serif','82px "Cambria Math", serif','82px Arial, sans-serif']){
      ctx.font=font;
      for(const letter of 'αβγδεζηθικλμνξοπρστυφχψω∂aAbBdDpP68'){
        ctx.fillStyle='#fff';ctx.fillRect(0,0,136,124);
        ctx.fillStyle='#000';ctx.fillText(letter,16,92);
        const pixels=glyphPixels(canvas);
        if(pixels)variableTemplates.push({letter,pixels});
      }
    }
    canvas.width=canvas.height=1;
  }
  const ranked=variableTemplates.map(({letter,pixels})=>({letter,distance:pixels.reduce((sum,value,i)=>sum+Math.abs(value-ink[i]),0)/560}))
    .sort((a,b)=>a.distance-b.distance);
  const best=ranked[0],alternative=ranked.find(candidate=>candidate.letter!==best.letter);
  return best.distance<.235&&alternative?.distance-best.distance>.013?best.letter:'';
}
async function recognizeCellFraction(canvas,letterHeight,worker){
  const bar=fractionBar(canvas,letterHeight);
  if(!bar)return null;
  const y0=Math.max(0,Math.floor(bar.top-letterHeight*1.5));
  const y1=Math.min(canvas.height,Math.ceil(bar.bottom+letterHeight*1.32));
  const numerator=imageCrop(canvas,bar.left-3,y0,bar.right+3,bar.top-1);
  const denominator=imageCrop(canvas,bar.left,bar.bottom+2,bar.right,y1);
  const left=imageCrop(canvas,Math.max(0,bar.left-letterHeight*2.2),bar.top-letterHeight*.65,bar.left-4,bar.bottom+letterHeight*.64);
  const inputs=[numerator,denominator,left];
  const latin='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const recognize=async(patch,mode,characters='')=>{
    const tight=trimCell(patch);
    if(!tight)return '';
    try{
      await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:characters});
      return (await worker.recognize(tight)).data.text.trim();
    }finally{tight.width=tight.height=1;}
  };
  try{
    const sides=cellInk(left);
    if(sides.length!==2)return null;
    const equals=imageCrop(left,sides[1].left-1,sides[1].top-1,sides[1].right+2,sides[1].bottom+2);
    inputs.push(equals);
    if(await recognize(equals,'10','=+-')!=='=')return null;
    const variable=imageCrop(left,sides[0].left-1,sides[0].top-1,sides[0].right+2,sides[0].bottom+2);
    inputs.push(variable);
    const lhs=mathVariable(variable)||await recognize(variable,'10',latin);
    if(!/^\p{L}$/u.test(lhs))return null;
    const den=await recognize(denominator,'7','0123456789');
    if(!/^\d+$/.test(den))return null;
    const symbols=cellInk(numerator);
    if(symbols.length<3||symbols.length>14)return null;
    const tokens=[];
    for(let i=0;i<symbols.length;i++){
      const glyph=symbols[i],prior=symbols[i-1];
      const h=glyph.bottom-glyph.top+1,w=glyph.right-glyph.left+1;
      if(w>h*2.5&&h<letterHeight*.25){tokens.push('−');continue;}
      const isIndex=prior&&/^[A-Za-z]$/.test(tokens.at(-1))&&h<(prior.bottom-prior.top+1)*.85&&
        glyph.bottom>prior.bottom+letterHeight*.08&&glyph.left-prior.right<letterHeight*.5;
      const part=imageCrop(numerator,Math.max(0,glyph.left-1),Math.max(0,glyph.top-1),glyph.right+2,glyph.bottom+2);
      let reading;
      try{
        const characters=isIndex?'0123456789':latin+'0123456789+';
        reading=await recognize(part,'10',characters);
        if(!reading&&!isIndex)reading=mathVariable(part);
        if(!reading)reading=await recognize(part,'13',characters);
      }finally{part.width=part.height=1;}
      if(!/^[A-Za-z\d+]$/.test(reading)||isIndex&&!/^\d$/.test(reading))return null;
      tokens.push(reading);
    }
    const num=tokens.join('').replace(/[−+]/g,sign=>' '+sign+' ');
    if(!/^[A-Za-z\d]+(?: [−+] [A-Za-z\d]+)+$/.test(num))return null;
    const before=imageCrop(canvas,0,0,canvas.width,y0),after=imageCrop(canvas,0,y1,canvas.width,canvas.height);
    inputs.push(before,after);
    const top=await recognize(before,'6'),bottom=await recognize(after,'6');
    const fold=value=>value.replace(/(\p{L})-\s*\n\s*(\p{L})/gu,'$1$2').replace(/\s+/g,' ');
    const box=[Math.max(0,bar.left-letterHeight*2.15),y0,Math.min(canvas.width,bar.right+letterHeight*.24),y1];
    const image=imageCrop(canvas,...box);
    try{return {text:[fold(top),lhs+' = ('+num+') / '+den,fold(bottom)].filter(Boolean).join(' '),image:await canvasBlob(image)};}
    finally{image.width=image.height=1;}
  }finally{
    for(const input of inputs)input.width=input.height=1;
    await worker.setParameters({tessedit_char_whitelist:''});
  }
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
  const match=String(text).match(/((?:п\s*р\s*о\s*д\s*о\s*л\s*ж\s*е\s*н\s*и\s*е|о\s*к\s*о\s*н\s*ч\s*а\s*н\s*и\s*е)\s*)?т\s*а\s*б\s*л(?:\s*и\s*ц\s*[аы]|\.)\s*(?:№\s*)?((?:[A-ZА-ЯЁ]\s*\.\s*)?\d+(?:\s*\.\s*\d+)*)/i);
  return match?{id:match[2].replace(/\s/g,''),continued:Boolean(match[1])}:null;
}
function positionedLines(positioned){
  const groups=[];
  for(const token of positioned.sort((a,b)=>a.y-b.y)){
    const line=groups.at(-1);
    if(line&&Math.abs(line.y-token.y)<=Math.max(3,token.height*.35))line.tokens.push(token);
    else groups.push({y:token.y,tokens:[token]});
  }
  for(const line of groups)line.tokens.sort((a,b)=>a.x-b.x);
  return groups;
}
async function rereadIndexedTableLabel(patch,cell,layer,worker){
  const match=layer.match(/^(?:\d{1,3})?(\p{Lu}{1,3})(\d+(?:[.,]\d+)?)$/u);
  if(!match||cell.text.replace(/[.,]/g,'.')===layer.replace(/[.,]/g,'.'))return;
  const glyphs=/^[А-ЯЁ]+$/.test(match[1])?'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ':'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tight=trimCell(patch);
  if(!tight)return;
  try{
    for(const psm of ['7','8','13']){
      await worker.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:glyphs+'0123456789.,'});
      const {data}=await worker.recognize(tight);
      const reading=data.text.replace(/\s/g,'');
      cell.variants.push({text:reading,confidence:data.confidence});
      if(data.confidence>=60&&reading.replace(',','.')===layer.replace(',','.')){
        cell.firstReading=cell.text;
        cell.text=reading;
        cell.confidence=data.confidence;
        cell.cellAgreement='PDF + OCR вырезки с буквенно-числовым алфавитом';
        return;
      }
    }
  }finally{
    tight.width=tight.height=1;
    await worker.setParameters({tessedit_char_whitelist:''});
  }
}
function isNotesHeading(text){
  return /^примечани[ея](?:$|[\s:.,—–-]|\d)/i.test(text.trim().replace(/^п\s*р\s*и\s*м\s*е\s*ч\s*а\s*н\s*и\s*([ея])/i,'Примечани$1'));
}
function tableCaptionLines(positioned){
  return positionedLines(positioned).flatMap(line=>{
    const title=line.tokens.map(token=>token.text).join(' ');
    const caption=/^\s*[«"^]?\s*(?:(?:Продолжение|Окончание)\s+)?т\s*а\s*б\s*л/i.test(title)&&tableCaption(title);
    return caption?[{caption,top:line.y,height:Math.max(10,...line.tokens.map(token=>token.height))}]:[];
  });
}
function appendixCaption(caption){return /^[A-ZА-ЯЁ]\./iu.test(caption?.id||'');}
async function readAppendixCaptions(canvas,positioned,ctx){
  const found=[];
  for(const line of positionedLines(positioned)){
    const title=line.tokens.map(token=>token.text).join(' ');
    const ambiguous=title.match(/^\s*т\s*а\s*б\s*л\s*и\s*ц\s*а\s+([A-ZА-ЯЁ])\s*\.\s*[ЗзOoОоІIl]\s*$/iu);
    if(!ambiguous)continue;
    const token=line.tokens.at(-1),height=Math.max(10,token.height);
    const right=token.x+token.width/2;
    const suffix=imageCrop(canvas,Math.max(0,right-height*.8),Math.max(0,line.y-height),
      Math.min(canvas.width,right+height*.25),Math.min(canvas.height,line.y+height*.45),3);
    const worker=await getOcr(ctx.lang||'rus+eng');
    try{
      await worker.setParameters({tessedit_pageseg_mode:'10',tessedit_char_whitelist:'0123456789'});
      const {data}=await worker.recognize(suffix),digit=data.text.trim();
      if(/^\d$/.test(digit)&&data.confidence>=55)found.push({caption:{id:ambiguous[1]+'.'+digit,continued:false},top:line.y,height});
      else ctx.pageIssue||='Не удалось прочитать цифру подписи таблицы приложения';
    }finally{
      suffix.width=suffix.height=1;
      await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});
    }
  }
  return found;
}
function amendmentRowGrids(canvas,from,to){
  const w=canvas.width,h=to-from;
  if(h<12)return [];
  const image=canvas.getContext('2d').getImageData(0,from,w,h);
  const dark=(x,y)=>image.data[(y*w+x)*4]<170;
  const rules=[];
  for(let y=2;y<h-2;y++){
    let start=-1;
    for(let x=0;x<=w;x++){
      if(x<w&&(dark(x,y)||dark(x,y-1)||dark(x,y+1))){if(start<0)start=x;}
      else if(start>=0){if(x-start>w*.60)rules.push([start,y,x-1]);start=-1;}
    }
  }
  if(!rules.length)return [];
  const levels=clusterPositions(rules.map(rule=>rule[1]),4);
  const result=[];
  for(let i=1;i<levels.length;i++){
    const top=levels[i-1],bottom=levels[i];
    const outline=rules.filter(r=>Math.abs(r[1]-top)<5).reduce((best,r)=>r[2]-r[0]>best[2]-best[0]?r:best);
    const [left,,right]=outline,xs=[];
    for(let x=left+9;x<right-9;x++){
      let hits=0,n=0;
      for(let y=Math.ceil(top)+3;y<bottom-3;y+=2){
        n++;if(dark(x,y)||dark(x-1,y)||dark(x+1,y))hits++;
      }
      if(n>4&&hits/n>.88)xs.push(x);
    }
    const columns=[left,...clusterPositions(xs,5),right];
    if(columns.length<3)continue;
    result.push({top:from+top,headerTop:from+top,headerStart:from+top,bottom:from+bottom,left,right,columns,
      lines:levels.map(y=>y+from),fullLines:levels.map(y=>y+from),bodyEdges:[top+from,bottom+from],
      horizontal:rules.map(([x,y,end])=>[x,y+from,end]),vertical:[],fragment:true});
  }
  return result;
}
function amendmentDataGrids(image){
  const {width:w,height:h,data}=image,lines=[];
  const dark=(x,y)=>data[(y*w+x)*4]<180;
  for(let y=2;y<h-2;y++){
    let start=-1;
    for(let x=0;x<=w;x++){
      if(x<w&&(dark(x,y-1)||dark(x,y)||dark(x,y+1))){if(start<0)start=x;}
      else if(start>=0){if(x-start>w*.58)lines.push([start,y,x-1]);start=-1;}
    }
  }
  const edges=clusterPositions(lines.map(l=>l[1]),4);
  const grids=[];
  for(let i=1;i<edges.length;i++){
    const top=edges[i-1],bottom=edges[i];
    if(bottom-top<10)continue;
    const outline=lines.filter(l=>Math.abs(l[1]-top)<4).sort((a,b)=>(b[2]-b[0])-(a[2]-a[0]))[0];
    if(!outline)continue;
    const xs=[];
    for(let x=Math.max(2,outline[0]-4);x<=Math.min(w-3,outline[2]+4);x++){
      let darkRows=0,count=0;
      for(let y=Math.ceil(top)+3;y<bottom-3;y+=2){
        count++;if(dark(x,y)||dark(x-1,y)||dark(x+1,y))darkRows++;
      }
      if(count>=4&&darkRows/count>.83)xs.push(x);
    }
    const columns=clusterPositions(xs,4);
    if(columns.length<8||columns[0]>outline[0]+8||columns.at(-1)<outline[2]-8)continue;
    const prior=grids.at(-1);
    if(prior&&prior.bottom===top&&columns.length===prior.columns.length&&columns.every((x,c)=>Math.abs(x-prior.columns[c])<6)){
      prior.bottom=bottom;prior.bodyEdges.push(bottom);
    }else grids.push({fragment:true,left:columns[0],right:columns.at(-1),columns,top,bottom,headerTop:top,
      headerStart:top,bodyEdges:[top,bottom],horizontal:lines,vertical:[],lines:[],fullLines:[]});
  }
  return grids;
}
function closedTablesByCaption(canvas,positioned,extraCaptions=[]){
  const captions=[...tableCaptionLines(positioned),...extraCaptions].sort((a,b)=>a.top-b.top);
  const notes=positionedLines(positioned).filter(line=>{
    const heading=line.tokens.map(token=>token.text).join(' ');
    return isNotesHeading(heading)||/^о\s*б\s*о\s*з\s*н\s*а\s*ч\s*е\s*н\s*и\s*[ея](?:\s|:|$)/iu.test(heading);
  });
  const tables=[];
  const lines=positionedLines(positioned);
  let target=null;
  for(const [i,line] of lines.entries()){
    const title=line.tokens.map(t=>t.text).join(' ');
    const id=title.match(/пункт\s+[\d.]+\s+таблица\s+(\d+(?:\.\d+)*)/iu);
    if(id)target=id[1];
    if(!target||!/строку\s+изложить\s+в\s+новой\s+редакции/iu.test(title))continue;
    const height=Math.max(...line.tokens.map(t=>t.height));
    const next=lines.slice(i+1).find(l=>/(?:строку|таблицу\s+\d+)\s+изложить/iu.test(l.tokens.map(t=>t.text).join(' ')));
    if(!next)continue;
    const from=Math.ceil(line.y+height*.7),to=Math.floor(next.y-height*.9);
    for(const grid of amendmentRowGrids(canvas,from,to))tables.push({grid,from:grid.top,caption:{id:target,continued:true}});
  }
  const fragmentCount=tables.length;
  const hasFragments=fragmentCount>0;
  for(const [i,entry] of captions.entries()){
    const from=Math.max(0,Math.floor(entry.top-entry.height*.76));
    const next=captions[i+1];
    const note=notes.find(line=>line.y>entry.top+entry.height*3&&
      (appendixCaption(entry.caption)||isNotesHeading(line.tokens.map(token=>token.text).join(' '))));
    const to=Math.min(canvas.height,next?Math.floor(next.top-next.height):canvas.height,
      note?Math.floor(note.y-Math.max(...note.tokens.map(token=>token.height))*.55):canvas.height);
    if(to<=from+entry.height*3)continue;
    const crop=imageCrop(canvas,0,from,canvas.width,to);
    try{
      const grid=lineGrid(crop.getContext('2d').getImageData(0,0,crop.width,crop.height),false,true,hasFragments||appendixCaption(entry.caption));
      if(!grid||grid.top>entry.height*4||grid.bottom-grid.top<entry.height*2.5)continue;
      if(!hasFragments&&captions.length===1&&!appendixCaption(entry.caption)&&grid.columns.length>4&&grid.bodyEdges.length>2)continue;
      moveGridY(grid,from);
      tables.push({grid,caption:entry.caption,from});
    }finally{crop.width=crop.height=1;}
  }
  return {tables,captions,expected:captions.length+fragmentCount};
}
function moveGridY(grid,from){
  for(const key of ['headerTop','headerStart','top','bottom'])if(grid[key]!=null)grid[key]+=from;
  grid.lines=grid.lines.map(y=>y+from);grid.fullLines=grid.fullLines.map(y=>y+from);
  if(grid.bodyEdges)grid.bodyEdges=grid.bodyEdges.map(y=>y+from);
  if(grid.regularEdges)grid.regularEdges=grid.regularEdges.map(y=>y+from);
  grid.horizontal=grid.horizontal.map(([left,y,right])=>[left,y+from,right]);
  grid.vertical=grid.vertical.map(([x,top,bottom])=>[x,top+from,bottom+from]);
}
function hasFigureCaptionBelow(grid,positioned){
  return positionedLines(positioned).some(line=>{
    const text=line.tokens.map(token=>token.text).join(' ');
    const height=Math.max(...line.tokens.map(token=>token.height));
    return line.y>=grid.bottom&&line.y-grid.bottom<height*10&&/^\s*р\s*и\s*с\s*у\s*н\s*о\s*к\s+[A-ZА-ЯЁ\d]/iu.test(text);
  });
}
function captionGrid(canvas,positioned,notesOnly=false){
  const groups=positionedLines(positioned);
  const titleAt=line=>line.tokens.map(token=>token.text).join(' ');
  const isCaption=title=>/^\s*[«"^]?\s*(?:(?:Продолжение|Окончание)\s+)?т\s*а\s*б\s*л/i.test(title);
  for(let index=0;index<groups.length;index++){
    const line=groups[index];
    const tokens=line.tokens;
    const title=titleAt(line);
    if(!isCaption(title))continue;
    const caption=tableCaption(title);
    if(!caption)continue;
    const height=Math.max(10,...tokens.map(token=>token.height));
    const from=Math.max(0,Math.floor(line.y-height*.76));
    const to=Math.min(canvas.height,Math.ceil(line.y+canvas.height*.27));
    const note=groups.slice(index+1).find(next=>next.y>=to||isCaption(titleAt(next))||isNotesHeading(titleAt(next)));
    const noteTop=note&&note.y<to&&!isCaption(titleAt(note))?
      Math.floor(note.y-Math.max(...note.tokens.map(token=>token.height))*.55):null;
    if(notesOnly&&noteTop==null)continue;
    const readGrid=(end,withNotes)=>{
      const crop=imageCrop(canvas,0,from,canvas.width,end);
      try{return lineGrid(crop.getContext('2d').getImageData(0,0,crop.width,crop.height),withNotes);}
      finally{crop.width=crop.height=1;}
    };
    const refined=noteTop>from+height*3?readGrid(noteTop,true):null;
    if(notesOnly&&!refined?.bodyEdges)continue;
    const grid=refined?.bodyEdges?refined:readGrid(to,false);
    if(grid){
      if(grid.columns.length<4||grid.top>height*3.9||grid.bottom-grid.top<height*2.6)continue;
      moveGridY(grid,from);
      if(noteTop!=null&&grid.bottom>noteTop+5&&!grid.bodyEdges)grid.needsReview=true;
      return {grid,caption,from};
    }
  }
  return null;
}
function dottedVariable(canvas){
  const [first]=cellInk(canvas);
  if(!first)return false;
  const {width,height}=canvas;
  const {data}=canvas.getContext('2d').getImageData(0,0,width,height);
  const heightOfGlyph=first.bottom-first.top+1;
  let dotEnd=first.top,stemStart=-1,dotRight=first.left;
  for(let y=first.top;y<=first.bottom;y++){
    let right=-1;
    for(let x=first.left;x<=first.right;x++){
      const k=(y*width+x)*4;
      if(data[k]+data[k+1]+data[k+2]<570)right=x;
    }
    if(right<0)continue;
    if(y-dotEnd>1){stemStart=y;break;}
    dotEnd=y;dotRight=Math.max(dotRight,right);
  }
  return stemStart-dotEnd>=3&&dotEnd-first.top<heightOfGlyph*.23&&first.bottom-stemStart>heightOfGlyph*.55&&
    dotRight<first.left+(first.right-first.left)*.68;
}
function indexedRatioParts(canvas,hasPunctuation){
  const groups=cellInk(canvas),base=groups[0],end=groups.at(-1);
  if(groups.length<2)return null;
  const glyphHeight=base.bottom-base.top+1;
  if(glyphHeight<13||glyphHeight>canvas.height*.93||base.right-base.left>glyphHeight*1.05)return null;
  const right=hasPunctuation&&end.top>=base.top+glyphHeight*.62&&end.bottom-end.top<glyphHeight*.46?end.left-1:canvas.width;
  const upper=imageCrop(canvas,0,base.top,right,base.top+Math.floor(glyphHeight*.54));
  const top=cellInk(upper);upper.width=upper.height=1;
  if(top.length!==3||top[1].right-top[1].left>glyphHeight*.60)return null;

  const {width,height}=canvas;
  const {data}=canvas.getContext('2d').getImageData(0,0,width,height);
  const dark=(x,y)=>{const k=(y*width+x)*4;return data[k]+data[k+1]+data[k+2]<570;};
  const points=[];
  let stroke=0;
  for(let y=base.top+1;y<base.top+Math.floor(glyphHeight*.52);y++){
    const row=[];
    for(let x=top[1].left-1;x<=top[1].right+1;x++)if(dark(x,y))row.push(x);
    if(!row.length||row.at(-1)-row[0]+1>glyphHeight*.30)continue;
    stroke=Math.max(stroke,row.at(-1)-row[0]+1);
    points.push([y,row.reduce((sum,x)=>sum+x,0)/row.length]);
  }
  if(points.length<Math.max(6,glyphHeight*.32))return null;
  const yMean=points.reduce((sum,[y])=>sum+y,0)/points.length;
  const xMean=points.reduce((sum,[,x])=>sum+x,0)/points.length;
  const slope=points.reduce((sum,[y,x])=>sum+(y-yMean)*(x-xMean),0)/points.reduce((sum,[y])=>sum+(y-yMean)**2,0);
  const center=y=>xMean+slope*(y-yMean);
  if(!(slope<-.10&&slope>-.85)||points.some(([y,x])=>Math.abs(x-center(y))>1.5))return null;

  const denominatorLeft=Math.floor((top[1].right+top[2].left)/2)-1;
  const middleLeft=base.right+1;
  const middle=imageCrop(canvas,middleLeft,0,denominatorLeft,height);
  const slash=imageCrop(canvas,middleLeft,0,denominatorLeft,height);
  for(const [part,index] of [[middle,true],[slash,false]]){
    const ctx=part.getContext('2d'),im=ctx.getImageData(0,0,part.width,part.height);
    for(let y=0;y<part.height;y++){
      for(let x=0;x<part.width;x++){
        const near=y>=base.top-1&&y<=base.bottom+1&&Math.abs(middleLeft+x-center(y))<=stroke*.72;
        const keep=index?!near&&y>=base.top+glyphHeight*.42:near;
        if(!keep){const k=(y*part.width+x)*4;im.data.fill(255,k,k+4);}
      }
    }
    ctx.putImageData(im,0,0);
  }
  const index=cellInk(middle);
  if(index.length!==1||index[0].bottom<base.bottom+glyphHeight*.13||
    index[0].bottom-index[0].top+1>glyphHeight*.95||index[0].top<base.top+glyphHeight*.39){
    middle.width=middle.height=slash.width=slash.height=1;
    return null;
  }
  const denominator=imageCrop(canvas,denominatorLeft,0,right,height);
  const rightGlyph=cellInk(denominator);
  if(rightGlyph.length!==1||rightGlyph[0].bottom>base.bottom+glyphHeight*.16){
    denominator.width=denominator.height=middle.width=middle.height=slash.width=slash.height=1;
    return null;
  }
  return [imageCrop(canvas,0,0,middleLeft,height),middle,slash,denominator];
}
async function readIndexedRatio(canvas,worker,hasPunctuation,caseHint,language){
  const parts=indexedRatioParts(canvas,hasPunctuation);
  if(!parts)return null;
  const latin='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const readPart=async(part,alphabet)=>{
    const tight=trimCell(part);
    if(!tight)return [];
    const larger=imageCrop(tight,0,0,tight.width,tight.height,2);
    try{
      await worker.setParameters({tessedit_pageseg_mode:'10',user_defined_dpi:'400',tessedit_char_whitelist:alphabet});
      const reads=[];
      for(const sample of [tight,larger]){
        const {data}=await worker.recognize(sample);
        const text=data.text.trim();
        if(text.length===1&&alphabet.includes(text))reads.push({text,confidence:data.confidence});
      }
      return reads;
    }finally{tight.width=tight.height=larger.width=larger.height=1;}
  };
  const choose=(reads,minimum)=>reads.find(result=>result.confidence>=minimum&&reads.every(other=>other.text===result.text))?.text;
  let switched=false;
  try{
    const indexReads=await readPart(parts[1],'0123456789');
    const slashReads=await readPart(parts[2],'/+-');
    const index=choose(indexReads,62),slash=choose(slashReads,52);
    if(!index||slash!=='/')return null;
    if(language.includes('+')&&language.split('+').includes('eng')){
      await worker.reinitialize('eng',1);switched=true;
    }
    const baseReads=await readPart(parts[0],latin);
    const divisorReads=await readPart(parts[3],latin);
    let base=choose(baseReads,62);
    const divisor=choose(divisorReads,68);
    // When the stem is case-ambiguous, use only the case of the same letter
    // in the PDF's own positioned token. The subscript comes from the pixels.
    if(caseHint&&divisor&&caseHint[1]===divisor&&baseReads.some(row=>row.text.toLowerCase()===caseHint[0].toLowerCase())&&
      !baseReads.some(row=>row.confidence>=72&&row.text.toLowerCase()!==caseHint[0].toLowerCase())){
      const matching=await readPart(parts[0],caseHint[0]===caseHint[0].toLowerCase()?latin.slice(0,26):latin.slice(26));
      if(matching.some(row=>row.text===caseHint[0]))base=caseHint[0];
    }
    return base&&index&&slash==='/'&&divisor?base+'_'+index+'/'+divisor:null;
  }finally{
    for(const part of parts)part.width=part.height=1;
    if(switched)await worker.reinitialize(language,1);
    await worker.setParameters({tessedit_char_whitelist:''});
  }
}
function ratioCaseHint(positioned,word){
  const denominator=word.match(/\/([A-Za-z])[,.]?$/)?.[1];
  if(!denominator)return '';
  const hints=new Set();
  for(const item of positioned){
    for(const token of item.text.split(/\s+/)){
      const ends=token.match(/^([A-Za-z])[^\s,]{1,5}([A-Za-z])[,.]?$/);
      if(ends&&/\(|\[|\//.test(token)&&ends[2].toLowerCase()===denominator.toLowerCase()){
        hints.add(ends[1]+ends[2]);
      }
    }
  }
  return hints.size===1?hints.values().next().value:'';
}
function ruledHeaderBoundary(grid,letterHeight,fullWidth){
  const starts=grid.columns.slice(1,-1).map(x=>grid.vertical.filter(rule=>Math.abs(rule[0]-x)<=8)
    .sort((a,b)=>(b[2]-b[1])-(a[2]-a[1]))[0]?.[1]).filter(y=>y>grid.top+letterHeight*.65);
  for(const level of clusterPositions(starts.slice(),Math.max(4,letterHeight*.22))){
    if(starts.filter(y=>Math.abs(y-level)<=Math.max(5,letterHeight*.35)).length<2)continue;
    const downstream=fullWidth.filter(y=>y>level+letterHeight*.55);
    if(downstream.length>=3)return downstream[0];
  }
  return null;
}
function headerAboveDecimalRows(grid,positioned,letterHeight){
  const lines=positionedLines(positioned.filter(token=>token.x>grid.columns[1]&&token.x<grid.right&&token.y>grid.top&&token.y<grid.bottom));
  const minColumns=Math.max(2,Math.ceil((grid.columns.length-2)*.65));
  const count=(line,pattern)=>new Set(line.tokens.filter(token=>pattern.test(token.text))
    .map(token=>grid.columns.findIndex(x=>x>token.x))).size;
  for(let i=1;i<lines.length-1;i++){
    const header=lines[i-1],data=lines[i];
    if(count(header,/^\d+$/)<minColumns||count(data,/^[+−-]?\d+[.,]\d+$/)<minColumns||
      count(lines[i+1],/^[+−-]?\d+[.,]\d+$/)<minColumns)continue;
    const between=grid.lines.filter(y=>y>header.y+letterHeight*.32&&y<data.y-letterHeight*.32);
    if(between.length)return between.at(-1);
  }
  return null;
}
async function recognizeCellTable(canvas,ctx,pageIndex,alongsideFormulas=false){
  const aligned=deskewCanvas(canvas);
  try{
    const image=aligned.getContext('2d',{willReadFrequently:true}).getImageData(0,0,aligned.width,aligned.height);
    const positioned=ctx.positionedTokens?.(aligned)||[];
    const amendment=!alongsideFormulas&&await ctx.amendmentCaption?.();
    if(amendment){
      const grids=amendmentDataGrids(image);
      if(grids.length){
        const output=[],stats=[],regions=[];
        const worker=await getOcr(ctx.lang||'rus+eng');
        await worker.setParameters({tessedit_pageseg_mode:'3'});
        const whole=await worker.recognize(aligned);
        for(const grid of grids){
          const text=await recognizeAlignedTable(aligned,ctx,pageIndex,image,grid,amendment,true,grid.top,whole);
          if(!text){ctx.pageIssue||='Не удалось восстановить фрагмент изменённой таблицы';continue;}
          stats.push(ctx.tableStats);output.push(text);regions.push([grid.left,grid.top,grid.right,grid.bottom]);
        }
        if(stats.length){
          ctx.tableStats=stats.length===1?stats[0]:{...stats[0],tables:stats};
          output.push(await tableRemainder(aligned,regions,ctx));
          return output.join('\n\n');
        }
      }
    }
    const refined=alongsideFormulas?null:captionGrid(aligned,positioned,true);
    if(refined)return await recognizeAlignedTable(aligned,ctx,pageIndex,image,refined.grid,refined.caption,false,refined.from);
    const extraCaptions=await readAppendixCaptions(aligned,positioned,ctx);
    const closed=closedTablesByCaption(aligned,positioned,extraCaptions);
    if(closed.tables.length){
      const output=[],stats=[],regions=[];
      const worker=await getOcr(ctx.lang||'rus+eng');
      await worker.setParameters({tessedit_pageseg_mode:'3'});
      const whole=await worker.recognize(aligned);
      for(const item of closed.tables){
        const {grid,caption,from}=item;
        const text=await recognizeAlignedTable(aligned,ctx,pageIndex,image,grid,caption,true,from,whole);
        if(!text)continue;
        output.push(text);stats.push(ctx.tableStats);regions.push([grid.left,from,grid.right,grid.bottom]);
      }
      if(output.length<closed.expected)ctx.pageIssue||='Не восстановлена сетка части таблиц с подписями';
      if(output.length){
        ctx.tableStats=stats.length===1?stats[0]:{...stats[0],tables:stats};
        if(alongsideFormulas)ctx.tableRegions=regions;
        else output.push(await tableRemainder(aligned,regions,ctx));
        return output.join('\n\n');
      }
    }
    if(closed.captions.length>1)ctx.pageIssue||='Не восстановлена сетка части таблиц с подписями';
    const geometry=alongsideFormulas?null:lineGrid(image);
    if(geometry&&geometry.columns.length>=4){
      if(!closed.captions.length&&hasFigureCaptionBelow(geometry,positioned))return null;
      const localCaption=closed.captions.filter(item=>appendixCaption(item.caption)&&item.top<=geometry.top&&
        geometry.top-item.top<item.height*5).at(-1);
      return await recognizeAlignedTable(aligned,ctx,pageIndex,image,geometry,localCaption?.caption||null,false,localCaption?.top);
    }
    const local=captionGrid(aligned,positioned);
    if(!local)return null;
    const text=await recognizeAlignedTable(aligned,ctx,pageIndex,image,local.grid,local.caption,alongsideFormulas,local.from);
    if(text&&alongsideFormulas)ctx.tableRegions=[[local.grid.left,local.from,local.grid.right,local.grid.bottom]];
    return text;
  }finally{if(aligned!==canvas)aligned.width=aligned.height=1;}
}
async function tableRemainder(canvas,regions,ctx){
  const remainder=imageCrop(canvas,0,0,canvas.width,canvas.height),graphics=remainder.getContext('2d');
  graphics.fillStyle='#fff';
  for(const [left,top,right,bottom] of regions)graphics.fillRect(left,top,right-left,bottom-top);
  try{return await ocrImage(remainder,ctx);}finally{remainder.width=remainder.height=1;}
}
async function recognizeAlignedTable(canvas,ctx,pageIndex,image,grid,knownCaption=null,skipProse=false,captionTop=null,pageOcr=null){
  ctx.status('Поиск сетки таблицы…');
  const worker=await getOcr(ctx.lang||'rus+eng');await worker.setParameters({tessedit_pageseg_mode:'3'});
  const whole=pageOcr||await worker.recognize(canvas),words=whole.data.words||[],candidates=[];
  for(const word of words){const b=word.bbox;if(b&&/^[−+-]?\d+(?:[.,]\d+)?[*%]?$/.test(word.text)&&b.x0>=grid.left&&b.x1<=grid.right&&b.y0>grid.top&&b.y1<grid.bottom)candidates.push({y:(b.y0+b.y1)/2,x:(b.x0+b.x1)/2,h:b.y1-b.y0});}
  if(grid.regularEdges?.length>=3){
    const bottom=grid.bottom,pitch=bottom-grid.regularEdges.at(-2);
    const limit=Math.min(canvas.height,bottom+pitch);
    const next=(ctx.positionedTokens?.(canvas)||[]).filter(t=>t.x>grid.left&&t.x<grid.right&&
      t.y>bottom+pitch*.15&&t.y<limit&&/^\d+(?:[.,]\d+)?$/.test(t.text));
    const occupied=new Set(next.map(t=>grid.columns.findIndex(x=>x>t.x)));
    const verticals=grid.columns.filter(x=>ruleCoverage(image,x,bottom+2,x,limit-3));
    if(occupied.size>=Math.max(4,grid.columns.length*.45)&&verticals.length>=grid.columns.length*.55){
      grid.regularEdges=[...grid.regularEdges,limit];grid.bottom=limit;
    }
  }
  const height=candidates.length?candidates.map(v=>v.h).sort((a,b)=>a-b)[Math.floor(candidates.length/2)]:10;
  const bands=clusterPositions(candidates.map(v=>v.y),Math.max(3,height*.5)).filter(y=>new Set(candidates.filter(v=>Math.abs(v.y-y)<height*.6).map(v=>grid.columns.findIndex(x=>x>v.x))).size>=Math.max(3,(grid.columns.length-1)*.35));
  const narrow=grid.columns.length<=6;
  // On a short ruled table, numbers in a second header row can form a band
  // just like data. The interior verticals start above those header numbers.
  const fullWidth=knownCaption&&narrow?grid.lines.filter(y=>{
    const ruled=grid.columns.slice(1).map((x,i)=>ruleCoverage(image,grid.columns[i]+3,y,x-3,y)>0);
    return ruled[0]&&ruled.filter(Boolean).length>=Math.ceil(ruled.length*.8);
  }):[];
  const ruledHeader=knownCaption&&narrow?(headerAboveDecimalRows(grid,ctx.positionedTokens?.(canvas)||[],height)||
    ruledHeaderBoundary(grid,height,fullWidth)):null;
  const firstBandData=grid.regularEdges&&(ctx.positionedTokens?.(canvas)||[]).filter(t=>
    t.y>grid.top&&t.y<grid.regularEdges[1]&&t.x>grid.left&&t.x<grid.right&&/^\d+[.,]\d+$/.test(t.text)).length>=4;
  const first=firstBandData?grid.top:grid.bodyEdges?.[0]||ruledHeader||grid.fullLines.find(y=>y>grid.top+height*2&&(!bands.length||y<bands[0]-height*.4))||
    (bands.length?grid.lines.filter(y=>y<bands[0]-height*.4).at(-1):grid.lines[1])||grid.top;
  let caption=knownCaption||tableCaption(ctx.sourceText)||tableCaption(whole.data.text);
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
  if(!caption&&ctx.amendmentCaption)caption=await ctx.amendmentCaption();
  const dividers=ruledHeader?fullWidth.filter(y=>y>first+5&&y<grid.bottom-5):narrow?clusterPositions(grid.horizontal
    .filter(([left,y,right])=>y>first+5&&y<grid.bottom-5&&left<=grid.columns[1]+6&&right>=grid.right-6)
    .map(line=>line[1]),4):[];
  const unruledBody=grid.closed&&(grid.bodyEdges.length===2||appendixCaption(caption))&&
    bands.filter(y=>y>first+height*.4).length>=grid.bodyEdges.length;
  const ruledEdges=unruledBody?null:grid.bodyEdges||grid.regularEdges?.filter(y=>y>=first-1)||(dividers.length>=2?[first,...dividers,grid.bottom]:null);
  const denseBody=ruledEdges?ruledEdges.slice(1).map((edge,i)=>(ruledEdges[i]+edge)/2):pixelRows(canvas,grid,first,height);
  const positionedTokens=ctx.positionedTokens?.(canvas)||[];
  const sparse=sparseBodyCells(image,grid,first,height,positionedTokens,denseBody.length);
  const body=sparse?.centers||denseBody;
  if(body.length<((grid.closed||grid.fragment)&&!unruledBody?1:2)||body.length*(grid.columns.length-1)>1400){
    if(caption)ctx.pageIssue='Не удалось восстановить ячейки таблицы '+caption.id;
    return null;
  }
  const matrix=sparse?.matrix||bodyCells(image,grid,body,first,height,words,ruledEdges);
  if(grid.closed&&!sparse)mergeBodyColumns(matrix,image);
  const headerGrid=caption?.continued?{...grid,headerTop:grid.top}:grid;
  const headers=grid.fragment?{rows:[],cells:[]}:headerCells(image,headerGrid,first,caption?.continued?(grid.right-grid.left)*.075:18);
  const sections=sparse?sparse.sections:matrix.map(row=>{
    if(!grid.regularEdges||row.some(cell=>cell.skip||cell.span!==1))return false;
    const left=row[0],top=left.bbox[1],bottom=left.bbox[3];
    const tokens=positionedTokens.filter(t=>t.x>grid.left&&t.x<grid.right&&t.y>top&&t.y<bottom);
    if(!tokens.some(t=>/[а-яё]{3}/iu.test(t.text))||tokens.some(t=>/^\d+[.,]\d+$/.test(t.text)))return false;
    if(grid.columns.slice(1,-1).some(x=>ruleCoverage(image,x,top+2,x,bottom-2)))return false;
    left.bbox[2]=grid.right;left.colspan=row.length;left.multiline=true;
    for(const cell of row.slice(1))cell.skip=true;
    return true;
  });
  const sectionRows=sections.filter(Boolean).length;
  const dataRows=body.length-sectionRows;
  ctx.tableStats={layout:TABLE_LAYOUT_VERSION,rows:dataRows,columns:grid.columns.length-1,headerRows:Math.max(0,headers.rows.length-1),headers:headers.cells};
  if(sectionRows)ctx.tableStats.sectionRows=sectionRows;
  if(grid.needsReview)ctx.pageIssue||='Не удалось отделить примечания от строк таблицы';
  const crop=imageCrop(canvas,grid.left,Math.min(grid.top,grid.headerTop),grid.right,grid.bottom),
    name=pageAssetName(ctx,pageIndex,'tabl');
  ctx.assets??={};ctx.assets[name]=await canvasBlob(crop);crop.width=crop.height=1;
  const id=caption?.id||'[?номер не распознан]';
  if(caption)ctx.tableStats.caption=caption;
  else ctx.pageIssue='Не определён номер таблицы';
  const tokensInCell=box=>positionedTokens.filter(word=>word.x>box[0]+3&&word.x<box[2]-3&&word.y>box[1]+2&&word.y<box[3]-2);
  const render=async(box,fullResolutionOnly=false)=>ctx.renderTablePatch?
    ctx.renderTablePatch(canvas,box,fullResolutionOnly):{canvas:imageCrop(canvas,...box,2),scale:2};
  const formulaLinks=[],cellLinks=[];
  const numeric=/^[±−+-]?\s*\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/;
  const same=s=>String(s||'').replace(/\s/g,'').replace(/,/g,'.');
  const read=async(patch,header=false,body=false)=>{
    const tight=trimCell(patch);if(!tight)return {text:'',confidence:100,variants:[],turn:0,empty:true};
    try{
      await worker.setParameters({tessedit_pageseg_mode:header?'6':'7',preserve_interword_spaces:'1',user_defined_dpi:'400'});
      let result=(await worker.recognize(tight)).data,variants=[],turnChosen=0;variants.push({text:result.text.trim(),confidence:result.confidence});
      if(header&&tight.height>tight.width*1.3){for(const sign of [-1,1]){const turn=document.createElement('canvas');turn.width=tight.height;turn.height=tight.width;const c=turn.getContext('2d');c.translate(turn.width/2,turn.height/2);c.rotate(sign*Math.PI/2);c.drawImage(tight,-tight.width/2,-tight.height/2);try{const r=(await worker.recognize(turn)).data;variants.push({text:r.text.trim(),confidence:r.confidence});if(r.confidence>result.confidence){result=r;turnChosen=sign;}}finally{turn.width=turn.height=1;}}}
      if(!header&&(result.confidence<85||!/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/.test(result.text.trim()))){
        await worker.setParameters({tessedit_pageseg_mode:'8'});const r=(await worker.recognize(tight)).data;variants.push({text:r.text.trim(),confidence:r.confidence});if(!/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/.test(result.text.trim())&&/\d/.test(r.text))result=r;
      }
      const text=body&&header&&!ctx.math&&!turnChosen?restoreWordDecimals(tight,result):result.text;
      const ratio=header&&!body&&!ctx.math&&!turnChosen?result.words?.find(word=>word.bbox&&
        /^[A-Za-z0-9\[][^/\s]{1,5}\/[A-Za-z][,.]?$/.test(word.text)):null;
      return {text:text.trim().replace(/\s+/g,' '),confidence:result.confidence,variants,turn:turnChosen,empty:false,
        ...(ratio?{ratio:{text:ratio.text,bbox:ratio.bbox}}:{})};
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
  const rereadLabel=async(patch,cell,isHeader)=>{
    const crop=isHeader?imageCrop(patch,patch.width*.08,patch.height*.06,patch.width*.92,patch.height*.94):patch;
    clearCellRules(crop);
    const tight=trimCell(crop);
    if(crop!==patch)crop.width=crop.height=1;
    if(!tight)return;
    try{
      const readings=[];
      const fold=value=>value.replace(/(\p{L})[-\u00ad]\s*\n\s*(\p{L})/gu,'$1$2').replace(/\s+/g,' ').trim();
      const sourceLines=positionedLines(tokensInCell(cell.bbox)).map(line=>line.tokens.map(item=>item.text).join(' '));
      const layer=fold(sourceLines.join('\n'));
      const bodyWords=value=>(value.toLowerCase().replace(/ё/g,'е').match(/[а-я]{2,}/g)||[]).join('');
      const comparableUnit=value=>value.toLowerCase().replace(/m/g,'м').replace(/c/g,'с').replace(/\s/g,'');
      for(const zoom of isHeader?[1,1.6,2.3]:[1,1.6]){
        const sample=zoom===1?tight:imageCrop(tight,0,0,tight.width,tight.height,zoom);
        try{
          for(const mode of isHeader?['7','13']:['6']){
            await worker.setParameters({tessedit_pageseg_mode:mode,user_defined_dpi:'400',tessedit_char_whitelist:''});
            const {data}=await worker.recognize(sample);
            readings.push({text:fold(data.text),confidence:data.confidence,lines:data.text.trim().split(/\n+/)});
          }
        }finally{if(sample!==tight)sample.width=sample.height=1;}
      }
      cell.variants.push(...readings);
      const best=readings.sort((a,b)=>b.confidence-a.confidence)[0];
      if(isHeader){
        const unit=readings.find(row=>row.confidence>=78&&/^[а-я]{1,3}$/i.test(layer)&&comparableUnit(row.text)===comparableUnit(layer));
        if(unit){cell.text=layer;cell.confidence=unit.confidence;return;}
        const suffixes=readings.map(row=>row.text.match(/^[fLliI]([yу\d])[,\s]+([сc][мm])$/i)?.[1]?.toLowerCase().replace('у','y')).filter(Boolean);
        const index=suffixes.find(value=>suffixes.filter(other=>other===value).length>=2);
        if(index&&dottedVariable(tight)){cell.text='i_'+index+', см';cell.confidence=best.confidence;return;}
        if(best.confidence>=65&&/[\p{L}\d]/u.test(best.text)){cell.text=best.text;cell.confidence=best.confidence;}
      }else if(best.confidence>=65&&/[а-яё]{3,}/i.test(best.text)){
        const confirmation=layer&&!/\d/.test(layer)&&bodyWords(layer).length>=12&&readings.find(row=>
          row.lines.length===sourceLines.length&&bodyWords(row.text)===bodyWords(layer));
        const joined=confirmation?sourceLines.reduce((text,line,i)=>text+(i&&!confirmation.lines[i-1].trimEnd().endsWith('-')?' ':'')+line,''):'';
        cell.text=joined||best.text;cell.confidence=best.confidence;
      }
    }finally{tight.width=tight.height=1;}
  };
  const retryNumber=async(patch,expected,mode=expected.length===1?'10':'13',characters='0123456789±−+.,/-')=>{
    const tight=trimCell(patch);
    if(!tight)return [];
    try{
      const readings=[];
      const glyph=binaryGlyph(tight,0);
      try{
        await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:characters});
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
  const lineCandidates=(cell,positioned,center,letterHeight)=>{
    const plain=/^[−+]?\d+(?:[.,]\d+)?$/;
    const profile=text=>cell.c===0&&/^\d+[А-Яа-яA-Za-z]\d*$/u.test(text);
    const main=positioned.filter(item=>Math.abs(item.localY-center)<letterHeight*.78)
      .map(item=>item.text).filter(text=>plain.test(text)||profile(text));
    const candidates=new Map(main.map(text=>[same(text),text]));
    if(/^1\d{2,}[.,]\d+$/.test(cell.text)){
      for(const alternate of cell.variants){
        const text=alternate.text.trim();
        if(alternate.confidence>=65&&plain.test(text)&&same(cell.text)==='1'+same(text))candidates.set(same(text),text);
      }
    }
    if(!plain.test(cell.text)&&main.every(text=>!plain.test(text))){
      const alternate=cell.alt.trim().split(/\s+/).filter(text=>plain.test(text)&&/[.,]/.test(text));
      if(alternate.length===1)candidates.set(same(alternate[0]),alternate[0]);
    }
    return candidates.has(same(cell.text))?[]:[...candidates.values()];
  };
  const recoverCellLine=async(patch,cell,candidates,center,letterHeight)=>{
    const inset=Math.min(letterHeight*.22,patch.width*.12);
    const x1=patch.width-inset,y0=Math.max(0,center-letterHeight*.83),y1=Math.min(patch.height,center+letterHeight*.83);
    if(x1<=inset||y1-y0<letterHeight*.6)return;
    const line=imageCrop(patch,inset,y0,x1,y1);
    try{
      const compact=text=>same(text).replace(/[yYУу]/g,'У').toUpperCase();
      for(const target of candidates){
        const isProfile=/^\d+[А-Яа-яA-Za-z]\d*$/.test(target);
        // Source text is a candidate only. Require the same reading from the
        // independently isolated line, including all digits and suffixes.
        const characters=isProfile?'0123456789'+
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЗИКЛМНОПРСТУФХЭЯабвгдезиклмнопрстуфхэя':undefined;
        const readings=await retryNumber(line,target,'7',characters);
        const matches=entry=>compact(entry.text)===compact(target);
        if(!readings.some(entry=>matches(entry)&&entry.confidence>=56))readings.push(...await retryNumber(line,target,'13',characters));
        let verified=readings.some(entry=>matches(entry)&&entry.confidence>=56);
        if(!verified&&isProfile){
          const glyphs=cellInk(line);
          if(glyphs.length===target.length){
            const pieces=[];
            for(let i=0;i<glyphs.length;i++){
              const g=glyphs[i];
              const piece=imageCrop(line,Math.max(0,g.left-1),Math.max(0,g.top-1),g.right+2,g.bottom+2);
              try{
                const alphabet=/\d/.test(target[i])?'0123456789':characters.replace(/\d/g,'');
                const reads=await retryNumber(piece,target[i],'10',alphabet);
                const agreeing=reads.find(read=>read.confidence>=42&&compact(read.text)===compact(target[i]));
                pieces.push(agreeing?.text||'');
              }finally{piece.width=piece.height=1;}
            }
            verified=pieces.every(Boolean)&&compact(pieces.join(''))===compact(target);
          }
        }else if(!verified&&target.replace(/[.,]/g,'')===cell.text.replace(/^[|\s]+/,'')&&/[.,]/.test(target)){
          const tighter=imageCrop(line,0,Math.max(0,center-letterHeight*.68-y0),line.width,Math.min(line.height,center+letterHeight*.68-y0));
          try{verified=decimalInk(tighter,target);}finally{tighter.width=tighter.height=1;}
        }
        if(verified){
          cell.firstReading=cell.text;cell.text=target;cell.variants.push(...readings);
          cell.cellAgreement='Повторное OCR отдельной строки';return;
        }
      }
    }finally{line.width=line.height=1;}
  };
  const fastReview=[];
  const unreadLabels=[];
  const ratioLabels=[];
  try{
    const headerRetries=[];
    for(let n=0;n<headers.cells.length;n++){
      await waitResume(ctx);const cell=headers.cells[n];ctx.status('Шапка: ячейка '+(n+1)+'/'+headers.cells.length);
      const box=[localBoundaryX(image,cell.bbox[0],cell.bbox[1],cell.bbox[3])+3,cell.bbox[1]+3,localBoundaryX(image,cell.bbox[2],cell.bbox[1],cell.bbox[3])-3,cell.bbox[3]-3];
      if(box[2]<=box[0]||box[3]<=box[1])continue;
      const patch=await render(box);
      try{
        Object.assign(cell,await read(patch.canvas,true));
        if(sparse&&cell.r>0&&!cell.empty)await rereadIndexedTableLabel(patch.canvas,cell,tokensInCell(cell.bbox).map(t=>t.text).join(''),worker);
        if(!ctx.math&&!cell.text&&!cell.empty)unreadLabels.push({cell,box,isHeader:true});
        if(cell.ratio)ratioLabels.push({cell,box});
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
      await waitResume(ctx);const roots=matrix[r].filter(c=>!c.skip);if(!roots.length)continue;
      const box=[grid.left,Math.min(...roots.map(c=>c.bbox[1])),grid.right,Math.max(...roots.map(c=>c.bbox[3]))];
      // A wide strip can exceed the budget even if its individual cells fit at 400 dpi.
      const strip=await render(box,true);
      try{for(const cell of roots){
        ctx.status('Таблица: строка '+(r+1)+'/'+body.length+', ячейка '+(cell.c+1)+'/'+(grid.columns.length-1));
        const b=cell.bbox,l=localBoundaryX(image,b[0],b[1],b[3]),right=localBoundaryX(image,b[2],b[1],b[3]);
        const bottomInset=sparse&&r===matrix.length-1?Math.max(2,height*.4):2;
        const cellBox=[l+3,b[1]+2,right-3,b[3]-bottomInset];
        const s=strip?.scale;
        const cropBox=strip?cellBox.map((v,i)=>(v-box[i%2])*s):null;
        const {canvas:patch,scale:k}=strip?{canvas:imageCrop(strip.canvas,...cropBox),scale:s}:await render(cellBox);
        const retryBox=strip?box:cellBox;
        cell.alt=words.filter(w=>w.bbox&&(w.bbox.x0+w.bbox.x1)/2>b[0]&&(w.bbox.x0+w.bbox.x1)/2<b[2]&&(w.bbox.y0+w.bbox.y1)/2>b[1]&&(w.bbox.y0+w.bbox.y1)/2<b[3]).map(w=>w.text).join(' ');
        try{
          Object.assign(cell,cell.empty?{text:'',confidence:100,empty:true}:await read(patch,cell.multiline,true));
          const positioned=tokensInCell(b);
          const values=positioned.map(item=>item.text);
          if(sparse&&!cell.c&&!cell.empty){
            if(sparse.sections[r])cell.text=cell.text.replace(/(\p{L})-\s+(?=\p{Ll})/gu,'$1');
            else await rereadIndexedTableLabel(patch,cell,values.join(''),worker);
          }
          const alt=cell.alt.replace(/^[|\s]+|[|\s]+$/g,'');
          const identifier=values.join('').replace(/\s/g,'');
          if(!cell.c&&/^\d{1,3}[А-ЯЁA-Z]{1,3}\d{1,3}$/u.test(identifier)&&alt===identifier){
            cell.identifierVerified=true;
            if(cell.text!==alt){
              cell.firstReading=cell.text;cell.text=alt;cell.cellAgreement='PDF + OCR марки на странице';
            }
          }
          if(!cell.c&&!cell.identifierVerified&&/^\d{1,3}[А-ЯЁA-Z]{1,3}\d{1,3}$/u.test(identifier)&&cell.text!==identifier){
            cell.sourceIdentifier=identifier;
            await rereadIndexedTableLabel(patch,cell,identifier,worker);
            cell.identifierVerified=cell.text===identifier;
          }
          const layer=values.length===1&&numeric.test(values[0])?values[0]:'';
          if(!ctx.math&&!cell.empty&&clearCellRules(patch)){
            const clean=await read(patch,cell.multiline,true);
            const originalDigits=same(cell.text).replace(/[.,]/g,'');
            const agreesWithLayer=layer&&originalDigits===same(layer).replace(/[.,]/g,'');
            const removedRule=!agreesWithLayer&&/^[1|]\s*/.test(cell.text)&&same(cell.text.replace(/^[1|]\s*/,''))===same(clean.text);
            const variants=[...cell.variants,...clean.variants];
            const clearedEmpty=clean.empty&&!alt&&!values.length;
            if(clearedEmpty||numeric.test(clean.text)&&(removedRule||[alt,layer].some(other=>other&&same(clean.text)===same(other)&&same(cell.text)!==same(other))||!numeric.test(cell.text)&&clean.confidence>=65)){
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
          if(!cell.text&&!/[\p{L}\d]/u.test(alt+values.join(''))){
            const insetX=Math.min(12,(b[2]-b[0])*.08),insetY=Math.min(10,(b[3]-b[1])*.1);
            const inside=imageCrop(canvas,b[0]+insetX,b[1]+insetY,b[2]-insetX,b[3]-insetY,2);
            try{if(printedDash(inside)){cell.text='—';cell.empty=false;cell.dash=true;}}
            finally{inside.width=inside.height=1;}
          }
          if(!cell.text&&values.length===1&&dash.test(values[0])&&(!altDash||dash.test(altDash)||altDash==='_')){
            const t=positioned[0],x=(t.x-cellBox[0])*k,y=(t.y-cellBox[1])*k;
            const width=Math.max(t.width*k,height*k),pad=Math.max(6,height*k*.65);
            const x0=Math.max(0,x-width*.65-pad),x1=Math.min(patch.width,x+width*.65+pad);
            const y0=Math.max(0,y-pad),y1=Math.min(patch.height,y+pad);
            if(x1>x0&&y1>y0){
              const focus=imageCrop(patch,x0,y0,x1,y1);
              try{if(printedDash(focus)){cell.text=values[0];cell.empty=false;cell.dash=true;}}
              finally{focus.width=focus.height=1;}
            }
          }
          if(!cell.text&&dash.test(altDash)){
            const word=words.find(w=>dash.test(w.text.trim())&&w.bbox&&
              w.bbox.x0>=b[0]&&w.bbox.x1<=b[2]&&w.bbox.y0>=b[1]&&w.bbox.y1<=b[3]);
            if(word){
              const pad=Math.max(5,height*.45),g=word.bbox;
              const around=imageCrop(canvas,Math.max(b[0]+2,g.x0-pad),Math.max(b[1]+2,g.y0-pad),
                Math.min(b[2]-2,g.x1+pad),Math.min(b[3]-2,g.y1+pad),2);
              try{if(printedDash(around)){cell.text=altDash;cell.empty=false;cell.dash=true;}}
              finally{around.width=around.height=1;}
            }
          }
          if(!cell.text&&!cell.empty&&cell.multiline&&isDiagramCrop(patch.getContext('2d').getImageData(0,0,patch.width,patch.height))){
            cell.image=pageAssetName(ctx,pageIndex,'cell');ctx.assets[cell.image]=await canvasBlob(patch);
            cell.text='Схема, см. вырезку строки '+(cell.r+1)+', столбца '+(cell.c+1);
          }
          if(cpuDash||(!/\d/.test(cell.text)&&(dash.test(altDash)||!cell.text))){
            if(!cell.text&&!/[\p{L}\d]/u.test(alt+values.join(''))){
            const insetX=Math.min(12,(b[2]-b[0])*.08),insetY=Math.min(10,(b[3]-b[1])*.1);
            const inside=imageCrop(canvas,b[0]+insetX,b[1]+insetY,b[2]-insetX,b[3]-insetY,2);
            try{if(printedDash(inside)){cell.text='—';cell.empty=false;cell.dash=true;}}
            finally{inside.width=inside.height=1;}
          }
          if(!cell.text&&values.length===1&&dash.test(values[0])&&(!altDash||dash.test(altDash)||altDash==='_')){
            const t=positioned[0],x=(t.x-cellBox[0])*k,y=(t.y-cellBox[1])*k;
            const width=Math.max(t.width*k,height*k),pad=Math.max(6,height*k*.65);
            const x0=Math.max(0,x-width*.65-pad),x1=Math.min(patch.width,x+width*.65+pad);
            const y0=Math.max(0,y-pad),y1=Math.min(patch.height,y+pad);
            if(x1>x0&&y1>y0){
              const focus=imageCrop(patch,x0,y0,x1,y1);
              try{if(printedDash(focus)){cell.text=values[0];cell.empty=false;cell.dash=true;}}
              finally{focus.width=focus.height=1;}
            }
          }
          if(!cell.text&&dash.test(altDash)){
            const word=words.find(w=>dash.test(w.text.trim())&&w.bbox&&
              w.bbox.x0>=b[0]&&w.bbox.x1<=b[2]&&w.bbox.y0>=b[1]&&w.bbox.y1<=b[3]);
            if(word){
              const pad=Math.max(5,height*.45),g=word.bbox;
              const around=imageCrop(canvas,Math.max(b[0]+2,g.x0-pad),Math.max(b[1]+2,g.y0-pad),
                Math.min(b[2]-2,g.x1+pad),Math.min(b[3]-2,g.y1+pad),2);
              try{if(printedDash(around)){cell.text=altDash;cell.empty=false;cell.dash=true;}}
              finally{around.width=around.height=1;}
            }
          }
          if(!cell.text&&!cell.empty&&cell.multiline&&isDiagramCrop(patch.getContext('2d').getImageData(0,0,patch.width,patch.height))){
            cell.image=pageAssetName(ctx,pageIndex,'cell');ctx.assets[cell.image]=await canvasBlob(patch);
            cell.text='Схема, см. вырезку строки '+(cell.r+1)+', столбца '+(cell.c+1);
          }
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
            if(!cell.multiline&&!cell.cellAgreement){
              const inStrip=positioned.map(item=>({...item,localY:(item.y-b[1]-2)*k}));
              const center=(body[r]-b[1]-2)*k,letterHeight=height*k;
              const candidates=lineCandidates(cell,inStrip,center,letterHeight);
              if(candidates.length)fastReview.push({cell,box:retryBox,cropBox,center,letterHeight,candidates});
            }
            if(cell.multiline&&cell.span>1&&cell.text.includes('=')){
              fastReview.push({cell,box:retryBox,cropBox,letterHeight:height*k});
            }
            if(!cell.text&&/[а-яё]{3,}/i.test(cell.alt))unreadLabels.push({cell,box:retryBox,cropBox});
          }
        }finally{patch.width=patch.height=1;}
      }}finally{if(strip)strip.canvas.width=strip.canvas.height=1;}
    }
  }finally{await worker.setParameters({tessedit_pageseg_mode:'3'});}
  let prose='';
  if(!skipProse){
    const remainder=imageCrop(canvas,0,0,canvas.width,canvas.height),rc=remainder.getContext('2d');
    const upper=captionTop??Math.min(grid.top,grid.headerTop);
    rc.fillStyle='#fff';rc.fillRect(grid.left,upper,grid.right-grid.left,grid.bottom-upper);
    try{prose=(await worker.recognize(remainder)).data.text||'';}finally{remainder.width=remainder.height=1;}
  }
  let retryBox,retryStrip;
  try{
    for(const {cell,box,cropBox,center,letterHeight,candidates} of fastReview){
      await waitResume(ctx);
      if(retryBox!==box){
        if(retryStrip)retryStrip.width=retryStrip.height=1;
        retryStrip=(await render(box)).canvas;retryBox=box;
      }
      const patch=cropBox?imageCrop(retryStrip,...cropBox):retryStrip;
      try{
        if(candidates){await recoverCellLine(patch,cell,candidates,center,letterHeight);continue;}
        const fraction=await recognizeCellFraction(patch,letterHeight,worker);
        if(!fraction)continue;
        cell.firstReading=cell.text;cell.text=fraction.text;
        const link=pageAssetName(ctx,pageIndex,'formula');
        ctx.assets[link]=fraction.image;
        formulaLinks.push('![Формула, строка '+(cell.r+1)+', столбец '+(cell.c+1)+']('+link+')\n\n[?Формула в ячейке не сверена с вырезкой]');
      }finally{if(patch!==retryStrip)patch.width=patch.height=1;}
    }
  }finally{if(retryStrip)retryStrip.width=retryStrip.height=1;}
  for(const {cell,box,cropBox,isHeader} of unreadLabels){
    if(cell.text)continue;
    await waitResume(ctx);
    const {canvas:strip}=await render(box);
    const patch=cropBox?imageCrop(strip,...cropBox):strip;
    try{await rereadLabel(patch,cell,isHeader);}finally{patch.width=patch.height=strip.width=strip.height=1;}
  }
  for(const {cell,box} of ratioLabels){
    await waitResume(ctx);
    const {text,bbox}=cell.ratio;
    if(!cell.text.includes(text))continue;
    const {canvas:patch}=await render(box);
    const tight=trimCell(patch);patch.width=patch.height=1;
    if(!tight)continue;
    const crop=imageCrop(tight,Math.max(0,bbox.x0-2),Math.max(0,bbox.y0-2),Math.min(tight.width,bbox.x1+2),Math.min(tight.height,bbox.y1+2));
    tight.width=tight.height=1;
    try{
      const punctuation=text.match(/[,.]$/)?.[0]||'';
      const hint=ratioCaseHint(tokensInCell(cell.bbox),text);
      const reading=await readIndexedRatio(crop,worker,Boolean(punctuation),hint,ctx.lang||'rus+eng');
      if(reading){cell.firstReading=cell.text;cell.text=cell.text.replace(text,'$'+reading+'$'+punctuation);}
    }finally{crop.width=crop.height=1;}
  }
  // Finish CPU work before starting the GPU phase: the browser keeps only the
  // one model needed for the current phase rather than both resident engines.
  if(ctx.math){
    if(ctx.glmMemoryExhausted)ctx.glmSkippedOnPage=true;
    for(let n=0;n<headers.cells.length&&!ctx.glmMemoryExhausted;n++){
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
      if(ctx.glmMemoryExhausted)break;
      cell.tesseract=cell.text;cell.neural=text;
      const cleaned=cleanedCellReading(text);
      const reading=cleaned.replace(/[$\s]/g,'')?cleaned:'';
      if(reading&&!/Генерация остановлена/.test(text)&&text.length<1500&&!(cell.confidence>=90&&/[А-Яа-яЁё]{4,}/.test(cell.tesseract)&&!/[|]/.test(cell.tesseract))){cell.text=reading;cell.engine='GLM';}
      else if(!reading&&!/[A-Za-zА-Яа-яЁё\d]/.test(cell.text)){cell.text='';}
      if(/^\d+(?:\s+\d+)+$/.test(cell.text)&&/^\d+$/.test(cell.tesseract)&&same(cell.text)===cell.tesseract&&
        tokensInCell(cell.bbox).some(token=>token.text===cell.tesseract))cell.text=cell.tesseract;
    }finally{if(input!==patch.canvas)input.width=input.height=1;patch.canvas.width=patch.canvas.height=1;}
  }
    const number=/^[−+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?(?:[А-ЯA-Zа-яa-z]\d*)?\*?$/;
    const review=matrix.flat().filter(cell=>!cell.skip&&!cell.empty&&!cell.dash&&!cell.separatorVerified&&!cell.numberVerified&&!cell.identifierVerified&&(cell.c===0||cell.span>1||cell.confidence<88||!number.test(cell.text)||number.test(cell.alt)&&same(cell.text)!==same(cell.alt)));
    ctx.tableStats.reviewedCells=review.length;
    for(let n=0;n<review.length&&!ctx.glmMemoryExhausted;n++){
      await waitResume(ctx);const cell=review[n],b=cell.bbox,box=[localBoundaryX(image,b[0],b[1],b[3])+3,b[1]+2,localBoundaryX(image,b[2],b[1],b[3])-3,b[3]-2];
      if(box[2]<=box[0]||box[3]<=box[1])continue;
      const patch=await render(box);
      if(Math.max(patch.canvas.width,patch.canvas.height)>100*Math.min(patch.canvas.width,patch.canvas.height)){patch.canvas.width=patch.canvas.height=1;continue;}
      ctx.status('Нейросеть: проверка ячейки '+(n+1)+'/'+review.length);const task=ctx.task,limit=ctx.maxTokens;ctx.task='Text Recognition:';ctx.maxTokens=128;
      try{
        const text=await glmRecognize(patch.canvas,ctx);cell.tesseract=cell.text;cell.neural=text;
        if(!text.trim()||/Генерация остановлена/.test(text)||text.length>=400)continue;
        const clean=value=>value.replace(/^```\w*\s*|```\s*$/g,'').trim().replace(/^\$\$?|\$\$?$/g,'').trim().replace(/\s+/g,' ');
        const cleaned=clean(text);
        if(!cleaned){
          if(cell.multiline&&patch.canvas.height>80&&patch.canvas.width>80){
            const asset=pageAssetName(ctx,pageIndex,'cell');
            ctx.assets[asset]=await canvasBlob(patch.canvas);
            cell.image=asset;
            const ink=patch.canvas.getContext('2d').getImageData(0,0,patch.canvas.width,patch.canvas.height);
            if(isDiagramCrop(ink))cell.text='Схема, см. вырезку строки '+(cell.r+1)+', столбца '+(cell.c+1);
            else if(cell.confidence<80)cell.text='';
          }
          continue;
        }
        cell.text=cleaned;cell.engine='GLM';
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
  for(const [i,row] of matrix.entries()){
    const tag=sections[i]?'th':'td';
    out+='<tr>';
    for(const cell of row){
      if(cell.skip)continue;
      if(cell.image)cellLinks.push('![Ячейка, строка '+(cell.r+1)+', столбец '+(cell.c+1)+']('+cell.image+')');
      const text=cell.empty?'':cell.text?'[?'+cell.text+']':'[?непрочитанная ячейка]';
      out+='<'+tag+(cell.span>1?' rowspan="'+cell.span+'"':'')+
        (cell.colspan>1?' colspan="'+cell.colspan+'"':'')+'>'+htmlEscape(text)+'</'+tag+'>';
    }
    out+='</tr>';
  }
  ctx.tableStats.cells=matrix;
  if(matrix.some(row=>row.some(cell=>!cell.skip&&cell.text&&isNotesHeading(cell.text)))){
    ctx.pageIssue||='Примечания попали в строки таблицы';
  }
  if(formulaLinks.length)ctx.formulaStats={layout:FORMULA_LAYOUT_VERSION,count:(ctx.formulaStats?.count||0)+formulaLinks.length};
  return out+'</tbody></table>\n\n<!-- таблица '+id+': строк '+dataRows+', столбцов '+(grid.columns.length-1)+' -->\n\n[?Границы и объединения ячеек требуют сверки по вырезке]\n\n'+[...formulaLinks,...cellLinks,prose].join('\n\n');
}
