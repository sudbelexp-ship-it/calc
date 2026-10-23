// Мост между веб-калькуляторами и Android-оболочкой БИЛДИНФОТЕХ.
// Подключается после загрузки каждой страницы. Делает так, чтобы веб-код работал без изменений:
//  - скачивание (a[download] с blob:/data:) → сохранение в «Загрузки/БИЛДИНФОТЕХ»;
//  - window.print() → системная печать Android (в т.ч. «Сохранить как PDF»);
//  - <input webkitdirectory> → выбор папки через системный диалог; файлы приходят событием «shell-folder».
(function () {
  if (window.__shell) return;
  var B = window.AndroidShell;
  if (!B) return;

  // На сайте есть ссылка «← ко всем калькуляторам» — в приложении она не нужна.
  var css = document.createElement('style');
  css.textContent = 'a[href="index.html"]{display:none!important}';
  document.head.appendChild(css);

  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  function save(href, name) {
    return fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      return toB64(blob).then(function (b64) { B.saveFile(name || 'file', blob.type || '', b64); });
    }).catch(function (e) { B.log('save failed: ' + e); });
  }

  var isLocal = function (h) { return /^(blob:|data:)/.test(h || ''); };

  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && isLocal(this.href)) { save(this.href, this.getAttribute('download')); return; }
    return anchorClick.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && isLocal(a.href)) { e.preventDefault(); save(a.href, a.getAttribute('download')); }
  }, true);

  window.print = function () { B.print(document.title || 'Отчёт'); };

  var pending = {}, seq = 1;
  var inputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && this.hasAttribute('webkitdirectory')) {
      var id = seq++;
      pending[id] = this;
      B.pickFolder(id, this.getAttribute('data-shell-ext') || '');
      return;
    }
    return inputClick.call(this);
  };

  function toItems(list) {
    return Promise.all(list.map(function (f) {
      return fetch(f.url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        return { file: new File([buf], f.name, { type: f.mime || '', lastModified: f.mtime || Date.now() }), rel: f.rel };
      });
    }));
  }

  window.__shell = {
    // id = -1 — файлы пришли не из диалога, а из приложения (данные «Спектр», Bluetooth)
    folderResult: function (id, list) {
      var input = pending[id] || document.querySelector('input[webkitdirectory]');
      delete pending[id];
      if (!list || !list.length || !input) return;
      toItems(list).then(function (items) {
        input.dispatchEvent(new CustomEvent('shell-folder', { detail: items }));
      }).catch(function (e) { B.log('load failed: ' + e); });
    }
  };

  B.ready();
})();
