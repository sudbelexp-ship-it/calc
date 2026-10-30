/* Общее переключение светлой/тёмной темы для всех страниц сайта. По умолчанию — светлая. */
(function(){
  var KEY="bit_theme", root=document.documentElement;
  function get(){ try{ return localStorage.getItem(KEY)==="dark"?"dark":"light"; }catch(e){ return "light"; } }
  function label(t){ return t==="dark"?"Дневной режим":"Ночной режим"; }
  function apply(t){
    root.setAttribute("data-theme",t); root.style.colorScheme=t;
    var b=document.getElementById("bitTheme"); if(b){ b.textContent=t==="dark"?"☀":"☾"; b.title=label(t); b.setAttribute("aria-label",label(t)); }
    try{ window.dispatchEvent(new CustomEvent("bit-theme",{detail:t})); }catch(e){}
  }
  function set(t){ try{ localStorage.setItem(KEY,t); }catch(e){} apply(t); }
  function toggle(){ set(get()==="dark"?"light":"dark"); }
  window.BitTheme={get:get,set:set,toggle:toggle};
  apply(get());
  window.addEventListener("storage",function(e){ if(e.key===KEY) apply(get()); });
  function inject(){
    if(document.getElementById("btnTheme")||document.getElementById("bitTheme")) return;
    var st=document.createElement("style");
    st.textContent="#bitTheme{position:fixed;top:10px;right:10px;z-index:1000;width:36px;height:36px;border-radius:50%;border:1px solid rgba(128,128,150,.45);background:rgba(255,255,255,.85);color:#333;font:18px/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(6px)}:root[data-theme=dark] #bitTheme{background:rgba(30,32,44,.85);color:#f0e8b0}#bitTheme:hover{border-color:#7d74f2}@media print{#bitTheme{display:none}}";
    document.head.appendChild(st);
    var b=document.createElement("button"); b.id="bitTheme"; b.type="button"; b.addEventListener("click",toggle);
    document.body.appendChild(b); apply(get());
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",inject); else inject();
})();
