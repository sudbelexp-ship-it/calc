const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('browser-layout.js','utf8'),c);
const w=420,h=420,data=new Uint8ClampedArray(w*h*4);data.fill(255);
function black(x,y){let k=(y*w+x)*4;data[k]=data[k+1]=data[k+2]=0;}
for(const x of [20,110,200,290,400])for(let y=20;y<=400;y++)black(x,y);
for(const y of [20,100,180,260,340,400])for(let x=20;x<=400;x++)black(x,y);
const g=c.lineGrid({width:w,height:h,data});assert.equal(g.columns.length,5);assert.equal(g.lines.length,6);
assert.equal(c.lineGrid({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)}),null);
assert.deepEqual(Array.from(c.clusterPositions([1,2,4,20,22],3)),[7/3,21]);
// Thin antialiased rules must remain column boundaries.
for(let y=20;y<=400;y++){const k=(y*w+245)*4;data[k]=data[k+1]=data[k+2]=170;}
assert.equal(c.lineGrid({width:w,height:h,data}).columns.length,6);
// Skew estimator uses all scanlines to avoid a false zero from sampling aliasing.
const sw=1100,sh=500,slant=new Uint8ClampedArray(sw*sh*4).fill(255);
for(const y0 of [40,100,160,220,280,340,400,460])for(let x=20;x<1080;x++){const y=Math.round(y0-x*.006);for(let dy=0;dy<2;dy++){const k=((y+dy)*sw+x)*4;slant[k]=slant[k+1]=slant[k+2]=0;}}
assert(Math.abs(c.scanSkew({width:sw,height:sh,data:slant})-.3)<.15);
const hw=300,hh=220,hd=new Uint8ClampedArray(hw*hh*4).fill(255);
function line(x0,y0,x1,y1){for(let t=0;t<=Math.max(x1-x0,y1-y0);t++){const len=Math.max(x1-x0,y1-y0),x=Math.round(x0+(x1-x0)*t/len),y=Math.round(y0+(y1-y0)*t/len),k=(y*hw+x)*4;hd[k]=hd[k+1]=hd[k+2]=0;}}
for(const y of [20,100])line(20,y,260,y);line(100,60,260,60);for(const x of [20,100,260])line(x,20,x,100);line(180,60,180,100);
const hi={width:hw,height:hh,data:hd},hg={columns:[20,100,180,260],left:20,right:260,headerTop:20,top:20};
const heads=c.headerCells(hi,hg,100);assert.equal(heads.rows.length,3);assert.equal(heads.cells.length,4);assert(heads.cells.some(x=>x.r===0&&x.c===0&&x.span===2));assert(heads.cells.some(x=>x.r===0&&x.c===1&&x.colspan===2));
// A short dark text baseline must not split an otherwise merged header cell.
line(25,40,85,40);const withText=c.headerCells(hi,hg,100);assert.equal(withText.rows.length,3);assert.equal(withText.cells.length,4);
// A value centered across two rows must start at the physical cell's top row.
line(20,110,180,110);line(20,210,180,210);line(100,160,180,160);
for(const y of [155,157,159,161,163,165])line(40,y,55,y);
for(const y0 of [130,180])for(let dy=0;dy<10;dy++)line(120,y0+dy,135,y0+dy);
const bc=c.bodyCells(hi,{columns:[20,100,180],lines:[110,160,210],bottom:210},[135,185],110,14);assert.equal(bc[0][0].span,2);assert(bc[1][0].skip);assert.equal(bc[0][1].span,1);assert(!bc[1][1].skip);
const closeRows=new Uint8ClampedArray(100*100*4).fill(255);
for(let y=10;y<80;y++){let k=(y*100+5)*4;closeRows[k]=closeRows[k+1]=closeRows[k+2]=0;}
for(const y0 of [20,34])for(let y=y0;y<y0+12;y++)for(let x=20;x<30;x++){let k=(y*100+x)*4;closeRows[k]=closeRows[k+1]=closeRows[k+2]=0;}
assert.equal(c.regionLines({width:100,height:100,data:closeRows},[0,10,60,70],12).length,2);
assert.equal(c.tableCaption('Т а б л и ц а  2').id,'2');
assert.equal(c.tableCaption('Продолжение таблицы № 6.8').id,'6.8');
assert(c.tableCaption('Продолжение таблицы № 6.8').continued);
assert(c.tableCaption('Окончание таблицы 1').continued);
assert.equal(c.tableCaption('см. таблицу 2'),null);
const compactGrid={top:80,columns:[20,100,170,240,310,380],
  vertical:[[100,80,320],[170,128,320],[240,129,320],[310,129,320]]};
