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
const page={version:'browser-3.0',text:'25,0',image:new Blob(['image-test'])};
await context.savePage(ctx,1,page.text,page.image);assert.equal(values.size,1);
values.clear();const restored=await context.loadPage(ctx,1);assert.equal(restored.text,page.text);assert.equal(await restored.image.text(),'image-test');assert.equal(values.size,1);
values.clear();assert.equal(await context.loadPage({...ctx,key:'different:modeB'},1),null);
assert.equal(await context.loadPage(ctx,2),null);
assert.notEqual(await context.resultLabel({name:'test.pdf'},'file:modeA'),await context.resultLabel({name:'test.pdf'},'file:modeB'));
console.log('Passed: atomic-page export, restore with empty browser cache, reject other mode/source, missing page, distinct output directories');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
