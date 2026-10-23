/* АР-01 — теплотехнический расчёт ограждающей конструкции (СП 50.13330.2012, климат — СП 131.13330.2025).
   Ядро расчёта (calc) не зависит от DOM и проверяется в Node; интерфейс (mount) — аккордеоны, каталог материалов, график, влагонакопление. */
(function(G){
"use strict";
const WC=G.WC;
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fr=(x,d)=>{ if(x===null||x===undefined||!isFinite(x)) return "—"; const k=d===undefined?2:d; let s=(+x).toFixed(k); if(+s===0&&x<0) s=s.replace("-",""); return s.replace(".",","); };
const pf=x=>{ const n=parseFloat(String(x).replace(",",".")); return n; };

/* ---------- климат ---------- */
const CL=(G.WC_CLIM||[]).map((r,i)=>({i,r:r[0],c:r[1],t5:r[2],z8:r[3],t8:r[4],z10:r[5],t10:r[6],rh:r[7],T:r[8],E:r[9]}));
const nan13=()=>Array(13).fill(NaN);
const MANUAL_REG=["Другой пункт (ввод вручную)"];
MANUAL_REG.forEach(rg=>CL.push({i:CL.length,r:rg,c:"Свой пункт",manual:true,t5:NaN,z8:NaN,t8:NaN,z10:NaN,t10:NaN,rh:NaN,T:nan13(),E:nan13()}));
{ const b=CL.find(c=>c.c==="Белгород"); if(b) CL.push(Object.assign({},b,{i:CL.length,r:"Харьковская область",c:"Харьков (климат принят по Белгороду)"})); }
const MON=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MDAYS=[31,28,31,30,31,30,31,31,30,31,30,31];

/* ---------- каталог материалов ---------- */
const AIRN=["Воздушная прослойка замкнутая: вертикальная или горизонтальная (поток тепла снизу вверх), t > 0 °C","Воздушная прослойка замкнутая: вертикальная или горизонтальная (поток снизу вверх), t < 0 °C","Воздушная прослойка замкнутая: горизонтальная, поток тепла сверху вниз, t > 0 °C","Воздушная прослойка замкнутая: горизонтальная, поток тепла сверху вниз, t < 0 °C"];
const MAT=(G.WC_MAT||[]).map(r=>{ const m=String(r[4]).match(/\d+/g)||[]; const rho=m.length?(m.length>1?(+m[0]+ +m[1])/2:+m[0]):NaN;
  return {id:String(r[0]),g:r[1],sg:r[2],name:r[3],dens:r[4],rho,c0:r[5],l0:r[6],wA:r[7],wB:r[8],lA:r[9],lB:r[10],sA:r[11],sB:r[12],mu:r[13]===null?NaN:r[13],dw:r[14]}; });
const MATBY={}; MAT.forEach(m=>MATBY[m.id]=m);
const airR=(d,col)=>{ const T=G.WC_AIR||[]; if(!T.length) return NaN; if(d<=T[0][0]) return T[0][col]; for(let i=1;i<T.length;i++){ if(d<=T[i][0]){ const a=T[i-1],b=T[i]; return a[col]+(b[col]-a[col])*(d-a[0])/(b[0]-a[0]); } } return T[T.length-1][col]; };

/* ---------- нормы (СП 50.13330.2012) ---------- */
const BT=[["1","Жилые"],["2","Лечебно-профилактические"],["3","Детские учреждения, школы, интернаты"],["4","Общественные (кроме указанных)"],["5","Административные"],["6","Бытовые"],
  ["7","Производственные с сухим и нормальным режимами"],["8","Производственные и др. с влажным или мокрым режимом"],["9","Производственные со значительными избытками явной теплоты (> 23 Вт/м³), φ ≤ 50 %"]];
const CT=[["1","Стены наружные"],["2","Стены наружные с воздушной прослойкой, вентилируемой наружным воздухом"],["3","Стены внутренние, сообщающиеся с неотапливаемыми помещениями"],["4","Покрытия (плоская кровля, утеплённая скатная/мансарда)"],
  ["5","Чердачное перекрытие под холодным чердаком — кровля из штучных материалов (металлочерепица, шифер, черепица)"],["6","Чердачное перекрытие под холодным чердаком — кровля из рулонных материалов (битумные рулоны, мембрана)"],["7","Перекрытия над проездами"],["8","Перекрытия над холодными подвалами, сообщающимися с наружным воздухом"],
  ["9","Перекрытия над неотапливаемыми подвалами со световыми проёмами"],["10","Перекрытия над неотапливаемыми подвалами без световых проёмов, выше уровня земли"],["11","Перекрытия над неотапливаемыми подвалами и подпольями ниже уровня земли"]];
const CCOL={"1":"w","2":"w","3":"w","4":"c","5":"a","6":"a","7":"c","8":"a","9":"a","10":"a","11":"a"};
const AEXT={"1":23,"2":12,"3":12,"4":23,"5":12,"6":12,"7":23,"8":17,"9":12,"10":6,"11":6};
const NCOEF={"1":1,"2":1,"3":null,"4":1,"5":1,"6":0.9,"7":1,"8":0.9,"9":0.75,"10":0.6,"11":0.4};
const DTCOL={"1":"w","2":"w","3":"w","4":"c","5":"c","6":"c","7":"f","8":"f","9":"f","10":"f","11":"f"};
const GRP=bt=>({"1":1,"2":1,"3":1,"4":2,"5":2,"6":2,"7":3,"8":2,"9":5}[bt]);
const AB={1:{w:[0.00035,1.4],c:[0.0005,2.2],a:[0.00045,1.9]},2:{w:[0.0003,1.2],c:[0.0004,1.6],a:[0.00035,1.3]},3:{w:[0.0002,1.0],c:[0.00025,1.5],a:[0.0002,1.0]}};
const ZONE=[["1","сухая"],["2","нормальная"],["3","влажная"]];

/* ---------- физика ---------- */
const Esat=t=>1.84e11*Math.exp(-5330/(273+t));                 // Па, ф. (8.8)
const tdew=e=>5330/Math.log(1.84e11/e)-273;                     // °C по парциальному давлению e, Па
const dewMag=(t,phi)=>{ const a=17.62,b=243.12,g=Math.log(phi/100)+a*t/(b+t); return b*g/(a-g); };
const fT=t=>(273+t)*(273+t)/Esat(t);                            // табл. 11 СП 50
function invF(f){ let lo=-40,hi=45; if(f>=fT(lo)) return lo; if(f<=fT(hi)) return hi; for(let i=0;i<60;i++){ const m=(lo+hi)/2; if(fT(m)>f) lo=m; else hi=m; } return (lo+hi)/2; }
const regimeOf=(t,phi)=>{ // табл. 1 СП 50: 0 сухой, 1 нормальный, 2 влажный, 3 мокрый
  const lim=t<=12?[60,75,Infinity]:t<=24?[50,60,75]:[40,50,60];
  return phi<=lim[0]?0:phi<=lim[1]?1:phi<=lim[2]?2:3; };
const REGN=["сухой","нормальный","влажный","мокрый"];
const condOf=(reg,zone)=>{ // табл. 2: zone 1 сухая, 2 нормальная, 3 влажная
  if(reg>=2) return "Б"; if(reg===0) return zone==="3"?"Б":"А"; return zone==="1"?"А":"Б"; };

/* ---------- ядро расчёта ---------- */
function layerData(L,cond){
  const d=L.d/1000; let lam,mu,R,Rp=NaN,warn=null;
  if(L.air){ R=airR(d,L.col); lam=d/R; mu=NaN; Rp=0; }
  else { lam=cond==="Б"?L.lamB:L.lamA; mu=L.mu; R=d/lam;
    if(isFinite(L.rp)) Rp=L.rp; else if(isFinite(mu)&&mu>0) Rp=d/mu; }
  return {d,lam,mu,R,Rp};
}
function calc(v){
  const C=CL[v.ci]; if(!C) return {err:"Не выбран пункт строительства"};
  const need=[C.t5,C.z8,C.t8,C.z10,C.t10,C.rh].concat(C.T,C.E);
  if(need.some(x=>!isFinite(x))) return {err:"Введите климатические параметры пункта (таблица ниже)"};
  const bt=v.bt, ct=v.ct, g=GRP(bt), ten=bt==="2"||bt==="3";
  const o={C,bt,ct,g};
  o.text=C.t5; o.tht=ten?C.t10:C.t8; o.zht=ten?C.z10:C.z8;
  const tint=v.tint, phi=v.phi;
  if(!isFinite(tint)||!isFinite(phi)) return {err:"Заполните температуру и влажность внутреннего воздуха"};
  o.tint=tint; o.phi=phi;
  o.reg=regimeOf(tint,phi); o.condAuto=condOf(o.reg,v.zone); o.cond=v.cond==="А"||v.cond==="Б"?v.cond:o.condAuto;
  o.gsop=(tint-o.tht)*o.zht;
  o.aint=v.ribs&&ct!=="1"&&ct!=="2"&&ct!=="3"?7.6:8.7;
  o.aext=AEXT[ct]; o.n=NCOEF[ct]==null?v.nman:NCOEF[ct];
  o.td=dewMag(tint,phi);
  { const col=DTCOL[ct]; let d;
    if(g===1) d={w:4,c:3,f:2}[col];
    else if(g===2&&bt!=="8") d={w:4.5,c:4,f:2.5}[col];
    else if(bt==="7") d= col==="w"?Math.min(tint-o.td,7): col==="c"?Math.min(0.8*(tint-o.td),6):2.5;
    else if(bt==="8") d= col==="w"?tint-o.td: col==="c"?0.8*(tint-o.td):2.5;
    else d= col==="f"?2.5:12;
    o.dtn=d; }
  o.Rc=o.n*(tint-o.text)/(o.dtn*o.aint);
  if(g===5||bt==="8"){ o.Rt=o.Rc; o.RtNote="для данного типа помещений базовое значение принято равным санитарно-гигиеническому по ф. (5.4)"; }
  else { const ab=AB[g][CCOL[ct]]; o.a=ab[0]; o.b=ab[1]; o.Rt=o.a*o.gsop+o.b; }
  o.mpmin=(ct==="1"||ct==="2"||ct==="3")?0.63:0.8;
  o.Re=o.Rt*o.mpmin;
  // слои
  o.layers=(v.lay||[]).map(L=>Object.assign({L},layerData(L,o.cond)));
  o.sumR=o.layers.reduce((s,x)=>s+x.R,0);
  o.Rcond=1/o.aint+o.sumR+1/o.aext;
  o.r=isFinite(v.r)&&v.r>0?v.r:1;
  o.R0=o.Rcond*o.r;
  o.dt0=o.n*(tint-o.text)/(o.R0*o.aint); o.tauInt=tint-o.dt0;
  o.sanOk=o.R0>=o.Rc-1e-9; o.condOk=o.td<=o.tauInt;
  o.stat=o.R0>=o.Rt-1e-9?"ok":o.R0>=o.Re-1e-9?"mid":"bad";
  // температурное поле при расчётных условиях v.tx, φx
  o.prof=profile(o,v);
  o.moist=moisture(o,v);
  o.loss=losses(o,v);
  return o;
}
/* температура/упругость водяного пара на границах слоёв; tx, φx — наружный воздух для графика */
function profile(o,v){
  const tx=isFinite(v.tx)?v.tx:o.text, px=isFinite(v.px)?v.px:o.C.rh, tin=o.tint;
  const ein=o.phi/100*Esat(tin), ex=px/100*Esat(tx);
  const Rtot=o.Rcond; const pts=[]; let Rcum=1/o.aint, Rpcum=0, x=0;
  const Rp0=o.layers.reduce((s,l)=>s+(isFinite(l.Rp)?l.Rp:0),0);
  const T=Rc=>tin-(tin-tx)*Rc/Rtot, Ev=Rp=>Rp0>0?ein-(ein-ex)*Rp/Rp0:ein;
  const surfIn=T(1/o.aint), surfOut=T(Rtot-1/o.aext);
  pts.push({x:0,t:surfIn,e:Ev(0)});
  o.layers.forEach(l=>{ Rcum+=l.R; Rpcum+=isFinite(l.Rp)?l.Rp:0; x+=l.d*100; pts.push({x,t:T(Rcum),e:Ev(Rpcum)}); });
  pts.forEach(p=>{ p.td=tdew(Math.max(p.e,1)); p.E=Esat(p.t); });
  return {tx,px,ein,ex,pts,total:x,surfIn,surfOut,rpAll:Rp0>0||o.layers.length===0,
    cond:pts.some(p=>p.e>p.E+1e-6)};
}
/* влагонакопление, СП 50.13330.2012 раздел 8 */
function moisture(o,v){
  const M={ok:false};
  if(!o.layers.length){ M.msg="Добавьте слои конструкции."; return M; }
  const miss=o.layers.filter(l=>!isFinite(l.Rp)); if(miss.length){ M.msg="Не задан коэффициент паропроницаемости μ (или Rп) у слоя «"+miss[0].L.name+"» — укажите в окне ✎."; return M; }
  const T=o.C.T, E=o.C.E.map(x=>x*100); // Па
  const ev=o.phi/100*Esat(o.tint);
  const neg=[]; for(let i=0;i<12;i++) if(T[i]<0) neg.push(i);
  const z0=neg.reduce((s,i)=>s+MDAYS[i],0);
  const tno=neg.length?neg.reduce((s,i)=>s+T[i],0)/neg.length:NaN, eno=neg.length?neg.reduce((s,i)=>s+E[i],0)/neg.length:NaN;
  const Rp0=o.layers.reduce((s,l)=>s+l.Rp,0); M.Rp0=Rp0;
  if(Rp0<=0){ M.msg="Конструкция не оказывает сопротивления паропроницанию."; return M; }
  // температуры на границах слоёв при tно (по ф. 8.10-8.11)
  const R0u=o.Rcond;
  const tAt=(t,Rc)=>o.tint-(o.tint-t)*Rc/R0u;
  // плоскость максимального увлажнения
  const lay=o.layers; let plane=null; // {i, frac}: i — слой, frac — доля слоя от внутренней грани
  const bd=[]; { let Rc=1/o.aint; lay.forEach(l=>{ const a=Rc; Rc+=l.R; bd.push({a,b:Rc,Rpi:0}); }); }
  { let s=0; lay.forEach((l,i)=>{ bd[i].Rpa=s; s+=l.Rp; bd[i].Rpb=s; }); }
  if(neg.length&&ev>eno){
    const f=lay.map(l=>5330*(o.tint-tno)*(l.d/l.Rp)*Rp0/((ev-eno)*l.lam*R0u));
    const tm=f.map(invF);
    const cand=[];
    lay.forEach((l,i)=>{ const ta=tAt(tno,bd[i].a), tb=tAt(tno,bd[i].b); const lo=Math.min(ta,tb), hi=Math.max(ta,tb);
      if(tm[i]>=lo&&tm[i]<=hi){ const fr_=Math.abs(ta-tb)<1e-9?0.5:(ta-tm[i])/(ta-tb); cand.push({i,frac:fr_}); } });
    if(cand.length>1){ cand.sort((p,q)=>(lay[q.i].R/lay[q.i].d)-(lay[p.i].R/lay[p.i].d)); plane=cand[0]; }
    else if(cand.length===1) plane=cand[0];
    else { for(let i=0;i<lay.length-1;i++){ const warmHi=tAt(tno,bd[i].a), warmLo=tAt(tno,bd[i].b), colHi=tAt(tno,bd[i+1].a), colLo=tAt(tno,bd[i+1].b);
        if(tm[i]<Math.min(warmHi,warmLo)&&tm[i+1]>Math.max(colHi,colLo)){ plane={i,frac:1}; break; } } }
    if(!plane){ plane={i:lay.length-1,frac:1}; M.outer=true; }
    M.tm=tm;
  } else { plane={i:lay.length-1,frac:1}; M.outer=true; }
  M.plane=plane;
  const pl=lay[plane.i];
  const Rx=bd[plane.i].a+(bd[plane.i].b-bd[plane.i].a)*plane.frac;                 // термическое сопр. от внутр. воздуха до плоскости
  const Rpin=bd[plane.i].Rpa+pl.Rp*plane.frac;                                     // Rп от внутренней поверхности до плоскости
  const Rpn=Rp0-Rpin;                                                              // Rп наружной части
  M.Rpin=Rpin; M.Rpn=Rpn; M.xcm=(lay.slice(0,plane.i).reduce((s,l)=>s+l.d,0)+pl.d*plane.frac)*100; M.layerName=pl.L.name;
  M.ev=ev;
  // годовой период: зима (< −5), весна-осень (−5…5), лето (> 5)
  const per=[[],[],[]]; for(let i=0;i<12;i++) (T[i]<-5?per[0]:T[i]<=5?per[1]:per[2]).push(i);
  const z=per.map(p=>p.length), tper=per.map(p=>p.length?p.reduce((s,i)=>s+T[i],0)/p.length:NaN);
  const Ep=per.map((p,k)=>{ if(!p.length) return 0; let t=o.tint-(o.tint-tper[k])*Rx/R0u; if(k===2) t=Math.max(t,tper[k]); return Esat(t); });
  M.per={z,t:tper,E:Ep};
  M.E=(Ep[0]*z[0]+Ep[1]*z[1]+Ep[2]*z[2])/12;
  M.en=o.C.E[12]*100;
  M.Rp1raw=(ev-M.E)*Rpn/(M.E-M.en); M.Rp1=M.E>M.en&&Rpn>0?M.Rp1raw:0;
  // за период с отрицательными температурами
  M.z0=z0; M.tno=tno; M.eno=eno;
  M.Rp2=0; M.note2=null;
  if(neg.length){
    const t0=tAt(tno,Rx); M.t0=t0; M.E0=Esat(t0);
    const rho=isFinite(pl.L.rho)?pl.L.rho:NaN, dw=pl.L.dw;
    M.rho=rho; M.dw=dw; M.dwl=pl.d*(lay.length===1?2/3:1);
    if(Rpn>0){
      M.eta=0.0024*(M.E0-eno)*z0/Rpn;
      if(isFinite(rho)&&isFinite(dw)&&dw>0){ M.Rp2=0.0024*z0*(ev-M.E0)/(rho*M.dwl*dw+M.eta); if(M.Rp2<0) M.Rp2=0; }
      else M.note2="Для слоя «"+pl.L.name+"» не задано предельное приращение влажности Δw (табл. 10) — проверка за период с отрицательными температурами не выполнена; задайте Δw в окне ✎.";
    }
  }
  M.Rtr=Math.max(M.Rp1,M.Rp2);
  { let k0=0; for(let i=1;i<12;i++) if(T[i]<T[k0]) k0=i;
    M.cx=neg.length?{t:tno,e:eno}:{t:T[k0],e:E[k0]};
    M.rows=lay.map((l,i)=>{ const ta=tAt(tno,bd[i].a), tb=tAt(tno,bd[i].b); let Xi=NaN;
      if(M.tm&&Math.abs(ta-tb)>1e-9) Xi=l.d*1000*(ta-M.tm[i])/(ta-tb);
      const inPl=i===plane.i&&!M.outer;
      return {name:l.L.name,d:l.d*1000,mu:l.L.air?NaN:(isFinite(l.mu)?l.mu:NaN),Rp:l.Rp,Xi,inside:isFinite(Xi)&&Xi>=0&&Xi<=l.d*1000,
        Rpin:inPl?Rpin:0,Rp1:inPl?M.Rp1raw:0,Rp2:inPl?M.Rp2:0,inPl}; });
    M.Xplane=M.outer?NaN:M.xcm*10; }
  M.ok=true; M.pass=Rpin>=M.Rtr-1e-9;
  return M;
}
/* теплопотери */
function losses(o,v){
  const A=isFinite(v.area)&&v.area>0?v.area:1, T=o.C.T;
  const q=(o.tint-o.text)/o.R0;
  const rows=[]; let sum=0;
  for(let i=0;i<12;i++){ const dT=o.tint-T[i]; const hot=dT>0&&T[i]<8; const e=hot?24*MDAYS[i]*dT/o.R0/1000:0; rows.push({m:MON[i],T:T[i],dT,days:MDAYS[i],e}); sum+=e; }
  const marks=[{n:"Санитарно-гигиенические требования [Rс]",r:o.Rc,col:"#e02424"},{n:"Нормируемое значение поэлементных требований [Rэ]",r:o.Re,col:"#0b6b1f"},{n:"Базовое значение поэлементных требований [Rт]",r:o.Rt,col:"#3ecf4a"},
    {n:"Сопротивление теплопередаче ограждающей конструкции [R]",r:o.R0,col:"#2430e0"},{n:"R + 10%",r:o.R0*1.1,col:"#9fd3e6"},{n:"R + 25%",r:o.R0*1.25,col:"#9fd3e6"},{n:"R + 50%",r:o.R0*1.5,col:"#9fd3e6"}];
  return {A,q,Q:q*A,rows,sum,sumA:sum*A,season:0.024*o.gsop/o.R0,seasonA:0.024*o.gsop/o.R0*A,marks};
}

/* ======================= интерфейс ======================= */
const CSS=`
.ar .acc{border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden;background:var(--card)}
.ar .acc>summary{cursor:pointer;list-style:none;padding:10px 14px;font-weight:700;font-size:14.5px;color:var(--accent);background:var(--accent-soft);display:flex;align-items:center;gap:10px}
.ar .acc>summary::-webkit-details-marker{display:none}
.ar .acc>summary::before{content:"▸";font-size:12px;transition:transform .15s}
.ar .acc[open]>summary::before{transform:rotate(90deg)}
.ar .acc>summary .sub{margin-left:auto;font-weight:400;color:var(--muted);font-size:13px;text-align:right}
.ar .accb{padding:12px 14px}
.ar .g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px 14px;margin-bottom:8px}
.ar .g2 label{display:block;font-size:12.5px;color:var(--muted)}
.ar .g2 label>input,.ar .g2 label>select{display:block;margin-top:3px}
.ar .g2 label.ck{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--text)}
.ar .g2 label.ck>input{display:inline-block;margin:0;width:auto}
.ar select,.ar input[type=text]{font:inherit;font-size:14px;padding:6px 8px;color:var(--text);background:var(--sunk);border:1px solid var(--line);border-radius:8px;width:100%;min-width:0}
.ar table.kv{border-collapse:collapse;width:100%;font-size:13.5px}
.ar table.kv td{padding:4px 6px;border-bottom:1px dotted var(--line)}
.ar table.kv td:nth-child(2){font-family:var(--serif);text-align:right;white-space:nowrap;font-weight:700}
.ar table.kv td:nth-child(3){color:var(--muted);white-space:nowrap}
.ar table.kv input{width:90px;text-align:right;font-family:var(--mono);padding:3px 6px}
.ar table.mon2 th,.ar table.mon2 td{padding:3px 4px;text-align:center;white-space:nowrap} .ar table.mon2 td:first-child,.ar table.mon2 th:first-child{text-align:left;font-weight:600} .ar table.mon2 input{width:46px;padding:2px 3px;text-align:center}
@media(max-width:720px){.ar .mon{grid-template-columns:1fr}}
.ar table.mt{border-collapse:collapse;width:100%;font-size:13px}
.ar table.mt th,.ar table.mt td{padding:3px 6px;border-bottom:1px solid var(--line);text-align:right}
.ar table.mt th:first-child,.ar table.mt td:first-child{text-align:left}
.ar table.mt th{color:var(--muted);font-weight:600;font-size:12px}
.ar table.mt input{width:64px;text-align:right;font-family:var(--mono);padding:2px 4px}
.ar table.lt{border-collapse:collapse;width:100%;font-size:13.5px}
.ar table.lt th{font-size:12px;color:var(--muted);text-align:left;padding:4px 6px;white-space:nowrap}
.ar table.lt td{padding:4px 6px;border-top:1px solid var(--line);vertical-align:middle}
.ar table.lt td.num{text-align:right;font-family:var(--mono);white-space:nowrap}
.ar table.lt input{width:84px;text-align:right;font-family:var(--mono)}
.ar .sw{display:inline-block;width:18px;height:18px;border:1px solid var(--muted);border-radius:4px;vertical-align:middle}
.ar .ib{font:inherit;font-size:13px;background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--text)}
.ar .ib:hover{background:var(--accent-soft)} .ar .ib:disabled{opacity:.35;cursor:default}
.ar .film td{color:var(--muted);font-size:13px}
.ar .mat{cursor:pointer;color:var(--accent);text-decoration:underline dotted}
.ar .tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:6px 0 10px;flex-wrap:wrap}
.ar .tabs button{font:inherit;font-size:14px;background:none;border:0;border-bottom:3px solid transparent;padding:8px 14px;cursor:pointer;color:var(--muted);font-weight:600}
.ar .tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
.ar .scal{margin:4px 0 10px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px 24px}
@media(max-width:720px){.ar .scal{grid-template-columns:1fr}}
.ar .scal b{font-size:12.5px;display:block;margin-bottom:2px}
.ar .scalbar{position:relative;height:16px;border:1px solid var(--line);border-radius:3px;background:var(--sunk);margin-bottom:22px}
.ar .scalbar i{position:absolute;left:0;top:0;bottom:0}
.ar .scalbar u{position:absolute;top:-2px;bottom:-2px;width:0;border-left:1px solid var(--text);text-decoration:none}
.ar .scalbar u s{position:absolute;top:20px;left:-12px;font-size:11px;text-decoration:none;white-space:nowrap}
.ar .pbar{height:16px;border:1px solid var(--line);border-radius:3px}
.ar .big{text-align:center;font-size:16px;font-weight:700;margin:8px 0}
.ar .msg{padding:10px 12px;border-radius:8px;margin:8px 0;font-size:13.5px;border:1px solid}
.ar .msg.ok{background:var(--ok-soft);border-color:var(--ok);color:var(--ok)}
.ar .msg.bad{background:var(--bad-soft);border-color:var(--bad);color:var(--bad)}
.ar .msg.mid{background:var(--warn-soft);border-color:var(--warn);color:var(--warn)}
.ar .msg b{display:block;font-weight:700}
.ar .req2{display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:14px;margin:6px 0}
.ar .req2 span:nth-child(even){font-family:var(--mono);font-weight:700;text-align:right}
.ar .rn{color:var(--bad)} .ar .gn{color:var(--ok)} .ar .an{color:var(--warn)}
.ar .chart{width:100%;max-width:860px;display:block}
.ar .leg{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;margin:6px 0}
.ar dialog{border:1px solid var(--line);border-radius:12px;padding:0;background:var(--card);color:var(--text);max-width:min(980px,96vw);width:96vw}
.ar dialog::backdrop{background:rgba(0,0,0,.45)}
.ar .dh{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line);font-weight:700;font-size:16px}
.ar .db{padding:12px 16px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px;max-height:70vh;overflow:auto}
@media(max-width:720px){.ar .db{grid-template-columns:1fr}}
.ar .sr{padding:10px 16px 0} .ar .sr input{width:100%;box-sizing:border-box;font-size:14.5px;padding:8px 10px}
.ar .tree details{margin-left:14px} .ar .tree>details{margin-left:0}
.ar .tree summary{cursor:pointer;padding:3px 0;font-size:14px}
.ar .tree .it{padding:3px 6px;cursor:pointer;border-radius:5px;font-size:13.5px;display:block;width:100%;text-align:left;background:none;border:0;font:inherit;font-size:13.5px;color:var(--text)}
.ar .tree .it:hover,.ar .tree .it:focus{background:var(--accent-soft);outline:none}
.ar .prop{font-size:13.5px;position:sticky;top:0;align-self:start}
.ar .prop h4{margin:0 0 8px;color:var(--accent);font-size:14.5px}
.ar .prop dt{color:var(--muted);font-size:12.5px;margin-top:6px} .ar .prop dd{margin:0;font-family:var(--serif);font-size:14.5px}
.ar .df{display:flex;gap:10px;align-items:center;padding:10px 16px;border-top:1px solid var(--line);flex-wrap:wrap}
.ar .df label{display:flex;gap:6px;align-items:center;font-size:13.5px}
.ar .acts2{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.ar .small{font-size:12.5px;color:var(--muted)}

.ar.prn{display:none}
.prn .rep{font-size:13px} .prn h4{font-size:15px;margin:16px 0 6px;color:var(--accent);border-bottom:1.5px solid var(--accent);padding-bottom:2px;break-after:avoid}
.prn .rfig svg{width:100%;height:auto;display:block} .prn .rfig figcaption{font-size:11.5px;color:var(--muted);text-align:center;margin:2px 0 6px}
.prn .kvt td:first-child{background:var(--sunk);color:var(--muted);width:32%;text-align:left} .prn .kvt td{text-align:left}
.prn .rmsg{border-left:4px solid var(--ok);background:var(--ok-soft);padding:6px 10px;margin:8px 0;break-inside:avoid;font-size:13px}
.prn .rmsg.mid{border-color:var(--warn);background:var(--warn-soft)} .prn .rmsg.bad{border-color:var(--bad);background:var(--bad-soft)}
.prn .rmsg b{display:block} .prn .rmsg.ok b{color:var(--ok)} .prn .rmsg.mid b{color:var(--warn)} .prn .rmsg.bad b{color:var(--bad)}
.prn .ph{display:flex;justify-content:space-between;gap:12px;border:1px solid var(--line);padding:8px 10px;margin-bottom:8px;break-inside:avoid}
.prn .ph .t{font-weight:700;font-size:16px} .prn .ph small{color:var(--muted);display:block}
.prn .pres{display:flex;gap:16px;align-items:center;border:1px solid var(--line);padding:8px 10px;margin-bottom:8px;break-inside:avoid;background:var(--ok-soft)}
.prn .pres.bad{background:var(--bad-soft)} .prn .pres b{font-size:16px}
.prn .req,.prn .rtab tr{break-inside:avoid} .prn .req{padding:2px 0} .prn .req .m{line-height:1.8;font-size:14.5px} .prn .rep p.rt{margin:3px 0} .prn .rtab{min-width:0;width:100%}
@media print{
 .ar:not(.prn){display:none!important} .ar.prn{display:block!important}
 body:has(.ar) #calcCard{display:block!important} body:has(.ar) .ttl code,body:has(.ar) .stamp{display:inline-flex}
 body:has(.ar) #resCard{display:none!important}
 .ar{--card:#fff;--text:#000;--muted:#333;--faint:#555;--line:#999;--sunk:#fff;--accent:#000;--accent-soft:#eee;--ok:#0a5c2e;--bad:#9b1c1c;--warn:#7a4a00;--ok-soft:#fff;--bad-soft:#fff;--warn-soft:#fff;color:#000}
 .ar .tabs,.ar .acts2,.ar .ib,.ar dialog,.ar #ar_dRep,.ar #ar_add,.ar #ar_clr{display:none!important}
 .ar .acc{break-inside:avoid-page;border-color:#999} .ar .acc>summary{background:#eee!important;color:#000}
 .ar .acc>summary::before{display:none}
 .ar input,.ar select{border:0!important;background:none!important;padding:0!important;appearance:none;-webkit-appearance:none;color:#000}
 .ar .chart{max-width:100%} .ar .msg{break-inside:avoid}
 .ar .scalbar,.ar .pbar,.ar .scalbar i,.ar .sw,.ar svg *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

function defaultState(){
  const msk=CL.find(c=>c.c==="Москва")||CL[0];
  const lay=[["201",20],["180",380],["27",150]].map(([id,d])=>fromMat(MATBY[id],d)).filter(Boolean);
  return {ci:msk.i,zone:"2",bt:"1",ct:"1",ribs:false,nman:0.7,tint:20,phi:55,r:1,cond:"auto",tx:NaN,px:NaN,txMode:"p5",area:100,lay};
}
function fromMat(m,d){ if(!m) return null; let mu=m.mu, note=false;
  if(!isFinite(mu)){ const base=m.name.split(", ")[0]; const alt=MAT.filter(x=>x.name.split(", ")[0]===base&&isFinite(x.mu)&&x.id!==m.id).sort((a,b)=>Math.abs(a.rho-m.rho)-Math.abs(b.rho-m.rho))[0]; if(alt){ mu=alt.mu; note=true; } }
  return {mat:m.id,name:m.name,d,lamA:m.lA,lamB:m.lB,mu,muNote:note,rho:m.rho,dw:m.dw,rp:NaN,c0:m.c0,air:false}; }
function airLayer(k,d){ return {mat:"air"+k,name:AIRN[k],d,air:true,col:k+1,mu:NaN,rho:NaN,dw:null,rp:NaN}; }
const LCOL=m=>{ const g=m&&m.g||""; return /Теплоизоляционные материалы|засыпки/.test(g)?"#ffe9a0":/Бетоны/.test(g)?"#cfd6e4":/Кирпичная/.test(g)?"#e8c3b0":/Дерево/.test(g)?"#e3cfa8":/Растворы/.test(g)?"#cfe3cf":/Металлы/.test(g)?"#c9c9d4":/Гидро|Плиты/.test(g)?"#dcd6c8":"#e6e6e6"; };
const layCol=L=>L.air?"#e4f1ff":LCOL(MATBY[L.mat]);

function mount(root){
  if(!document.getElementById("ar01css")){ const st=document.createElement("style"); st.id="ar01css"; st.textContent=CSS; document.head.appendChild(st); }
  const S=defaultState(); let lastCalc=null, tab=0;
  const regs=[...new Set(CL.map(c=>c.r))].sort((a,b)=>a.localeCompare(b,"ru"));
  root.innerHTML=`<div class="ar prn" id="ar_prn"></div><div class="ar">
  <div class="scal"><div><b>Тепловая защита</b><div class="scalbar" id="ar_scal"></div></div><div><b>Защита от переувлажнения</b><div class="pbar" id="ar_pbar"></div></div></div>

  <details class="acc" id="ar_dClim"><summary>Район строительства <span class="sub" id="ar_sClim"></span></summary><div class="accb">
    <div class="g2"><label>Регион<select id="ar_reg"></select></label><label>Населённый пункт<select id="ar_city"></select></label>
      <label>Зона влажности (прил. В СП 50, по карте)<select id="ar_zone">${ZONE.map(z=>`<option value="${z[0]}">${z[1]}</option>`).join("")}</select></label></div>
    <div id="ar_clim"></div></div></details>

  <details class="acc" id="ar_dRoom" open><summary>Здание и конструкция <span class="sub" id="ar_sRoom"></span></summary><div class="accb">
    <div class="g2"><label>Тип здания (помещения)<select id="ar_bt">${BT.map(([k,t])=>`<option value="${k}">${esc(t)}</option>`).join("")}</select></label>
      <label>Тип ограждающей конструкции<select id="ar_ct">${CT.map(([k,t])=>`<option value="${k}">${esc(t)}</option>`).join("")}</select></label>
      <label class="ck"><input type="checkbox" id="ar_ribs"> Потолок с рёбрами при h/a &gt; 0,3</label>
      <label id="ar_lnman">Коэффициент n (внутренние стены к неотапливаемым помещениям)<input type="text" id="ar_nman" inputmode="decimal"></label></div>
    <div id="ar_room"></div></div></details>

  <details class="acc" id="ar_dEnv" open><summary>Внутри и снаружи <span class="sub" id="ar_sEnv"></span></summary><div class="accb">
    <div class="g2"><label>Температура внутреннего воздуха t<sub>int</sub>, °C<input type="text" id="ar_tint" inputmode="decimal"></label>
      <label>Относительная влажность внутреннего воздуха φ<sub>int</sub>, %<input type="text" id="ar_phi" inputmode="decimal"></label>
      <label>Коэффициент теплотехнической однородности r<input type="text" id="ar_r" inputmode="decimal"></label>
      <label>Условия эксплуатации конструкции<select id="ar_cond"><option value="auto">Автоматически (табл. 1–2 СП 50)</option><option value="А">А</option><option value="Б">Б</option></select></label>
      <label>Наружный воздух для графика<select id="ar_txm"><option value="p5">Холодная пятидневка 0,92</option><option value="m">Самый холодный месяц</option><option value="c">Свои значения</option></select></label>
      <label id="ar_ltx">t<sub>ext</sub>, °C<input type="text" id="ar_tx" inputmode="decimal"></label>
      <label id="ar_lpx">φ<sub>ext</sub>, %<input type="text" id="ar_px" inputmode="decimal"></label></div>
    <div id="ar_env"></div></div></details>

  <details class="acc" id="ar_dLay" open><summary>Слои конструкции (от внутренней грани к наружной) <span class="sub" id="ar_sLay"></span></summary><div class="accb">
    <div class="tw"><table class="lt" id="ar_lt"></table></div>
    <div class="acts2"><button type="button" class="btn sm" id="ar_add">＋ Вставить слой</button><button type="button" class="btn sm sec" id="ar_clr">Очистить</button></div></div></details>

  <div class="tabs" role="tablist"><button type="button" class="on" data-t="0">Тепловая защита</button><button type="button" data-t="1">Влагонакопление</button><button type="button" data-t="2">Тепловые потери</button></div>
  <div id="ar_out"></div>

  <details class="acc" id="ar_dRep"><summary>Отчёт</summary><div class="accb">
    <div class="metag" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
      ${[["obj","Объект"],["el","Элемент (марка, оси)"],["author","Выполнил"],["checker","Проверил"]].map(([k,t])=>`<label class="small" style="display:flex;flex-direction:column;gap:3px">${t}<input type="text" data-m="${k}"></label>`).join("")}</div>
    <div class="acts2"><button type="button" class="btn" id="ar_word">Скачать отчёт Word</button><button type="button" class="btn sec" id="ar_print">Печать / PDF</button></div></div></details>

  <dialog id="ar_dlg"></dialog></div>`;
  const $=id=>root.querySelector("#ar_"+id);
  // --- выбор пункта ---
  function fillReg(){ $("reg").innerHTML=regs.map(r=>`<option>${esc(r)}</option>`).join(""); }
  function fillCity(){ const rg=$("reg").value; $("city").innerHTML=CL.filter(c=>c.r===rg).sort((a,b)=>a.c.localeCompare(b.c,"ru")).map(c=>`<option value="${c.i}">${esc(c.c)}</option>`).join(""); }
  fillReg(); $("reg").value=CL[S.ci].r; fillCity(); $("city").value=S.ci;
  $("zone").value=S.zone; $("bt").value=S.bt; $("ct").value=S.ct; $("tint").value=fr(S.tint,1).replace(",0",""); $("phi").value=S.phi; $("r").value=String(S.r).replace(".",","); $("nman").value="0,7";
  // --- климат ---
  function drawClim(){
    const C=CL[S.ci], man=!!C.manual, inp=(k,val,w)=>man?`<input type="text" inputmode="decimal" data-k="${k}" value="${isFinite(val)?String(val).replace(".",","):""}">`:fr(val,w===undefined?0:w);
    const ten=S.bt==="2"||S.bt==="3";
    const rows=[["Температура холодной пятидневки, обеспеченность 0,92","t5",C.t5,"°C",0],
      ["Продолжительность отопительного периода (≤ "+(ten?10:8)+" °C)",ten?"z10":"z8",ten?C.z10:C.z8,"сут",0],
      ["Средняя температура отопительного периода",ten?"t10":"t8",ten?C.t10:C.t8,"°C",1],
      ["Относительная влажность воздуха наиболее холодного месяца","rh",C.rh,"%",0]];
    let h=man?`<p class="small">Данных по пункту нет в СП 131.13330.2025 — введите параметры из своего источника (значения сохраняются до закрытия страницы).</p>`:"";
    h+=`<table class="kv">${rows.map(r=>`<tr><td>${r[0]}</td><td>${inp(r[1],r[2],r[4])}</td><td>${r[3]}</td></tr>`).join("")}<tr><td>Градусо-сутки отопительного периода (ГСОП)</td><td id="ar_gsop"></td><td>°C·сут</td></tr></table>`;
    h+=`<p class="small" style="margin:12px 0 4px"><b>Температура воздуха T, °C и парциальное давление водяного пара E, гПа</b> — средние месячные и годовые (СП 131.13330.2025, табл. 7.1 и 11.1)</p>`;
    const cell=(arr,i,key,w)=>man?`<input type="text" data-${key}="${i}" value="${isFinite(arr[i])?String(arr[i]).replace(".",","):""}">`:fr(arr[i],1);
    const sh=["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек","Год"];
    h+=`<div class="tw"><table class="mt mon2"><tr><th></th>${sh.map(x=>`<th>${x}</th>`).join("")}</tr>
      <tr><td>T, °C</td>${sh.map((_,i)=>`<td>${cell(C.T,i,"t")}</td>`).join("")}</tr>
      <tr><td>E, гПа</td>${sh.map((_,i)=>`<td>${cell(C.E,i,"e")}</td>`).join("")}</tr></table></div>`;
    $("clim").innerHTML=h;
  }
  $("clim").addEventListener("input",e=>{ const C=CL[S.ci]; if(!C.manual) return; const d=e.target.dataset, v=pf(e.target.value);
    if(d.k) C[d.k]=v; if(d.t!==undefined) C.T[+d.t]=v; if(d.e!==undefined) C.E[+d.e]=v; recalc(); });
  // --- слои ---
  function drawLayers(){
    const lt=$("lt"); const c=lastCalc&&!lastCalc.err?lastCalc:null;
    let h=`<thead><tr><th>№</th><th>Тип</th><th>Материал</th><th>Толщина, мм</th><th>λ</th><th>μ (Rп)</th><th>R</th><th></th></tr></thead><tbody>`;
    h+=`<tr class="film"><td colspan="2">Внутри</td><td>Сопротивление тепловосприятию 1/α<sub>int</sub></td><td></td><td></td><td></td><td class="num" id="ar_rin"></td><td></td></tr>`;
    S.lay.forEach((L,i)=>{ h+=`<tr data-i="${i}"><td>${i+1}</td><td><span class="sw" style="background:${layCol(L)}"></span></td><td><span class="mat" data-a="pick">${esc(L.name)}</span></td>
      <td><input type="text" inputmode="decimal" data-a="d" value="${String(L.d).replace(".",",")}"></td><td class="num" data-c="lam"></td><td class="num" data-c="mu"></td><td class="num" data-c="R"></td>
      <td style="white-space:nowrap"><button class="ib" data-a="up" ${i?"":"disabled"} title="Выше">↑</button> <button class="ib" data-a="dn" ${i<S.lay.length-1?"":"disabled"} title="Ниже">↓</button> <button class="ib" data-a="ed" title="Свойства слоя">✎</button> <button class="ib" data-a="del" title="Удалить">✕</button></td></tr>`; });
    h+=`<tr class="film"><td colspan="2">Снаружи</td><td>Сопротивление теплоотдаче 1/α<sub>ext</sub></td><td></td><td></td><td></td><td class="num" id="ar_rout"></td><td></td></tr></tbody>`;
    lt.innerHTML=h; fillLayerCells();
  }
  function fillLayerCells(){
    const c=lastCalc&&!lastCalc.err?lastCalc:null; if(!c) return;
    $("rin").textContent=fr(1/c.aint,2); $("rout").textContent=fr(1/c.aext,2);
    c.layers.forEach((x,i)=>{ const tr=root.querySelector(`#ar_lt tr[data-i="${i}"]`); if(!tr) return;
      tr.querySelector('[data-c=lam]').textContent=fr(x.lam,3); tr.querySelector('[data-c=mu]').textContent=x.L.air?"—":isFinite(x.L.rp)?fr(x.Rp,2)+" Rп":fr(x.mu,3); tr.querySelector('[data-c=R]').textContent=fr(x.R,2); });
  }
  $("lt").addEventListener("input",e=>{ const tr=e.target.closest("tr[data-i]"); if(!tr||e.target.dataset.a!=="d") return; S.lay[+tr.dataset.i].d=pf(e.target.value); recalc(); });
  $("lt").addEventListener("click",e=>{ const b=e.target.closest("[data-a]"); if(!b) return; const tr=b.closest("tr[data-i]"); if(!tr) return; const i=+tr.dataset.i, a=b.dataset.a;
    if(a==="up"&&i>0){ [S.lay[i-1],S.lay[i]]=[S.lay[i],S.lay[i-1]]; drawLayers(); recalc(); }
    else if(a==="dn"&&i<S.lay.length-1){ [S.lay[i+1],S.lay[i]]=[S.lay[i],S.lay[i+1]]; drawLayers(); recalc(); }
    else if(a==="del"){ S.lay.splice(i,1); drawLayers(); recalc(); }
    else if(a==="ed") editLayer(i);
    else if(a==="pick") pickMaterial(i); });
  $("add").addEventListener("click",()=>pickMaterial(null));
  $("clr").addEventListener("click",()=>{ S.lay=[]; drawLayers(); recalc(); });

  // --- окно выбора материала ---
  const dlg=$("dlg");
  function propHtml(m){
    if(!m) return `<p class="small">Наведите курсор на материал, чтобы увидеть его характеристики.</p>`;
    if(m.air) return `<h4>${esc(m.name)}</h4><p class="small">Термическое сопротивление — по табл. Е.1 СП 50.13330.2012 в зависимости от толщины прослойки (0,01…0,3 м). Сопротивление паропроницанию принимается равным нулю.</p>`;
    const cd=m.cond||"A";
    return `<h4>${esc(m.name)}</h4><dl><dt>Плотность</dt><dd>ρ<sub>0</sub> = ${esc(m.dens)} кг/м³</dd><dt>Удельная теплоёмкость</dt><dd>c<sub>0</sub> = ${fr(m.c0,3).replace(/,?0+$/,"")} кДж/(кг·°C)</dd>
      <dt>Теплопроводность</dt><dd>λ<sub>0</sub> = ${fr(m.l0,3)} Вт/(м·°C)<br>λ(А) = ${fr(m.lA,3)} Вт/(м·°C)<br>λ(Б) = ${fr(m.lB,3)} Вт/(м·°C)</dd>
      <dt>Расчётная массовая влажность</dt><dd>w(А) = ${fr(m.wA,1)} %; w(Б) = ${fr(m.wB,1)} %</dd>
      <dt>Паропроницаемость</dt><dd>μ = ${isFinite(m.mu)?fr(m.mu,3):"—"} мг/(м·ч·Па)</dd>
      <dt>Теплоусвоение (24 ч)</dt><dd>s(А) = ${fr(m.sA,2)}; s(Б) = ${fr(m.sB,2)} Вт/(м²·°C)</dd>
      ${m.dw!=null?`<dt>Предельное приращение влажности (табл. 10)</dt><dd>Δw = ${fr(m.dw,1)} %</dd>`:""}</dl>`;
  }
  function treeHtml(){
    const groups=[]; const gi={};
    MAT.forEach(m=>{ let g=gi[m.g]; if(!g){ g=gi[m.g]={name:m.g,subs:[],si:{}}; groups.push(g); } let s=g.si[m.sg]; if(!s){ s=g.si[m.sg]={name:m.sg,items:[]}; g.subs.push(s); } s.items.push(m); });
    const order=["Теплоизоляционные засыпки","Теплоизоляционные материалы","Плиты и панели","Дерево и изделия из древесины","Бетоны","Кирпичная кладка и природный камень","Растворы","Гидроизоляция, кровельные и отделочные","Металлы, стекло"];
    groups.sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name));
    const itm=m=>`<button type="button" class="it" data-m="${m.id}">${esc(m.name)}</button>`;
    let h=`<button type="button" class="it" data-m="custom"><b>＋ Свой материал…</b></button>`;
    h+=groups.map(g=>`<details><summary>${esc(g.name)}</summary>${g.subs.map(s=>s.name?`<details><summary>${esc(s.name)}</summary>${s.items.map(itm).join("")}</details>`:s.items.map(itm).join("")).join("")}</details>`).join("");
    h+=`<details><summary>Воздушные прослойки</summary>${AIRN.map((n,k)=>`<button type="button" class="it" data-m="air${k}">${esc(n)}</button>`).join("")}</details>`;
    return h;
  }
  function pickMaterial(replaceIdx){
    dlg.innerHTML=`<div class="dh"><span>⚙ Выбор материала</span><button type="button" class="ib" data-x>✕</button></div>
      <div class="sr"><input type="search" id="ar_q" placeholder="Поиск материала: введите несколько букв, например «пенопл», «кирпич 1800», «минвата»" autocomplete="off"></div>
      <div class="db"><div class="tree" id="ar_tree">${treeHtml()}</div><div class="prop" id="ar_prop">${propHtml(null)}</div></div>
      <div class="df"><label>${replaceIdx===null?"Вставить после:":"Заменить слой:"}<select id="ar_after">${replaceIdx===null?`<option value="0">0. Внутри</option>`+S.lay.map((L,i)=>`<option value="${i+1}">${i+1}. ${esc(L.name.slice(0,60))}</option>`).join(""):`<option>${replaceIdx+1}. ${esc(S.lay[replaceIdx].name.slice(0,60))}</option>`}</select></label>
      <span class="small">Клик по материалу — добавить слой.</span><button type="button" class="btn sec sm" data-x style="margin-left:auto">Отмена</button></div>`;
    const after=dlg.querySelector("#ar_after"); if(replaceIdx===null) after.value=String(S.lay.length);
    const prop=dlg.querySelector("#ar_prop"), show=id=>{ const m=id.startsWith("air")?{air:true,name:AIRN[+id.slice(3)]}:MATBY[id]; prop.innerHTML=propHtml(m); };
    const tree=dlg.querySelector("#ar_tree"), q=dlg.querySelector("#ar_q"), full=tree.innerHTML;
    const norm=t=>String(t).toLowerCase().replace(/ё/g,"е");
    const idx=MAT.map(m=>({id:m.id,t:norm([m.name,m.dens,m.sg,m.g].join(" ")),m})).concat(AIRN.map((n,k)=>({id:"air"+k,t:norm("воздушная прослойка "+n),m:{name:n,air:true}})));
    const search=()=>{ const toks=norm(q.value).split(/\s+/).filter(Boolean);
      if(!toks.length){ tree.innerHTML=full; return; }
      const res=idx.filter(x=>toks.every(k=>x.t.includes(k))).slice(0,60);
      tree.innerHTML=res.length?res.map(x=>`<button type="button" class="it" data-m="${x.id}">${esc(x.m.name)}${x.m.air?"":` <span class="small">· ${esc(x.m.g)}</span>`}</button>`).join(""):`<p class="small">Ничего не найдено. Можно добавить «Свой материал» и ввести λ и μ вручную.</p>`; };
    q.addEventListener("input",search);
    q.addEventListener("keydown",e=>{ const first=tree.querySelector(".it[data-m]");
      if(e.key==="Enter"){ e.preventDefault(); if(q.value.trim()&&first) first.click(); }
      else if(e.key==="ArrowDown"&&first){ e.preventDefault(); first.focus(); } });
    tree.addEventListener("keydown",e=>{ if(e.key!=="ArrowDown"&&e.key!=="ArrowUp") return; const b=[...tree.querySelectorAll(".it[data-m]")], i=b.indexOf(document.activeElement); if(i<0) return; e.preventDefault();
      if(e.key==="ArrowUp"&&i===0){ q.focus(); return; } const n=b[i+(e.key==="ArrowDown"?1:-1)]; if(n) n.focus(); });
    dlg.onmouseover=e=>{ const b=e.target.closest("[data-m]"); if(b&&b.dataset.m!=="custom") show(b.dataset.m); };
    dlg.onfocusin=dlg.onmouseover;
    dlg.onclick=e=>{ if(e.target.closest("[data-x]")||e.target===dlg){ dlg.close(); return; }
      const b=e.target.closest("[data-m]"); if(!b) return; const id=b.dataset.m; let L;
      if(id==="custom") L={mat:"custom",name:"Свой материал",d:100,lamA:0.5,lamB:0.5,mu:0.1,rho:1000,dw:null,rp:NaN,air:false};
      else if(id.startsWith("air")) L=airLayer(+id.slice(3),30);
      else L=fromMat(MATBY[id],100);
      if(replaceIdx===null){ const pos=+after.value; S.lay.splice(pos,0,L); } else { L.d=S.lay[replaceIdx].d; S.lay[replaceIdx]=L; }
      dlg.close(); drawLayers(); recalc(); if(id==="custom") editLayer(replaceIdx===null?+after.value:replaceIdx); };
    dlg.showModal(); q.focus();
  }
  function editLayer(i){
    const L=S.lay[i]; const n=x=>x!=null&&isFinite(x)?String(x).replace(".",","):"";
    dlg.innerHTML=`<div class="dh"><span>Свойства слоя ${i+1}</span><button type="button" class="ib" data-x>✕</button></div>
      <div class="accb"><div class="g2"><label>Наименование<input type="text" id="e_name" value="${esc(L.name)}"></label>
      ${L.air?`<p class="small">Воздушная прослойка: сопротивление — по табл. Е.1 от толщины.</p>`:`
      <label>λ для условий А, Вт/(м·°C)<input type="text" id="e_la" value="${n(L.lamA)}"></label><label>λ для условий Б, Вт/(м·°C)<input type="text" id="e_lb" value="${n(L.lamB)}"></label>
      <label>μ, мг/(м·ч·Па)<input type="text" id="e_mu" value="${n(L.mu)}"></label><label>Rп вместо μ, м²·ч·Па/мг (для плёнок, мембран, рулонных материалов)<input type="text" id="e_rp" value="${n(L.rp)}"></label>
      <label>Плотность ρ, кг/м³<input type="text" id="e_rho" value="${n(L.rho)}"></label><label>Δw (табл. 10 СП 50), % по массе<input type="text" id="e_dw" value="${n(L.dw)}"></label>`}</div>
      <p class="small">Значения из каталога можно изменить (например, по паспорту материала). Пустые поля считаются незаданными.</p></div>
      <div class="df"><button type="button" class="btn sm" id="e_ok">Применить</button><button type="button" class="btn sec sm" data-x>Отмена</button></div>`;
    dlg.onmouseover=dlg.onfocusin=null;
    dlg.onclick=e=>{ if(e.target.closest("[data-x]")||e.target===dlg){ dlg.close(); return; }
      if(e.target.id==="e_ok"){ const g=id=>{ const el=dlg.querySelector("#"+id); return el?pf(el.value):NaN; };
        L.name=dlg.querySelector("#e_name").value||L.name;
        if(!L.air){ L.lamA=g("e_la"); L.lamB=g("e_lb"); L.mu=g("e_mu"); L.rp=g("e_rp"); L.rho=g("e_rho"); L.dw=isFinite(g("e_dw"))?g("e_dw"):null; }
        dlg.close(); drawLayers(); recalc(); } };
    dlg.showModal();
  }

  // --- чтение полей ---
  function readState(){
    S.ci=+$("city").value; S.zone=$("zone").value; S.bt=$("bt").value; S.ct=$("ct").value; S.ribs=$("ribs").checked;
    S.nman=pf($("nman").value); S.tint=pf($("tint").value); S.phi=pf($("phi").value); S.r=pf($("r").value); S.cond=$("cond").value; S.txMode=$("txm").value;
    S.area=S.area;
    const C=CL[S.ci];
    if(S.txMode==="p5"){ S.tx=C.t5; S.px=C.rh; }
    else if(S.txMode==="m"&&C.T.every(isFinite)&&C.E.every(isFinite)){ let k=0; for(let i=1;i<12;i++) if(C.T[i]<C.T[k]) k=i; S.tx=C.T[k]; S.px=Math.min(100,100*C.E[k]*100/Esat(C.T[k])); }
    else if(S.txMode==="c"){ S.tx=pf($("tx").value); S.px=pf($("px").value); }
    else { S.tx=NaN; S.px=NaN; }
    return S;
  }
  // --- вывод ---
  const chartSvg=(c,kind)=>{
    const P=c.prof, W=760, H=330, mL=44, mR=44, mT=26, mB=44, pw=W-mL-mR, ph=H-mT-mB;
    const xs=P.pts.map(p=>p.x), tot=P.total||1, pad=tot*0.03+1;
    const x0=-pad, x1=tot+pad;
    const ys=[]; P.pts.forEach(p=>{ ys.push(p.t,p.td); }); ys.push(c.tint,P.tx);
    let ymin=Math.floor((Math.min(...ys)-1)/5)*5, ymax=Math.ceil((Math.max(...ys)+1)/5)*5;
    const X=x=>mL+(x-x0)/(x1-x0)*pw, Y=t=>mT+(ymax-t)/(ymax-ymin)*ph;
    const fg=getComputedStyle(root).color||"#222";
    let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart" font-family="system-ui,Arial,sans-serif" font-size="12">`;
    s+=`<rect width="${W}" height="${H}" fill="#fff"/>`;
    // слои
    c.layers.forEach((l,i)=>{ const a=P.pts[i].x,b=P.pts[i+1].x; s+=`<rect x="${X(a)}" y="${mT}" width="${Math.max(1,X(b)-X(a))}" height="${ph}" fill="${layCol(l.L)}" opacity=".85"/><circle cx="${(X(a)+X(b))/2}" cy="${mT+14}" r="9" fill="#fff" stroke="#333"/><text x="${(X(a)+X(b))/2}" y="${mT+18}" text-anchor="middle" fill="#222" font-size="11">${i+1}</text>`; });
    // сетка
    for(let t=ymin;t<=ymax;t+=5){ s+=`<line x1="${mL}" x2="${W-mR}" y1="${Y(t)}" y2="${Y(t)}" stroke="#bbb" stroke-dasharray="2 3" stroke-width=".7"/><text x="${mL-6}" y="${Y(t)+4}" text-anchor="end" fill="#222">${t}</text><text x="${W-mR+6}" y="${Y(t)+4}" fill="#222">${t}</text>`; }
    const st=Math.max(1,Math.ceil(tot/10/5)*5); for(let x=0;x<=tot;x+=st) s+=`<line x1="${X(x)}" x2="${X(x)}" y1="${mT+ph}" y2="${mT+ph+4}" stroke="#333"/><text x="${X(x)}" y="${mT+ph+16}" text-anchor="middle" fill="#222">${fr(x,0)}</text>`;
    s+=`<text x="${mL}" y="14" fill="#222">(°C)</text><text x="${W-mR}" y="${H-6}" text-anchor="end" fill="#222">(см)</text><text x="${mL}" y="${H-6}" fill="#222">Внутри</text><text x="${W-mR-40}" y="${H-6}" text-anchor="end" fill="#222">Снаружи</text>`;
    const tl=[[x0,c.tint]].concat(P.pts.map(p=>[p.x,p.t])).concat([[x1,P.tx]]);
    // линия точки росы (непрерывная вдоль толщины)
    const dl=P.pts.map(p=>[p.x,p.td]);
    const n=60, dense=[]; // плотная выборка для зоны конденсации
    for(let i=0;i<c.layers.length;i++){ const A=P.pts[i],B=P.pts[i+1]; for(let k=0;k<=n;k++){ const u=k/n; const t=A.t+(B.t-A.t)*u, e=A.e+(B.e-A.e)*u; dense.push([A.x+(B.x-A.x)*u,t,tdew(Math.max(e,1))]); } }
    if(kind!=="t"&&dense.length){ const seg=[]; let cur=null; dense.forEach(p=>{ if(p[2]>p[1]){ if(!cur){cur=[];seg.push(cur);} cur.push(p); } else cur=null; });
      seg.forEach(sg=>{ if(sg.length<2) return; s+=`<polygon points="${sg.map(p=>X(p[0])+","+Y(p[1])).join(" ")+" "+sg.slice().reverse().map(p=>X(p[0])+","+Y(p[2])).join(" ")}" fill="#2f6df0" opacity=".45"/>`; });
      s+=`<polyline points="${dense.map(p=>X(p[0])+","+Y(p[2])).join(" ")}" fill="none" stroke="#1f4fd8" stroke-width="2"/>`; }
    s+=`<polyline points="${tl.map(p=>X(p[0])+","+Y(p[1])).join(" ")}" fill="none" stroke="#111" stroke-width="2"/>`;
    s+=`</svg>`; return s;
  };
  function legend(c){ return `<div class="leg"><span><span class="sw" style="background:#111;height:3px;width:22px;border:0"></span> Температура</span><span><span class="sw" style="background:#1f4fd8;height:3px;width:22px;border:0"></span> Температура «точки росы»</span><span><span class="sw" style="background:#2f6df0;opacity:.45"></span> Зона конденсации</span>${c.layers.map((l,i)=>`<span>(${i+1}) [${fr(l.L.d,0)} мм] ${esc(l.L.name)}</span>`).join("")}</div>`; }
  function scale(c){
    const mx=Math.max(c.Rt*1.3,c.R0*1.1,0.1), pc=x=>(x/mx*100).toFixed(1)+"%";
    const col=c.stat==="ok"?"#2fa84f":c.stat==="mid"?"#e0a100":"#d23b2e";
    const pos=[["Rс",c.Rc],["Rэ",c.Re],["Rт",c.Rt]].sort((a,b)=>a[1]-b[1]);
    $("scal").innerHTML=`<i style="width:${pc(Math.min(c.R0,mx))};background:${col}"></i>`+pos.map(([n,v])=>`<u style="left:${pc(v)}"><s>${n}</s></u>`).join("");
    const M=c.moist; const pb=$("pbar");
    pb.style.background=!M.ok?"var(--sunk)":M.pass?"#2fa84f":"#d23b2e";
  }
  function outThermal(c){
    const P=c.prof; let h="";
    h+=`<div class="big">Сопротивление теплопередаче: ${fr(c.R0,2)} (м²·°C)/Вт</div>`;
    h+=chartSvg(c,"d")+legend(c);
    h+=`<div class="acts2"><button type="button" class="btn sec sm" id="ar_png">⭳ Загрузить график</button></div>`;
    h+=`<p class="small" style="margin-top:14px"><b>Слои конструкции (изнутри наружу)</b>, наружный воздух: t = ${fr(P.tx,1)} °C, φ = ${fr(P.px,0)} %</p>
      <div class="tw"><table class="mt"><thead><tr><th>№</th><th>Толщина, мм</th><th style="text-align:left">Материал</th><th>λ</th><th>R</th><th>T<sub>max</sub></th><th>T<sub>min</sub></th></tr></thead><tbody>
      <tr><td></td><td></td><td style="text-align:left">Сопротивление тепловосприятию</td><td></td><td>${fr(1/c.aint,2)}</td><td>${fr(c.tint,1)}</td><td>${fr(P.surfIn,1)}</td></tr>
      ${c.layers.map((l,i)=>`<tr><td>${i+1}</td><td>${fr(l.L.d,0)}</td><td style="text-align:left">${esc(l.L.name)}</td><td>${fr(l.lam,3)}</td><td>${fr(l.R,2)}</td><td>${fr(P.pts[i].t,1)}</td><td>${fr(P.pts[i+1].t,1)}</td></tr>`).join("")}
      <tr><td></td><td></td><td style="text-align:left">Сопротивление теплоотдаче</td><td></td><td>${fr(1/c.aext,2)}</td><td>${fr(P.surfOut,1)}</td><td>${fr(P.tx,1)}</td></tr></tbody></table></div>
      <div class="req2"><span>Термическое сопротивление ограждающей конструкции ΣR</span><span>${fr(c.sumR,2)}</span>
      <span>Сопротивление теплопередаче ограждающей конструкции R<sub>0</sub> (r = ${fr(c.r,2)})</span><span>${fr(c.R0,2)}</span></div>
      <p class="small"><b>Требуемое сопротивление теплопередаче</b></p>
      <div class="req2"><span>Санитарно-гигиенические требования R<sub>с</sub></span><span class="${c.sanOk?"gn":"rn"}">${fr(c.Rc,2)}</span>
      <span>Нормируемое значение поэлементных требований R<sub>э</sub> (m<sub>p</sub> = ${fr(c.mpmin,2)})</span><span class="${c.R0>=c.Re?"gn":"rn"}">${fr(c.Re,2)}</span>
      <span>Базовое значение поэлементных требований R<sub>т</sub></span><span class="${c.R0>=c.Rt?"gn":"rn"}">${fr(c.Rt,2)}</span></div>`;
    if(c.RtNote) h+=`<p class="small">${esc(c.RtNote)}.</p>`;
    h+=`<div class="msg ${c.sanOk&&c.condOk?"ok":"bad"}"><b>Санитарно-гигиенические требования: R<sub>0</sub> ${c.sanOk?"≥":"<"} R<sub>с</sub></b>${c.sanOk?"Ограждающая конструкция удовлетворяет санитарно-гигиеническим нормам по тепловой защите.":"Ограждающая конструкция не удовлетворяет санитарно-гигиеническим нормам по тепловой защите. Эксплуатация такой конструкции недопустима."}
      Перепад Δt<sub>0</sub> = ${fr(c.dt0,2)} °C ${c.dt0<=c.dtn?"≤":">"} Δt<sub>n</sub> = ${fr(c.dtn,1)} °C; τ<sub>int</sub> = ${fr(c.tauInt,2)} °C, точка росы t<sub>d</sub> = ${fr(c.td,2)} °C${c.condOk?" — конденсата на внутренней поверхности нет.":" — возможна конденсация на внутренней поверхности."}</div>`;
    const m=c.stat==="ok"?["ok","Поэлементные требования: R<sub>0</sub> ≥ R<sub>т</sub>","Ограждающая конструкция удовлетворяет нормам по тепловой защите вне зависимости от иных требований."]:
            c.stat==="mid"?["mid","Поэлементные требования: R<sub>э</sub> ≤ R<sub>0</sub> < R<sub>т</sub>","Конструкция удовлетворяет поэлементным требованиям только при выполнении комплексного требования — удельной характеристики расхода тепловой энергии (прил. Г СП 50.13330.2012, п. 5.2)."]:
            ["bad","Поэлементные требования: R<sub>0</sub> < R<sub>э</sub>","Ограждающая конструкция не удовлетворяет нормам (поэлементные требования) по тепловой защите."];
    h+=`<div class="msg ${m[0]}"><b>${m[1]}</b>${m[2]}</div>`;
    if(P.cond) h+=`<div class="msg mid"><b>Условия для графика</b>При заданных внутренних и наружных условиях в конструкции есть зона, где температура ниже температуры точки росы (стационарный расчёт). Накопление влаги за год оценивается на вкладке «Влагонакопление».</div>`;
    return h;
  }
  /* безразмерный график: X — доля термического сопротивления от внутреннего воздуха, Y — доля сопротивления паропроницанию */
  function moistSvg(c){
    const M=c.moist, W=760, H=330, mL=44, mR=44, mT=26, mB=44, pw=W-mL-mR, ph=H-mT-mB;
    const X=x=>mL+x*pw, Y=y=>mT+(1-y)*ph, Rt=c.Rcond;
    let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart" font-family="system-ui,Arial,sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>`;
    for(let t=0;t<=10;t+=2){ const v=t/10; s+=`<line x1="${mL}" x2="${W-mR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ccc" stroke-dasharray="2 3" stroke-width=".7"/><text x="${mL-6}" y="${Y(v)+4}" text-anchor="end" fill="#222">${v.toFixed(1)}</text><text x="${W-mR+6}" y="${Y(v)+4}" fill="#222">${v.toFixed(1)}</text><text x="${X(v)}" y="${mT+ph+16}" text-anchor="middle" fill="#222">${v.toFixed(1)}</text>`; }
    const b=[1/c.aint/Rt]; let Rcum=1/c.aint, Rp=0; const gp=[[0,0],[b[0],0]];
    const Rp0=M.Rp0; c.layers.forEach((l,i)=>{ Rcum+=l.R; Rp+=l.Rp; b.push(Rcum/Rt); gp.push([Rcum/Rt,Rp/Rp0]); }); gp.push([1,1]);
    const bl=[0].concat(b); 
    c.layers.forEach((l,i)=>{ const xm=(bl[i+1]+b[i+1])/2; s+=`<line x1="${X(b[i+1])}" x2="${X(b[i+1])}" y1="${mT}" y2="${mT+ph}" stroke="#777" stroke-width=".8"/>`; s+=`<circle cx="${X((b[i]+b[i+1])/2)}" cy="${Y(0.12)}" r="9" fill="#fff" stroke="#333"/><text x="${X((b[i]+b[i+1])/2)}" y="${Y(0.12)+4}" text-anchor="middle" fill="#222" font-size="11">${i+1}</text>`; });
    s+=`<line x1="${X(b[0])}" x2="${X(b[0])}" y1="${mT}" y2="${mT+ph}" stroke="#777" stroke-width=".8"/>`;
    s+=`<polyline points="${gp.map(p=>X(p[0])+","+Y(p[1])).join(" ")}" fill="none" stroke="#22c322" stroke-width="2.2"/>`;
    // насыщенный пар
    const cx=M.cx, ev=M.ev, ex=cx.e, pts=[]; for(let k=0;k<=200;k++){ const x=k/200, t=c.tint-(c.tint-cx.t)*x, y=(ev-Esat(t))/(ev-ex); pts.push([x,y]); }
    let seg=[],segs=[]; pts.forEach(p=>{ if(p[1]>=0&&p[1]<=1.0001){ seg.push(p); } else { if(seg.length) segs.push(seg); seg=[]; } }); if(seg.length) segs.push(seg);
    segs.forEach(sg=>{ s+=`<polyline points="${sg.map(p=>X(p[0])+","+Y(Math.min(1,p[1]))).join(" ")}" fill="none" stroke="#2430e0" stroke-width="2.2"/>`; });
    if(!M.outer){ const i=M.plane.i; const xp=((bl[i]+ (b[i+1]-bl[i])*0) , 0); const Rx=1/c.aint+c.layers.slice(0,i).reduce((q,l)=>q+l.R,0)+c.layers[i].R*M.plane.frac; const xx=Rx/Rt; s+=`<line x1="${X(xx)}" x2="${X(xx)}" y1="${mT}" y2="${mT+ph}" stroke="#e02424" stroke-width="2"/>`; }
    s+=`<text x="${mL}" y="14" fill="#222">Y</text><text x="${W-mR}" y="${H-6}" text-anchor="end" fill="#222">X</text><text x="${mL}" y="${H-6}" fill="#222">Внутри</text><text x="${W-mR-30}" y="${H-6}" text-anchor="end" fill="#222">Снаружи</text></svg>`;
    return s;
  }
  function outMoist(c){
    const M=c.moist; if(!M.ok) return `<div class="msg mid"><b>Влагонакопление</b>${esc(M.msg)}</div>`;
    let h=`<div class="big" style="font-size:15px">Расчёт защиты от переувлажнения методом безразмерных величин</div><p class="small" style="text-align:center">Нахождение плоскости максимального увлажнения (СП 50.13330.2012, раздел 8; климат — СП 131.13330.2025)</p>`;
    h+=moistSvg(c);
    h+=`<div class="leg"><span><span class="sw" style="background:#22c322;height:3px;width:22px;border:0"></span> Безразмерное сопротивление паропроницанию</span><span><span class="sw" style="background:#2430e0;height:3px;width:22px;border:0"></span> То же насыщенного паром воздуха</span><span><span class="sw" style="background:#e02424;height:3px;width:22px;border:0"></span> Плоскость максимального увлажнения</span>${c.layers.map((l,i)=>`<span>(${i+1}) [${fr(l.L.d,0)} мм] ${esc(l.L.name)}</span>`).join("")}</div>`;
    h+=`<div class="acts2"><button type="button" class="btn sec sm" id="ar_png">⭳ Загрузить график</button></div>`;
    const raw=v=>isFinite(v)?fr(v,2):"—";
    h+=`<table class="kv" style="margin-top:12px"><tr><td>Координата плоскости максимального увлажнения</td><td>X</td><td>${M.outer?"—":fr(M.Xplane,1)+" мм"}</td></tr>
      <tr><td>Сопротивление паропроницанию от внутренней поверхности до плоскости максимального увлажнения</td><td>R<sub>п</sub>(в)</td><td>${M.outer?"0,00":fr(M.Rpin,2)} (м²·ч·Па)/мг</td></tr>
      <tr><td>Сопротивление паропроницанию от плоскости максимального увлажнения до наружной поверхности</td><td>R<sub>п</sub>(н)</td><td>${fr(M.Rpn,2)} (м²·ч·Па)/мг</td></tr>
      <tr><td>Условие недопустимости накопления влаги в конструкции за годовой период эксплуатации</td><td>R<sub>п.тр</sub>(1)</td><td class="${M.Rp1>M.Rpin?"rn":"gn"}">${fr(M.Rp1,2)} (м²·ч·Па)/мг</td></tr>
      <tr><td>Условие ограничения влаги в конструкции за период с отрицательными среднемесячными температурами</td><td>R<sub>п.тр</sub>(2)</td><td class="${M.Rp2>M.Rpin?"rn":"gn"}">${M.note2?"—":fr(M.Rp2,2)} (м²·ч·Па)/мг</td></tr></table>`;
    if(M.note2) h+=`<div class="msg mid">${esc(M.note2)}</div>`;
    { const mn=c.layers.filter(l=>l.L.muNote&&!isFinite(l.L.rp)); if(mn.length) h+=`<div class="msg mid">В таблице Т.1 СП 50 для «${esc(mn.map(l=>l.L.name).join("»; «"))}» коэффициент μ не указан — принят по ближайшей плотности того же материала (μ = ${mn.map(l=>fr(l.L.mu,3)).join("; ")}). При необходимости уточните в окне ✎.</div>`; }
    if(M.outer) h+=`<div class="msg ok"><b>Защита от переувлажнения конструкции</b>В ограждающей конструкции нет условий для образования конденсата: плоскость максимального увлажнения в толще не образуется (расположена на наружной поверхности).</div>`;
    else h+=`<div class="msg ${M.pass?"ok":"bad"}"><b>Защита от переувлажнения конструкции: R<sub>п</sub>(в) = ${fr(M.Rpin,2)} ${M.pass?"≥":"<"} R<sub>п.тр</sub> = ${fr(M.Rtr,2)} (м²·ч·Па)/мг</b>${M.pass?"Сопротивление паропроницанию внутренней части конструкции достаточно: накопления влаги сверх допустимого нет.":"Сопротивление паропроницанию внутренней части конструкции недостаточно. Требуется пароизоляция со стороны помещения или изменение состава слоёв."}</div>`;
    h+=`<p class="small" style="margin-top:16px"><b>Послойный расчёт защиты от переувлажнения</b></p><div class="tw"><table class="mt"><thead><tr><th>№</th><th>Толщина</th><th style="text-align:left">Материал</th><th>μ</th><th>R<sub>п</sub></th><th>X</th><th>R<sub>п</sub>(в)</th><th>R<sub>п.тр</sub>(1)</th><th>R<sub>п.тр</sub>(2)</th></tr></thead><tbody>${M.rows.map((r,i)=>`<tr><td>${i+1}</td><td>${fr(r.d,0)}</td><td style="text-align:left">${esc(r.name)}</td><td>${raw(r.mu)}</td><td>${fr(r.Rp,2)}</td><td>${!isFinite(r.Xi)?"—":r.Xi>r.d?fr(r.d,0)+" ("+fr(r.Xi,1)+")":fr(r.Xi,1)}</td><td>${fr(r.Rpin,2)}</td><td>${r.inPl&&isFinite(r.Rp1)?fr(r.Rp1,2):"0,00"}</td><td>${r.inPl&&!M.note2?fr(r.Rp2,2):"0,00"}</td></tr>`).join("")}</tbody></table></div>`;
    h+=M.rows.map((r,i)=>`<p class="small" style="margin:10px 0 2px"><b>${i+1}. ${esc(r.name)}</b></p><table class="kv"><tr><td>Толщина слоя</td><td>d</td><td>${fr(r.d,0)} мм</td></tr><tr><td>Координата плоскости возможной конденсации</td><td>X<sub>i</sub></td><td>${isFinite(r.Xi)?fr(r.Xi,1)+" мм":"—"}</td></tr></table><div class="msg ${r.inside?"mid":"ok"}" style="margin:4px 0">${r.inside?"В слое возможна плоскость конденсации (температура плоскости максимального увлажнения лежит в пределах слоя).":"В выбранном слое ограждающей конструкции нет условий для образования конденсата."}</div>`).join("");
    h+=`<p class="small" style="margin-top:12px">Годовой период (ф. 8.1, 8.4): зима (T &lt; −5 °C) — ${M.per.z[0]} мес., весна–осень — ${M.per.z[1]} мес., лето — ${M.per.z[2]} мес.; E = ${fr(M.E,0)} Па, e<sub>н</sub> = ${fr(M.en,0)} Па, e<sub>в</sub> = ${fr(M.ev,0)} Па.${M.z0>0?` Период с отрицательными температурами: z<sub>0</sub> = ${M.z0} сут, t<sub>н.отр</sub> = ${fr(M.tno,2)} °C, e<sub>н.отр</sub> = ${fr(M.eno,0)} Па, E<sub>0</sub> = ${fr(M.E0,0)} Па.`:""}</p>`;
    return h;
  }
  function lossSvg(c){
    const L=c.loss, R0=c.R0, dT=c.tint-c.text, W=760, H=330, mL=44, mR=44, mT=26, mB=44, pw=W-mL-mR, ph=H-mT-mB;
    const Rmin=Math.max(0.2,Math.floor(Math.min(c.Rc,R0)*0.9*2)/2), Rmax=Math.max(R0*1.5,c.Rt)*1.08;
    const X=r=>mL+(r-Rmin)/(Rmax-Rmin)*pw, ymax=Math.ceil(dT/Rmin/5)*5, Y=q=>mT+(1-q/ymax)*ph;
    let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart" font-family="system-ui,Arial,sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>`;
    const st=ymax>40?10:5; for(let q=0;q<=ymax;q+=st) s+=`<line x1="${mL}" x2="${W-mR}" y1="${Y(q)}" y2="${Y(q)}" stroke="#ccc" stroke-dasharray="2 3" stroke-width=".7"/><text x="${mL-6}" y="${Y(q)+4}" text-anchor="end" fill="#222">${q}</text><text x="${W-mR+6}" y="${Y(q)+4}" fill="#222">${q}</text>`;
    const rs=Math.max(0.5,Math.round((Rmax-Rmin)/8*2)/2); for(let r=Math.ceil(Rmin/rs)*rs;r<=Rmax;r+=rs) s+=`<line x1="${X(r)}" x2="${X(r)}" y1="${mT+ph}" y2="${mT+ph+4}" stroke="#333"/><text x="${X(r)}" y="${mT+ph+16}" text-anchor="middle" fill="#222">${fr(r,1)}</text>`;
    const pts=[]; for(let k=0;k<=120;k++){ const r=Rmin+(Rmax-Rmin)*k/120; pts.push(X(r)+","+Y(dT/r)); }
    s+=`<polyline points="${pts.join(" ")}" fill="none" stroke="#777" stroke-width="2.2"/>`;
    L.marks.forEach(m=>{ if(m.r>=Rmin&&m.r<=Rmax) s+=`<line x1="${X(m.r)}" x2="${X(m.r)}" y1="${Y(dT/m.r)}" y2="${mT+ph}" stroke="${m.col}" stroke-width="2.4"/>`; });
    s+=`<text x="${mL}" y="14" fill="#222">Q, Вт·ч</text><text x="${W-mR}" y="${H-6}" text-anchor="end" fill="#222">R, (м²·°C)/Вт</text></svg>`; return s;
  }
  function outLoss(c){
    const L=c.loss, q0=L.q;
    const row=(n,r,col)=>`<tr><td style="text-align:left">${n}</td><td>${fr(r,2)}</td><td>${fr((r/c.R0-1)*100,2)}</td><td>${fr(c.tint-c.text>0?(c.tint-c.text)/r:NaN,2)}</td><td>${fr((c.tint-c.text)/r-q0,2)}</td></tr>`;
    let h=`<div class="big" style="font-size:15px">Тепловые потери через квадратный метр ограждающей конструкции</div>`+lossSvg(c);
    h+=`<div class="leg">${L.marks.map(m=>`<span><span class="sw" style="background:${m.col};height:3px;width:22px;border:0"></span> ${m.n}</span>`).join("")}</div>`;
    h+=`<div class="acts2"><button type="button" class="btn sec sm" id="ar_png">⭳ Загрузить график</button></div>`;
    h+=`<p class="small" style="margin-top:14px"><b>Потери тепла через 1 м² за один час при сопротивлении теплопередаче (Вт·ч)</b></p><div class="tw"><table class="mt"><thead><tr><th>Сопротивление теплопередаче</th><th>R</th><th>±R, %</th><th>Q</th><th>±Q, Вт·ч</th></tr></thead><tbody>
      ${row("Санитарно-гигиенические требования [Rс]",c.Rc)}${row("Нормируемое значение поэлементных требований [Rэ]",c.Re)}${row("Базовое значение поэлементных требований [Rт]",c.Rt)}
      ${row("<b>Сопротивление теплопередаче ограждающей конструкции [R]</b>",c.R0)}${row("R + 10%",c.R0*1.1)}${row("R + 25%",c.R0*1.25)}${row("R + 50%",c.R0*1.5)}${row("R + 100%",c.R0*2)}</tbody></table></div>
      <div class="req2"><span>Потери тепла через 1 м² за отопительный период 0,024·ГСОП/R, кВт·ч</span><span>${fr(L.season,2)}</span><span>Потери тепла через 1 м² за 1 час при температуре холодной пятидневки, Вт·ч</span><span>${fr(L.q,2)}</span></div>
      <div class="g2" style="max-width:420px;margin-top:10px"><label>Площадь конструкции, м²<input type="text" id="ar_area" inputmode="decimal" value="${String(S.area).replace(".",",")}"></label></div>
      <div class="req2"><span>Теплопотери через конструкцию Q = q·A при расчётной температуре, Вт</span><span>${fr(L.Q,0)}</span><span>За отопительный период на всю площадь, кВт·ч</span><span>${fr(L.seasonA,0)}</span></div>
      <div class="tw"><table class="mt"><thead><tr><th>Месяц</th><th>T, °C</th><th>Δt, °C</th><th>Сут</th><th>кВт·ч/м²</th><th>кВт·ч</th></tr></thead><tbody>${L.rows.map(r=>`<tr><td>${r.m}</td><td>${fr(r.T,1)}</td><td>${fr(r.dT,1)}</td><td>${r.days}</td><td>${r.e?fr(r.e,1):"—"}</td><td>${r.e?fr(r.e*L.A,0):"—"}</td></tr>`).join("")}
      <tr><td><b>Итого (помесячно, T &lt; +8 °C)</b></td><td></td><td></td><td></td><td><b>${fr(L.sum,1)}</b></td><td><b>${fr(L.sumA,0)}</b></td></tr></tbody></table></div>`;
    return h;
  }
  function recalc(){
    readState();
    const c=calc(S); lastCalc=c;
    const out=$("out");
    $("lnman").hidden=S.ct!=="3"; $("ltx").hidden=$("lpx").hidden=S.txMode!=="c";
    if(S.txMode!=="c"&&isFinite(S.tx)){ $("tx").value=fr(S.tx,1).replace(",0",""); $("px").value=fr(S.px,0); }
    $("sClim").textContent=`${CL[S.ci].c} (${CL[S.ci].r})`;
    if(c.err){ out.innerHTML=`<div class="msg bad">${esc(c.err)}</div>`; $("scal").innerHTML=""; $("pbar").style.background="var(--sunk)"; return; }
    $("sRoom").textContent=`${REGN[c.reg]} режим · условия эксплуатации ${c.cond}`;
    $("sEnv").textContent=`Внутри: ${fr(c.tint,0)} °C (${fr(c.phi,0)} %)`;
    $("sLay").textContent=`${S.lay.length} сл., R = ${fr(c.R0,2)}`;
    if($("gsop")) $("gsop").textContent=fr(c.gsop,1);
    drawRoom(c); fillLayerCells(); scale(c);
    out.innerHTML=tab===0?outThermal(c):tab===1?outMoist(c):outLoss(c);
    const png=out.querySelector("#ar_png"); if(png) png.onclick=()=>savePng(out.querySelector("svg.chart"));
    const bindLoss=()=>{ const ar=out.querySelector("#ar_area"); if(!ar) return; ar.oninput=()=>{ S.area=pf(ar.value); const pos=ar.selectionStart; const c2=calc(S); lastCalc=c2; out.innerHTML=outLoss(c2); const p2=out.querySelector("#ar_png"); if(p2) p2.onclick=()=>savePng(out.querySelector("svg.chart")); const a2=out.querySelector("#ar_area"); a2.focus(); try{a2.setSelectionRange(pos,pos);}catch(e){} bindLoss(); }; };
    bindLoss();
  }
  function drawRoom(c){
    $("room").innerHTML=`<table class="kv"><tr><td>Влажностный режим помещения (табл. 1 СП 50)</td><td>${REGN[c.reg]}</td><td></td></tr>
      <tr><td>Условия эксплуатации ограждающей конструкции (табл. 2; зона влажности — ${ZONE.find(z=>z[0]===S.zone)[1]})</td><td>${c.cond}${S.cond==="auto"?"":" (задано вручную)"}</td><td></td></tr>
      <tr><td>Коэффициент положения наружной поверхности по отношению к наружному воздуху n</td><td>${fr(c.n,2)}</td><td></td></tr>
      <tr><td>Коэффициент теплоотдачи внутренней поверхности α<sub>int</sub></td><td>${fr(c.aint,1)}</td><td>Вт/(м²·°C)</td></tr>
      <tr><td>Коэффициент теплоотдачи наружной поверхности α<sub>ext</sub></td><td>${fr(c.aext,0)}</td><td>Вт/(м²·°C)</td></tr>
      <tr><td>Нормируемый температурный перепад Δt<sub>n</sub></td><td>${fr(c.dtn,1)}</td><td>°C</td></tr>
      <tr><td>Температура точки росы внутреннего воздуха t<sub>d</sub></td><td>${fr(c.td,2)}</td><td>°C</td></tr></table>`;
    $("env").innerHTML=`<p class="small">Градусо-сутки отопительного периода ГСОП = ${fr(c.gsop,1)} °C·сут (t<sub>ht</sub> = ${fr(c.tht,1)} °C, z<sub>ht</sub> = ${c.zht} сут).</p>`;
  }
  function savePng(svg){ if(!svg) return; const xml=new XMLSerializer().serializeToString(svg); const img=new Image();
    img.onload=()=>{ const cv=document.createElement("canvas"); cv.width=1520; cv.height=660; const g=cv.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,cv.width,cv.height); g.drawImage(img,0,0,cv.width,cv.height);
      cv.toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="АР-01 график.png"; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000); }); };
    img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(xml); }

  // --- события ---
  $("reg").addEventListener("change",()=>{ fillCity(); S.ci=+$("city").value; drawClim(); recalc(); });
  $("city").addEventListener("change",()=>{ S.ci=+$("city").value; drawClim(); recalc(); });
  ["zone","bt","ct","ribs","cond","txm"].forEach(k=>$(k).addEventListener("change",()=>{ if(k==="bt") drawClim(); recalc(); }));
  ["nman","tint","phi","r","tx","px"].forEach(k=>$(k).addEventListener("input",recalc));
  root.querySelector(".tabs").addEventListener("click",e=>{ const b=e.target.closest("button[data-t]"); if(!b) return; tab=+b.dataset.t; root.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("on",x===b)); recalc(); });
  // шапка отчёта
  const store=(()=>{ try{ return {get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}}; }catch(e){ return {get:(k,d)=>d,set:()=>{}}; } })();
  const meta=store.get("wc_meta",{}); root.querySelectorAll("[data-m]").forEach(el=>{ if(el.tagName==="INPUT"){ el.value=meta[el.dataset.m]||""; el.addEventListener("change",()=>{ const m=store.get("wc_meta",{}); m[el.dataset.m]=el.value; store.set("wc_meta",m); }); } });
  let wasOpen=null;
  const buildPrn=()=>{ const c=lastCalc, box=$("prn"); if(!box) return; if(!c||c.err){ box.innerHTML=""; return; }
    const R=WC.run("АР-01",Object.assign({},S)), m=store.get("wc_meta",{}), def=WC.CALC["АР-01"], ver=(window.WC_VERIFIED||[]).includes("АР-01");
    const imgs={therm:chartSvg(c,"d")}; if(c.moist&&c.moist.ok) imgs.moist=moistSvg(c);
    const info=R.k===null;
    box.innerHTML=`<div class="ph"><div><small>ПОВЕРОЧНЫЙ РАСЧЁТ</small><b>${esc(m.org||"БИЛДИНФОТЕХ")}</b></div><div><small>Объект</small>${esc(m.obj||"—")}</div><div><small>Элемент</small>${esc(m.el||"—")}</div><div><small>Дата</small>${new Date().toLocaleDateString("ru-RU")}</div></div>
      <div class="pres ${R.ok?"":"bad"}"><b>${R.ok?"✓ Требования выполняются":"✗ Требования НЕ выполняются"}</b>${R.worst?`<span>Kисп = ${WC.fmtd(R.k,3)} — ${esc(R.worst.name)}${R.worst.ref?", "+esc(R.worst.ref):""}</span>`:""}</div>
      <div class="rep">${WC.reportHtml(R,imgs)}</div>
      <div class="ph" style="margin-top:24px"><div>Выполнил ${esc(m.author||"")} ________________</div><div>Проверил ${esc(m.checker||"")} ________________</div></div>`; };
  window.addEventListener("beforeprint",buildPrn);
  window.addEventListener("afterprint",()=>{ if(wasOpen){ [...root.querySelectorAll("details.acc")].forEach((x,i)=>x.open=wasOpen[i]); wasOpen=null; } });
  $("print").addEventListener("click",()=>print());
  $("word").addEventListener("click",async ()=>{
    const b=$("word"); const c=lastCalc; if(!c||c.err){ alert("Сначала заполните исходные данные"); return; }
    b.disabled=true; b.textContent="Формирую…";
    try{ if(!window.docx) await new Promise((ok,no)=>{ const s=document.createElement("script"); s.src="webcad/docx.iife.js"; s.onload=ok; s.onerror=()=>no(new Error("не удалось загрузить библиотеку docx")); document.head.appendChild(s); });
      const def=WC.CALC["АР-01"], m=store.get("wc_meta",{}); m.verified=(window.WC_VERIFIED||[]).includes("АР-01");
      const v=Object.assign({},S); const R=WC.run("АР-01",v);
      const png=svg=>new Promise((ok,no)=>{ const img=new Image(); img.onload=()=>{ const cv=document.createElement("canvas"); cv.width=1520; cv.height=660; const g=cv.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,1520,660); g.drawImage(img,0,0,1520,660); cv.toBlob(async b=>ok({data:new Uint8Array(await b.arrayBuffer()),w:1520,h:660}),"image/png"); }; img.onerror=()=>no(new Error("график не отрисован")); img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg); });
      m.imgs={therm:await png(chartSvg(c,"d"))}; if(c.moist&&c.moist.ok) m.imgs.moist=await png(moistSvg(c));
      const blob=await WC.docx(def,v,R,m);
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${WC.short("АР-01")} ${def.title.slice(0,60)}${m.el?" — "+m.el:""}.docx`.replace(/[\\/:*?"<>|]/g,"_");
      document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
    }catch(e){ alert("Ошибка формирования Word: "+e.message); console.error(e); }
    b.disabled=false; b.textContent="Скачать отчёт Word"; });
  drawClim(); drawLayers(); recalc();
  root.__ar={S,calc:()=>lastCalc,recalc,drawLayers};
}

/* ======================= отчёт Word ======================= */
function run(v,R){
  const c=calc(v); if(c.err) throw new Error(c.err);
  const P=c.prof, M=c.moist, f=WC.fmtd, base=(x)=>String(x).replace(/\./g,",");
  R.h("Исходные данные");
  R.kv([["Пункт строительства",`${c.C.c} (${c.C.r}); климат — СП 131.13330.2025`],
    ["Тип здания",BT.find(x=>x[0]===c.bt)[1]],
    ["Ограждающая конструкция",CT.find(x=>x[0]===c.ct)[1]],
    ["Внутренний воздух",`$t_{int}$ = ${f(c.tint,1)} °C; $phi_{int}$ = ${f(c.phi,0)} %`],
    ["Режим помещения и условия эксплуатации",`${REGN[c.reg]} режим (табл. 1 СП 50); зона влажности — ${ZONE.find(z=>z[0]===v.zone)[1]}; условия эксплуатации — ${c.cond} (табл. 2)`]]);
  R.tbl(["№","Материал (изнутри наружу)","$delta$, мм","$lambda$, Вт/(м·°C)","R, м²·°C/Вт","t внутр. грани, °C","t наруж. грани, °C"],
    [["","Сопротивление тепловосприятию (1/αint)","","",f(1/c.aint,3),f(c.tint,1),f(P.surfIn,1)]]
    .concat(c.layers.map((l,i)=>[String(i+1),l.L.name,f(l.L.d,0),f(l.lam,3),f(l.R,3),f(P.pts[i].t,1),f(P.pts[i+1].t,1)]))
    .concat([["","Сопротивление теплоотдаче (1/αext)","","",f(1/c.aext,3),f(P.surfOut,1),f(P.tx,1)]]),{w:[5,33,9,12,12,14,15],left:[1]});
  R.h("Климатические параметры и градусо-сутки");
  R.val("t_{int}",c.tint,"°C","задано");
  R.val("t_{ext}",c.text,"°C","t₅ (0,92), СП 131");
  R.val("t_{ht}",c.tht,"°C","средняя за период со среднесуточной T ≤ "+(c.bt==="2"||c.bt==="3"?10:8)+" °C"); R.val("z_{ht}",c.zht,"сут","");
  R.eq("D_d","(t_{int}-t_{ht})*z_{ht}","°C·сут/год","ф. (5.2)");
  R.h("Требуемое сопротивление теплопередаче");
  R.val("alpha_{int}",c.aint,"Вт/(м²·°C)","табл. 4"); R.val("alpha_{ext}",c.aext,"Вт/(м²·°C)","табл. 6"); R.val("n",c.n,"","табл. 6 СП 50"); R.val("Dt_n",c.dtn,"°C","табл. 5");
  R.eq("R_c","n*(t_{int}-t_{ext})/(Dt_n*alpha_{int})","м²·°C/Вт","ф. (5.4), санитарно-гигиеническое требование");
  if(c.a!==undefined){ R.val("a",c.a,"","табл. 3",{d:6}); R.val("b",c.b,"","табл. 3"); R.eq("R_t","a*D_d+b","м²·°C/Вт","табл. 3, базовое значение"); }
  else { R.t(c.RtNote+"."); R.val("R_t",c.Rt,"м²·°C/Вт","ф. (5.4)"); }
  R.val("m_p",c.mpmin,"","п. 5.2");
  R.eq("R_e","m_p*R_t","м²·°C/Вт","ф. (5.1), поэлементное требование");
  R.h("Сопротивление теплопередаче конструкции");
  R.val("SR",c.sumR,"м²·°C/Вт"); WC.ALIAS.SR=()=>({r:"row",c:[{r:"t",s:"Σ"},{r:"fr",n:{r:"sub",b:{r:"t",s:"δ"},s:{r:"t",s:"i"},sup:null},d:{r:"sub",b:{r:"t",s:"λ"},s:{r:"t",s:"i"},sup:null}}]});
  R.val("r",c.r,"","коэффициент теплотехнической однородности");
  R.eq("R_0","(1/alpha_{int}+SR+1/alpha_{ext})*r","м²·°C/Вт","прил. Е");
  R.chk("Поэлементное требование: R₀ ≥ Rэ","R_0","≥","R_e","м²·°C/Вт","п. 5.2");
  R.chk("Базовое значение: R₀ ≥ Rт","R_0","≥","R_t","м²·°C/Вт","табл. 3",{info:true});
  if(c.stat==="ok") R.msg("ok","Поэлементные требования: R₀ ≥ Rт","Ограждающая конструкция удовлетворяет нормам по тепловой защите вне зависимости от иных требований.");
  else if(c.stat==="mid") R.msg("mid","Поэлементные требования: Rэ ≤ R₀ < Rт","Конструкция удовлетворяет поэлементным требованиям только при выполнении комплексного требования — удельной характеристики расхода тепловой энергии (прил. Г СП 50.13330.2012, п. 5.2).");
  else R.msg("bad","Поэлементные требования: R₀ < Rэ","Ограждающая конструкция не удовлетворяет нормам (поэлементные требования) по тепловой защите.");
  R.h("Санитарно-гигиеническое требование");
  R.eq("Dt_0","n*(t_{int}-t_{ext})/(R_0*alpha_{int})","°C","ф. (5.4)");
  R.chk("Температурный перепад","Dt_0","≤","Dt_n","°C","табл. 5");
  R.eq("tau_{int}","t_{int}-Dt_0","°C"); R.val("t_d",c.td,"°C","точка росы при φint");
  R.chk("Отсутствие конденсации на внутренней поверхности","t_d","≤","tau_{int}","°C","п. 5.7",{info:true});
  R.chk("Санитарно-гигиеническое требование: R₀ ≥ Rс","R_0","≥","R_c","м²·°C/Вт","п. 5.1",{info:true});
  R.msg(c.sanOk&&c.condOk?"ok":"bad","Санитарно-гигиенические требования: R₀ "+(c.sanOk?"≥":"<")+" Rс",
    (c.sanOk?"Ограждающая конструкция удовлетворяет санитарно-гигиеническим нормам по тепловой защите.":"Ограждающая конструкция не удовлетворяет санитарно-гигиеническим нормам по тепловой защите. Эксплуатация такой конструкции недопустима.")+
    (c.condOk?" Конденсата на внутренней поверхности нет.":" Возможна конденсация на внутренней поверхности."));
  R.h("Температурное поле (стационарный режим)");
  R.t(`Наружный воздух: t = ${f(P.tx,1)} °C, φ = ${f(P.px,0)} %. На графике: чёрная линия — температура, синяя — температура точки росы, закрашенная область — зона конденсации.`);
  R.img("therm","Слои: "+c.layers.map((l,i)=>`(${i+1}) ${f(l.L.d,0)} мм — ${l.L.name}`).join("; "));
  R.h("Защита от переувлажнения (раздел 8 СП 50.13330.2012)");
  if(!M.ok) R.t(M.msg);
  else{
    R.img("moist","График безразмерных величин: зелёная линия — сопротивление паропроницанию, синяя — то же для насыщенного пара, красная вертикаль — плоскость максимального увлажнения.");
    R.t(M.outer?"Плоскость максимального увлажнения расположена на наружной поверхности конструкции.":`Плоскость максимального увлажнения — в слое «${M.layerName}», на расстоянии ${f(M.xcm,1)} см от внутренней поверхности.`);
    R.tbl(["№","Материал","$delta$, мм","$mu$, мг/(м·ч·Па)","$R_{п}$, м²·ч·Па/мг"],M.rows.map((r,i)=>[String(i+1),r.name,f(r.d,0),isFinite(r.mu)?f(r.mu,3):"—",f(r.Rp,2)]),{w:[5,45,12,18,20],left:[1]});
    R.val("e_в",M.ev,"Па","ф. (8.3)"); R.val("R_{п.в}",M.Rpin,"м²·ч·Па/мг","до плоскости увлажнения"); R.val("R_{п.н}",M.Rpn,"м²·ч·Па/мг","от плоскости до наружной поверхности");
    R.val("E",M.E,"Па","ф. (8.4)"); R.val("e_н",M.en,"Па","годовое значение, СП 131");
    R.val("R_{п1}",M.Rp1,"м²·ч·Па/мг","ф. (8.1)");
    if(M.z0>0){ R.val("z_0",M.z0,"сут","период с отрицательными среднемесячными температурами"); R.val("E_0",M.E0,"Па","");
      if(M.note2) R.note(M.note2); else R.val("R_{п2}",M.Rp2,"м²·ч·Па/мг","ф. (8.2)"); }
    R.val("R_{п.тр}",M.Rtr,"м²·ч·Па/мг","наибольшее из Rп1, Rп2");
    R.chk("Сопротивление паропроницанию внутренней части","R_{п.в}","≥","R_{п.тр}","м²·ч·Па/мг","п. 8.1");
    const mn=c.layers.filter(l=>l.L.muNote&&!isFinite(l.L.rp)); if(mn.length) R.note(`В табл. Т.1 СП 50 для «${mn.map(l=>l.L.name).join("»; «")}» μ не указан — принят по ближайшей плотности того же материала.`);
    if(M.outer) R.msg("ok","Защита от переувлажнения","Условий для образования конденсата в толще конструкции нет.");
    else R.msg(M.pass?"ok":"bad","Защита от переувлажнения: Rп(в) "+(M.pass?"≥":"<")+" Rп.тр",M.pass?"Сопротивление паропроницанию внутренней части конструкции достаточно: накопления влаги сверх допустимого нет.":"Сопротивление паропроницанию внутренней части недостаточно. Требуется пароизоляция со стороны помещения или изменение состава слоёв.");
  }
  R.res(`R0 = ${f(c.R0,2)} м²·°C/Вт; Rс = ${f(c.Rc,2)}, Rэ = ${f(c.Re,2)}, Rт = ${f(c.Rt,2)}`);
}

WC.reg("АР-01",{title:"Теплотехнический расчёт ограждающей конструкции",norm:"СП 50.13330.2012; климат — СП 131.13330.2025; материалы — прил. Т СП 50",tool:true,lean:true,mount,run,groups:[]});
WC.AR={calc,CL,MAT,Esat,tdew,invF,regimeOf,condOf,defaultState,fromMat};
})(typeof window!=="undefined"?window:globalThis);
