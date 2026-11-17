const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('browser-names.js','utf8'),ctx);
assert.equal(ctx.shortDocumentName('СП 20.13330.2016 Нагрузки и воздействия. Актуализированная редакция СНиП 2.01.07-85* (с Изменениями № 1-6).pdf'),'СП 20.13330.2016 Нагрузки и воздействия');
assert.equal(ctx.shortDocumentName('ГОСТ 8509-93 Уголки стальные горячекатаные равнополочные (с Изменением № 1).pdf'),'ГОСТ 8509-93 Уголки стальные горячекатаные равнополочные');
assert.equal(ctx.shortDocumentName('4293750590.pdf'),'');
assert.equal(ctx.inferDocumentName('СВОД ПРАВИЛ\nСП 20.13330.2016\nНагрузки и воздействия\nАктуализированная редакция'),'СП 20.13330.2016 Нагрузки и воздействия');
const html=fs.readFileSync('markitdown.html','utf8');assert(html.indexOf('id="analyzeAll"')>html.indexOf('id="mode"'));assert(html.indexOf('id="analyzeAll"')<html.indexOf('id="results"'));assert(html.includes('id="ocrPolicy"'));assert(!html.includes('id="ocrAll"'));
console.log('Passed: short SP/GOST names, numeric-filename fallback, title-page name, controls below settings, single OCR policy');
