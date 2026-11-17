const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
async function main(){
const messages=[],items=new Map(),legacy=new Map([['https://models/existing',new Response('old')]]);
const cache={match:async k=>items.get(k)?.clone(),put:async(k,v)=>items.set(k,v.clone())};
const context={self:{caches:{},postMessage:m=>messages.push(m)},caches:{open:async name=>{assert.equal(name,'bitexp-ocr-models-v1');return cache;},match:async k=>legacy.get(k)?.clone()}};
vm.createContext(context);vm.runInContext(fs.readFileSync('browser-model-cache.js','utf8'),context);
const TX={env:{}};await context.configureModelCache(TX);assert.equal(TX.env.useCustomCache,true);
assert.equal(await(await TX.env.customCache.match('https://models/existing')).text(),'old');
await TX.env.customCache.put('https://models/a.onnx_data',new Response('weights'));
// New Worker/environment, same persistent cache; no network implementation exists in test.
const reopened={env:{}};await context.configureModelCache(reopened);
assert.equal(await(await reopened.env.customCache.match('https://models/a.onnx_data')).text(),'weights');
assert(messages.some(m=>m.cacheInfo.startsWith('Из кеша:')));
console.log('Passed: stable cache across Worker restarts, reuse legacy cache, cache-read status');
}main().catch(e=>{console.error(e);process.exitCode=1;});
