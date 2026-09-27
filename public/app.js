// 폴리마켓 비트코인 가격 발견 — 화면 로직 (바닐라 JS, canvas)
// v5: 통합 분포(예측시장+옵션 분위수 가중 평균) · 시점 사이 분위수 보간으로 분포·밴드가 연속 변형 · 달력에 묶인 고정 잡음으로 경로가 끈처럼 출렁임 · 축은 모든 시점 합쳐 고정, 가격축/날짜축 끌어서 조절
const DATA_URL='https://raw.githubusercontent.com/kimsubbae114/polymarket-btc/data/latest.json',DAY=864e5;
const C={text:'#d1d4dc',muted:'#787b86',up:'#089981',down:'#f23645',orange:'#f5a524',grid:'#1e2431',cross:'#5d6b7e',axis:'#2a3140'};
const finite=v=>typeof v==='number'&&Number.isFinite(v);

// ---------- 순수 함수 (tests/test_app.js 가 검증) ----------
function closeBins(b){const a=(b||[]).map(x=>({...x})),w=a.map(x=>finite(x.lo)&&finite(x.hi)?x.hi-x.lo:0),d=w.find(Boolean)||1;return a.map((x,i)=>{const q=w[i]||w[i-1]||w[i+1]||d;if(!finite(x.lo))x.lo=x.hi-q;if(!finite(x.hi))x.hi=x.lo+q;return x})}
function binSum(h){return(h.bins||[]).reduce((s,x)=>s+(+x.p||0),0)}
function modeBin(b){return closeBins(b).reduce((a,x)=>!a||x.p>a.p?x:a,null)}
function densityAt(b,y){return closeBins(b).reduce((s,x)=>y>=x.lo&&y<=x.hi?(x.p||0)/(x.hi-x.lo):s,0)}
function cdfAt(b,y){let s=0;for(const x of closeBins(b)){if(y>=x.hi)s+=x.p||0;else if(y>x.lo){s+=(x.p||0)*(y-x.lo)/(x.hi-x.lo);break}}return s}
function quantile(b,q){let s=0;for(const x of closeBins(b)){if(s+(x.p||0)>=q)return x.lo+(x.hi-x.lo)*(q-s)/(x.p||1);s+=x.p||0}return NaN}
function interpolateDensity(a,b,w,y){return(1-w)*densityAt(a,y)+w*densityAt(b,y)}
function logTimeRatio(t,now,max){return Math.min(1,Math.log1p(Math.max(0,t-now)/DAY)/Math.log1p(Math.max(DAY,max-now)/DAY))}
function logTimeX(t,now,max,x,w){return x+w*logTimeRatio(t,now,max)}
function chartRange(history,hs,now,days=45,count=Infinity){const v=[];(history||[]).forEach(x=>v.push(+x[1],+x[2],+x[3],+x[4]));hs.filter(h=>Date.parse(h.t)>=now&&Date.parse(h.t)-now<=days*DAY).slice(0,count).forEach(h=>v.push(quantile(h.bins,.1),quantile(h.bins,.9)));const a=v.filter(finite),lo=Math.min(...a),hi=Math.max(...a),p=(hi-lo)*.04||1;return{lo:lo-p,hi:hi+p}}
function columnAlphas(d,fade=1){const m=Math.max(0,...d);return d.map(x=>m&&x>0?.95*Math.pow(x/m,.45)*fade:0)}
function spacedLabels(x,min=36){return x.map((v,i)=>!i||i===x.length-1||(v-x[i-1]>=min&&x[i+1]-v>=min))}
function candleLabels(x,min=70){return x.map((v,i)=>(!i||v-x[i-1]>=min)&&(i===x.length-1||x[i+1]-v>=min))}
function selectTouchTables(a){return(a||[]).slice().sort((x,y)=>Date.parse(x.t)-Date.parse(y.t))}
function bandAt(horizons,spot,now,t){const hs=(horizons||[]).slice().sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));if(!hs.length||t<=now)return{q10:spot,q25:spot,q50:spot,q75:spot,q90:spot};let i=hs.findIndex(h=>Date.parse(h.t)>=t);if(i<0)i=hs.length-1;const end=Date.parse(hs[i].t),start=i?Date.parse(hs[i-1].t):now,a=i?hs[i-1]:null,w=Math.max(0,Math.min(1,(t-start)/Math.max(1,end-start))),q=k=>(1-w)*(a?quantile(a.bins,k):spot)+w*quantile(hs[i].bins,k);return{q10:q(.1),q25:q(.25),q50:q(.5),q75:q(.75),q90:q(.9)}}
function hashSeed(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function normal(r){let u=0,v=0;while(!u)u=r();while(!v)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
// 과거 종가의 일일 로그수익률 표준편차 — 미래 캔들의 하루 잡음 크기 (과거와 같은 결로 움직이게)
function realizedVol(history){const c=(history||[]).map(x=>+x[4]).filter(v=>finite(v)&&v>0);if(c.length<6)return .02;const r=[];for(let i=1;i<c.length;i++)r.push(Math.log(c[i]/c[i-1]));const m=r.reduce((s,x)=>s+x,0)/r.length,sd=Math.sqrt(r.reduce((s,x)=>s+(x-m)**2,0)/(r.length-1));return Math.min(.08,Math.max(.005,sd))}
// ★v5 통합 분포: 만기마다 구간확률 → 분위수 101점(0%·1%…99%·100%, 끝점 = 닫힌 구간 끝) = 조각선형 누적분포. 한 출처 안에서는 만기 사이를 분위수로 선형 보간(모양이 흘러가듯 변함),
//   출처끼리는 누적확률 가중 평균(선형 풀 — 의견이 갈리면 두 봉우리·꼬리를 그대로 보인다, GPT 검토 2026-09-28). 도달근사 만기는 가중치 0.35. 마지막 만기 뒤로는 가중치를 7일에 걸쳐 줄여 끊김 없이 넘긴다.
//   ponytail: 예측시장:옵션 = 1:1 고정 가중. 유동성·신선도 기반 가중은 근거 자료가 쌓이면.
const NQ=101,PQ=Array.from({length:NQ},(_,i)=>i/100),SCR=[0,1,2].map(()=>new Float64Array(NQ));let PY=new Float64Array(0),PF=new Float64Array(0);const E0=Math.floor(Date.parse('2026-01-01T00:00:00Z')/DAY),TOUCH_W=.35,TAIL_DAYS=7,PIN_DAYS=30,RHO=.9;
function quantileGrid(bins){const bs=closeBins(bins).filter(x=>finite(x.lo)&&finite(x.hi)&&x.hi>=x.lo).sort((a,b)=>a.lo-b.lo),tot=bs.reduce((s,x)=>s+Math.max(0,+x.p||0),0),out=new Float64Array(NQ);if(!(tot>0)){out.fill(NaN);return out}const nz=bs.filter(x=>x.p>0);out[0]=nz[0].lo;let s=0,j=1;for(const x of bs){const p=Math.max(0,+x.p||0)/tot;while(j<NQ-1&&s+p>=PQ[j]-1e-12){out[j]=x.lo+(x.hi-x.lo)*(p?Math.max(0,PQ[j]-s)/p:0);j++}s+=p}for(;j<NQ-1;j++)out[j]=nz[nz.length-1].hi;out[NQ-1]=nz[nz.length-1].hi;for(let k=1;k<NQ;k++)if(out[k]<out[k-1])out[k]=out[k-1];return out}
// 분위수 사이 간격의 역수 = 밀도(누적분포의 기울기). 간격 중점끼리 선형 보간해서 계단이 안 보이게. 0%·100% 밖은 0
function gridDensity(q,y){const n=q.length;if(!(y>=q[0]&&y<=q[n-1]))return 0;const eps=Math.abs(q[n>>1])*1e-6+1e-12;let a=0,b=n-1;while(b-a>1){const m=(a+b)>>1;if(q[m]<=y)a=m;else b=m}const d=i=>(PQ[i+1]-PQ[i])/Math.max(eps,q[i+1]-q[i]),m=i=>(q[i]+q[i+1])/2,k=y<m(a)?a-1:a+1;if(k<0||k>n-2)return d(a);return d(a)+(d(k)-d(a))*Math.min(1,Math.abs(y-m(a))/Math.max(eps,Math.abs(m(k)-m(a))))}
function gridCdf(q,y){const n=q.length;if(y<=q[0])return 0;if(y>=q[n-1])return 1;let a=0,b=n-1;while(b-a>1){const m=(a+b)>>1;if(q[m]<=y)a=m;else b=m}return PQ[a]+(PQ[b]-PQ[a])*(y-q[a])/Math.max(1e-12,q[b]-q[a])}
function gridMode(q){let bi=1,bw=Infinity;for(let i=1;i+4<q.length-1;i++){const w=q[i+4]-q[i];if(w<bw){bw=w;bi=i}}return(q[bi]+q[bi+4])/2}
function srcNodes(list){return(list||[]).map(h=>({t:Date.parse(h.t),touch:h.kind==='touch-approx',q:quantileGrid(h.bins),h})).filter(n=>finite(n.t)&&finite(n.q[0])).sort((a,b)=>a.t-b.t)}
// 한 출처의 t 시점 분위수를 out 에 쓰고 가중치를 돌려준다. 첫 만기 전은 현물(sq)에서, 만기 사이는 이웃 두 만기에서 보간
function srcAt(ns,t,now,sq,out){const n=ns.length;if(!n)return 0;const wt=x=>x.touch?TOUCH_W:1;let i=0;while(i<n&&ns[i].t<t)i++;if(i>=n){out.set(ns[n-1].q);return wt(ns[n-1])*Math.exp(-(t-ns[n-1].t)/(TAIL_DAYS*DAY))}const b=ns[i],a=i?ns[i-1]:null,t0=a?a.t:now,w=Math.max(0,Math.min(1,(t-t0)/Math.max(1,b.t-t0))),qa=a?a.q:sq;for(let k=0;k<out.length;k++)out[k]=qa[k]+(b.q[k]-qa[k])*w;return a?wt(a)+(wt(b)-wt(a))*w:wt(b)}
// 선형 풀: 매듭(모든 출처 분위수)을 정렬해 합친 CDF 를 구하고, 0~100% 격자로 뒤집는다
function poolGrid(gs,ws,out){const k=gs.length,W=ws.reduce((a,b)=>a+b,0),n=k*NQ,ys=PY.length>=n?PY:(PY=new Float64Array(n)),F=PF.length>=n?PF:(PF=new Float64Array(n)),h=new Int32Array(k),a=new Int32Array(k);for(let m=0;m<n;m++){let jb=-1,yb=Infinity;for(let j=0;j<k;j++)if(h[j]<NQ&&gs[j][h[j]]<yb){yb=gs[j][h[j]];jb=j}h[jb]++;let f=0;for(let j=0;j<k;j++){const g=gs[j];if(yb<=g[0])continue;if(yb>=g[NQ-1]){f+=ws[j];continue}while(a[j]<NQ-2&&g[a[j]+1]<=yb)a[j]++;const x=a[j];f+=ws[j]*(PQ[x]+(PQ[x+1]-PQ[x])*(yb-g[x])/Math.max(1e-12,g[x+1]-g[x]))}ys[m]=yb;F[m]=f/W}out[0]=ys[0];out[NQ-1]=ys[n-1];let q=0;for(let i=1;i<NQ-1;i++){const p=PQ[i];while(q<n-2&&F[q+1]<p)q++;const f0=F[q],f1=F[q+1];out[i]=f1>f0?ys[q]+(ys[q+1]-ys[q])*Math.min(1,Math.max(0,(p-f0)/(f1-f0))):ys[q+1]}return out}
function unifiedAt(st,t,out,_,ws){if(t<=st.now||!st.src.length){out.set(st.sq);return out}const gs=[],w=[];st.src.forEach((s,j)=>{const g=SCR[j],x=srcAt(s.ns,t,st.now,st.sq,g);if(ws)ws[j]=x;if(x>1e-6){gs.push(g);w.push(x)}});if(!gs.length)out.set(st.sq);else if(gs.length===1)out.set(gs[0]);else poolGrid(gs,w,out);return out}
// ★끈 같은 경로: 잡음은 달력 날짜에 묶인 고정 평균회귀 과정 W(날짜)(하루 ρ=0.9 — 하루 움직임 ≈ 실현 변동성, 중앙값에서 ±5% 안팎). 시점이 바뀌어도 같은 날엔 같은 잡음 → 경로가 끊기지 않고 출렁이며 변한다.
//   종가 = 중앙값 × exp(h·tanh(변동성·다리/h)), h = 그날 10~90% 폭의 절반(로그). 흔들림 = W(날짜)−W(지금)·ρ^경과일(지금에서 0), 마지막 30일에 걸쳐 0 으로 줄여 마지막 종가 = 마지막 중앙값(끝 만기가 바뀌어도 앞쪽 경로는 그대로).
function mkNoise(seed){const W=[0],g=(tag,k)=>normal(mulberry32(hashSeed(`${seed}:${tag}:${k}`)));return{at(t){const x=t/DAY-E0;if(x<=0)return 0;const k=Math.floor(x);while(W.length<=k+1)W.push(RHO*W[W.length-1]+Math.sqrt(1-RHO*RHO)*g('w',W.length));return W[k]+(W[k+1]-W[k])*(x-k)},z:g}}
function dayGrid(qAt,n0,n1){const out=[],q=new Float64Array(NQ);if(!(n1>n0))return out;for(let d=Math.floor(n0/DAY)+1;d*DAY<n1;d++){const tc=Math.min((d+1)*DAY,n1);qAt(tc,q);out.push({d,t:d*DAY,tc,M:q[50],h:Math.max(1e-6,(Math.log(q[90])-Math.log(q[10]))/2)})}return out}
function futurePath(grid,n0,n1,sp,vol,noise,wicks=true){const out=[];if(!grid.length)return out;const w0=noise.at(n0),K=vol/Math.sqrt(1-RHO*RHO);let prev=sp;for(const g of grid){const B=(noise.at(g.tc)-w0*Math.pow(RHO,(g.tc-n0)/DAY))*Math.min(1,(n1-g.tc)/(PIN_DAYS*DAY)),c=g.M*Math.exp(g.h*Math.tanh(K*B/g.h));out.push(wicks?{t:g.t,o:prev,c,h:Math.max(prev,c)*(1+Math.abs(noise.z('h',g.d))*vol*.5),l:Math.min(prev,c)*(1-Math.abs(noise.z('l',g.d))*vol*.5)}:{t:g.t,c});prev=c}return out}
const rank={'polymarket-bracket':0,'polymarket-threshold':1,'deribit-options-rnd':1.5,'kalshi-bracket':2,'kalshi-threshold':3,'touch-approx':4};
function selectHorizons(all,now,generated,name,layer){const m=new Map;for(const h of all||[]){if(layer==='pm'&&h.source==='deribit')continue;if(layer==='opt'&&h.source!=='deribit')continue;const t=Date.parse(h.t),z=modeBin(h.bins),rb=(h.bins||[]).reduce((a,x)=>!a||x.p>a.p?x:a,null);if(h.unreliable||t<now||binSum(h)<.6||binSum(h)>1.5||!z||!rb||rb.lo==null||rb.hi==null||(name==='FED'&&t>Date.parse(generated)+465*DAY))continue;const k=new Date(t).toISOString().slice(0,10),o=m.get(k);if(!o||(rank[h.source+'-'+h.kind]??9)<(rank[o.source+'-'+o.kind]??9))m.set(k,h)}return[...m.values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t))}
// ★층 합치기: 'both' 는 예측시장 실제 시장 + 옵션. 옵션 만기가 7일 안에 있으면 도달근사(touch-approx)는 뺀다(옵션이 더 정직한 만기분포). 같은 날은 rank 로 하나.
function mergeLayers(pm,opt,mode){pm=pm||[];opt=opt||[];if(mode==='pm')return pm.slice();if(mode==='opt')return opt.slice();const near=t=>opt.some(o=>Math.abs(Date.parse(o.t)-t)<=7*DAY);const m=new Map;for(const h of pm.concat(opt)){if(h.kind==='touch-approx'&&near(Date.parse(h.t)))continue;const k=new Date(Date.parse(h.t)).toISOString().slice(0,10),o=m.get(k);if(!o||(rank[h.source+'-'+h.kind]??9)<(rank[o.source+'-'+o.kind]??9))m.set(k,h)}return[...m.values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t))}
const SRC={polymarket:'폴리마켓',kalshi:'칼시',deribit:'옵션(Deribit)'};
function fmt(v,d=0,u=''){if(!finite(v))return'?';return u==='USD'&&Math.abs(v)>=1000?(v/1000).toFixed(v>=1e5?0:1)+'k':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmtFull(v,d=0){return finite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'?'}
function dateLabel(t){const d=new Date(t);return`${d.getUTCMonth()+1}/${d.getUTCDate()}`}
const lerp=(a,b,w)=>a+(b-a)*w,hkey=h=>`${h.source}|${h.kind}|${h.t}`;

// ---------- 차트 ----------
// 시점(state) = {label, now, spot, layers:{pm,opt}, present, data}. 슬라이더 pos 가 정수면 그 시점, 소수면 앞뒤 시점의 분위수를 섞는다 → 분포·밴드·경로가 연속으로 변형.
class Chart{
  constructor(el,o){this.o=o;el.innerHTML=`<div class="panel-head"><h2>${o.title}</h2><span class="spot">${fmt(o.spot,o.decimals,o.unit)}</span></div><div class="chart-wrap"><canvas></canvas><div class="legend"></div><div class="tip"></div></div>`;this.canvas=el.querySelector('canvas');this.wrap=el.querySelector('.chart-wrap');this.tip=el.querySelector('.tip');this.legend=el.querySelector('.legend');this.ctx=this.canvas.getContext('2d');
    this.hist=(o.history||[]).map(x=>o.candles?{t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]}:{t:Date.parse(x[0]),v:+x[1]}).filter(x=>finite(x.t));
    this.vol=o.candles?realizedVol(o.history):.01;this.now=o.now||Date.now();this.qa=new Float64Array(NQ);this.qb=new Float64Array(NQ);this.tmp=new Float64Array(NQ);
    this.noise=mkNoise(o.title);this.paths=Array.from({length:10},(_,i)=>mkNoise(o.title+':'+i));this.yLock=null;
    if(o.layers){o.mode=o.mode||'both'}
    this.setStates(o.states||[{label:'현재',now:this.now,spot:o.spot,layers:o.layers||{pm:o.horizons,opt:[]},present:true}],true);
    const first=this.hist.length?this.hist[0].t:this.now-30*DAY;
    this.view={t0:o.small?first:Math.max(first,this.now-30*DAY),t1:Math.min(Math.max(this.max+2*DAY,this.now+7*DAY),this.now+130*DAY)};// 기본 화면은 약 4개월 — 더 먼 만기는 휠로 축소해서 본다
    if(typeof window!=='undefined')(window.__charts=window.__charts||[]).push(this);
    const hd=el.querySelector('.panel-head');
    if(o.layers){const mb=document.createElement('div');mb.className='modes';mb.innerHTML=[['both','통합'],['pm','예측시장만'],['opt','옵션만']].map(([m,l])=>`<button data-m="${m}" class="${m===o.mode?'on':''}">${l}</button>`).join('');hd.insertBefore(mb,hd.lastElementChild);mb.onclick=e=>{const b=e.target.closest('button');if(!b)return;this.setMode(b.dataset.m);mb.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.m===b.dataset.m))}}
    if(!o.small){const b=this.lockBtn=document.createElement('button');b.className='axis-lock';b.title='오른쪽 가격축을 위아래로 끌면 세로 비율, 아래 날짜축을 좌우로 끌면 가로 비율이 바뀝니다. 가격축 더블클릭 = 자동';b.onclick=()=>{this.yLock=this.yLock?null:{lo:this.lo,hi:this.hi};this.lockUi();this.requestDraw()};hd.insertBefore(b,hd.lastElementChild);this.lockUi()}
    new ResizeObserver(()=>this.requestDraw()).observe(this.wrap);
    this.canvas.onpointermove=e=>this.move(e);this.canvas.onpointerleave=()=>{this.cross=null;this.tip.style.display='none';this.requestDraw()};
    this.canvas.onpointerdown=e=>{const z=this.zone(e);this.drag={z,x:e.clientX,y:e.clientY,t0:this.view.t0,t1:this.view.t1,lo:this.lo,hi:this.hi};this.canvas.setPointerCapture(e.pointerId)};
    this.canvas.onpointerup=()=>{this.drag=null};
    this.canvas.ondblclick=e=>{if(this.zone(e)==='y'){this.yLock=null;this.lockUi();this.requestDraw()}};
    this.canvas.onwheel=e=>{e.preventDefault();const f=e.deltaY>0?1.15:1/1.15;if(this.zone(e)==='y'){this.scaleY(f);return}const r=this.canvas.getBoundingClientRect(),tc=this.tAt(e.clientX-r.left),span=(this.view.t1-this.view.t0)*f;if(span<5*DAY||span>600*DAY)return;this.view={t0:tc-(tc-this.view.t0)*f,t1:tc+(this.view.t1-tc)*f};this.requestDraw()};
  }
  zone(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return x>this.L+this.pw?'y':y>this.T+this.ph?'x':'plot'}
  lockUi(){if(this.lockBtn){this.lockBtn.textContent=this.yLock?'축 고정됨 · 풀기':'축 고정';this.lockBtn.classList.toggle('on',!!this.yLock)}}
  scaleY(f,base){const b=base||{lo:this.lo,hi:this.hi},c=(b.lo+b.hi)/2,h=(b.hi-b.lo)/2*f;if(!(h>0))return;this.yLock={lo:c-h,hi:c+h};this.lockUi();this.requestDraw()}
  mkState(s){// ★시점 하나: 출처별 분위수 만기 목록 + 현물(0.8% 폭) + 만기 점
    const L=s.layers||{pm:s.hs||[],opt:[]},mode=this.o.mode||'both',use=mode==='pm'?['pm']:mode==='opt'?['opt']:['pm','opt'],src=use.map(k=>({k,ns:srcNodes(L[k])})).filter(x=>x.ns.length),sp=s.spot,all=[].concat(...src.map(x=>x.ns)),days=new Map;
    for(const n of all){const k=new Date(n.t).toISOString().slice(0,10),o=days.get(k);if(!o||(rank[n.h.source+'-'+n.h.kind]??9)<(rank[o.h.source+'-'+o.h.kind]??9))days.set(k,n)}
    return{label:s.label,now:s.now,spot:sp,present:!!s.present,data:s.data,raw:mergeLayers(L.pm,L.opt,mode),src,sq:Float64Array.from(PQ,p=>sp*(1+.008*(p-.5))),max:all.length?Math.max(...all.map(n=>n.t)):s.now+7*DAY,dots:[...days.entries()].map(([k,n])=>({k,t:n.t,h:n.h}))}}
  setStates(list,keepPos){this.srcStates=list;this.states=list.map(s=>this.mkState(s));const P=this.states[this.states.length-1];this.o.horizons=P.raw;this.max=P.max;this.gref=1/(Math.abs(P.spot)*.008||1);if(!keepPos||this.pos==null)this.pos=this.states.length-1;this.pos=Math.min(this.pos,this.states.length-1);this.layerKey=this.rangeKey=this.futKey='';this.requestDraw()}
  setMode(m){this.o.mode=m;this.setStates(this.srcStates,true)}
  setPos(p){this.pos=Math.max(0,Math.min(this.states.length-1,p));this.requestDraw()}
  cur(){const N=this.states.length,i=Math.min(N-1,Math.floor(this.pos)),j=Math.min(N-1,i+1),w=Math.min(1,Math.max(0,this.pos-i));return{A:this.states[i],B:this.states[j],w:i===j?0:w,rest:i===j||w===0}}
  near(){const{A,B,w}=this.cur();return w<.5?A:B}
  mix(){const{A,B,w}=this.cur();return{n0:lerp(A.now,B.now,w),n1:lerp(A.max,B.max,w),sp:lerp(A.spot,B.spot,w)}}
  qAt(t,out){const{A,B,w}=this.cur();unifiedAt(A,t,out,this.tmp);if(!w)return out;unifiedAt(B,t,this.qb,this.tmp);for(let k=0;k<out.length;k++)out[k]+=(this.qb[k]-out[k])*w;return out}
  requestDraw(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw()})}
  x(t){return this.L+(t-this.view.t0)/(this.view.t1-this.view.t0)*this.pw}
  tAt(x){return this.view.t0+(x-this.L)/this.pw*(this.view.t1-this.view.t0)}
  y(v){return this.T+(this.hi-v)/(this.hi-this.lo)*this.ph}
  vAt(y){return this.hi-(y-this.T)/this.ph*(this.hi-this.lo)}
  range(){// ★세로 범위는 모든 시점을 합쳐 한 번만 — 재생·슬라이더 중에 축이 흔들리지 않게. 잠그면(yLock) 그 값 그대로.
    if(this.yLock){this.lo=this.yLock.lo;this.hi=this.yLock.hi;return}
    const key=[this.view.t0,this.view.t1,this.states.length,this.o.mode].join();if(key!==this.rangeKey){const v=[],{t0,t1}=this.view,q=new Float64Array(NQ);this.hist.forEach(h=>{if(h.t>=t0&&h.t<=t1)v.push(...(this.o.candles?[h.h,h.l]:[h.v]))});
      for(const st of this.states){if(st.now>=t0&&st.now<=t1)v.push(st.spot);for(const d of st.dots){if(d.t<t0||d.t>t1)continue;unifiedAt(st,d.t,q,this.tmp);if(d.t-st.now<=45*DAY)v.push(q[10],q[90]);else v.push(q[50])}}
      const a=v.filter(finite);if(!a.length)this.auto={lo:0,hi:1};else{const lo=Math.min(...a),hi=Math.max(...a),p=(hi-lo)*.06||Math.abs(hi)*.01||1;this.auto={lo:lo-p,hi:hi+p}}this.rangeKey=key}
    this.lo=this.auto.lo;this.hi=this.auto.hi}
  future(){// 지금 시점(섞인 것)의 예측 캔들 + 흐린 10갈래. pos·모드가 바뀔 때만 다시 계산
    const key=[this.pos,this.o.mode,this.states.length].join();if(key===this.futKey)return this.fut;const{n0,n1,sp}=this.mix(),g=this.o.candles?dayGrid((t,o)=>this.qAt(t,o),n0,n1):[];
    this.fut=futurePath(g,n0,n1,sp,this.vol,this.noise);this.pathFut=this.paths.map(nz=>futurePath(g,n0,n1,sp,this.vol,nz,false));this.futKey=key;return this.fut}
  draw(){const r=this.wrap.getBoundingClientRect(),d=devicePixelRatio||1;if(!r.width)return;this.w=r.width;this.h=r.height;const cw=Math.round(r.width*d),ch=Math.round(r.height*d);if(this.canvas.width!==cw||this.canvas.height!==ch){this.canvas.width=cw;this.canvas.height=ch}this.ctx.setTransform(d,0,0,d,0,0);
    this.L=6;this.T=8;this.pw=this.w-6-62;this.ph=this.h-8-34;this.range();this.future();
    const key=[this.view.t0,this.view.t1,this.lo,this.hi,cw,ch,this.o.mode||'',this.pos].join();
    if(key!==this.layerKey){// ★정적 층(격자·밀도·밴드)은 뷰·시점이 바뀔 때만 다시 그린다 — 마우스 이동은 캔들·십자선만
      const o=this.layer||(this.layer=document.createElement('canvas'));if(o.width!==cw||o.height!==ch){o.width=cw;o.height=ch}const g=o.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cw,ch);g.setTransform(d,0,0,d,0,0);g.save();g.beginPath();g.rect(this.L,this.T,this.pw,this.ph);g.clip();this.gridLines(g);this.density(g);this.band(g);g.restore();this.layerKey=key}
    const c=this.ctx;c.clearRect(0,0,this.w,this.h);c.drawImage(this.layer,0,0,this.w,this.h);c.save();c.beginPath();c.rect(this.L,this.T,this.pw,this.ph);c.clip();this.historyDraw();this.futureDraw();this.marks();c.restore();this.axes();this.crosshair();this.legendText()}
  nowX(){return this.x(this.mix().n0)}
  rgb(){return this.o.mode==='opt'?[74,163,255]:[245,165,36]}
  gridLines(c){c.strokeStyle=C.grid;c.lineWidth=1;for(let i=0;i<=5;i++){const y=Math.round(this.T+this.ph*i/5)+.5;c.beginPath();c.moveTo(this.L,y);c.lineTo(this.L+this.pw,y);c.stroke()}
    for(const t of this.ticks()){const x=Math.round(this.x(t))+.5;c.beginPath();c.moveTo(x,this.T);c.lineTo(x,this.T+this.ph);c.stroke()}
    const xn=this.nowX();c.setLineDash([4,4]);c.strokeStyle=C.cross;c.beginPath();c.moveTo(xn,this.T);c.lineTo(xn,this.T+this.ph);c.stroke();c.setLineDash([])}
  ticks(){const ppd=this.pw/((this.view.t1-this.view.t0)/DAY),step=[1,2,3,7,14,30,61,91,182].find(s=>s*ppd>=80)||365,out=[];const d0=new Date(this.view.t0);d0.setUTCHours(0,0,0,0);let t=d0.getTime();while(t<this.view.t1){if(t>=this.view.t0)out.push(t);t+=step*DAY}return out}
  density(g){// ★하나의 통합 분포. 진하기 기준(gref)은 현물 밀도로 고정 — 시점이 바뀌어도 밝기 기준이 흔들리지 않는다
    const{n0,n1}=this.mix(),x0=Math.max(this.L,Math.ceil(this.x(n0))),x1=Math.min(this.L+this.pw,Math.floor(this.x(n1))),W=x1-x0;if(W<1)return;const S=2,cw=Math.ceil(W/S),ch=Math.ceil(this.ph/S),o=document.createElement('canvas');o.width=cw;o.height=ch;const oc=o.getContext('2d'),im=oc.createImageData(cw,ch),D=im.data,rgb=this.rgb(),q=this.qa,ys=Array.from({length:ch},(_,j)=>this.vAt(this.T+j*S));
    for(let i=0;i<cw;i++){this.qAt(this.tAt(x0+i*S),q);for(let j=0;j<ch;j++){const v=gridDensity(q,ys[j]);if(v>0){const k=(j*cw+i)*4;D[k]=rgb[0];D[k+1]=rgb[1];D[k+2]=rgb[2];D[k+3]=Math.round(.85*Math.sqrt(Math.min(1,v/this.gref))*255)}}}
    oc.putImageData(im,0,0);g.imageSmoothingEnabled=true;g.drawImage(o,0,0,cw,ch,x0,this.T,cw*S,ch*S)}
  band(g){if(this.o.small)return;const{n0,n1}=this.mix(),x0=Math.max(this.L,this.x(n0)),x1=Math.min(this.L+this.pw,this.x(n1));if(x1-x0<2)return;const S=2,n=Math.ceil((x1-x0)/S),Q=[],q=this.qa;for(let i=0;i<=n;i++){this.qAt(this.tAt(Math.min(x1,x0+i*S)),q);Q.push([q[10],q[25],q[50],q[75],q[90]])}const X=i=>Math.min(x1,x0+i*S),[r,gg,b]=this.rgb(),col=a=>`rgba(${r},${gg},${b},${a})`;
    const fill=(a,bb,cl)=>{g.beginPath();Q.forEach((z,i)=>i?g.lineTo(X(i),this.y(z[a])):g.moveTo(X(0),this.y(z[a])));for(let i=n;i>=0;i--)g.lineTo(X(i),this.y(Q[i][bb]));g.closePath();g.fillStyle=cl;g.fill()};
    fill(4,0,col(.07));fill(3,1,col(.11));
    for(const[k,cl,dash]of[[0,col(.75),[3,3]],[4,col(.75),[3,3]],[2,col(.35),[2,3]]]){g.beginPath();Q.forEach((z,i)=>i?g.lineTo(X(i),this.y(z[k])):g.moveTo(X(0),this.y(z[k])));g.strokeStyle=cl;g.setLineDash(dash);g.lineWidth=1;g.stroke()}g.setLineDash([]);
    const e=Q[n];g.fillStyle=C.muted;g.font='10px system-ui';g.textAlign='right';g.fillText(`상한 90% ${fmt(e[4],this.o.decimals,this.o.unit)}`,x1-3,this.y(e[4])-4);g.fillText(`하한 10% ${fmt(e[0],this.o.decimals,this.o.unit)}`,x1-3,this.y(e[0])+12)}
  bodyW(){const ppd=this.pw/((this.view.t1-this.view.t0)/DAY);return Math.max(1,Math.min(14,Math.floor(ppd*.6)))}
  candle(x,k){const c=this.ctx,bw=this.bodyW(),up=k.c>=k.o;c.strokeStyle=c.fillStyle=up?C.up:C.down;c.lineWidth=1;c.beginPath();c.moveTo(Math.round(x)+.5,this.y(k.h));c.lineTo(Math.round(x)+.5,this.y(k.l));c.stroke();const y1=this.y(Math.max(k.o,k.c)),y2=this.y(Math.min(k.o,k.c));c.fillRect(Math.round(x-bw/2),y1,bw,Math.max(1,y2-y1))}
  historyDraw(){// 실제 캔들은 그 시점까지만. 그 뒤 실제 종가는 흐린 점선(예측과 비교용)
    const c=this.ctx,{t0,t1}=this.view;if(!this.hist.length)return;if(!this.o.candles){c.strokeStyle='#aab3c4';c.lineWidth=1.2;c.beginPath();let s=false;this.hist.forEach(h=>{if(h.t<t0-DAY||h.t>t1+DAY)return;s?c.lineTo(this.x(h.t),this.y(h.v)):c.moveTo(this.x(h.t),this.y(h.v));s=true});c.stroke();return}
    const n0=this.mix().n0,after=[];this.hist.forEach(h=>{if(h.t>n0){after.push(h);return}if(h.t>=t0-DAY&&h.t<=t1+DAY)this.candle(this.x(h.t),h)});
    if(after.length){c.save();c.setLineDash([2,3]);c.strokeStyle='rgba(209,212,220,.5)';c.lineWidth=1.2;c.beginPath();c.moveTo(this.x(n0),this.y(this.mix().sp));after.forEach(h=>c.lineTo(this.x(h.t),this.y(h.c)));c.stroke();c.restore();const l=after[after.length-1];c.fillStyle='rgba(209,212,220,.7)';c.font='10px system-ui';c.textAlign='left';c.fillText('실제',this.x(l.t)+5,this.y(l.c)+3)}}
  futureDraw(){// 예측 캔들은 시점과 상관없이 같은 모양(채운 캔들). 흐린 10갈래도 같은 잡음이라 함께 출렁인다
    const c=this.ctx,{t0,t1}=this.view,{n0,sp}=this.mix();c.strokeStyle='rgba(209,212,220,.13)';c.lineWidth=1;this.pathFut.forEach(p=>{if(!p.length)return;c.beginPath();c.moveTo(this.x(n0),this.y(sp));p.forEach(k=>c.lineTo(this.x(k.t),this.y(k.c)));c.stroke()});
    this.fut.forEach(k=>{if(k.t>=t0-DAY&&k.t<=t1+DAY)this.candle(this.x(k.t),k)})}
  dotY(st,d){if(st.src.length===1&&st.src[0].ns.some(n=>n.t===d.t)){const m=modeBin(d.h.bins);return{v:(m.lo+m.hi)/2,m}}const q=unifiedAt(st,d.t,new Float64Array(NQ),this.tmp);return{v:gridMode(q)}}
  marks(){// 만기마다 통합 분포의 최빈 점. 시점 사이엔 같은 날짜 점이 미끄러지고, 한쪽에만 있는 점은 사라지거나 나타난다.
    const c=this.ctx,{A,B,w}=this.cur(),mA=new Map(A.dots.map(d=>[d.k,d])),mB=new Map(B.dots.map(d=>[d.k,d])),pts=[];
    new Set([...mA.keys(),...mB.keys()]).forEach(k=>{const a=mA.get(k),b=mB.get(k),ya=a&&this.dotY(A,a),yb=b&&this.dotY(B,b),d=b||a,info=(w<.5?ya:yb)||ya||yb;pts.push({d,x:this.x(a&&b?lerp(a.t,b.t,w):d.t),y:this.y(a&&b?lerp(ya.v,yb.v,w):(ya||yb).v),al:a&&b?1:a?1-w:w,info})});pts.sort((p,q)=>p.x-q.x);
    if(this.o.small&&this.o.connect!==false){c.setLineDash([2,3]);c.strokeStyle='rgba(245,165,36,.6)';c.beginPath();c.moveTo(this.nowX(),this.y(this.mix().sp));pts.forEach(p=>c.lineTo(p.x,p.y));c.stroke();c.setLineDash([])}
    const col=`rgb(${this.rgb().join()})`,lab=candleLabels(pts.map(p=>p.x),80);pts.forEach((p,i)=>{c.save();c.globalAlpha=p.al;c.fillStyle=col;c.beginPath();c.arc(p.x,p.y,3,0,Math.PI*2);c.fill();c.strokeStyle='#0b0e14';c.lineWidth=1;c.stroke();if(lab[i]&&p.x>this.L&&p.x<this.L+this.pw){const m=p.info.m,u=this.o.unit,dd=this.o.decimals;c.fillStyle=C.text;c.font='10px system-ui';c.textAlign='center';c.fillText(m?`${fmt(m.lo,dd,u)}–${fmt(m.hi,dd,u)} · ${(m.p*100).toFixed(0)}%`:`최빈 ${fmt(p.info.v,dd,u)}`,p.x,Math.max(this.T+10,p.y-9))}c.restore()})}
  axes(){const c=this.ctx,{A,B,w}=this.cur(),st=this.near();c.fillStyle='#0f1420';c.fillRect(this.L+this.pw,0,this.w-this.L-this.pw,this.h);c.fillRect(0,this.T+this.ph,this.w,this.h-this.T-this.ph);c.strokeStyle=C.axis;c.beginPath();c.moveTo(this.L+this.pw+.5,this.T);c.lineTo(this.L+this.pw+.5,this.T+this.ph);c.moveTo(this.L,this.T+this.ph+.5);c.lineTo(this.L+this.pw,this.T+this.ph+.5);c.stroke();
    c.fillStyle=this.yLock?'#b28cff':C.muted;c.font='11px ui-monospace, Menlo, Consolas, monospace';c.textAlign='left';for(let i=0;i<=5;i++){const v=this.hi-(this.hi-this.lo)*i/5;c.fillText(fmt(v,this.o.decimals,this.o.unit),this.L+this.pw+6,this.T+this.ph*i/5+4)}c.fillStyle=C.muted;
    const xn=this.nowX();c.textAlign='center';for(const t of this.ticks()){if(Math.abs(this.x(t)-xn)<34)continue;const d=new Date(t);c.fillText(d.getUTCDate()===1||(this.view.t1-this.view.t0)>150*DAY?`${d.getUTCMonth()+1}월${d.getUTCDate()===1?'':' '+d.getUTCDate()+'일'}`:dateLabel(t),this.x(t),this.T+this.ph+14)}
    c.fillStyle=st.present?C.orange:'#b28cff';c.fillText(st.present?'지금':st.label+' 시점',xn,this.T+this.ph+14);
    const hs=st.raw,xs=hs.map(h=>this.x(Date.parse(h.t))),ok=spacedLabels(xs,40);c.fillStyle=C.text;c.font='10px system-ui';hs.forEach((h,i)=>{if(ok[i]&&xs[i]>=this.L&&xs[i]<=this.L+this.pw)c.fillText(h.label+(h.low_liquidity?'*':''),xs[i],this.T+this.ph+28)});
    this.tag(lerp(A.spot,B.spot,w),st.present?C.orange:'#b28cff','#111')}
  tag(v,bg,fg){if(!finite(v))return;const c=this.ctx,y=this.y(v);if(y<this.T||y>this.T+this.ph)return;const s=fmtFull(v,this.o.decimals);c.font='10px ui-monospace, Menlo, Consolas, monospace';const w=c.measureText(s).width+8;c.fillStyle=bg;c.fillRect(this.L+this.pw+1,y-8,Math.max(w,this.w-this.L-this.pw-2),16);c.fillStyle=fg;c.textAlign='left';c.fillText(s,this.L+this.pw+5,y+4)}
  crosshair(){if(!this.cross)return;const c=this.ctx,{x,y}=this.cross;c.save();c.setLineDash([3,3]);c.strokeStyle=C.cross;c.beginPath();c.moveTo(this.L,y+.5);c.lineTo(this.L+this.pw,y+.5);c.moveTo(x+.5,this.T);c.lineTo(x+.5,this.T+this.ph);c.stroke();c.restore();this.tag(this.vAt(y),'#3a4250','#fff')}
  nearestCandle(t){const n0=this.mix().n0,all=this.o.candles?this.hist.filter(h=>h.t<=n0).concat(this.fut||[]):[];if(!all.length)return null;return all.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a)}
  legendText(){if(!this.o.candles){this.legend.textContent='';return}const st=this.near(),n0=this.mix().n0,k=this.cross?this.nearestCandle(this.tAt(this.cross.x)):this.hist.filter(h=>h.t<=n0).pop();if(!k){this.legend.textContent='';return}const fut=!this.hist.includes(k),col=k.c>=k.o?C.up:C.down,d=this.o.decimals;this.legend.innerHTML=`<span class="lg-t">${st.present?'':`<em>${st.label} 시점 예측</em> · `}${this.o.title} · 1D${fut?' · <em>예시 경로(중앙값 따라 흔들림)</em>':''} · ${dateLabel(k.t)}</span> <span style="color:${col}">O ${fmtFull(k.o,d)} H ${fmtFull(k.h,d)} L ${fmtFull(k.l,d)} C ${fmtFull(k.c,d)}</span>`}
  move(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,dr=this.drag;
    if(dr&&e.buttons){if(dr.z==='y'){this.scaleY(Math.exp((e.clientY-dr.y)/150),dr);return}
      if(dr.z==='x'){const f=Math.exp((dr.x-e.clientX)/200),c=(dr.t0+dr.t1)/2,span=Math.min(600*DAY,Math.max(5*DAY,(dr.t1-dr.t0)*f));this.view={t0:c-span/2,t1:c+span/2};this.requestDraw();return}
      const dt=(dr.x-e.clientX)/this.pw*(dr.t1-dr.t0);this.view={t0:dr.t0+dt,t1:dr.t1+dt};if(this.yLock){const dv=(e.clientY-dr.y)/this.ph*(dr.hi-dr.lo);this.yLock={lo:dr.lo+dv,hi:dr.hi+dv}}this.cross={x,y};this.requestDraw();return}
    const z=this.zone(e);this.canvas.style.cursor=z==='y'?'ns-resize':z==='x'?'ew-resize':'crosshair';
    if(z!=='plot'){this.cross=null;this.tip.style.display='none';this.requestDraw();return}
    this.cross={x,y};const t=this.tAt(x),v=this.vAt(y),{n0,n1}=this.mix(),st=this.near(),d=this.o.decimals,u=this.o.unit;let html='';
    if(t>n0&&t<=n1+DAY&&st.src.length){const q=this.qAt(t,this.qa),ws=[];unifiedAt(st,t,new Float64Array(NQ),this.tmp,ws);const W=ws.reduce((s,a)=>s+(a||0),0)||1,nm={pm:'예측시장',opt:'옵션'};
      html=`<b>${dateLabel(t)} 예상 분포</b>${st.present?'':` · <span style="color:#b28cff">${st.label} 시점</span>`}<br>P(가격 &lt; ${fmt(v,d,u)}) ${(gridCdf(q,v)*100).toFixed(1)}%<br>10~90%: ${fmt(q[10],d,u)} – ${fmt(q[90],d,u)} · 중앙 ${fmt(q[50],d,u)}${st.src.length>1?`<br><span class="muted">반영: ${st.src.map((s,j)=>`${nm[s.k]||s.k} ${Math.round((ws[j]||0)/W*100)}%`).join(' · ')}</span>`:''}`}
    else if(!this.o.candles&&this.hist.length){const k=this.hist.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a);html=`${dateLabel(k.t)} · ${fmtFull(k.v,d)}`}
    if(html){this.tip.innerHTML=html;this.tip.style.display='block';this.tip.style.left=Math.min(this.w-230,x+12)+'px';this.tip.style.top=Math.min(this.h-90,y+10)+'px'}else this.tip.style.display='none';
    this.requestDraw()}
}

