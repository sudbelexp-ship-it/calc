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
console.log('PASS: grid, grey rules, skew, close text rows, centered merged cells, multilevel header spans, false-rule rejection');
