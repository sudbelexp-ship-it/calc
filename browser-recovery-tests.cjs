const fs=require('node:fs/promises'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
async function main(){
const code=await fs.readFile('browser-storage.js','utf8');
const values=new Map();
const context={indexedDB:{open:()=>({})},$:()=>({}),crypto,TextEncoder,Blob,console,showDirectoryPicker:()=>{},window:{},setTimeout};
vm.createContext(context);vm.runInContext(code,context);
context.memoryGet=async k=>values.get(k);context.memoryPut=async(k,v)=>values.set(k,v);
vm.runInContext('dbGet=memoryGet;dbPut=memoryPut;',context);
const root='output/browser-recovery-test';await fs.mkdir(root,{recursive:true});
async function dir(path){return {getDirectoryHandle:async(n,o)=>{const p=path+'/'+n;if(o?.create)await fs.mkdir(p,{recursive:true});else try{await fs.access(p);}catch{const e=new Error();e.name='NotFoundError';throw e;}return dir(p);},getFileHandle:async(n,o)=>{const p=path+'/'+n;if(!o?.create)try{await fs.access(p);}catch{const e=new Error();e.name='NotFoundError';throw e;}return {createWritable:async()=>({write:async data=>fs.writeFile(p,typeof data==='string'?data:Buffer.from(await data.arrayBuffer())),close:async()=>{},abort:async()=>{}}),getFile:async()=>{const b=await fs.readFile(p);return new Blob([b]);}};}};}
const ctx={key:'source:modeA',dir:await dir(root)};
ctx.assets={'img/p001_formula_1.jpg':new Blob(['formula-crop']),'img/p001_tabl_1.jpg':new Blob(['table-crop'])};ctx.tableStats={layout:1,rows:1,columns:1,cells:[[{text:'25,0',alt:'250'}]]};ctx.formulaStats={count:1};
const page={text:'25,0\n![Формула](img/p001_formula_1.jpg)\n![Таблица](img/p001_tabl_1.jpg)',image:new Blob(['image-test'])};
await context.savePage(ctx,1,page.text,page.image);assert.equal(values.size,1);
values.clear();const restored=await context.loadPage(ctx,1);assert.equal(restored.text,page.text);assert.equal(await restored.image.text(),'image-test');assert.equal(values.size,1);
assert.equal(await restored.assets['img/p001_formula_1.jpg'].text(),'formula-crop');assert.equal(restored.table.cells[0][0].alt,'250');
assert(!context.pageAssetsComplete({...restored,image:new Blob([])},1));
assert(!context.pageAssetsComplete({...restored,assets:{}},1));
assert(!context.pageAssetsComplete(restored,2));
assert(!context.pageAssetsComplete({...restored,table:{rows:4,columns:3}},1));
values.clear();assert.equal(await context.loadPage({...ctx,key:'different:modeB'},1),null);
assert.equal(await context.loadPage(ctx,2),null);
assert.notEqual(await context.resultLabel({name:'test.pdf'},'file:modeA'),await context.resultLabel({name:'test.pdf'},'file:modeB'));
vm.runInContext(await fs.readFile('browser-names.js','utf8'),context);
const namedRoot=await dir(root+'/named');await fs.mkdir(root+'/named',{recursive:true});
const title='СП 20.13330.2016 Нагрузки и воздействия';
const first={key:'name-source-1',file:{name:'1.pdf'},output:namedRoot};await context.ensureDocumentDir(first,title);assert.equal(first.label,title);
const second={key:'name-source-2',file:{name:'2.pdf'},output:namedRoot};await context.ensureDocumentDir(second,title);assert.equal(second.label,title+' (2)');
const again={key:'name-source-1',file:{name:'1.pdf'},output:namedRoot};await context.ensureDocumentDir(again,title);assert.equal(again.label,title);
console.log('Passed: atomic-page export, restore with empty browser cache, reject other mode/source, missing page, distinct output directories');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