// ---------- 데이터 ----------
async function candles(){try{const r=await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=60');if(!r.ok)throw 0;return(await r.json()).map(x=>[x[0],+x[1],+x[2],+x[3],+x[4]])}catch(_){try{const r=await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440');const d=await r.json(),k=Object.values(d.result).find(Array.isArray)||[];return k.slice(-60).map(x=>[x[0]*1000,+x[1],+x[2],+x[3],+x[4]])}catch(__){return[]}}}
// ---------- 도달 확률 표: 네 표의 「현재」 구분선 높이를 맞추고, 확률을 막대로 ----------
function touchTable(p,spot,d,u){const tables=selectTouchTables(p.touch).map(t=>{const lv=(t.levels||[]).filter(z=>z.p>.002&&z.p<.995);const up=lv.filter(z=>z.dir==='up'&&z.price>spot).sort((a,b)=>a.price-b.price).slice(0,10).sort((a,b)=>b.price-a.price),dn=lv.filter(z=>z.dir==='down'&&z.price<spot).sort((a,b)=>b.price-a.price).slice(0,10);return{t,up,dn}});
  const nUp=Math.max(0,...tables.map(x=>x.up.length)),nDn=Math.max(0,...tables.map(x=>x.dn.length));
  const row=(z,cls)=>`<div class="touchrow ${cls}"><span class="lv">${cls==='up'?'↑':'↓'} ${fmt(z.price,d,u)}</span><span class="bar"><i style="width:${Math.min(100,z.p*100).toFixed(1)}%"></i></span><b>${(z.p*100).toFixed(1)}%</b></div>`,empty='<div class="touchrow empty"></div>';
  return`<div class="touch-grid">${tables.map(({t,up,dn})=>`<div class="touchbox"><h3>${t.label} 도달 확률</h3>${empty.repeat(nUp-up.length)}${up.map(z=>row(z,'up')).join('')}<div class="touch-divider">현재 ${fmt(spot,d,u)}</div>${dn.map(z=>row(z,'down')).join('')}${empty.repeat(nDn-dn.length)}</div>`).join('')}</div>`}

