const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const OPS={save:1,restore:2,transform:3,setTextRenderingMode:4,paintImageXObject:5,paintInlineImageXObject:6};
const transform=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
let allocated=0;
const c={MAX_PX:4_000_000,pdfjsLib:{OPS,Util:{transform}},document:{
  createElement(){allocated++;return {getContext:()=>({})};},
}};
vm.createContext(c);vm.runInContext(fs.readFileSync('browser-pdf.js','utf8'),c);
assert(c.hasScanLayer({fnArray:[4],argsArray:[[3]]},10000));
assert(c.hasScanLayer({fnArray:[3,5],argsArray:[[100,0,0,100,0,0],['image']]},10000));
assert(!c.hasScanLayer({fnArray:[3,5],argsArray:[[10,0,0,10,0,0],['small-figure']]},10000));
assert(!c.hasScanLayer({fnArray:[1,3,2,5],argsArray:[[],[100,0,0,100,0,0],[],['small-figure']]},10000));
assert(c.hasScanLayer({fnArray:[],argsArray:[]},10000,{f:{fontFamily:'GlyphLessFont'}}));
vm.runInContext(fs.readFileSync('browser-formulas.js','utf8'),c);
const identity=[1,0,0,1,0,0];
const item=(str,x,y,width)=>({str,width,transform:[10,0,0,10,x,y]});
const candidates=[item('(8.4)',820,210,28),item('(8.9)',860,260,29),item('(8.10)',853,370,36)];
const regions=c.formulaRegions(candidates,{scale:1,transform:identity},1000,1000);
assert.deepEqual(Array.from(regions,r=>r.label),['(8.9)','(8.10)']);
assert.equal(c.formulaRegions([candidates[1]],{scale:1,transform:identity},1000,1000).length,1);
assert(c.incompleteFraction(String.raw`\eta=\frac{1}{1-\frac{N}{ }}`));
assert(c.incompleteFraction(String.raw`\dfrac{{x} + y}{`));
assert(!c.incompleteFraction(String.raw`\eta=\frac{1}{1-\frac{N}{N_{cr}}}`));
async function checkPatches(){
  const normal=c.pdfPatchGeometry([10,20,510,820],2.5);
  assert.deepEqual({...normal},{width:1250,height:2000,scale:2.5,reduced:false});
  const box=[60,70,4060,4070],m=[0,1,-1,0,200,100];
  const oversized=c.pdfPatchGeometry(box,3.5);
  assert(oversized.reduced&&oversized.width*oversized.height<=4_000_000);
  assert.equal(oversized.width,2000);
  assert.equal(oversized.height,2000);
  assert.equal(Math.ceil(4000*oversized.scale),2000);
  let render;
  const page={
    getViewport:({scale})=>({scale,width:1200*scale}),
    render(options){render=options;return {promise:Promise.resolve()};},
  };
  assert.equal(await c.renderPdfPatch(page,{width:1200},{pageMatrix:m},box,true),null);
  assert.equal(allocated,0,'Oversized strip skipped before creating a canvas');
  const detail=await c.renderPdfPatch(page,{width:1200},{pageMatrix:m},box);
  assert(detail.canvas.width*detail.canvas.height<=4_000_000);
  assert.equal(detail.scale,render.viewport.scale);
  assert.deepEqual(Array.from(render.transform),[0,1,-1,0,140*detail.scale,30*detail.scale]);
}
checkPatches().then(()=>console.log('PASS: PDF scan detection, formula labels, capped crops and skipped oversized strips'))
  .catch(error=>{console.error(error);process.exitCode=1;});
