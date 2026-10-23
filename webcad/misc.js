/* прочие инструменты (интерполяция, единицы, арматура, сортаменты) */
(function(G){
"use strict";
const WC=G.WC, F=WC.F;

/* ===================== Прочее ===================== */
/* Табличные «инструменты»: свой интерфейс, результат сразу при вводе */
const num=x=>{x=parseFloat(String(x).replace(",","."));return x;};
const nf=(y,d)=>{ if(!isFinite(y)) return "—"; const r=+y.toPrecision(d||10); return String(r).replace(".",","); };
const inp=(id,val,cls)=>`<input type="text" inputmode="decimal" data-i="${id}" value="${val}" class="${cls||""}">`;
WC.reg("ПР-интерп",{title:"Линейная интерполяция",norm:"Плоская и двойная линейная интерполяция — результат пересчитывается сразу при вводе",tool:true,
 mount(root){
  root.innerHTML=`<h3 class="th">Плоская задача</h3>
  <div class="tw"><table class="tt"><thead><tr><th></th><th>X</th><th>Y</th></tr></thead><tbody>
   <tr><th>Точка 1</th><td>${inp("x1",5)}</td><td>${inp("y1",2)}</td></tr>
   <tr><th>Точка 2</th><td>${inp("x2",8)}</td><td>${inp("y2",10)}</td></tr>
   <tr class="q"><th>Искомая</th><td>${inp("x",6.5)}</td><td><output data-o="y"></output></td></tr></tbody></table></div>
  <p class="note2" data-o="n2"></p>
  <h3 class="th">Пространственная задача Z(X, Y)</h3>
  <div class="tw"><table class="tt"><thead><tr><th>Y \\ X</th><th>${inp("X1",2,"h")}</th><th>${inp("X2",10,"h")}</th></tr></thead><tbody>
   <tr><th>${inp("Y1",5,"h")}</th><td>${inp("z11",0.1)}</td><td>${inp("z21",0.5)}</td></tr>
   <tr><th>${inp("Y2",20,"h")}</th><td>${inp("z12",1.2)}</td><td>${inp("z22",2.1)}</td></tr></tbody></table></div>
  <div class="tw"><table class="tt"><thead><tr><th></th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>
   <tr class="q"><th>Искомая</th><td>${inp("X",5)}</td><td>${inp("Y",10)}</td><td><output data-o="Z"></output></td></tr></tbody></table></div>
  <p class="note2" data-o="n3"></p>`;
  const g=k=>num(root.querySelector(`[data-i="${k}"]`).value), o=k=>root.querySelector(`[data-o="${k}"]`);
  const lin=(a,fa,b,fb,x)=>fa+(fb-fa)*(x-a)/(b-a);
  const calc=()=>{
   const y=lin(g("x1"),g("y1"),g("x2"),g("y2"),g("x")); o("y").textContent=nf(y);
   const ex=g("x")<Math.min(g("x1"),g("x2"))||g("x")>Math.max(g("x1"),g("x2"));
   o("n2").textContent=ex&&isFinite(y)?"X вне диапазона точек 1–2 — выполнена экстраполяция.":"";
   const X1=g("X1"),X2=g("X2"),Y1=g("Y1"),Y2=g("Y2"),X=g("X"),Y=g("Y");
   const za=lin(X1,g("z11"),X2,g("z21"),X), zb=lin(X1,g("z12"),X2,g("z22"),X), z=lin(Y1,za,Y2,zb,Y);
   o("Z").textContent=nf(z);
   const ex3=X<Math.min(X1,X2)||X>Math.max(X1,X2)||Y<Math.min(Y1,Y2)||Y>Math.max(Y1,Y2);
   o("n3").textContent=isFinite(z)?`Z(X; Y1) = ${nf(za,6)};  Z(X; Y2) = ${nf(zb,6)}${ex3?". Точка вне сетки — выполнена экстраполяция.":""}`:"";
  };
  root.addEventListener("input",calc); calc();
 }});
Object.assign(WC.ALIAS,{Dt:()=>({r:"t",s:"Δt",it:true}),XX:()=>({r:"t",s:"X",it:true}),YY:()=>({r:"t",s:"Y",it:true}),XX_1:()=>({r:"sub",b:{r:"t",s:"X",it:true},s:{r:"t",s:"1"},sup:null}),XX_2:()=>({r:"sub",b:{r:"t",s:"X",it:true},s:{r:"t",s:"2"},sup:null}),
  YY_1:()=>({r:"sub",b:{r:"t",s:"Y",it:true},s:{r:"t",s:"1"},sup:null}),YY_2:()=>({r:"sub",b:{r:"t",s:"Y",it:true},s:{r:"t",s:"2"},sup:null})});

const DIAM=[3,4,5,6,8,10,12,14,16,18,20,22,25,28,32,36,40];
WC.reg("ПР-арм",{title:"Калькулятор арматуры",norm:"Площадь сечения и масса стержней",pre:["Укажите диаметр, затем количество стержней либо шаг (на 1 м)."],
 groups:[{name:"Арматура",f:[F.s("d","Диаметр стержня, мм",DIAM.map(x=>[String(x),String(x)]),"12"),F.s("mode","Задать",[["n","Количество стержней"],["s","Шаг на 1 м"]],"n"),
   F.n("cnt","Количество стержней","n","шт",4,{showIf:v=>v.mode==="n"}),F.s("st","Шаг, мм",[50,100,150,200,250,300,350,400,450,500,550,600].map(x=>[String(x),String(x)]),"200",{showIf:v=>v.mode==="s"})]}],
 run(v,R){ const S=R.S; S.d=+v.d; R.val("d",S.d,"мм"); R.eq("A_1","pi*d^2/400","см²");
  if(v.mode==="s"){ S.s=+v.st; R.eq("n","1000/s","шт/м"); } else R.val("n",v.cnt,"шт");
  R.eq("A_s","n*A_1","см²"); R.eq("m","n*0.00617*d^2","кг/м");
  const t=DIAM.map(d=>[`Ø${d}`,...[1,2,3,4,5,6,7,8,9,10].map(k=>WC.fmtd(k*Math.PI*d*d/400,2))]);
  R.tbl(["Ø, мм","1","2","3","4","5","6","7","8","9","10"],t,{cap:"Площадь сечения стержней, см²"});
  R.res(`ΣAs = ${WC.fmtd(S.A_s,3)} см²`); }});

/* Конвертер единиц */
const g0=9.80665;
const UNITS={
 m:{n:"Момент",u:{"Н·м":1,"кН·м":1e3,"МН·м":1e6,"кгс·м":g0,"кгс·см":g0/100,"тс·м":g0*1e3,"тс·см":g0*10}},
 f:{n:"Сила",u:{"Н":1,"кН":1e3,"МН":1e6,"кгс":g0,"тс":g0*1e3}},
 p:{n:"Напряжение",u:{"Па":1,"кПа":1e3,"МПа":1e6,"кгс/см²":g0*1e4,"кгс/мм²":g0*1e6,"кгс/м²":g0,"тс/м²":g0*1e3}},
 q:{n:"Нагрузка погонная",u:{"Н/м":1,"Н/см":100,"кН/м":1e3,"кН/см":1e5,"МН/м":1e6,"кгс/м":g0,"кгс/см":g0*100,"тс/м":g0*1e3,"тс/см":g0*1e5}},
 w:{n:"Нагрузка распределённая",u:{"Па (Н/м²)":1,"кПа (кН/м²)":1e3,"МПа":1e6,"кгс/м²":g0,"тс/м²":g0*1e3,"кгс/см²":g0*1e4}},
 g:{n:"Объёмный вес",u:{"Н/м³":1,"кН/м³":1e3,"кгс/м³":g0,"тс/м³":g0*1e3,"кгс/см³":g0*1e6,"гс/см³":g0*1e3}},
 l:{n:"Расстояние",u:{"мм":1e-3,"см":1e-2,"дм":0.1,"м":1,"км":1e3}},
 a:{n:"Площадь",u:{"мм²":1e-6,"см²":1e-4,"дм²":1e-2,"м²":1,"км²":1e6}},
 v:{n:"Объём",u:{"мм³":1e-9,"см³":1e-6,"дм³ (л)":1e-3,"м³":1,"км³":1e9}},
 W:{n:"Момент сопротивления",u:{"мм³":1e-9,"см³":1e-6,"дм³":1e-3,"м³":1}},
 S:{n:"Статический момент",u:{"мм³":1e-9,"см³":1e-6,"дм³":1e-3,"м³":1}},
 I:{n:"Момент инерции",u:{"мм⁴":1e-12,"см⁴":1e-8,"дм⁴":1e-4,"м⁴":1}},
};
WC.reg("ПР-ед",{title:"Конвертер единиц измерения",norm:"Введите значение в любой строке — остальные пересчитаются сразу (g = 9,80665 м/с²)",tool:true,
 mount(root){
  root.innerHTML=`<div class="tw"><label class="cl">Физическая величина <select data-i="cat">${Object.entries(UNITS).map(([k,o])=>`<option value="${k}">${o.n}</option>`).join("")}</select></label></div><div class="tw"><table class="tt cv"><thead><tr><th>Единица</th><th>Значение</th></tr></thead><tbody data-o="rows"></tbody></table></div>`;
  const sel=root.querySelector("select"), body=root.querySelector("[data-o=rows]"); let base=1;
  const draw=()=>{ const U=UNITS[sel.value].u; body.innerHTML=Object.keys(U).map(k=>`<tr><th>${k}</th><td><input type="text" inputmode="decimal" data-u="${k}"></td></tr>`).join(""); fill(null); };
  const fill=skip=>{ const U=UNITS[sel.value].u; body.querySelectorAll("input").forEach(i=>{ if(i.dataset.u!==skip) i.value=nf(base/U[i.dataset.u]); }); };
  sel.addEventListener("change",()=>{ base=UNITS[sel.value].u[Object.keys(UNITS[sel.value].u)[0]]; draw(); });
  body.addEventListener("input",e=>{ const i=e.target; const x=num(i.value); const U=UNITS[sel.value].u; if(isFinite(x)){ base=x*U[i.dataset.u]; fill(i.dataset.u);} });
  base=UNITS.m.u["Н·м"]; draw();
  // стартовое значение: 1 кН·м
  base=1e3; fill(null);
 }});

WC.reg("ПР-сорт",{title:"Сортаменты металлопроката",norm:"ГОСТ 8239-89, 26020-83, СТО АСЧМ 20-93, ГОСТ 8240-97, 8509-93, 8510-86, 30245-2003",tool:true,
 mount(root){
  const S=WC.SORT, C=WC.SORTCOL, ids=Object.keys(S), lab={"8509":"Номер","8510":"Номер","30245s":"Профиль","30245r":"Профиль"};
  root.innerHTML=`<div class="tw"><label class="cl">Сортамент <select data-i="sel">${ids.map(k=>`<option value="${k}">${S[k].name}</option>`).join("")}</select></label>
   <label class="cl" style="margin-left:14px">Поиск <input type="text" data-i="q" placeholder="например 20Ш1 или 100x50" style="padding:6px;font:inherit"></label></div>
   <p class="note2">Значения подлежат вашей сверке с бумажными ГОСТ (в разделе «Не проверено»). Список внесённых исправлений распознавания — <a href="webcad/sort-corrections.txt" target="_blank">sort-corrections.txt</a>.</p>
   <div class="tw" style="max-height:70vh;overflow:auto"><table class="tt st"><thead></thead><tbody></tbody></table></div>`;
  const sel=root.querySelector("[data-i=sel]"), q=root.querySelector("[data-i=q]"), th=root.querySelector("thead"), tb=root.querySelector("tbody");
  const f=x=>x===null||x===undefined?"—":String(x).replace(".",",");
  const draw=()=>{ const d=S[sel.value], cols=d.cols;
    th.innerHTML="<tr><th>"+(lab[sel.value]||"Номер")+"</th>"+cols.map(c=>{const m=C[c]||[c,""];return `<th>${m[0]}${m[1]?`<br><small>${m[1]}</small>`:""}</th>`;}).join("")+"</tr>";
    const t=q.value.trim().toLowerCase().replace(/[хx×]/g,"x").replace(",",".");
    tb.innerHTML=d.rows.filter(r=>!t||String(r[0]).toLowerCase().replace(/[хx×]/g,"x").includes(t)).map(r=>"<tr><th>"+r[0]+"</th>"+r.slice(1).map(x=>`<td>${f(x)}</td>`).join("")+"</tr>").join(""); };
  sel.addEventListener("change",draw); q.addEventListener("input",draw); draw();
 }});
})(typeof window!=="undefined"?window:globalThis);
