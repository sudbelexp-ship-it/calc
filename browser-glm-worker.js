const GLM_ID = 'onnx-community/GLM-OCR-ONNX';
const GLM_PX = 2200000;
let glm = null, glmLoading = null, glmDl = null;

async function gpuSupport(){
  if (!self.isSecureContext) return 'Страница открыта по http, а WebGPU работает только по https. Откройте https://' + self.location.host + (self.location.pathname || '/') + ' (если не открывается — сертификат ещё выпускается).';
  if (!navigator.gpu) return 'В этом браузере нет WebGPU. Нужен свежий Chrome или Edge.';
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return 'WebGPU не нашёл видеокарту.';
    if (!a.features.has('shader-f16')) return 'Видеокарта не поддерживает shader-f16.';
  } catch (e) { return 'WebGPU недоступен: ' + e.message; }
  return '';
}

async function getGlm(){
  if (glm) return glm;
  if (!glmLoading) glmLoading = (async () => {
    
    const bad = await gpuSupport();
    if (bad) throw new Error(bad);
    const TX = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0');
    const cb = e => { if (e.progress != null && glmDl) glmDl(e.progress,e.file); };
    const [processor, model] = await Promise.all([
      TX.AutoProcessor.from_pretrained(GLM_ID, {progress_callback: cb}),
      TX.AutoModelForImageTextToText.from_pretrained(GLM_ID, {
        device: 'webgpu', dtype: 'q4f16', progress_callback: cb,
        use_external_data_format: {'vision_encoder_q4f16.onnx': 1, 'embed_tokens_q4f16.onnx': 1, 'decoder_model_merged_q4f16.onnx': 1}
      })
    ]);
    glm = {TX, processor, model};
    return glm;
  })().catch(e => { glmLoading = null; throw e; });
  return glmLoading;
}

function loopCut(g){
  for (const L of [12, 24, 48]) {
    if (g.length < 3 * L) continue;
    let same = true;
    for (let i = 1; i <= L && same; i++) if (g[g.length - i] !== g[g.length - L - i] || g[g.length - i] !== g[g.length - 2 * L - i]) same = false;
    if (same) return g.length - 2 * L;
  }
  return -1;
}

function fixUnits(t){
  const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
  if (cyr < 20) return t;
  const map = {kH: 'кН', kr: 'кг', cm: 'см', mm: 'мм', m: 'м'};
  return t.replace(/\\mathrm\{([A-Za-z]+)\}/g, (all, u) => map[u] ? '\\mathrm{' + map[u] + '}' : all);
}

async function glmRecognize(canvas, ctx){
  ctx.status('Загрузка модели…');
  glmDl = (p,file) => ctx.status('Загрузка '+(file||'GLM-OCR')+': ' + Math.round(p) + '%');
  const {TX, processor, model} = await getGlm();
  glmDl = null;
  const c2 = canvas;
  const image = new TX.RawImage(new Uint8ClampedArray(c2.data), canvas.width, canvas.height, 4);
  const prompt = processor.apply_chat_template([{role: 'user', content: [{type: 'image'}, {type: 'text', text: 'Text Recognition:'}]}], {add_generation_prompt: true});
  const inputs = await processor(prompt, image);
  const pl = inputs.input_ids.dims.at(-1);
  const stopper = new TX.InterruptableStoppingCriteria();
  const gen = []; let n = 0, cut = -1;
  const streamer = new TX.TextStreamer(processor.tokenizer, {
    skip_prompt: true, skip_special_tokens: true, callback_function: () => {},
    token_callback_function: ids => {
      n++; for (const id of ids) gen.push(Number(id));
      if (n % 8 === 0) ctx.status((ctx.stage || 'GLM-OCR') + ': ' + n + ' токенов');
      if (n % 16 === 0) { cut = loopCut(gen); if (cut !== -1) stopper.interrupt(); }
    }
  });
  let out;try { out = await model.generate({...inputs, max_new_tokens: 4096, do_sample: false, streamer, stopping_criteria: stopper});
  const end = cut === -1 ? out.dims.at(-1) : pl + cut;
  const text = processor.batch_decode(out.slice(null, [pl, end]), {skip_special_tokens: true})[0];
  return (text.replace(/^<think>[\s\S]*?<\/think>/, '').trim()) + (cut!==-1 || end-pl>=4096 ? '\n\n[?Генерация остановлена: возможен пропуск текста, сверьте страницу]' : '');} finally {out?.dispose?.();for(const v of Object.values(inputs))v?.dispose?.();}
}

self.onmessage=async e=>{const {pixels,width,height}=e.data;try{const text=await glmRecognize({data:pixels,width,height},{status:s=>self.postMessage({status:s})});self.postMessage({text});}catch(err){self.postMessage({error:err.message});}};