// ---------- 예보 이력: 시점 슬라이더·재생, 예측 변화 패널 ----------
const HIST=DATA_URL.replace('latest.json','history/');
const S={latest:null,hist:[],snaps:{},index:[],summary:null,chart:null,box:null,present:null,statesLoaded:false,playing:false,selRow:null};
function buildLayers(d,now){const p=d.panels.BTC,pm=selectHorizons(p.horizons,now,d.generated_at,'BTC','pm'),opt=selectHorizons(p.horizons,now,d.generated_at,'BTC','opt');return{pm,opt}}
async function loadSnap(date){if(S.snaps[date])return S.snaps[date];const r=await fetch(`${HIST}daily/${date}.json?t=${Date.now()}`);if(!r.ok)throw new Error('snapshot '+date);return S.snaps[date]=await r.json()}
function tween(from,to,ms,step,done){const t0=performance.now(),f=()=>{const u=Math.min(1,(performance.now()-t0)/ms),e=1-Math.pow(1-u,3);step(from+(to-from)*e);if(u<1)requestAnimationFrame(f);else if(done)done()};requestAnimationFrame(f)}
function renderTouch(data,spot){const e=document.querySelector('#btc-panel');e.querySelector('.touch-grid')?.remove();e.insertAdjacentHTML('beforeend',touchTable(data.panels.BTC,spot,0,'USD'))}
function renderMain(){const e=document.querySelector('#btc-panel'),d=S.latest,now=Date.now(),spot=S.hist.length?S.hist[S.hist.length-1][4]:d.spot.BTC,L=buildLayers(d,now);
  S.present={label:'현재',now,spot,layers:L,present:true,data:d};
  S.chart=new Chart(e,{title:'BTC/USD',spot,unit:'USD',decimals:0,layers:L,mode:'both',history:S.hist,candles:true,generatedAt:d.generated_at,now,states:[S.present]});
  renderTouch(d,spot);e.querySelector('.panel-head').appendChild(scrubber());renderChanges()}
