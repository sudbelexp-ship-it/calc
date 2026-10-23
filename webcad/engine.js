/* =====================================================================
   Движок поверочных расчётов (резерв webcad).
   - мини-язык формул: одна строка → вычисление, общий вид, подстановка;
   - построитель отчёта R (заголовки, формулы, проверки, таблицы);
   - вывод отчёта в HTML и в Word (.docx с редактируемыми формулами).
   Работает и в браузере, и в Node (для автотестов).
   ===================================================================== */
(function(G){
"use strict";
const WC = G.WC = G.WC || {};
WC.CALC = WC.CALC || {};
WC.reg = (code, def) => { def.code = code; WC.CALC[code] = def; };

/* ---------------- единицы и материалы ---------------- */
// webcad считает в кгс: 1 МПа = 1/0,0981 кгс/см²
const MPA = WC.MPA = 1/0.0981;
// СП 63.13330.2018: Rb, Rbt (табл. 6.8), Rb,n=Rb,ser, Rbt,n=Rbt,ser (табл. 6.7), Eb (табл. 6.11), φb,cr при влажности 40–75 % (табл. 6.12) — МПа
WC.BET = {
  "B10":  {Rb:6.0, Rbt:0.56,Rbn:7.5, Rbtn:0.85,Eb:19000,fcr:2.8},
  "B12,5":{Rb:7.5, Rbt:0.66,Rbn:9.5, Rbtn:1.00,Eb:21500,fcr:3.2},
  "B15":  {Rb:8.5, Rbt:0.75,Rbn:11.0,Rbtn:1.10,Eb:24000,fcr:3.4},
  "B20":  {Rb:11.5,Rbt:0.90,Rbn:15.0,Rbtn:1.35,Eb:27500,fcr:2.8},
  "B25":  {Rb:14.5,Rbt:1.05,Rbn:18.5,Rbtn:1.55,Eb:30000,fcr:2.5},
  "B30":  {Rb:17.0,Rbt:1.15,Rbn:22.0,Rbtn:1.75,Eb:32500,fcr:2.3},
  "B35":  {Rb:19.5,Rbt:1.30,Rbn:25.5,Rbtn:1.95,Eb:34500,fcr:2.1},
  "B40":  {Rb:22.0,Rbt:1.40,Rbn:29.0,Rbtn:2.10,Eb:36000,fcr:1.9},
  "B45":  {Rb:25.0,Rbt:1.50,Rbn:32.0,Rbtn:2.25,Eb:37000,fcr:1.8},
  "B50":  {Rb:27.5,Rbt:1.60,Rbn:36.0,Rbtn:2.45,Eb:38000,fcr:1.6},
  "B55":  {Rb:30.0,Rbt:1.70,Rbn:39.5,Rbtn:2.60,Eb:39000,fcr:1.5},
  "B60":  {Rb:33.0,Rbt:1.80,Rbn:43.0,Rbtn:2.75,Eb:39500,fcr:1.4},
};
// fcr для влажности: [>75 %, 40–75 %, <40 %] (табл. 6.12)
WC.FCR = {"B10":[1.9,2.8,3.4],"B12,5":[2.2,3.2,3.8],"B15":[2.4,3.4,4.0],"B20":[2.0,2.8,3.4],"B25":[1.8,2.5,3.0],"B30":[1.6,2.3,2.7],
  "B35":[1.5,2.1,2.5],"B40":[1.4,1.9,2.3],"B45":[1.3,1.8,2.2],"B50":[1.2,1.6,2.0],"B55":[1.1,1.5,1.8],"B60":[1.0,1.4,1.7]};
// арматура: Rs, Rsc (длит./кратк.), Rsw, Rsn (МПа). СП 63.13330.2018 табл. 6.13–6.15; А500СП, Ау500СП, А600СП — СТО 36554501-065-2020*
WC.ARM = {
  "A240": {Rs:210,RscL:210,RscS:210,Rsw:170,Rsn:240},
  "A400": {Rs:350,RscL:350,RscS:350,Rsw:280,Rsn:400},
  "A500": {Rs:435,RscL:400,RscS:435,Rsw:300,Rsn:500},
  "A600": {Rs:520,RscL:400,RscS:470,Rsw:null,Rsn:600},
  "A500СП":{Rs:435,RscL:400,RscS:435,Rsw:300,Rsn:500},
  "Ау500СП":{Rs:435,RscL:400,RscS:435,Rsw:300,Rsn:500},
  "A600СП":{Rs:520,RscL:400,RscS:470,Rsw:null,Rsn:600},
};
WC.ES = 200000;
WC.betNames = Object.keys(WC.BET).map(k=>[k,k]);
WC.armNames = Object.keys(WC.ARM).map(k=>[k,k]);

/* ---------------- форматирование чисел ---------------- */
const SUP = {"-":"⁻","0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
const toSup = s => String(s).split("").map(c=>SUP[c]||c).join("");
const dec = (v,d) => { let s=v.toFixed(d); if(d>0) s=s.replace(/0+$/,"").replace(/\.$/,""); return s.replace("-","−").replace(".",","); };
// число в «инженерном» виде: 4 значащие цифры, большие — ×10³ⁿ
function fmt(v, o={}){
  if(v===null||v===undefined||Number.isNaN(v)) return "—";
  if(!Number.isFinite(v)) return v>0?"∞":"−∞";
  if(typeof o==="number") o={d:o};
  if(o.d!==undefined){ return dec(v,o.d); }
  const a=Math.abs(v);
  if(a===0) return "0";
  if(a>=1e5 || (a<1e-3)){
    let e = a>=1e5 ? 3*Math.floor(Math.log10(a)/3) : Math.floor(Math.log10(a));
    let m = v/Math.pow(10,e);
    let ms = a>=1e5 ? (Math.abs(m)>=100?m.toFixed(1):Math.abs(m)>=10?m.toFixed(2):m.toFixed(3)) : m.toFixed(3);
    ms = ms.replace("-","−").replace(".",",");
    return {mant:ms, exp:e, toString(){return ms+"·10"+toSup(e);}};
  }
  const d = a>=1000?0 : a>=100?1 : a>=10?2 : a>=1?3 : a>=0.1?3 : 4;
  return dec(v, d);
}
WC.fmt = v => String(fmt(v));
WC.fmtd = (v,d) => String(fmt(v,{d}));

/* ---------------- мини-язык формул ----------------
   Идентификаторы: R_b, R_{b,ser}, A'_s, phi_l, xi_R, e_0, l_0, M_{l1}, x^2 …
   Операции: + − * / ^ ( ) ; функции sqrt sin cos tan atan abs ln exp min max floor
   «*» в общем виде не печатается (bh0), в подстановке — «·».
   «/» — дробь; «//» — строчная косая черта.                                   */
const GREEK = {alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",eps:"ε",zeta:"ζ",eta:"η",theta:"θ",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",pi:"π",
  rho:"ρ",sigma:"σ",tau:"τ",phi:"φ",chi:"χ",psi:"ψ",omega:"ω",Delta:"Δ",Sigma:"Σ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",Lambda:"Λ"};
const FUN = {sqrt:Math.sqrt,sin:Math.sin,cos:Math.cos,tan:Math.tan,tg:Math.tan,atan:Math.atan,arctg:Math.atan,abs:Math.abs,ln:Math.log,exp:Math.exp,
  min:Math.min,max:Math.max,floor:Math.floor,log10:Math.log10,lg:Math.log10};
function tokenize(s){
  const T=[]; let i=0;
  while(i<s.length){
    const c=s[i];
    if(/\s/.test(c)){i++;continue;}
    if(/[0-9.]/.test(c)){ let j=i; while(j<s.length&&/[0-9.]/.test(s[j]))j++;
      if(s[j]==="e"&&/[-+0-9]/.test(s[j+1]||"")){ j++; if(/[-+]/.test(s[j]))j++; while(/[0-9]/.test(s[j]||""))j++; }
      T.push({t:"num",v:parseFloat(s.slice(i,j)),src:s.slice(i,j)}); i=j; continue; }
    if(/[A-Za-zА-Яа-яЁё]/.test(c)){ // идентификатор: буквы, затем ' , затем _sub , затем ^sup (^ только если сразу { )
      let j=i; while(j<s.length&&/[A-Za-zА-Яа-яЁё]/.test(s[j]))j++; while(j<s.length&&/[0-9]/.test(s[j]))j++;
      const base=s.slice(i,j); let primes=""; while(s[j]==="'"){primes+="'";j++;}
      let sub=null;
      if(s[j]==="_"){ j++; if(s[j]==="{"){ let k=s.indexOf("}",j); sub=s.slice(j+1,k); j=k+1; } else { let k=j; while(k<s.length&&/[A-Za-z0-9А-Яа-яЁё]/.test(s[k]))k++; sub=s.slice(j,k); j=k; } }
      T.push({t:"id",base,primes,sub}); i=j; continue; }
    if(c==="/"&&s[i+1]==="/"){T.push({t:"op",v:"//"});i+=2;continue;}
    if("+-*/^(),".includes(c)){T.push({t:"op",v:c});i++;continue;}
    if(c==="<"&&s[i+1]==="="){T.push({t:"op",v:"≤"});i+=2;continue;}
    if(c===">"&&s[i+1]==="="){T.push({t:"op",v:"≥"});i+=2;continue;}
    if("=<>≤≥≠≈".includes(c)){T.push({t:"op",v:c});i++;continue;}
    if(c==="−"){T.push({t:"op",v:"-"});i++;continue;}
    if(c==="·"){T.push({t:"op",v:"*"});i++;continue;}
    throw new Error("Формула: непонятный символ «"+c+"» в «"+s+"»");
  }
  return T;
}
// AST: {k:"num",v} {k:"var",key,base,primes,sub} {k:"bin",op,a,b} {k:"neg",a} {k:"par",a} {k:"fn",f,args}
function parse(src){
  const T=tokenize(src); let p=0;
  const peek=()=>T[p], eat=v=>{ if(T[p]&&T[p].v===v){p++;return true;} return false; };
  function rel(){ let a=expr(); while(T[p]&&T[p].t==="op"&&"=<>≤≥≠≈".includes(T[p].v)){ const op=T[p++].v; a={k:"rel",op,a,b:expr()}; } return a; }
  function expr(){ let a=term(); for(;;){ if(eat("+"))a={k:"bin",op:"+",a,b:term()}; else if(eat("-"))a={k:"bin",op:"-",a,b:term()}; else return a; } }
  function term(){ let a=unary(); for(;;){ if(eat("*"))a={k:"bin",op:"*",a,b:unary()}; else if(eat("//"))a={k:"bin",op:"//",a,b:unary()}; else if(eat("/"))a={k:"bin",op:"/",a,b:unary()}; else return a; } }
  function unary(){ if(eat("-")) return {k:"neg",a:unary()}; return power(); }
  function power(){ let a=atom(); if(eat("^")) return {k:"bin",op:"^",a,b:unary()}; return a; }
  function atom(){
    const t=T[p++]; if(!t) throw new Error("Формула оборвана: "+src);
    if(t.t==="num") return {k:"num",v:t.v,src:t.src};
    if(t.t==="id"){
      if(FUN[t.base]&&!t.sub&&!t.primes&&T[p]&&T[p].v==="("){ p++; const args=[expr()]; while(eat(","))args.push(expr()); if(!eat(")"))throw new Error("нет ) в "+src); return {k:"fn",f:t.base,args}; }
      const key=t.base+t.primes+(t.sub!==null?"_"+t.sub:"");
      return {k:"var",key,base:t.base,primes:t.primes,sub:t.sub};
    }
    if(t.v==="("){ const a=expr(); if(!eat(")"))throw new Error("нет ) в "+src); return {k:"par",a}; }
    throw new Error("Формула: неожиданное «"+t.v+"» в «"+src+"»");
  }
  const r=rel(); if(p<T.length) throw new Error("Формула: лишнее «"+T[p].v+"» в «"+src+"»"); return r;
}
const CACHE={};
const ast = s => CACHE[s] || (CACHE[s]=parse(s));
function evalAst(n,S){
  switch(n.k){
    case "num": return n.v;
    case "var": if(n.key in S) return S[n.key]; if(n.key==="pi") return Math.PI; throw new Error("Не задана величина "+n.key);
    case "neg": return -evalAst(n.a,S);
    case "par": return evalAst(n.a,S);
    case "rel": throw new Error("сравнение нельзя вычислить");
    case "fn": return FUN[n.f](...n.args.map(a=>evalAst(a,S)));
    case "bin": { const a=evalAst(n.a,S), b=evalAst(n.b,S);
      switch(n.op){case "+":return a+b;case "-":return a-b;case "*":return a*b;case "/":case "//":return a/b;case "^":return Math.pow(a,b);} }
  }
}
WC.ev = (s,S) => evalAst(ast(s),S);

/* Промежуточное дерево отображения (общее для HTML и Word):
   {r:"t",s,it}  текст (it — курсив)        {r:"row",c:[...]}
   {r:"sub",b,s,sup}  индекс/степень        {r:"fr",n,d}   дробь
   {r:"sq",c}  корень                       {r:"par",c}    скобки                  */
const T_=(s,it)=>({r:"t",s,it:!!it});
// особые обозначения: kr → (1/r), ratio → As,cal/As,ef
const ALIAS={
  kr:n=>({r:"par",c:{r:"fr",n:T_("1"),d:T_("r",true)}}),
  ratio:()=>({r:"fr",n:{r:"sub",b:T_("A",true),s:T_("s,cal"),sup:null},d:{r:"sub",b:T_("A",true),s:T_("s,ef"),sup:null}}),
};
WC.ALIAS=ALIAS;
function symNode(n){
  if(ALIAS[n.key]) return ALIAS[n.key](n);
  if(ALIAS[n.base]){ const b=ALIAS[n.base](n); return n.sub!==null?{r:"sub",b,s:T_(n.sub),sup:null}:b; }
  const g=GREEK[n.base]; const pr=n.primes?n.primes.replace(/'/g,"′"):""; const base=g?T_(g+pr,false):T_(n.base+pr, true);
  const sub=n.sub!==null? T_(n.sub.split("").map(c=>GREEK[c]||c).join("").replace(/(alpha|beta|gamma|delta|phi|xi|eta|mu|nu|psi|sigma|tau|lambda|rho|eps)/g,m=>GREEK[m]),false):null;
  const sup=null;
  if(!sub&&!sup) return base;
  return {r:"sub",b:base,s:sub,sup};
}
function numNode(v){ const f=fmt(v); if(typeof f==="object") return {r:"row",c:[T_(f.mant),{r:"sub",b:T_("·10"),s:null,sup:T_(String(f.exp).replace("-","−"))}]}; return T_(f); }
const PREC={"+":1,"-":1,"*":2,"/":3,"//":2,"^":4};
// mode: "sym" — общий вид; "num" — подстановка значений из S
function disp(n,mode,S){
  const D=x=>disp(x,mode,S), row=(...c)=>({r:"row",c});
  switch(n.k){
    case "num": return T_(n.src.replace(".",","));
    case "var":
      if(mode==="num"&&n.key!=="pi"){ const v=S[n.key]; const nd=numNode(v); return v<0?{r:"par",c:nd}:nd; }
      return n.key==="pi"?T_("π"):symNode(n);
    case "neg": return row(T_("−"),D(n.a));
    case "par": return {r:"par",c:D(n.a)};
    case "rel": return row(D(n.a),T_(" "+n.op+" "),D(n.b));
    case "fn":
      if(n.f==="sqrt") return {r:"sq",c:D(n.args[0])};
      if(n.f==="abs") return row(T_("|"),D(n.args[0]),T_("|"));
      { const nm={tan:"tg",atan:"arctg",log10:"lg"}[n.f]||n.f; const args=[]; n.args.forEach((a,i)=>{ if(i)args.push(T_("; ")); args.push(D(a)); });
        return row(T_(nm+" "),{r:"par",c:row(...args)}); }
    case "bin": {
      if(n.op==="/") return {r:"fr",n:D(n.a.k==="par"?n.a.a:n.a),d:D(n.b.k==="par"?n.b.a:n.b)};
      if(n.op==="^") return {r:"sub",b:D(n.a),s:null,sup:D(n.b)};
      if(n.op==="//") return row(D(n.a),T_("/"),D(n.b));
      if(n.op==="*"){
        let dot = mode==="num";
        if(!dot){ // общий вид: точку ставим только между числами и в «число·число»
          const L=lastLeaf(n.a), Rr=firstLeaf(n.b);
          dot = (L==="num"&&Rr==="num") || Rr==="num";
        }
        return row(D(n.a), dot?T_("\u2009·\u2009"):T_(""), D(n.b));
      }
      return row(D(n.a),T_(n.op==="-"?" − ":" + "),D(n.b));
    }
  }
}
function lastLeaf(n){ if(n.k==="bin"&&n.op!=="/"&&n.op!=="^") return lastLeaf(n.b); if(n.k==="neg") return lastLeaf(n.a); return n.k==="num"?"num":"x"; }
function firstLeaf(n){ if(n.k==="bin"&&n.op!=="/") return firstLeaf(n.a); return n.k==="num"?"num":n.k==="neg"?"num":"x"; }
WC.sym = s => disp(ast(s),"sym");
WC.symId = s => { const a=ast(s); return disp(a,"sym"); };

/* ---------------- построитель отчёта ---------------- */
function Report(){
  this.items=[]; this.S={}; this.checks=[]; this.mats=[]; this.results=[]; this.notes=[];
}
Report.prototype = {
  set(o){ Object.assign(this.S,o); return this; },
  h(s){ this.items.push({k:"h",s}); return this; },
  t(s){ this.items.push({k:"t",s}); return this; },       // текст; $...$ — встроенная формула (общий вид)
  note(s){ this.items.push({k:"note",s}); this.notes.push(s); return this; },
  mat(label, sym, v, unit){ this.mats.push({label,sym,v,unit}); this.S[ast(sym).key||sym]=v; return this; },
  // переменная = формула = подстановка = результат [ед.] (ссылка)
  eq(lhs, expr, unit, ref, o={}){
    const A=ast(expr), v=evalAst(A,this.S); const key=ast(lhs).key; if(key) this.S[key]=v;
    const simple = A.k==="num" || (A.k==="var");
    this.items.push({k:"eq", lhs:disp(ast(lhs),"sym"), sym: simple&&A.k==="num"?null:disp(A,"sym"), num:(o.nosub||simple)?null:disp(A,"num",this.S), v:o.d!==undefined?T_(fmt(v,o.d)):numNode(v), unit, ref});
    return v;
  },
  // показать значение без формулы: lhs = v
  val(lhs, v, unit, ref, o={}){ const key=ast(lhs).key; if(key) this.S[key]=v;
    this.items.push({k:"eq", lhs:disp(ast(lhs),"sym"), sym:null, num:null, v:o.d!==undefined?T_(fmt(v,o.d)):(typeof v==="string"?T_(v):numNode(v)), unit, ref}); return v; },
  // проверка: левая ≤ (или ≥) правая; регистрирует коэффициент использования
  chk(name, left, op, right, unit, ref, o={}){
    const lv = typeof left==="number"?left:evalAst(ast(left),this.S), rv = typeof right==="number"?right:evalAst(ast(right),this.S);
    const ok = op==="≤"||op==="<" ? lv<=rv : lv>=rv;
    const k = op==="≤"||op==="<" ? lv/rv : rv/lv;
    const side=(e,v)=>{ if(typeof e==="number") return {lhs:null,sym:null,num:null,v:numNode(v)};
      const A=ast(e); const simple=A.k==="var"||A.k==="num"; return {lhs:null,sym:disp(A,"sym"),num:simple?null:disp(A,"num",this.S),v:numNode(v)}; };
    this.items.push({k:"chk", L:side(left,lv), R:side(right,rv), op: ok?op:({"≤":"≰","<":"≮","≥":"≱",">":"≯"}[op]), unit, ref, ok});
    this.checks.push({name, ref:ref||"", act:lv, lim:rv, k, ok, unit, info:o.info});
    return ok;
  },
  tbl(head, rows, o={}){ this.items.push({k:"tbl",head,rows,cap:o.cap,w:o.w,left:o.left}); return this; },
  kv(rows){ this.items.push({k:"kv",rows}); return this; },                       // таблица «параметр — значение»
  img(key,cap){ this.items.push({k:"img",key,cap}); return this; },                // рисунок из meta.imgs[key]
  msg(kind,title,text){ this.items.push({k:"msg",kind,title,text}); return this; }, // цветной вывод ok|mid|bad
  res(s){ this.results.push(s); return this; },  // итоговая формулировка (для расчётов-подборов)
};
WC.Report = Report;

/* ---------------- запуск расчёта ---------------- */
WC.run = function(code, v){
  const def=WC.CALC[code]; const R=new Report();
  // исходные величины из полей с символами
  (def.groups||[]).forEach(g=>g.f.forEach(fd=>{ if(fd.sym&&fd.t==="n"&&(!fd.showIf||fd.showIf(v))){ try{ const k=ast(fd.sym).key; if(k) R.S[k]=v[fd.id]; }catch(e){} } }));
  def.run(v,R);
  const worst = R.checks.filter(c=>!c.info).reduce((m,c)=>(!m||c.k>m.k)?c:m,null);
  R.ok = R.checks.filter(c=>!c.info).every(c=>c.ok);
  R.k = worst?worst.k:null; R.worst=worst;
  return R;
};

/* ---------------- HTML-рендер формул ---------------- */
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function h(n){
  if(!n) return "";
  switch(n.r){
    case "t": return n.it?`<i>${esc(n.s)}</i>`:esc(n.s);
    case "row": return n.c.map(h).join("");
    case "sub": return n.s&&n.sup ? `<span class="ms">${h(n.b)}<span class="ss"><span>${h(n.sup)}</span><span>${h(n.s)}</span></span></span>`
                      : `<span class="ms">${h(n.b)}${n.sup?`<sup>${h(n.sup)}</sup>`:""}${n.s?`<sub>${h(n.s)}</sub>`:""}</span>`;
    case "fr": return `<span class="mf"><span>${h(n.n)}</span><span>${h(n.d)}</span></span>`;
    case "sq": return `<span class="mq">√<span>${h(n.c)}</span></span>`;
    case "par": return `(${h(n.c)})`;
  }
  return "";
}
WC.html = h;
// $...$ внутри текста → формула (общий вид)
WC.inline = s => esc(s).replace(/\$([^$]+)\$/g,(m,f)=>{ try{ return `<span class="mi">${h(disp(ast(f.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")),"sym"))}</span>`; }catch(e){ return f; } });
function eqHtml(it){
  const parts=[h(it.lhs)]; if(it.sym) parts.push(h(it.sym)); if(it.num) parts.push(h(it.num)); parts.push(h(it.v)+(it.unit?" "+esc(it.unit):""));
  return parts.join(" = ");
}
function sideHtml(s){ const p=[]; if(s.sym)p.push(h(s.sym)); if(s.num)p.push(h(s.num)); p.push(h(s.v)); return p.join(" = "); }
WC.reportHtml = function(R,imgs){
  let out="", hn=0;
  R.items.forEach(it=>{
    if(it.k==="h"){ hn++; out+=`<h4>${esc(it.s)}</h4>`; }
    else if(it.k==="t") out+=`<p class="rt">${WC.inline(it.s)}</p>`;
    else if(it.k==="note") out+=`<div class="note">${WC.inline(it.s)}</div>`;
    else if(it.k==="eq") out+=`<div class="req"><div class="m">${eqHtml(it)}</div><div class="ref">${esc(it.ref||"")}</div></div>`;
    else if(it.k==="chk") out+=`<div class="req ${it.ok?"":"bad"}"><div class="m">${sideHtml(it.L)} <b class="op">${it.op}</b> ${sideHtml(it.R)}${it.unit?" "+esc(it.unit):""}</div><div class="ref">${esc(it.ref||"")}</div></div>`;
    else if(it.k==="kv") out+=`<div class="tw"><table class="rtab kvt">${it.rows.map(r=>`<tr><td>${WC.inline(String(r[0]))}</td><td>${WC.inline(String(r[1]))}</td></tr>`).join("")}</table></div>`;
    else if(it.k==="msg") out+=`<div class="rmsg ${it.kind}"><b>${WC.inline(it.title)}</b>${it.text?"<div>"+WC.inline(it.text)+"</div>":""}</div>`;
    else if(it.k==="img"){ if(imgs&&imgs[it.key]) out+=`<figure class="rfig">${imgs[it.key]}${it.cap?`<figcaption>${esc(it.cap)}</figcaption>`:""}</figure>`; }
    else if(it.k==="tbl") out+=`<div class="tw"><table class="rtab">${it.cap?`<caption>${esc(it.cap)}</caption>`:""}<thead><tr>${it.head.map(c=>`<th>${WC.inline(String(c))}</th>`).join("")}</tr></thead><tbody>${it.rows.map(r=>`<tr>${r.map(c=>`<td>${typeof c==="number"?esc(WC.fmt(c)):WC.inline(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  });
  return out;
};

/* ---------------- Word (.docx) ---------------- */
WC.docx = async function(def, v, R, meta){
  const D=G.docx; if(!D) throw new Error("Библиотека docx не загружена");
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,AlignmentType,BorderStyle,ShadingType,Header,Footer,PageNumber,
    TabStopType,VerticalAlign,TableLayoutType,ImageRun,MathRun,MathFraction,MathSubScript,MathSuperScript,MathSubSuperScript,MathRadical,MathRoundBrackets}=D;
  const FONT="Times New Roman", ACC="1F3A93", GREY="6B7280", LINE="C9CED6", OK="1A7F4B", BAD="B42318", WARN="9A5A00";
  const verified = meta.verified;
  const T=(t,o={})=>new TextRun({text:t,font:FONT,size:o.size||24,bold:o.b,italics:o.i,color:o.c});
  const P=(runs,o={})=>new Paragraph({children:Array.isArray(runs)?runs:[T(runs,o)],alignment:o.al,spacing:{before:o.before||0,after:o.after??80,line:276},indent:o.ind?{firstLine:o.ind}:undefined,keepNext:o.keepNext});
  // формула → OMML
  const om=n=>{ if(!n) return [];
    switch(n.r){
      case "t": return n.s===""?[]:[new MathRun(n.s)];
      case "row": return n.c.flatMap(om);
      case "sub": if(n.s&&n.sup) return [new MathSubSuperScript({children:om(n.b),subScript:om(n.s),superScript:om(n.sup)})];
                  if(n.s) return [new MathSubScript({children:om(n.b),subScript:om(n.s)})];
                  return [new MathSuperScript({children:om(n.b),superScript:om(n.sup)})];
      case "fr": return [new MathFraction({numerator:om(n.n),denominator:om(n.d)})];
      case "sq": return [new MathRadical({children:om(n.c)})];
      case "par": return [new MathRoundBrackets({children:om(n.c)})];
    } return []; };
  const M=(nodes)=>new D.Math({children:nodes.flatMap(om)});
  const eqNodes=it=>{ const c=[it.lhs]; if(it.sym)c.push(T_(" = "),it.sym); if(it.num)c.push(T_(" = "),it.num); c.push(T_(" = "),it.v); return c; };
  const sideNodes=s=>{ const c=[]; if(s.sym)c.push(s.sym,T_(" = ")); if(s.num)c.push(s.num,T_(" = ")); c.push(s.v); return c; };
  // инлайн-текст с $формулами$
  const runs=(s,o={})=>{ const out=[]; String(s).split(/(\$[^$]+\$)/).forEach(part=>{ if(!part)return;
      if(part[0]==="$"&&part.length>1){ try{ out.push(M([disp(ast(part.slice(1,-1)),"sym")])); }catch(e){ out.push(T(part,o)); } } else out.push(T(part,o)); }); return out; };
  const none={style:BorderStyle.NONE,size:0,color:"FFFFFF"}, noB={top:none,bottom:none,left:none,right:none};
  const thin={style:BorderStyle.SINGLE,size:4,color:LINE}, box={top:thin,bottom:thin,left:thin,right:thin};
  const cell=(ch,o={})=>new TableCell({children:(Array.isArray(ch)?ch:[ch]).map(x=>typeof x==="string"?P(runs(x,{size:o.size||22,b:o.b,c:o.c}),{al:o.al,after:0}):x),
    width:o.w?{size:o.w,type:WidthType.DXA}:undefined,borders:o.borders||box,shading:o.fill?{type:ShadingType.CLEAR,color:"auto",fill:o.fill}:undefined,
    margins:{top:50,bottom:50,left:90,right:90},verticalAlign:o.va||VerticalAlign.CENTER,columnSpan:o.span});
  const FULL=9638;
  const tbl=(widths,rows,o={})=>new Table({width:{size:widths.reduce((a,b)=>a+b,0),type:WidthType.DXA},layout:TableLayoutType.FIXED,columnWidths:widths,borders:o.borders,rows});
  const EQrow=(nodes,ref,tail)=>tbl([7500,2138],[new TableRow({cantSplit:true,children:[
     cell(new Paragraph({children:[M(nodes),...(tail?[T(" "+tail)]:[])],alignment:AlignmentType.CENTER,spacing:{before:30,after:30}}),{w:7500,borders:noB}),
     cell(P(ref||"",{size:20,c:GREY,al:AlignmentType.RIGHT,after:0}),{w:2138,borders:noB})]})],{borders:noB});
  const H1=(n,t)=>new Paragraph({children:[T(`${n}  ${t}`,{b:true,size:26,c:ACC})],spacing:{before:260,after:120},keepNext:true,border:{bottom:{style:BorderStyle.SINGLE,size:6,color:ACC,space:2}}});
  const H2=(n,t)=>new Paragraph({children:[T(`${n}  ${t}`,{b:true,size:24})],spacing:{before:160,after:60},keepNext:true});
  const date=new Date().toLocaleDateString("ru-RU");
  const body=[];
  // шапка
  body.push(tbl([2200,4638,1400,1400],[
    new TableRow({children:[cell([P([T(meta.org||"БИЛДИНФОТЕХ",{b:true,size:22,c:ACC})],{after:0}),P(meta.orgSub||"строительная экспертиза",{size:18,c:GREY,after:0})],{w:2200,fill:"F3F5F9"}),
      cell([P([T("ПОВЕРОЧНЫЙ РАСЧЁТ",{b:true,size:18,c:GREY})],{after:0}),P([T(def.title,{b:true,size:24})],{after:0})],{w:4638}),
      cell([P("Шифр",{size:18,c:GREY,after:0}),P([T(def.code,{b:true,size:24})],{after:0})],{w:1400}),
      cell([P("Дата",{size:18,c:GREY,after:0}),P(date,{size:22,after:0})],{w:1400})]}),
    new TableRow({children:[cell(P("Объект",{size:18,c:GREY,after:0}),{w:2200,fill:"F3F5F9"}),cell(meta.obj||"—",{w:4638}),
      cell(P("Элемент",{size:18,c:GREY,after:0}),{w:1400}),cell(meta.el||"—",{w:1400})]})]));
  body.push(P("",{after:60}));
  if(!verified){ const dash={style:BorderStyle.DASHED,size:8,color:"C98A00"};
    body.push(tbl([FULL],[new TableRow({children:[cell(P([T("⚠  НЕ ПРОВЕРЕНО",{b:true,size:22,c:WARN}),T("  — расчётный шаблон не прошёл ручную проверку инженером",{size:20,c:WARN})],{after:0}),{w:FULL,fill:"FFF6E0",borders:{top:dash,bottom:dash,left:dash,right:dash}})]})]));
    body.push(P("",{after:60})); }
  // итог
  const info=R.k===null;
  const k=R.k, barN=20, fillN=info?0:Math.min(barN,Math.round(k*barN));
  const resTxt = info ? (R.results[0]||"Расчёт выполнен") : (R.ok?"✓ Требования выполняются":"✗ Требования НЕ выполняются");
  const resCol = info?ACC:(R.ok?OK:BAD), resFill = info?"EEF1FA":(R.ok?"E9F6EF":"FDECEB");
  body.push(tbl([3700,2500,3438],[new TableRow({children:[
    cell([P("РЕЗУЛЬТАТ",{size:18,c:GREY,after:0}),P([T(resTxt,{b:true,size:26,c:resCol})],{after:0})],{w:3700,fill:resFill}),
    cell(info?[P("—",{size:22,after:0})]:[P("Коэффициент использования",{size:18,c:GREY,after:0}),P([T(WC.fmtd(k,3),{b:true,size:30})],{after:0}),
      P([T("█".repeat(fillN),{size:14,c:k>1?BAD:k>0.9?"C98A00":OK}),T("█".repeat(barN-fillN),{size:14,c:"E4E7EC"})],{after:0})],{w:2500,fill:resFill}),
    cell(info?[P(R.results.slice(1).join("; ")||"",{size:20,after:0})]:[P("Определяющая проверка",{size:18,c:GREY,after:0}),P(R.worst.name+(R.worst.ref?", "+R.worst.ref:""),{size:21,after:0}),
      P(R.ok?`Запас ${WC.fmtd((1-k)*100,1)} %`:`Перегрузка ${WC.fmtd((k-1)*100,1)} %`,{size:20,c:GREY,after:0})],{w:3438,fill:resFill})]})]));
  // 1. нормы
  let sec=1; const lean=!!def.lean;
  if(lean){ body.push(P([T("Нормативная база: "+def.norm,{size:20,c:GREY})],{after:40})); }
  else{ body.push(H1(sec++,"Нормативная база и допущения"));
  body.push(P(def.norm,{ind:567}));
  (def.pre||[]).forEach(s=>body.push(P(runs(s),{ind:567,after:60}))); }
  // 2. исходные данные
  if(!lean){ body.push(H1(sec++,"Исходные данные"));
  const W4=[4200,1300,2338,1800];
  const hdr=new TableRow({tableHeader:true,children:["Параметр","Обозн.","Значение","Ед. изм."].map((x,i)=>cell(P([T(x,{b:true,size:20,c:"FFFFFF"})],{after:0}),{w:W4[i],fill:ACC}))});
  const rows=[hdr];
  (def.groups||[]).forEach(g=>{
    const vis=g.f.filter(fd=>fd.t!=="fixed"&&fd.t!=="rows"&&!fd.noRep&&(!fd.showIf||fd.showIf(v)));
    if(!vis.length) return;
    rows.push(new TableRow({children:[cell(P([T(g.name,{b:true,size:20})],{after:0}),{span:4,fill:"F3F5F9"})]}));
    vis.forEach(fd=>{ let val=v[fd.id];
      if(fd.t==="s") val=(fd.opts.find(o=>o[0]===val)||[0,val])[1]; else if(fd.t==="c") val=val?"да":"нет"; else val=WC.fmt(val);
      rows.push(new TableRow({children:[cell(fd.label,{w:W4[0],size:20}),cell(fd.sym?new Paragraph({children:[M([WC.sym(fd.sym)])],spacing:{after:0}}):"",{w:W4[1]}),cell(String(val),{w:W4[2],size:20,al:AlignmentType.RIGHT}),cell(fd.unit||"",{w:W4[3],size:20,c:GREY})]})); });
  });
  if(R.mats.length){ rows.push(new TableRow({children:[cell(P([T("Расчётные характеристики материалов",{b:true,size:20})],{after:0}),{span:4,fill:"F3F5F9"})]}));
    R.mats.forEach(m=>rows.push(new TableRow({children:[cell(m.label,{w:W4[0],size:20}),cell(new Paragraph({children:[M([WC.sym(m.sym)])],spacing:{after:0}}),{w:W4[1]}),cell(typeof m.v==="number"?WC.fmt(m.v):String(m.v),{w:W4[2],size:20,al:AlignmentType.RIGHT}),cell(m.unit||"",{w:W4[3],size:20,c:GREY})]}))); }
  body.push(tbl(W4,rows));
  (def.groups||[]).forEach(g=>g.f.forEach(fd=>{ if(fd.t==="rows"&&(!fd.showIf||fd.showIf(v))){ const R2=v[fd.id]||[];
    body.push(P([T(fd.label,{b:true,size:22})],{before:120,after:40}));
    const w=Math.floor(FULL/fd.cols.length); const ws=fd.cols.map(()=>w);
    body.push(tbl(ws,[new TableRow({tableHeader:true,children:fd.cols.map((c,i)=>cell(P([T(c.h,{b:true,size:20,c:"FFFFFF"})],{after:0,al:AlignmentType.CENTER}),{w:ws[i],fill:ACC}))}),
      ...R2.map(r=>new TableRow({children:fd.cols.map((c,i)=>{ let x=r[c.id]; if(c.t==="s") x=(c.opts.find(o=>o[0]===x)||[0,x])[1]; else if(typeof x==="number") x=WC.fmt(x); return cell(String(x??""),{w:ws[i],size:20,al:AlignmentType.CENTER}); })}))])); } }));
  }
  // 3. расчёт
  if(!lean) body.push(H1(sec,"Расчёт")); let sub=0; const secR=sec++;
  R.items.forEach(it=>{
    if(it.k==="h"){ sub++; body.push(lean?H1(sub,it.s):H2(`${secR}.${sub}`,it.s)); }
    else if(it.k==="kv"){ const wk=[3600,FULL-3600];
      body.push(tbl(wk,it.rows.map(r=>new TableRow({cantSplit:true,children:[cell(P(runs(String(r[0]),{size:20,c:GREY}),{after:0}),{w:wk[0],fill:"F3F5F9"}),cell(P(runs(String(r[1]),{size:21}),{after:0}),{w:wk[1]})]})))); body.push(P("",{after:60})); }
    else if(it.k==="img"){ const im=meta.imgs&&meta.imgs[it.key]; if(im){ const W=Math.round(FULL/20*96/72*0.97), H=Math.round(W*im.h/im.w);
        body.push(new Paragraph({children:[new ImageRun({type:"png",data:im.data,transformation:{width:W,height:H}})],alignment:AlignmentType.CENTER,spacing:{before:60,after:40},keepNext:!!it.cap}));
        if(it.cap) body.push(P([T(it.cap,{size:18,c:GREY})],{after:80,al:AlignmentType.CENTER})); } }
    else if(it.k==="msg"){ const C={ok:[OK,"E9F6EF"],mid:[WARN,"FFF6E0"],bad:[BAD,"FDECEB"]}[it.kind]||[ACC,"EEF1FA"]; const bar={style:BorderStyle.SINGLE,size:24,color:C[0]};
      body.push(tbl([FULL],[new TableRow({cantSplit:true,children:[cell([P(runs(it.title,{b:true,size:22,c:C[0]}),{after:20}),...(it.text?[P(runs(it.text,{size:21}),{after:0})]:[])],{w:FULL,fill:C[1],borders:{top:none,bottom:none,right:none,left:bar}})]})])); body.push(P("",{after:60})); }
    else if(it.k==="t") body.push(P(runs(it.s),{ind:567,after:60}));
    else if(it.k==="note") body.push(P(runs("Примечание. "+it.s,{c:WARN,size:22}),{ind:567,after:60}));
    else if(it.k==="eq") body.push(EQrow(eqNodes(it),it.ref,it.unit));
    else if(it.k==="chk") body.push(EQrow([...sideNodes(it.L),T_(" "+it.op+" "),...sideNodes(it.R)],it.ref,it.unit));
    else if(it.k==="tbl"){ const sw=it.w?it.w.reduce((a,b)=>a+b,0):0, w=Math.floor(FULL/it.head.length), ws=it.w?it.w.map(x=>Math.round(FULL*x/sw)):it.head.map(()=>w);
      if(it.cap) body.push(P([T(it.cap,{size:20,c:GREY})],{after:40}));
      body.push(tbl(ws,[new TableRow({tableHeader:true,children:it.head.map((c,i)=>cell(P(runs(String(c),{b:true,size:20}),{al:AlignmentType.CENTER,after:0}),{w:ws[i],fill:"F3F5F9"}))}),
        ...it.rows.map(r=>new TableRow({cantSplit:true,children:r.map((c,i)=>cell(typeof c==="number"?WC.fmt(c):String(c),{w:ws[i],size:20,al:(it.left||[]).includes(i)?AlignmentType.LEFT:AlignmentType.CENTER}))}))])); body.push(P("",{after:60})); }
  });
  // 4. сводка проверок
  const cks=R.checks.filter(c=>!c.info);
  if(cks.length&&!lean){
    body.push(H1(sec++,"Сводка проверок"));
    const W7=[450,3550,1500,1150,1150,900,938];
    body.push(tbl(W7,[new TableRow({tableHeader:true,children:["№","Проверка","Норма","Расчётное","Предельное","Kисп","Итог"].map((x,i)=>cell(P([T(x,{b:true,size:20,c:"FFFFFF"})],{after:0,al:AlignmentType.CENTER}),{w:W7[i],fill:ACC}))}),
      ...cks.map((c,i)=>new TableRow({cantSplit:true,children:[cell(String(i+1),{w:W7[0],size:20,al:AlignmentType.CENTER}),cell(c.name+(c.unit?", "+c.unit:""),{w:W7[1],size:20}),cell(c.ref,{w:W7[2],size:20,c:GREY}),
        cell(WC.fmt(c.act),{w:W7[3],size:20,al:AlignmentType.RIGHT}),cell(WC.fmt(c.lim),{w:W7[4],size:20,al:AlignmentType.RIGHT}),
        cell(P([T(WC.fmtd(c.k,3),{b:true,size:20})],{al:AlignmentType.CENTER,after:0}),{w:W7[5]}),
        cell(P([T(c.ok?"✓ ОК":"✗ НЕТ",{b:true,size:20,c:c.ok?OK:BAD})],{al:AlignmentType.CENTER,after:0}),{w:W7[6],fill:c.ok?"E9F6EF":"FDECEB"})]}))]));
  }
  // 5. вывод
  if(!lean) body.push(H1(sec++,"Вывод"));
  const concl = lean?[]:WC.conclusion(R);
  concl.forEach((s,i)=>body.push(P(runs(s),{ind:567,after:60,keepNext:i===concl.length-1})));
  body.push(new Paragraph({children:[],keepNext:true,spacing:{after:240}}));
  body.push(tbl([2000,3000,2000,2638],[new TableRow({children:[cell("Выполнил",{w:2000,borders:noB,c:GREY}),cell(meta.author?`${meta.author}  ________`:"________________",{w:3000,borders:noB}),
    cell("Проверил",{w:2000,borders:noB,c:GREY}),cell(meta.checker?`${meta.checker}  ________`:"________________",{w:2638,borders:noB})]})],{borders:noB}));
  const doc=new Document({styles:{default:{document:{run:{font:FONT,size:24}}}},
    sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1701,right:567,header:567,footer:567}}},
      headers:{default:new Header({children:[new Paragraph({children:[T(`${meta.org||"БИЛДИНФОТЕХ"} · Поверочный расчёт ${def.code}`,{size:18,c:GREY}),
        new TextRun({children:["\t"+(verified?"ПРОВЕРЕНО":"НЕ ПРОВЕРЕНО")],font:FONT,size:18,bold:true,color:verified?OK:WARN})],tabStops:[{type:TabStopType.RIGHT,position:FULL}],border:{bottom:{style:BorderStyle.SINGLE,size:4,color:LINE,space:4}}})]})},
      footers:{default:new Footer({children:[new Paragraph({children:[T(def.norm.length>90?def.norm.slice(0,88)+"…":def.norm,{size:16,c:GREY}),new TextRun({children:["\tЛист ",PageNumber.CURRENT," из ",PageNumber.TOTAL_PAGES],font:FONT,size:18,color:GREY})],tabStops:[{type:TabStopType.RIGHT,position:FULL}]})]})},
      children:body}]});
  return Packer.toBlob ? Packer.toBlob(doc) : Packer.toBuffer(doc);
};

WC.conclusion = function(R){
  const out=[];
  const cks=R.checks.filter(c=>!c.info);
  if(R.results.length) out.push(...R.results);
  if(cks.length){
    if(R.ok) out.push(`Все проверки выполняются. Максимальный коэффициент использования ${WC.fmtd(R.k,3)} — «${R.worst.name}»${R.worst.ref?" ("+R.worst.ref+")":""}.`);
    else out.push(`Не выполняются проверки: ${cks.filter(c=>!c.ok).map(c=>`«${c.name}» (Kисп = ${WC.fmtd(c.k,3)})`).join(", ")}.`);
  }
  return out;
};
})(typeof window!=="undefined"?window:globalThis);
