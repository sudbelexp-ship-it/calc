// Stable Cache API storage independent of the HTML/Worker version query string.
async function configureModelCache(TX){
  TX.env.allowLocalModels=false;
  if(!self.caches){self.postMessage({cacheInfo:'Кеш моделей недоступен: повторная загрузка может потребовать интернет.'});return;}
  let cache;try{cache=await caches.open('bitexp-ocr-models-v1');}catch(e){TX.env.useBrowserCache=false;TX.env.useCustomCache=false;self.postMessage({cacheInfo:'Хранилище моделей заблокировано: '+e.message+'. Модель будет загружаться из сети.'});return;}
  TX.env.useBrowserCache=false;TX.env.useCustomCache=true;
  TX.env.customCache={
    async match(request){
      const found=await cache.match(request)||await caches.match(request);
      const url=typeof request==='string'?request:request.url;
      if(/onnx|tokenizer|config/.test(url))self.postMessage({cacheInfo:(found?'Из кеша: ':'Нет в кеше, запрос к сети: ')+url.split('/').pop()});
      return found;
    },
    async put(request,response){
      try{await cache.put(request,response);}catch(e){self.postMessage({cacheInfo:'Не удалось сохранить модель в кеш: '+e.message+'. Проверьте свободное место и разрешения хранения.'});}
    }
  };
}