function snapLabel(g){return`${g.slice(5,7)}/${g.slice(8,10)} ${g.slice(11,16)}`}
function scrubber(){// ★시점 슬라이더: 왼쪽 = 가장 오래된 스냅샷, 오른쪽 끝 = 현재. 수집할 때마다 남긴 스냅샷(intraday)을 차례로 지나간다. ▶ 는 자동 재생.
  const box=document.createElement('div');box.className='when';S.box=box;box.innerHTML=`<button class="play" title="과거→현재 재생">▶</button><input type="range" min="0" max="0" step="0.001" value="0"><span class="when-lab">현재</span><button class="jump">현재로</button><span class="muted hint-load"></span>`;
  const range=box.querySelector('input'),lab=box.querySelector('.when-lab'),play=box.querySelector('.play'),hint=box.querySelector('.hint-load');
  const label=()=>{const st=S.chart.near();lab.textContent=st.present?'현재':st.label+' 시점';lab.style.color=st.present?'':'#b28cff'};
  const settle=i=>{const st=S.chart.states[i];renderTouch(st.data||S.latest,st.spot);label()};
  const go=(to,ms,then)=>tween(+range.value,to,ms,v=>{range.value=v;S.chart.setPos(v);label()},()=>{if(then)then()});
  const stop=()=>{S.playing=false;play.textContent='▶'};
  async function ensureStates(){if(S.statesLoaded)return true;const lastGen=S.latest.generated_at,from=new Date(Date.parse(lastGen)-30*DAY).toISOString();hint.textContent='이력 불러오는 중…';
    try{let snaps=[];try{const r=await fetch(HIST+'intraday.json?t='+Date.now());if(r.ok)snaps=((await r.json()).snaps||[])}catch(_){}
      const covered=new Set(snaps.map(s=>(s.generated_at||'').slice(0,10))),days=(S.index||[]).filter(x=>x<lastGen.slice(0,10)&&x>=from.slice(0,10)&&!covered.has(x));snaps=snaps.concat(await Promise.all(days.map(loadSnap)));
      snaps=snaps.filter(s=>s.generated_at&&s.generated_at<lastGen&&s.generated_at>=from&&s.panels&&s.panels.BTC&&finite((s.spot||{}).BTC)).sort((a,b)=>a.generated_at<b.generated_at?-1:1);
      const pick=[];for(const s of snaps){if(!pick.length||Date.parse(s.generated_at)-Date.parse(pick[pick.length-1].generated_at)>=20*60e3)pick.push(s)}// 20분 안쪽 중복은 하나만
      if(!pick.length){hint.textContent='이력 없음 — 수집이 쌓이면 슬라이더가 열립니다';range.disabled=true;return false}
      const states=pick.map(d=>{const n=Date.parse(d.generated_at);return{label:snapLabel(d.generated_at),now:n,spot:d.spot.BTC,layers:buildLayers(d,n),data:d}});states.push(S.present);S.chart.setStates(states,false);range.max=states.length-1;range.value=states.length-1;range.disabled=false;S.statesLoaded=true;hint.textContent=`${pick.length}개 시점 · ${snapLabel(pick[0].generated_at)}부터 (UTC)`;return true}catch(e){console.error(e);hint.textContent='이력을 못 불러왔습니다';return false}}
  range.oninput=()=>{stop();S.chart.setPos(+range.value);label()};
  range.onchange=()=>{const t=Math.round(+range.value);go(t,250,()=>settle(t))};// 손을 떼면 가까운 시점으로 스르륵
  play.onclick=async()=>{if(S.playing){stop();return}if(!(await ensureStates()))return;S.playing=true;play.textContent='❚❚';const N=S.chart.states.length,dur=Math.min(40,Math.max(8,N*.35))*1000,rate=(N-1)/dur;let v=+range.value>=N-1?0:+range.value,last=performance.now();
    const step=now=>{if(!S.playing)return;v=Math.min(N-1,v+(now-last)*rate);last=now;range.value=v;S.chart.setPos(v);label();if(v>=N-1){stop();settle(N-1);return}requestAnimationFrame(step)};requestAnimationFrame(t=>{last=t;step(t)})};// 시점 수와 상관없이 8~40초에 한 바퀴
  box.querySelector('.jump').onclick=()=>{stop();const N=S.chart.states.length;go(N-1,300,()=>settle(N-1))};
  setTimeout(ensureStates,400);return box}
