// Verdantas Market Tool v6 — RESTORED FULL UI (stable)
// - Restores prior formatting (matches index.html structure)
// - Fixes all syntax issues
// - B2B calibration computed ONCE at init and then locked
// - Claude remains EXTERNAL ONLY

let CFG=null, TUNE=null, EXT=null, UTE=null;

let STATE={
  neutral:1.07,
  cal:{slope:0, intercept:0, ready:false},
  inflationYoy:0,
  markets:{},
  b2bMonths:[],
  b2bValues:[],
  plSeries:{},
  geoMix:{},
  // inflation series
  ppiQuarters:[], ppiIndex:[], eciQuarters:[], eciIndex:[],
  ppiYoY:0, eciYoY:0, spread:0
};

function $(id){ return document.getElementById(id); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function fmtP(v){ if(!Number.isFinite(v)) return '—'; return (v>=0?'+':'')+v.toFixed(1)+'%'; }
function cleanArr(a){ return (Array.isArray(a)?a:[]).filter(v=>v!==null && v!==undefined && Number.isFinite(v)); }

function consBlendV(){ return parseInt($('consBlendSlider').value,10)/100; }
function plBlendV(){ return parseInt($('plBlendSlider').value,10)/100; }

async function fetchJson(url, timeoutMs=8000){
  const ctl=new AbortController();
  const t=setTimeout(()=>ctl.abort(), timeoutMs);
  const res=await fetch(url,{signal:ctl.signal});
  clearTimeout(t);
  if(!res.ok) throw new Error(url+' '+res.status);
  return await res.json();
}

// -------- Calibration (ONCE) --------
function rollAvg(values, endIdx, windowN){
  const start=Math.max(0, endIdx-(windowN-1));
  let s=0,c=0;
  for(let i=start;i<=endIdx;i++){
    const v=values[i];
    if(Number.isFinite(v)){ s+=v; c++; }
  }
  return c ? (s/c) : STATE.neutral;
}

function roll6Firm(idx){ return rollAvg(STATE.b2bValues, idx, 6); }

function calibrateOnce(){
  if(STATE.cal.ready) return;
  const cal = (CFG && CFG.calibration) ? CFG.calibration : null;
  if(!cal || !cal.targets) {
    STATE.cal.slope = 50;
    STATE.cal.intercept = -50*STATE.neutral;
    STATE.cal.ready = true;
    return;
  }
  const lag = cal.lag_months || 6;
  const months = STATE.b2bMonths;
  const vals = STATE.b2bValues;
  const idx = new Map(months.map((m,i)=>[m,i]));

  function avgLagged(targetMonths){
    const xs=[];
    (targetMonths||[]).forEach(m=>{
      const i = idx.get(m);
      if(i===undefined) return;
      const j = i - lag;
      if(j < 0 || j >= vals.length) return;
      xs.push(roll6Firm(j));
    });
    if(!xs.length) return null;
    return xs.reduce((a,b)=>a+b,0)/xs.length;
  }

  const x0 = avgLagged(cal.targets.flat.months);
  const x1 = avgLagged(cal.targets.growth.months);
  const y0 = cal.targets.flat.growth;
  const y1 = cal.targets.growth.growth;

  if(x0===null || x1===null || Math.abs(x1-x0) < 1e-9){
    STATE.cal.slope = 50;
    STATE.cal.intercept = -50*STATE.neutral;
  } else {
    STATE.cal.slope = (y1-y0)/(x1-x0);
    STATE.cal.intercept = y0 - STATE.cal.slope*x0;
  }
  STATE.cal.ready = true;
}

function internalGrowthFromB2B(b2b){
  if(!STATE.cal.ready) return 0;
  return STATE.cal.intercept + STATE.cal.slope*b2b;
}

// Trend adjustment uses slope of rolling-6 B2B over recent window (does NOT recalibrate main slope)
function trendAdjUpTo(endIdx){
  const win = (CFG && CFG.calibration && CFG.calibration.slope_window_months) ? CFG.calibration.slope_window_months : 6;
  const cap = (CFG && CFG.calibration && CFG.calibration.slope_cap_pct) ? CFG.calibration.slope_cap_pct : 2.0;
  const start = Math.max(0, endIdx-(win-1));
  const ys=[];
  for(let i=start;i<=endIdx;i++) ys.push(roll6Firm(i));
  if(ys.length < 2) return 0;
  const m=ys.length;
  let sx=0,sy=0,sxy=0,sx2=0;
  for(let i=0;i<m;i++){ sx+=i; sy+=ys[i]; sxy+=i*ys[i]; sx2+=i*i; }
  const denom = m*sx2 - sx*sx;
  if(Math.abs(denom) < 1e-9) return 0;
  const slope = (m*sxy - sx*sy)/denom; // B2B ratio/month
  let adj = (slope/STATE.neutral)*100*6;
  adj = clamp(adj, -cap, cap);
  return adj;
}

// -------- External weighted growth --------
function weightedExternalGrowth(){
  let g=0;
  (CFG.market.keys||[]).forEach(k=>{
    const eg = (STATE.markets[k] && Number.isFinite(STATE.markets[k].extGrowth)) ? STATE.markets[k].extGrowth : 0;
    const w = (CFG.weights && Number.isFinite(CFG.weights[k])) ? CFG.weights[k] : 0;
    g += eg*w;
  });
  return g;
}

// -------- UTE --------
function uteStats(key){
  if(!UTE || !UTE.actuals || !UTE.goals) return {avg:null, goal:null, delta:0};
  const arr = UTE.actuals[key];
  const goal = UTE.goals[key];
  if(!Array.isArray(arr) || !Number.isFinite(goal)) return {avg:null, goal:Number.isFinite(goal)?goal:null, delta:0};
  const w = (CFG.ute && Number.isFinite(CFG.ute.window_months)) ? CFG.ute.window_months : 3;
  const slice = arr.slice(Math.max(0, arr.length-w)).filter(v=>Number.isFinite(v));
  if(!slice.length) return {avg:null, goal, delta:0};
  const avg = slice.reduce((a,b)=>a+b,0)/slice.length;
  return {avg, goal, delta: avg-goal};
}

function hrec(x){
  if(x>5) return {t:'>>> Aggressively Hire', c:'hr-agh'};
  if(x>1) return {t:'+ Hire', c:'hr-h'};
  if(x>=-1) return {t:'= Steady', c:'hr-s'};
  if(x>=-3) return {t:'! Reduce', c:'hr-r'};
  return {t:'<<< Aggressively Reduce', c:'hr-agr'};
}

// -------- Charts (with hover tooltip) --------
function sizedCanvas(cv, heightCss){
  const dpr = window.devicePixelRatio || 1;
  const w = (cv.offsetWidth || (cv.parentElement?cv.parentElement.offsetWidth:900) || 900);
  cv.width = Math.round(w*dpr);
  cv.height = Math.round(heightCss*dpr);
  return {dpr};
}

function drawDualAxisChart(cv, labels, leftSeries, rightSeries, rightFmt){
  if(!cv) return;
  const {dpr}=sizedCanvas(cv, 220);
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  const pL=58*dpr,pR=58*dpr,pT=22*dpr,pB=54*dpr;
  const pw=cv.width-pL-pR, ph=cv.height-pT-pB;
  const n=labels.length;
  if(n<2||pw<=0||ph<=0) return;

  const L=leftSeries.data.map(v=>Number.isFinite(v)?v:null);
  const R=rightSeries.data.map(v=>Number.isFinite(v)?v:null);
  const Lc=L.filter(v=>v!==null), Rc=R.filter(v=>v!==null);
  if(!Lc.length||!Rc.length) return;
  let lmin=Math.min(...Lc), lmax=Math.max(...Lc);
  let rmin=Math.min(...Rc), rmax=Math.max(...Rc);
  if(lmin===lmax){lmin-=1;lmax+=1;}
  if(rmin===rmax){rmin-=0.05;rmax+=0.05;}

  ctx.strokeStyle='rgba(45,51,82,1)';
  ctx.lineWidth=1*dpr;
  const gN=4;
  for(let i=0;i<=gN;i++){
    const y=pT+ph*(i/gN);
    ctx.beginPath(); ctx.moveTo(pL,y); ctx.lineTo(pL+pw,y); ctx.stroke();
  }

  ctx.font=(11*dpr)+'px Segoe UI';
  ctx.textAlign='right'; ctx.fillStyle=leftSeries.color;
  for(let i=0;i<=gN;i++){
    const y=pT+ph*(i/gN);
    const val=lmax-(lmax-lmin)*(i/gN);
    ctx.fillText(val.toFixed(1)+'%', pL-5*dpr, y+4*dpr);
  }
  ctx.textAlign='left'; ctx.fillStyle=rightSeries.color;
  for(let i=0;i<=gN;i++){
    const y=pT+ph*(i/gN);
    const val=rmax-(rmax-rmin)*(i/gN);
    const txt = (rightFmt==='ratio') ? val.toFixed(3) : val.toFixed(1)+'%';
    ctx.fillText(txt, pL+pw+5*dpr, y+4*dpr);
  }

  ctx.fillStyle='rgba(100,116,139,1)';
  ctx.font=(9*dpr)+'px Segoe UI';
  ctx.textAlign='center';
  const step=Math.max(1, Math.floor(n/8));
  for(let i=0;i<n;i+=step){
    const x=pL+pw*(i/(n-1));
    ctx.fillText(labels[i], x, pT+ph+18*dpr);
  }

  const yLeft=v=>pT+(lmax-v)/(lmax-lmin)*ph;
  const yRight=v=>pT+(rmax-v)/(rmax-rmin)*ph;

  function drawLine(series, yMap){
    ctx.strokeStyle=series.color;
    ctx.lineWidth=2*dpr;
    ctx.beginPath();
    let started=false;
    for(let i=0;i<n;i++){
      const v=series.data[i];
      if(!Number.isFinite(v)) continue;
      const x=pL+pw*(i/(n-1));
      const y=yMap(v);
      if(!started){ctx.moveTo(x,y); started=true;} else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  drawLine(leftSeries, yLeft);
  drawLine(rightSeries, yRight);

  cv._chartMeta={labels,leftSeries,rightSeries,n,rightFmt};
}

function attachTooltip(cv){
  if(!cv) return;
  cv.addEventListener('mousemove',(ev)=>{
    const meta=cv._chartMeta;
    const tip=$('chartTip');
    if(!meta || !tip) return;
    const rect=cv.getBoundingClientRect();
    const frac=clamp((ev.clientX-rect.left)/rect.width,0,1);
    const i=Math.round(frac*(meta.n-1));
    $('ctMonth').textContent=meta.labels[i]||'';
    const l=meta.leftSeries.data[i];
    const r=meta.rightSeries.data[i];
    const rows=[
      {k:meta.leftSeries.label, v:Number.isFinite(l)?(l.toFixed(1)+'%'):'—', c:meta.leftSeries.color},
      {k:meta.rightSeries.label, v:(meta.rightFmt==='ratio')?(Number.isFinite(r)?r.toFixed(3):'—'):(Number.isFinite(r)?(r.toFixed(1)+'%'):'—'), c:meta.rightSeries.color}
    ];
    $('ctRows').innerHTML = rows.map(x=>
      `<div class="ct-row"><div class="ct-k"><span class="ct-sw" style="background:${x.c}"></span>${x.k}</div><div class="ct-v">${x.v}</div></div>`
    ).join('');

    tip.style.display='block';
    tip.style.left=(ev.clientX+14)+'px';
    tip.style.top=(ev.clientY+14)+'px';
  });
  cv.addEventListener('mouseleave',()=>{ const tip=$('chartTip'); if(tip) tip.style.display='none'; });
}

// -------- Rendering --------
function renderConsolidated(){
  const wI=consBlendV(), wE=1-wI;
  const last=STATE.b2bValues.length-1;
  const b2bRoll=roll6Firm(last);
  const trend=trendAdjUpTo(last);
  const intG=internalGrowthFromB2B(b2bRoll) + trend;
  const extG=weightedExternalGrowth();
  const raw=wI*intG+wE*extG;
  const adj=raw-STATE.inflationYoy;

  const kpis=[
    {l:'Weighted Ext Growth', v:fmtP(extG), c:(extG>=0?'pos':'neg2')},
    {l:'Internal Signal', v:fmtP(intG), c:(intG>=0?'pos':'neg2')},
    {l:'6-Mo Rolling B2B Avg', v:Number.isFinite(b2bRoll)?b2bRoll.toFixed(3):'—', c:''},
    {l:'Consolidated Prediction', v:fmtP(raw), c:(raw>=0?'pos':'neg2')},
    {l:'PPI-Adj (Eng Svcs)', v:fmtP(adj), c:(adj>=0?'pos':'neg2')}
  ];
  var uteF=uteStats('firmwide');
  var uteKbox='';
  if(uteF.avg!=null && uteF.goal!=null){
    var uteFAvg=uteF.avg.toFixed(1)+'%';
    var uteFGoal=uteF.goal.toFixed(1)+'%';
    var uteFDel=(uteF.delta>=0?'+':'')+uteF.delta.toFixed(1)+'%';
    var hrF=hrec(adj + uteF.delta);
    uteKbox='<div class="kbox"><div class="klbl">UTE (Avg / Goal / Δ)</div><div class="kval">'+uteFAvg+' / '+uteFGoal+'</div><div style="font-size:.75rem;color:var(--muted);margin-top:3px;">Δ '+uteFDel+'</div></div>'+'<div class="kbox"><div class="klbl">Hiring Rec</div><div class="kval"><span class="hrec '+hrF.c+'">'+hrF.t+'</span></div></div>';
  }
  $('consKPIs').innerHTML = kpis.map(k=>`<div class="kbox"><div class="klbl">${k.l}</div><div class="kval ${k.c}">${k.v}</div></div>`).join('') + uteKbox;

  const pills=(CFG.market.keys||[]).map(k=>{
    const eg=STATE.markets[k]?.extGrowth??0;
    const wt=CFG.market.weight_labels?.[k]??'';
    const ec=(eg>4?'pos':(eg<0?'neg2':'neu'));
    return `<span class="mwt-pill"><span class="mwt-lbl">${CFG.market.short?.[k]||k}</span><span class="wt-pill">${wt}</span><span class="mwt-eg ${ec}">${fmtP(eg)}</span></span>`;
  });
  $('mwtBar').innerHTML = pills.join('');

  const histPred=STATE.b2bValues.map((_,i)=>{
    const r=roll6Firm(i);
    const t=trendAdjUpTo(i);
    return internalGrowthFromB2B(r)+t;
  });
  const histRoll=STATE.b2bValues.map((_,i)=>roll6Firm(i));
  drawDualAxisChart($('histChart'), STATE.b2bMonths.map(function(m){var mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];try{var p=m.split("'");var idx=mn.indexOf(p[0].trim());var yr=parseInt(p[1]);var ni=(idx+1)%12;var ny=yr+(idx+1>=12?1:0);return mn[ni]+"'"+String(ny).slice(-2);}catch(e){return m;}}),
    {label:'Internal Growth Signal %', data:histPred, color:'#4f9cf9'},
    {label:'B2B Rolling 6-Mo Avg', data:histRoll, color:'#22c55e'},
    'ratio'
  );

  const ext=EXT?.consolidated||{};
  const tail=Array.isArray(ext.tailwinds)?ext.tailwinds:[];
  const head=Array.isArray(ext.headwinds)?ext.headwinds:[];
  const watch=Array.isArray(ext.watch_items)?ext.watch_items:[];
  const bullets=a=>a.map(x=>'• '+x).join('\n');
  let consHtml = '';
  consHtml += '<div class="narr-body" style="margin:0 0 8px"><strong style="color:var(--text)">Internal outlook:</strong> Rolling 6-mo B2B ' + b2bRoll.toFixed(3) + '; calibrated signal ' + fmtP(intG) + ' (trend adj ' + fmtP(trend) + ').</div>';
  consHtml += '<div class="narr-body" style="margin:0 0 8px"><strong style="color:var(--text)">External outlook:</strong> ' + (ext.summary||'') + '</div>';
  consHtml += '<div class="narr-body" style="margin:0 0 8px"><strong style="color:var(--text)">Forecast blend:</strong> Internal ' + fmtP(intG) + ' | External ' + fmtP(extG) + ' | Blended ' + fmtP(raw) + ' | PPI-adjusted ' + fmtP(adj) + ' &mdash; <strong>Confidence:</strong> ' + (ext.confidence||'N/A') + '</div>';
  if(tail.length){consHtml+='<div class="narr-body" style="margin:6px 0 2px"><strong style="color:var(--text)">Tailwinds:</strong></div><ul style="font-size:.77rem;color:var(--muted);line-height:1.7;padding-left:18px;margin-bottom:6px">';tail.forEach(function(x){consHtml+='<li>'+x+'</li>';});consHtml+='</ul>';}
  if(head.length){consHtml+='<div class="narr-body" style="margin:6px 0 2px"><strong style="color:var(--text)">Headwinds:</strong></div><ul style="font-size:.77rem;color:var(--muted);line-height:1.7;padding-left:18px;margin-bottom:6px">';head.forEach(function(x){consHtml+='<li>'+x+'</li>';});consHtml+='</ul>';}
  if(watch.length){consHtml+='<div class="narr-body" style="margin:6px 0 2px"><strong style="color:var(--text)">Watch Items:</strong></div><ul style="font-size:.77rem;color:var(--muted);line-height:1.7;padding-left:18px;margin-bottom:6px">';watch.forEach(function(x){consHtml+='<li>'+x+'</li>';});consHtml+='</ul>';}
  $('consNarrBody').innerHTML = consHtml;

  renderConsUte();
}

function renderConsUte(){ /* UTE now rendered inline in consKPIs row */ }

function renderMarkets(){
  const grid=$('marketGrid');
  grid.innerHTML='';
  (CFG.market.keys||[]).forEach(k=>{
    const m=STATE.markets[k];
    if(!m) return;
    const kpis=Array.isArray(m.kpis)?m.kpis:[];
    const kpiHtml = kpis.map(kp=>`<li><span class="dot ${kp.dot||'n'}"></span><span>${kp.text||''}</span></li>`).join('');
    const card=document.createElement('div');
    card.className='mcard';
    card.innerHTML = `
      <div class="mchdr">
        <div class="mcname">${CFG.market.names[k]||k}</div>
        <div class="badge ${m.statusClass||'badge-neutral'}">${m.status||''}</div>
      </div>
      <div class="mgrowth" style="color:var(--accent)">${fmtP(m.extGrowth)}</div>
      <ul class="kpi-list">${kpiHtml}</ul>
      <div class="snote"><strong>Tailwind:</strong> ${m.tailwind||''}</div>
      <div class="snote"><strong>Headwind:</strong> ${m.headwind||''}</div>
    `;
    grid.appendChild(card);
  });
}

function renderGeoSliders(){
  const g=$('geoGrid');
  g.innerHTML='';
  (CFG.geo.keys||[]).forEach(gk=>{
    const pl = (CFG.pl.list||[]).find(p=>p.key===gk);
    const card=document.createElement('div');
    card.className='geo-card';
    const rows=(CFG.geo.mix_labels||[]).map((lbl,i)=>{
      const sid=`gmix_${gk}_${i}`;
      const v=(STATE.geoMix[gk]&&Number.isFinite(STATE.geoMix[gk][i]))?STATE.geoMix[gk][i]:0;
      return `<div class="mix-row"><label>${lbl}</label><input type="range" id="${sid}" min="0" max="100" value="${v}" oninput="onMix('${gk}',${i},this.value)" /><div class="mval" id="${sid}v">${v}%</div></div>`;
    }).join('');
    card.innerHTML = `<h3>${pl?pl.label:gk}</h3>${rows}<div class="msum" id="gmix_${gk}_sum"></div>`;
    g.appendChild(card);
    updateGeoSum(gk);
  });
}

function updateGeoSum(gk){
  const sum=(STATE.geoMix[gk]||[]).reduce((a,b)=>a+(b||0),0);
  const el=$(`gmix_${gk}_sum`);
  if(!el) return;
  el.textContent = `Total: ${sum}%`;
  el.style.background = (sum===100)?'#0d2e1a':'#2e2010';
  el.style.color = (sum===100)?'#22c55e':'#fb923c';
}

function onMix(gk,i,val){
  const nv=parseInt(val,10);
  if(!STATE.geoMix[gk]) return;
  const cur=STATE.geoMix[gk][i]||0;
  const delta=nv-cur;
  if(delta===0) return;
  STATE.geoMix[gk][i]=nv;

  const others=STATE.geoMix[gk].map((v,idx)=>({idx,v})).filter(o=>o.idx!==i);
  const ot=others.reduce((s,o)=>s+(o.v||0),0);
  if(ot>0){
    others.forEach(o=>{
      const adj=Math.round(delta*((o.v||0)/ot));
      STATE.geoMix[gk][o.idx]=Math.max(0,(STATE.geoMix[gk][o.idx]||0)-adj);
    });
  }

  let diff=100-STATE.geoMix[gk].reduce((s,v)=>s+(v||0),0);
  if(diff!==0){
    const cands=STATE.geoMix[gk].map((v,idx)=>({idx,v})).filter(o=>o.idx!==i).sort((a,b)=>(b.v||0)-(a.v||0));
    if(cands.length) STATE.geoMix[gk][cands[0].idx]=clamp((STATE.geoMix[gk][cands[0].idx]||0)+diff,0,100);
  }

  (CFG.geo.mix_labels||[]).forEach((_,idx)=>{
    const el=$(`gmix_${gk}_${idx}`);
    const elv=$(`gmix_${gk}_${idx}v`);
    const v=STATE.geoMix[gk][idx]||0;
    if(el) el.value=v;
    if(elv) elv.textContent=v+'%';
  });
  updateGeoSum(gk);
  renderPL();
  renderNarr();
}
window.onMix=onMix;

function seriesAvg(arr,n){
  const c=cleanArr(arr); if(!c.length) return null;
  const t=c.slice(Math.max(0,c.length-n));
  return t.reduce((a,b)=>a+b,0)/t.length;
}

function plB2BValue(pl){
  const arr=STATE.plSeries[pl.series_key];
  const c=cleanArr(arr);
  if(!c.length) return STATE.neutral;
  const n=(c.length>=6)?6:Math.min(3,c.length);
  const avg=seriesAvg(c,n);
  return (avg==null)?STATE.neutral:avg;
}

function plModeLabel(pl){
  const arr=STATE.plSeries[pl.series_key];
  const c=cleanArr(arr);
  return (c.length>=6)?'6-mo rolling':'3-mo avg';
}

function extForPL(pl){
  if(pl.type==='geo'){
    const mix=STATE.geoMix[pl.key]||[0,0,0,0,0];
    let g=0;
    (CFG.geo.mix_markets||[]).forEach((mk,i)=>{
      const eg=(STATE.markets[mk]?.extGrowth??0);
      g += eg*((mix[i]||0)/100);
    });
    var _gaf=EXT&&EXT.geo_adjustment_factors?EXT.geo_adjustment_factors[pl.key]:null;
    var _factor=(_gaf&&Number.isFinite(_gaf.factor))?_gaf.factor:1.0;
    var _adjusted = g >= 0 ? g * _factor : g;
    if(!STATE.geoAdjFactors)STATE.geoAdjFactors={};
    STATE.geoAdjFactors[pl.key]={base:g,factor:_factor,adjusted:_adjusted,rationale:(_gaf&&_gaf.rationale)?_gaf.rationale:''};
    return _adjusted;
  }
  let g=0;
  (pl.extKeys||[]).forEach((k,i)=>{
    const eg=(STATE.markets[k]?.extGrowth??0);
    const w=(pl.extWts && Number.isFinite(pl.extWts[i]))?pl.extWts[i]:0;
    g += eg*w;
  });
  return g;
}

function renderPL(){
  const wI=plBlendV(), wE=1-wI;
  let html='';
  let lastType='';
  (CFG.pl.list||[]).forEach(pl=>{
    if(pl.type!==lastType){
      const grp = pl.type==='geo'?'GEOGRAPHIC P&Ls':(pl.type==='energy'?'ENERGY P&Ls':'NATURAL & BUILT ENVIRONMENT P&Ls');
      html += `<tr class="grp-row"><td colspan="8">${grp}</td></tr>`;
      lastType=pl.type;
    }
    const b2b=plB2BValue(pl);
    const intG=internalGrowthFromB2B(b2b);
    const extG=extForPL(pl);
    const raw=wI*intG+wE*extG;
    const adj=raw-STATE.inflationYoy;
    const us=uteStats(pl.key);
    const uteAvg=(us&&us.avg!=null)?us.avg.toFixed(1)+'%':'—';
    const uteGoal=(us&&us.goal!=null)?us.goal.toFixed(1)+'%':'—';
    const uteDel=(us&&us.avg!=null&&us.goal!=null)?((us.delta>=0?'+':'')+us.delta.toFixed(1)+'%'):'—';
    const driver = adj + ((us&&us.delta!=null)?us.delta:0);
    const hr=hrec(driver);

    html += `<tr>
      <td>${pl.label}</td>
      <td>${b2b.toFixed(3)}<div style="font-size:.68rem;color:var(--muted);margin-top:2px;">${plModeLabel(pl)}</div></td>
      <td>${fmtP(intG)}</td>
      <td>${fmtP(extG)}${pl.type==='geo'&&STATE.geoAdjFactors&&STATE.geoAdjFactors[pl.key]?'<div style="font-size:.65rem;color:#4f9cf9;margin-top:2px;">×'+STATE.geoAdjFactors[pl.key].factor.toFixed(2)+'</div>':''}</td>
      <td>${fmtP(raw)}</td>
      <td>${fmtP(adj)}</td>
      <td>${uteAvg} / ${uteGoal}<div style="font-size:.68rem;color:var(--muted);margin-top:2px;">Δ ${uteDel}</div></td>
      <td><span class="hrec ${hr.c}">${hr.t}</span></td>
    </tr>`;
  });
  $('plBody').innerHTML=html;
  $('plFootnote').textContent = '† Hiring recommendation uses: (PPI-adjusted growth) + (UTE Δ). UTE Δ = 3-mo avg utilization − goal (percentage points).';
}

function renderNarr(){
  const pn = EXT && EXT.pl_narratives ? EXT.pl_narratives : {};
  let html='';
  (CFG.pl.list||[]).forEach(pl=>{
    const d = pn[pl.key] || {};
    const extDrivers = d.external_drivers || '';
    const infl = Array.isArray(d.influencers) ? d.influencers : [];
    const mmix = Array.isArray(d.market_mix_analysis) ? d.market_mix_analysis : [];
    const watch = Array.isArray(d.watch_items) ? d.watch_items : [];
    const recs = d.investment_recs || null;

    const bullet = arr => arr.map(x=>`• ${x}`).join('\n');

    let recHtml='';
    const rcClass = r => (r==='Strong Invest')?'ic-strong':(r==='Moderate Invest')?'ic-mod':(r==='Light')?'ic-light':'ic-avoid';
    if(recs && typeof recs==='object' && !Array.isArray(recs)){
      const cards = Object.keys(recs).map(cat=>{
        const rec = recs[cat];
        const rating = (typeof rec==='string')?rec:(rec.rating||'');
        const body = (typeof rec==='string')?'':(rec.text||rec.body||'');
        return `<div class="invest-card"><div class="ic-cat">${cat}</div><div class="ic-rec ${rcClass(rating)}">${rating}</div><div class="ic-body">${body}</div></div>`;
      }).join('');
      recHtml = `<div class="narr-item"><h3>Investment Recommendations</h3><div class="invest-grid">${cards}</div></div>`;
    } else if(Array.isArray(recs) && recs.length){
      var PRAC_LABELS={
        'nbe_ehs':['EHS Compliance Hiring','Advanced Manufacturing EHS','PFAS Industrial Discharge'],
        'nbe_flow':['PFAS Treatment Modeling','Stormwater & Green Infra','Data Center Water Optimization'],
        'nbe_sf':['Regulatory Interface','Remediation Technology','Stakeholder Coordination'],
        'nbe_aq':['Transportation Ecology','Renewable Energy Ecology','Stream & Wetland Restoration'],
        'eng_pw':['Transmission Planning','Substation Engineering','Data Center Power Delivery'],
        'eng_og':['Methane Compliance','LNG & Pipeline Permitting','Produced Water Management']
      };
      var plCats=PRAC_LABELS[pl.key]||[];
      var recCards=[];
      recs.forEach(function(txt,ri){
        var cat=plCats[ri]||('Action '+(ri+1));
        recCards.push('<div class="invest-card"><div class="ic-cat">'+cat+'</div><div class="ic-rec ic-mod">Invest</div><div class="ic-body">'+txt+'</div></div>');
      });
      recHtml='<div class="narr-item"><h3>Investment Recommendations</h3><div class="invest-grid">'+recCards.join('')+'</div></div>';
    }

    html += `<div class="narr-item"><h3>${pl.label}</h3>
      ${extDrivers?`<div class="narr-body"><strong>External Growth Drivers:</strong> ${extDrivers}</div>`:''}
      ${pl.type==='geo'&&STATE.geoAdjFactors&&STATE.geoAdjFactors[pl.key]?`<div class="narr-body" style="margin:4px 0 8px;font-size:.78rem;">Regional Adj: <span style="font-weight:700;color:#4f9cf9;">${STATE.geoAdjFactors[pl.key].factor.toFixed(2)}×</span></div>`:''}
      ${infl.length?`<div class="narr-body" style="white-space:pre-line;"><strong>Influencers:</strong>\n${bullet(infl)}</div>`:''}
      ${mmix.length?`<div class="narr-body" style="white-space:pre-line;"><strong>Market Mix Analysis:</strong>\n${mmix.map(x=>`\u2022 ${(typeof x==='object'&&x.text)?x.text:x}`).join('\n')}</div>`:''}
      ${watch.length?`<div class="narr-body" style="white-space:pre-line;"><strong>Watch Items:</strong>\n${bullet(watch)}</div>`:''}
      ${recHtml}
    </div>`;
  });
  $('narrBody').innerHTML=html;
}

function renderInflation(inflData){
  const infl = inflData || {};
  const ppi = infl.ppi || {}; const eci = infl.eci || {};
  STATE.ppiQuarters = Array.isArray(ppi.quarters)?ppi.quarters:[];
  STATE.ppiIndex = Array.isArray(ppi.index)?ppi.index:[];
  STATE.eciQuarters = Array.isArray(eci.quarters)?eci.quarters:[];
  STATE.eciIndex = Array.isArray(eci.index)?eci.index:[];

  const minLen = Math.min(STATE.ppiIndex.length, STATE.eciIndex.length, STATE.ppiQuarters.length, STATE.eciQuarters.length);
  const labels=[], pYoY=[], eYoY=[];
  for(let i=4;i<minLen;i++){
    labels.push(STATE.ppiQuarters[i]);
    pYoY.push(((STATE.ppiIndex[i]/STATE.ppiIndex[i-4])-1)*100);
    eYoY.push(((STATE.eciIndex[i]/STATE.eciIndex[i-4])-1)*100);
  }

  STATE.ppiYoY = (STATE.ppiIndex.length>=5) ? ((STATE.ppiIndex.at(-1)/STATE.ppiIndex.at(-5)-1)*100) : 0;
  STATE.eciYoY = (STATE.eciIndex.length>=5) ? ((STATE.eciIndex.at(-1)/STATE.eciIndex.at(-5)-1)*100) : 0;
  STATE.spread = STATE.ppiYoY - STATE.eciYoY;
  STATE.inflationYoy = STATE.ppiYoY;


  drawDualAxisChart($('ppiChart'), labels,
    {label:'PPI YoY% (Eng Svcs)', data:pYoY, color:'#4f9cf9'},
    {label:'ECI YoY% (Prof/Tech)', data:eYoY, color:'#f97316'},
    'pct'
  );

  const p=STATE.ppiYoY, e=STATE.eciYoY, s=STATE.spread;
  const billTxt = (p>3.5)?'PPI running strongly — raise billing rates 3–5% and add escalation clauses in new contracts.'
                :(p>2.0)?'Moderate PPI — a 2–3% rate increase is warranted; review schedules at next renewal.'
                :(p>0.5)?'Mild PPI pressure — standard annual rate increases are supportable.'
                :'Flat PPI — hold rates steady; aggressive increases risk losing competitive bids.';
  const salTxt = (e>4.5)?'Wage growth elevated — merit budgets need significant increase (4–5%+) to retain staff.'
               :(e>3.5)?'Above-trend ECI — plan merit budgets above standard 3% guidance (3.5–4.5%).'
               :(e>2.5)?'Moderate ECI — standard ~3% merit increases appropriate.'
               :'Subdued ECI — standard merit budgets sufficient; selective retention bonuses for scarce roles.';
  const spTxt = (s>1.0)?'Positive spread: billing rates outpacing labor costs — margin expansion opportunity; protect in renewals.'
              :(s>-0.5)?'Narrow spread — billing rates tracking wage growth; margins stable but watch closely.'
              :'Negative spread: labor costs outpacing billed rates — margin compression risk; prioritize rate escalation.';

  $('inflRecs').innerHTML = `<div class="infl-recs">
    <div class="infl-rec-card"><div class="infl-rec-lbl">PPI YoY</div><div class="infl-rec-val">${fmtP(p)}</div><div class="infl-rec-txt"><strong>Billing Rate Action:</strong> ${billTxt}</div></div>
    <div class="infl-rec-card"><div class="infl-rec-lbl">ECI YoY</div><div class="infl-rec-val">${fmtP(e)}</div><div class="infl-rec-txt"><strong>Salary Action:</strong> ${salTxt}</div></div>
    <div class="infl-rec-card"><div class="infl-rec-lbl">Spread</div><div class="infl-rec-val">${fmtP(s)}</div><div class="infl-rec-txt"><strong>Margin Signal:</strong> ${spTxt}</div></div>
  </div>`;
}

function renderValueDrivers(){
  const el=$('valueDriverGrid');
  if(!el) return;
  const drivers = (EXT && Array.isArray(EXT.value_drivers)) ? EXT.value_drivers : [];
  if(!drivers.length){ el.innerHTML='<div class="mcard">No value drivers in external_market_data.json.</div>'; return; }
  el.innerHTML = drivers.map(d=>{
    const tags=Array.isArray(d.tags)?d.tags:[];
    return `<div class="mcard"><div class="mchdr"><div class="mcname">#${d.rank||''} ${d.title||''}</div><div class="badge badge-neutral">Value</div></div><div class="narr-body">${d.body||''}</div>${tags.length?`<div class="snote">${tags.map(t=>`<span class="wt-pill">${t}</span>`).join(' ')}</div>`:''}</div>`;
  }).join('');
}

function onConsBlend(){
  const v=parseInt($('consBlendSlider').value,10);
  $('consBlendReadout').textContent=`Internal: ${v}% / External: ${100-v}%`;
  renderConsolidated();
}
function onPLBlend(){
  const v=parseInt($('plBlendSlider').value,10);
  $('plBlendReadout').textContent=`Internal: ${v}% / External: ${100-v}%`;
  renderPL();
  renderNarr();
}
window.onConsBlend=onConsBlend;
window.onPLBlend=onPLBlend;

async function init(){
  try{
    const [cfg,tune,b2b,ext,ute,infl] = await Promise.all([
      fetchJson('/api/config'),
      fetchJson('/api/tuning_inputs'),
      fetchJson('/api/b2b_data'),
      fetchJson('/api/external_market_data'),
      fetchJson('/api/ute_data'),
      fetchJson('/api/inflation_data')
    ]);

    CFG=cfg; TUNE=tune; EXT=ext; UTE=ute;
    STATE.neutral = CFG.tool.neutral_b2b;

    CFG.weights = (TUNE && TUNE.market_weights) ? TUNE.market_weights : {};
    CFG.market.weight_labels = {};
    (CFG.market.keys||[]).forEach(k=>{ const w=CFG.weights[k]||0; CFG.market.weight_labels[k]=Math.round(w*100)+'%'; });
    if(TUNE && TUNE.geo_slider_defaults) CFG.geo.defaults=TUNE.geo_slider_defaults;

    STATE.b2bMonths = b2b.firmwide.months || [];
    STATE.b2bValues = b2b.firmwide.values || [];
    STATE.plSeries = b2b.pl_series || {};
    STATE.markets = ext.markets || {};

    STATE.geoMix = {};
    (CFG.geo.keys||[]).forEach(k=>{
      const def = (CFG.geo.defaults && CFG.geo.defaults[k]) ? CFG.geo.defaults[k] : [20,20,20,20,20];
      STATE.geoMix[k] = def.slice(0,5);
    });

    calibrateOnce();
    renderInflation(infl);

    $('dataBadge').textContent = '[LIVE] ' + (ext.last_updated || 'external_market_data.json');
    $('lastUpdated').textContent = `Tuning: ${tune.last_updated||'—'}  |  B2B: ${b2b.last_updated||'—'}  |  UTE: ${ute.last_updated||'—'}  |  External: ${ext.last_updated||'—'}`;

    onConsBlend();
    onPLBlend();
    renderMarkets();
    renderGeoSliders();
    renderPL();
    renderNarr();
    renderValueDrivers();

    attachTooltip($('histChart'));
    attachTooltip($('ppiChart'));

  } catch(e){
    console.error(e);
    $('dataBadge').textContent='[ERROR] JSON missing';
    $('lastUpdated').textContent='Run: node server.js  (ensure all JSON files are present in /data/)';
  }
}

document.addEventListener('DOMContentLoaded', init);
