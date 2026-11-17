const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={};vm.createContext(ctx);const source=fs.readFileSync('browser-djvu.js','utf8');vm.runInContext(source,ctx);
assert.equal(ctx.cleanDjvuText('Size\x1f25,0\x1d\x0bMass\x1f0.785\x00'),'Size 25,0\n\nMass 0.785');
assert(source.includes('worker.terminate()'));assert(source.includes('await waitResume(ctx)'));assert(source.indexOf('await loadPage')<source.indexOf('getImageData()'));assert(source.includes('45000000'));
const html=fs.readFileSync('markitdown.html','utf8');assert(html.includes('.djvu,.djv'));assert(html.includes('return convDjvu(file,ctx)'));assert(html.includes('id="aiPrompt"'));assert(html.includes("z.file('Промпт для ИИ.txt',AI_PROMPT)"));
assert(!html.includes('Microsoft MarkItDown'));assert(!html.includes('<b>Как это работает</b>'));
new vm.Script(fs.readFileSync('browser-ai-prompt.js','utf8'));
console.log('Passed: DJVU control separators/numbers, cleanup, cache-before-decoding, page limit, input dispatch, universal prompt, compact UI');