function renderChanges(){const sec=document.querySelector('#change-panel');if(!sec)return;if(!S.summary||!S.chart){sec.innerHTML='';return}const days=Object.keys(S.summary.days||{}).sort().slice(-30),cur=S.chart.o.horizons;if(!days.length||!cur.length){sec.innerHTML='';return}
  const rows=cur.map(h=>({h,k:hkey(h),cells:days.map(d=>((S.summary.days[d]||{}).horizons||[]).find(x=>x.k===hkey(h))||null)})).filter(r=>r.cells.some(Boolean));if(!rows.length){sec.innerHTML='';return}
  const q50now=h=>quantile(h.bins,.5),cell=(r,c,d)=>{if(!c||!finite(c.q[2]))return`<td class="hm-c"></td>`;const pct=c.q[2]/q50now(r.h)-1,a=Math.min(1,Math.abs(pct)/.05)*.85,bg=pct>=0?`rgba(245,165,36,${a})`:`rgba(74,163,255,${a})`;return`<td class="hm-c" style="background:${bg}" title="${d} · 10% ${fmt(c.q[0],0,'USD')} · 중앙 ${fmt(c.q[2],0,'USD')} · 90% ${fmt(c.q[4],0,'USD')}"></td>`};
  const sel=S.selRow&&rows.find(r=>r.k===S.selRow)?S.selRow:rows[rows.length-1].k;S.selRow=sel;
  sec.innerHTML=`<div class="panel-head"><h2>예측 변화 — 날짜별 스냅샷</h2><span class="muted small-note">${days.length}일치 · 칸 색 = 그날 중앙값이 지금보다 높으면 주황, 낮으면 파랑(±5% 에서 최대) · 줄을 누르면 아래에 이력</span></div>`+(days.length<2?`<p class="muted">이력 ${days.length}일치(${days[0]}) — 내일부터 변화가 보입니다.</p>`:'')+`<div class="hm-wrap"><table class="hm"><thead><tr><th></th>${days.map(d=>`<th>${d.slice(5)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-k="${r.k}" class="${r.k===sel?'on':''}"><th>${r.h.label} <span class="muted">${SRC[r.h.source]||r.h.source}</span></th>${r.cells.map((c,i)=>cell(r,c,days[i])).join('')}</tr>`).join('')}</tbody></table></div><div class="spark"></div>`;
  sec.querySelectorAll('tbody tr').forEach(tr=>tr.onclick=()=>{S.selRow=tr.dataset.k;renderChanges()});spark(sec.querySelector('.spark'),rows.find(r=>r.k===sel),days)}
function spark(el,r,days){if(!el||!r)return;const pts=days.map((d,i)=>({d,c:r.cells[i]})).filter(x=>x.c&&finite(x.c.q[2]));if(!pts.length)return;const W=Math.max(320,el.clientWidth||640),H=110,P={l:58,r:14,t:14,b:18},xs=i=>P.l+(pts.length>1?i/(pts.length-1):.5)*(W-P.l-P.r),vals=[].concat(...pts.map(x=>[x.c.q[0],x.c.q[4]])),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.1||lo*.01,ys=v=>P.t+(hi+pad-v)/(hi-lo+2*pad)*(H-P.t-P.b);
  const poly=(a,b)=>pts.map((x,i)=>`${xs(i)},${ys(x.c.q[a])}`).concat(pts.map((x,i)=>{const j=pts.length-1-i;return`${xs(j)},${ys(pts[j].c.q[b])}`})).join(' '),line=k=>pts.map((x,i)=>`${i?'L':'M'}${xs(i)},${ys(x.c.q[k])}`).join(' ');
  const f=pts[0].c,l=pts[pts.length-1].c,dm=(l.q[2]/f.q[2]-1)*100,dw=((l.q[4]-l.q[0])/((f.q[4]-f.q[0])||1)-1)*100;
  el.innerHTML=`<div class="spark-head"><b>${r.h.label} 만기</b> · ${SRC[r.h.source]||r.h.source} · 중앙값 Δ ${dm>=0?'+':''}${dm.toFixed(1)}% · 밴드폭(10~90%) Δ ${dw>=0?'+':''}${dw.toFixed(1)}% <span class="muted">(${pts[0].d} → ${pts[pts.length-1].d})</span></div><svg width="${W}" height="${H}"><polygon points="${poly(0,4)}" fill="rgba(245,165,36,.15)"/><polygon points="${poly(1,3)}" fill="rgba(245,165,36,.25)"/><path d="${line(2)}" stroke="#f5a524" fill="none" stroke-width="1.5"/>${pts.map((x,i)=>`<circle cx="${xs(i)}" cy="${ys(x.c.q[2])}" r="2.5" fill="#f5a524"/>`).join('')}<text x="${P.l-6}" y="${ys(hi)+4}" fill="#787b86" font-size="10" text-anchor="end">${fmt(hi,0,'USD')}</text><text x="${P.l-6}" y="${ys(lo)+4}" fill="#787b86" font-size="10" text-anchor="end">${fmt(lo,0,'USD')}</text><text x="${xs(0)}" y="${H-4}" fill="#787b86" font-size="10" text-anchor="middle">${pts[0].d.slice(5)}</text>${pts.length>1?`<text x="${xs(pts.length-1)}" y="${H-4}" fill="#787b86" font-size="10" text-anchor="middle">${pts[pts.length-1].d.slice(5)}</text>`:''}</svg>`}
function renderSmall(d,now){for(const[k,t]of[['FED','기준금리'],['USDKRW','USD/KRW'],['USDJPY','USD/JPY'],['EURUSD','EUR/USD']]){try{const el=document.createElement('section'),q=d.panels[k];el.className='panel small';document.querySelector('#small-grid').append(el);const sh=selectHorizons(q.horizons,now,d.generated_at,k).slice(0,6);if(!finite(d.spot[k])){el.innerHTML=`<div class="panel-head"><h2>${t}</h2></div><p class="muted">현물값 없음</p>`;continue}if(!sh.length){el.innerHTML=`<div class="panel-head"><h2>${t}</h2><span class="spot">${fmt(d.spot[k],q.decimals,q.unit)}</span></div><p class="muted">예측시장 없음</p>`;continue}new Chart(el,{title:t,spot:d.spot[k],unit:q.unit,decimals:q.decimals,horizons:sh,history:(d.history[k]||[]).slice(-60),small:true,connect:k!=='FED',generatedAt:d.generated_at});
    if(k==='FED'&&q.decision&&q.decision.length){const ko={'No change':'동결','25 bps increase':'+25bp','25 bps decrease':'−25bp','50+ bps increase':'+50bp+','50+ bps decrease':'−50bp+','Cut 25bps':'−25bp','Cut >25bps':'−50bp+','Hike 25bps':'+25bp','Hike >25bps':'+50bp+','Fed maintains rate':'동결'};el.insertAdjacentHTML('beforeend',`<p class="muted small-note">${q.decision.filter(x=>x.source==='polymarket').slice(0,2).map(x=>`${x.label} FOMC: ${x.items.filter(i=>i.p>=.01).map(i=>`${ko[i.name]||i.name} ${(i.p*100).toFixed(0)}%`).join(' · ')}`).join('<br>')}</p>`)}}catch(err){console.error(k,err)}}}
async function boot(){try{const d=await(await fetch(DATA_URL+'?t='+Date.now())).json(),now=Date.now(),ag=document.querySelector('#data-age');S.latest=d;
    if(ag){const m=Math.max(0,Math.round((now-Date.parse(d.generated_at))/60000));ag.textContent=`데이터 ${m}분 전 · 10분마다 갱신`;if(m>60)ag.classList.add('warn')}
    S.hist=await candles();
    try{const[ix,sm]=await Promise.all([fetch(HIST+'index.json?t='+Date.now()),fetch(HIST+'summary.json?t='+Date.now())]);if(ix.ok)S.index=(await ix.json()).daily||[];if(sm.ok)S.summary=await sm.json()}catch(err){console.warn('history',err)}
    renderMain();renderSmall(d,now)
  }catch(e){console.error(e);const el=document.querySelector('#btc-panel');if(el)el.innerHTML='<p class="muted">데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>'}}
if(typeof document!=='undefined')boot();
if(typeof module!=='undefined')module.exports={poolGrid,quantileGrid,gridDensity,gridCdf,gridMode,srcNodes,srcAt,unifiedAt,mkNoise,dayGrid,futurePath,PQ,mergeLayers,closeBins,densityAt,cdfAt,quantile,interpolateDensity,modeBin,selectHorizons,logTimeRatio,logTimeX,chartRange,columnAlphas,spacedLabels,candleLabels,selectTouchTables,binSum,bandAt,realizedVol};
