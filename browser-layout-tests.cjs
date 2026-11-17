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
console.log('PASS: grid, grey rules, skew, row clustering, blank-page rejection');