assert.equal(c.ruledHeaderBoundary(compactGrid,18,[80,176,225,273,320]),176);
assert.equal(c.ruledHeaderBoundary({...compactGrid,vertical:[[100,80,320],[170,128,320]]},18,[80,176,225,273,320]),null);
const captionLines=c.positionedLines([{x:150,y:30,height:12,text:'8.1'},
  {x:20,y:29,height:12,text:'Т а б л и ц а'},{x:20,y:50,height:12,text:'Класс бетона'}]);
assert.deepEqual(Array.from(captionLines[0].tokens,token=>token.text),['Т а б л и ц а','8.1']);
const rows=[['2','4','6','8'],['0,23','0,25','0,26','0,28'],['0,41','0,42','0,45','0,48']];
const labels=rows.flatMap((row,i)=>row.map((text,j)=>({text,x:130+70*j,y:150+48*i,height:17})));
const headerGrid={...compactGrid,right:380,bottom:320,lines:[80,128,176,225,273,320]};
assert.equal(c.headerAboveDecimalRows(headerGrid,labels,18),176);
assert.equal(c.headerAboveDecimalRows(headerGrid,labels.slice(4),18),null);
const sparseImage={width:211,height:130,data:new Uint8ClampedArray(211*130*4).fill(255)};
for(const top of [29,79]){
  for(let y=top;y<top+12;y++){
    for(const left of [25,95]){
      for(let x=left;x<left+14;x++){
        const offset=(y*sparseImage.width+x)*4;
        sparseImage.data.fill(0,offset,offset+3);
      }
    }
  }
}
const sparseGrid={columns:[10,80,150,200],lines:[],bottom:115};
const sparse=c.bodyCells(sparseImage,sparseGrid,[23,43,63,83,103],13,12);
for(const column of [0,1]){
  assert.equal(sparse[0][column].span,2);
  assert.equal(sparse[2][column].span,3);
  assert(sparse[1][column].skip&&sparse[3][column].skip&&sparse[4][column].skip);
}
const decimalWidth=62,decimalHeight=42;
const decimalPixels=new Uint8ClampedArray(decimalWidth*decimalHeight*4).fill(255);
const drawInk=(left,top,right,bottom)=>{
  for(let y=top;y<bottom;y++){
    for(let x=left;x<right;x++){
      const offset=(y*decimalWidth+x)*4;
      decimalPixels.fill(0,offset,offset+3);
    }
  }
};
drawInk(0,0,61,2);
drawInk(9,9,19,33);
drawInk(29,9,40,33);
const decimalCanvas={width:decimalWidth,height:decimalHeight,getContext:()=>({getImageData:()=>({data:decimalPixels})})};
assert(!c.decimalInk(decimalCanvas,'2,0'));
drawInk(22,27,26,35);
assert(c.decimalInk(decimalCanvas,'2,0'));
assert(!c.decimalInk(decimalCanvas,'2,01'));
assert.equal(c.cleanedCellReading('```markdown\n\n```'),'');
assert.equal(c.cleanedCellReading('$i_x$ CM'),'$i_x$ CM');
function cellImage(width,height){
  const data=new Uint8ClampedArray(width*height*4).fill(255);
  return {canvas:{width,height,getContext:()=>({getImageData:()=>({data}),putImageData(){}})},
    ink(left,top,right,bottom){for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)data.fill(0,(y*width+x)*4,(y*width+x)*4+3);}};
}
const dash=cellImage(72,44);
dash.ink(22,20,50,23);
assert(c.printedDash(dash.canvas));
dash.ink(1,0,3,44);
assert(!c.printedDash(dash.canvas));
assert(c.edgeStroke(dash.canvas));
assert(c.clearCellRules(dash.canvas));
assert(c.printedDash(dash.canvas));
assert(!c.edgeStroke(dash.canvas));
const signs=cellImage(80,45);
signs.ink(10,10,13,27); signs.ink(4,17,19,20);
signs.ink(25,9,39,31);
assert.deepEqual(Array.from(c.plusMinusLines(signs.canvas)),[false]);
signs.ink(4,29,19,31);
assert.deepEqual(Array.from(c.plusMinusLines(signs.canvas)),[true]);
const fraction=cellImage(120,80);
fraction.ink(0,29,120,31);
assert.equal(c.fractionBar(fraction.canvas,13),undefined);
fraction.ink(44,43,78,45);
const bar=c.fractionBar(fraction.canvas,13);
assert.deepEqual([bar.left,bar.right,bar.top,bar.bottom],[44,78,43,44]);
console.log('PASS: grid, skew, merged cells, aligned sparse rows, multilevel headers, false rules, table captions');
