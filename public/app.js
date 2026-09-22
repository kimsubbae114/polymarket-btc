// 폴리마켓 비트코인 가격 발견 — 화면 로직 (바닐라 JS, canvas)
// v3: 선형 시간축(과거·미래 같은 스케일, 하루 1캔들) + 휠 확대/드래그 이동 + 실현 변동성 브라운 다리 + 트레이딩뷰식 축·범례
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
function smoothDensityAt(b,y){const bs=closeBins(b);if(!bs.length)return 0;const c=bs.map(x=>(x.lo+x.hi)/2),d=bs.map(x=>(x.p||0)/(x.hi-x.lo));if(y<bs[0].lo||y>bs[bs.length-1].hi)return 0;if(y<=c[0])return d[0];if(y>=c[c.length-1])return d[d.length-1];for(let i=1;i<c.length;i++)if(y<=c[i]){const w=(y-c[i-1])/(c[i]-c[i-1]);return d[i-1]+(d[i]-d[i-1])*w}return 0}
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
// ★하루 1캔들 랜덤워크. 닻 = (지금, spot) + 각 만기의 중앙값(q50). 닻 사이는 로그가격 브라운 다리(누적 잡음, 하루 표준편차 = dailyVol).
//   각 캔들 시가 = 직전 종가, 마지막 종가 = 마지막 만기 최빈값. N 은 예전 호출 호환용(무시).
function futureCandles(spot,horizons,now,max,N,seed,dailyVol=.02){const hs=(horizons||[]).slice().sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));if(!hs.length)return[];const r=mulberry32(hashSeed(seed));const anchors=[{t:now,v:spot}].concat(hs.map(h=>{const q=quantile(h.bins,.5),m=modeBin(h.bins);return{t:Date.parse(h.t),v:finite(q)?q:(m.lo+m.hi)/2}}));const days=Math.max(1,Math.ceil((max-now)/DAY)),ts=[];for(let i=1;i<=days;i++)ts.push(i===days?max:Math.min(max,now+i*DAY));const vals=new Array(days);for(let k=1;k<anchors.length;k++){const A=anchors[k-1],B=anchors[k],span=Math.max(1,B.t-A.t),sig=dailyVol*Math.sqrt(span/DAY),idx=[];ts.forEach((t,i)=>{if(t>A.t&&(t<=B.t||k===anchors.length-1))idx.push(i)});if(!idx.length)continue;const us=idx.map(i=>Math.min(1,(ts[i]-A.t)/span)),Ws=[];let W=0,pu=0;us.forEach(u=>{W+=normal(r)*Math.sqrt(Math.max(0,u-pu));Ws.push(W);pu=u});const Wend=W+normal(r)*Math.sqrt(Math.max(0,1-pu));idx.forEach((i,j)=>{const u=us[j];vals[i]=Math.exp(Math.log(A.v)+u*(Math.log(B.v)-Math.log(A.v))+sig*(Ws[j]-u*Wend))})}vals[days-1]=anchors[anchors.length-1].v;let prev=spot;const out=[];for(let i=0;i<days;i++){const c=finite(vals[i])?vals[i]:prev,hi=Math.max(prev,c)*(1+Math.abs(normal(r))*dailyVol*.5),lo=Math.min(prev,c)*(1-Math.abs(normal(r))*dailyVol*.5);out.push({t:ts[i],o:prev,h:hi,l:lo,c});prev=c}return out}
const rank={'polymarket-bracket':0,'polymarket-threshold':1,'kalshi-bracket':2,'kalshi-threshold':3,'touch-approx':4};
function selectHorizons(all,now,generated,name){const m=new Map;for(const h of all||[]){const t=Date.parse(h.t),z=modeBin(h.bins),rb=(h.bins||[]).reduce((a,x)=>!a||x.p>a.p?x:a,null);if(h.unreliable||t<now||binSum(h)<.6||binSum(h)>1.5||!z||!rb||rb.lo==null||rb.hi==null||(name==='FED'&&t>Date.parse(generated)+465*DAY))continue;const k=new Date(t).toISOString().slice(0,10),o=m.get(k);if(!o||(rank[h.source+'-'+h.kind]??9)<(rank[o.source+'-'+o.kind]??9))m.set(k,h)}return[...m.values()].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t))}
function fmt(v,d=0,u=''){if(!finite(v))return'?';return u==='USD'&&Math.abs(v)>=1000?(v/1000).toFixed(v>=1e5?0:1)+'k':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmtFull(v,d=0){return finite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'?'}
function dateLabel(t){const d=new Date(t);return`${d.getUTCMonth()+1}/${d.getUTCDate()}`}

// ---------- 차트 ----------
class Chart{
  constructor(el,o){this.o=o;el.innerHTML=`<div class="panel-head"><h2>${o.title}</h2><span class="spot">${fmt(o.spot,o.decimals,o.unit)}</span></div><div class="chart-wrap"><canvas></canvas><div class="legend"></div><div class="tip"></div></div>`;this.canvas=el.querySelector('canvas');this.wrap=el.querySelector('.chart-wrap');this.tip=el.querySelector('.tip');this.legend=el.querySelector('.legend');this.ctx=this.canvas.getContext('2d');
    // 과거: 큰 패널은 [t,o,h,l,c], 작은 패널은 [날짜, 값] → t 로 통일
    this.hist=(o.history||[]).map(x=>o.candles?{t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]}:{t:Date.parse(x[0]),v:+x[1]}).filter(x=>finite(x.t));
    this.now=Date.now();this.max=o.horizons.length?Math.max(...o.horizons.map(h=>Date.parse(h.t))):this.now+7*DAY;
    this.vol=o.candles?realizedVol(o.history):.01;
    this.future=o.candles?futureCandles(o.spot,o.horizons,this.now,this.max,0,`${o.generatedAt||''}:${o.title}`,this.vol):[];this.paths=o.candles?Array.from({length:10},(_,i)=>futureCandles(o.spot,o.horizons,this.now,this.max,0,`${o.generatedAt||''}:${o.title}:${i}`,this.vol).map(k=>[k.t,k.c])):[];this.prep();if(typeof window!=='undefined')(window.__charts=window.__charts||[]).push(this);
    const first=this.hist.length?this.hist[0].t:this.now-30*DAY;
    this.view={t0:o.small?first:Math.max(first,this.now-30*DAY),t1:Math.max(this.max+2*DAY,this.now+7*DAY)};
    new ResizeObserver(()=>this.requestDraw()).observe(this.wrap);
    this.canvas.onpointermove=e=>this.move(e);this.canvas.onpointerleave=()=>{this.cross=null;this.tip.style.display='none';this.requestDraw()};
    this.canvas.onpointerdown=e=>{this.drag={x:e.clientX,t0:this.view.t0,t1:this.view.t1};this.canvas.setPointerCapture(e.pointerId)};
    this.canvas.onpointerup=()=>{this.drag=null};
    this.canvas.onwheel=e=>{e.preventDefault();const r=this.canvas.getBoundingClientRect(),tc=this.tAt(e.clientX-r.left),f=e.deltaY>0?1.15:1/1.15,span=(this.view.t1-this.view.t0)*f;if(span<5*DAY||span>600*DAY)return;this.view={t0:tc-(tc-this.view.t0)*f,t1:tc+(this.view.t1-tc)*f};this.requestDraw()};
  }
  prep(){// ★만기별 닫힌 구간·중앙·밀도·분위를 한 번만 계산 (픽셀마다 closeBins 를 부르던 것이 렉의 원인)
    this.hs=this.o.horizons.map(h=>{const bs=closeBins(h.bins);return{t:Date.parse(h.t),kind:h.kind,c:bs.map(x=>(x.lo+x.hi)/2),d:bs.map(x=>(x.p||0)/(x.hi-x.lo)),q:[.1,.25,.5,.75,.9].map(k=>quantile(h.bins,k)),lo:bs[0].lo,hi:bs[bs.length-1].hi}}).sort((a,b)=>a.t-b.t);
    const s=this.o.spot;this.spotH={t:this.now,kind:'',c:[s],d:[1/(s*.008)],q:[s,s,s,s,s],lo:s*.996,hi:s*1.004}}
  dens(h,y){if(y<h.lo||y>h.hi)return 0;const c=h.c,d=h.d,n=c.length;if(y<=c[0])return d[0];if(y>=c[n-1])return d[n-1];let i=1;while(i<n&&c[i]<y)i++;const w=(y-c[i-1])/(c[i]-c[i-1]);return d[i-1]+(d[i]-d[i-1])*w}
  seg(t){const hs=this.hs;let n=0;while(n<hs.length&&hs[n].t<t)n++;if(n>=hs.length)return null;const a=n?hs[n-1]:this.spotH,b=hs[n];return{a,b,w:Math.max(0,Math.min(1,(t-a.t)/Math.max(1,b.t-a.t)))}}
  bandFast(t){const s=this.o.spot;if(t<=this.now||!this.hs.length)return[s,s,s,s,s];const g=this.seg(t);if(!g)return this.hs[this.hs.length-1].q;return g.a.q.map((v,i)=>(1-g.w)*v+g.w*g.b.q[i])}
  requestDraw(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw()})}
  x(t){return this.L+(t-this.view.t0)/(this.view.t1-this.view.t0)*this.pw}
  tAt(x){return this.view.t0+(x-this.L)/this.pw*(this.view.t1-this.view.t0)}
  y(v){return this.T+(this.hi-v)/(this.hi-this.lo)*this.ph}
  vAt(y){return this.hi-(y-this.T)/this.ph*(this.hi-this.lo)}
  range(){// 보이는 것만으로 세로 범위: 과거(창 안) + 45일 이내 만기의 10~90% + 보이는 미래 캔들·닻
    const v=[],{t0,t1}=this.view;this.hist.forEach(h=>{if(h.t>=t0&&h.t<=t1)v.push(...(this.o.candles?[h.h,h.l]:[h.v]))});
    this.o.horizons.forEach(h=>{const t=Date.parse(h.t);if(t<t0||t>t1)return;const m=modeBin(h.bins);v.push((m.lo+m.hi)/2);if(t-this.now<=45*DAY)v.push(quantile(h.bins,.1),quantile(h.bins,.9))});
    this.future.forEach(c=>{if(c.t>=t0&&c.t<=t1)v.push(c.h,c.l)});
    if(this.o.spot!=null)v.push(this.o.spot);
    const a=v.filter(finite);if(!a.length){this.lo=0;this.hi=1;return}const lo=Math.min(...a),hi=Math.max(...a),p=(hi-lo)*.06||Math.abs(hi)*.01||1;this.lo=lo-p;this.hi=hi+p}
  draw(){const r=this.wrap.getBoundingClientRect(),d=devicePixelRatio||1;if(!r.width)return;this.w=r.width;this.h=r.height;const cw=Math.round(r.width*d),ch=Math.round(r.height*d);if(this.canvas.width!==cw||this.canvas.height!==ch){this.canvas.width=cw;this.canvas.height=ch}this.ctx.setTransform(d,0,0,d,0,0);
    this.L=6;this.T=8;this.pw=this.w-6-62;this.ph=this.h-8-34;this.range();
    const key=[this.view.t0,this.view.t1,this.lo,this.hi,cw,ch].join();
    if(key!==this.layerKey){// ★정적 층(격자·밀도·밴드)은 뷰가 바뀔 때만 다시 그린다 — 마우스 이동은 캔들·십자선만
      const o=this.layer||(this.layer=document.createElement('canvas'));if(o.width!==cw||o.height!==ch){o.width=cw;o.height=ch}const g=o.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cw,ch);g.setTransform(d,0,0,d,0,0);g.save();g.beginPath();g.rect(this.L,this.T,this.pw,this.ph);g.clip();this.gridLines(g);this.density(g);this.band(g);g.restore();this.layerKey=key}
    const c=this.ctx;c.clearRect(0,0,this.w,this.h);c.drawImage(this.layer,0,0,this.w,this.h);c.save();c.beginPath();c.rect(this.L,this.T,this.pw,this.ph);c.clip();this.historyDraw();this.futureDraw();this.marks();c.restore();this.axes();this.crosshair();this.legendText()}
  gridLines(c){c.strokeStyle=C.grid;c.lineWidth=1;for(let i=0;i<=5;i++){const y=Math.round(this.T+this.ph*i/5)+.5;c.beginPath();c.moveTo(this.L,y);c.lineTo(this.L+this.pw,y);c.stroke()}
    for(const t of this.ticks()){const x=Math.round(this.x(t))+.5;c.beginPath();c.moveTo(x,this.T);c.lineTo(x,this.T+this.ph);c.stroke()}
    const xn=this.x(this.now);c.setLineDash([4,4]);c.strokeStyle=C.cross;c.beginPath();c.moveTo(xn,this.T);c.lineTo(xn,this.T+this.ph);c.stroke();c.setLineDash([])}
  ticks(){// 눈금 간격: 라벨이 80px 이상 떨어지게
    const ppd=this.pw/((this.view.t1-this.view.t0)/DAY),step=[1,2,3,7,14,30,61,91,182].find(s=>s*ppd>=80)||365,out=[];const d0=new Date(this.view.t0);d0.setUTCHours(0,0,0,0);let t=d0.getTime();while(t<this.view.t1){if(t>=this.view.t0)out.push(t);t+=step*DAY}return out}
  density(g){const hs=this.hs;if(!hs.length)return;const x0=Math.max(this.L,Math.ceil(this.x(this.now))),x1=Math.min(this.L+this.pw,Math.floor(this.x(this.max)));const W=x1-x0;if(W<1)return;const S=2,cw=Math.ceil(W/S),ch=Math.ceil(this.ph/S),o=document.createElement('canvas');o.width=cw;o.height=ch;const oc=o.getContext('2d'),im=oc.createImageData(cw,ch),cols=[];let gmax=1e-12;
    for(let i=0;i<cw;i++){const sg=this.seg(this.tAt(x0+i*S));if(!sg)continue;const ds=new Float32Array(ch),fade=(sg.a.kind==='touch-approx'||sg.b.kind==='touch-approx')?.6:1;for(let j=0;j<ch;j++){const y=this.vAt(this.T+j*S),v=(1-sg.w)*this.dens(sg.a,y)+sg.w*this.dens(sg.b,y);ds[j]=v;if(v>gmax)gmax=v}cols.push({i,ds,fade})}
    // ★절대 비교: 전체 최대 밀도 기준 — 집중된 근일은 진하고, 퍼진 먼 만기는 연하게
    const D=im.data;for(const{i,ds,fade}of cols)for(let j=0;j<ch;j++){const v=ds[j];if(v>0){const k=(j*cw+i)*4;D[k]=245;D[k+1]=165;D[k+2]=36;D[k+3]=Math.round(.85*Math.sqrt(v/gmax)*fade*255)}}
    oc.putImageData(im,0,0);g.imageSmoothingEnabled=true;g.drawImage(o,0,0,cw,ch,x0,this.T,cw*S,ch*S)}
  band(g){if(this.o.small||!this.hs.length)return;const x0=Math.max(this.L,this.x(this.now)),x1=Math.min(this.L+this.pw,this.x(this.max));if(x1-x0<2)return;const S=2,n=Math.ceil((x1-x0)/S),Q=[];for(let i=0;i<=n;i++)Q.push(this.bandFast(this.tAt(x0+i*S)));const X=i=>x0+i*S;
    const fill=(a,b,col)=>{g.beginPath();Q.forEach((q,i)=>i?g.lineTo(X(i),this.y(q[a])):g.moveTo(X(0),this.y(q[a])));for(let i=n;i>=0;i--)g.lineTo(X(i),this.y(Q[i][b]));g.closePath();g.fillStyle=col;g.fill()};
    fill(4,0,'rgba(245,165,36,.07)');fill(3,1,'rgba(245,165,36,.11)');
    for(const[k,col,dash]of[[0,'rgba(245,165,36,.75)',[3,3]],[4,'rgba(245,165,36,.75)',[3,3]],[2,'rgba(245,165,36,.35)',[2,3]]]){g.beginPath();Q.forEach((q,i)=>i?g.lineTo(X(i),this.y(q[k])):g.moveTo(X(0),this.y(q[k])));g.strokeStyle=col;g.setLineDash(dash);g.lineWidth=1;g.stroke()}g.setLineDash([]);
    const e=this.bandFast(this.max);g.fillStyle=C.muted;g.font='10px system-ui';g.textAlign='right';g.fillText(`상한 90% ${fmt(e[4],this.o.decimals,this.o.unit)}`,x1-3,this.y(e[4])-4);g.fillText(`하한 10% ${fmt(e[0],this.o.decimals,this.o.unit)}`,x1-3,this.y(e[0])+12)}
  bodyW(){const ppd=this.pw/((this.view.t1-this.view.t0)/DAY);return Math.max(1,Math.min(14,Math.floor(ppd*.6)))}
  candle(x,k){const c=this.ctx,bw=this.bodyW(),up=k.c>=k.o;c.strokeStyle=c.fillStyle=up?C.up:C.down;c.lineWidth=1;c.beginPath();c.moveTo(Math.round(x)+.5,this.y(k.h));c.lineTo(Math.round(x)+.5,this.y(k.l));c.stroke();const y1=this.y(Math.max(k.o,k.c)),y2=this.y(Math.min(k.o,k.c));c.fillRect(Math.round(x-bw/2),y1,bw,Math.max(1,y2-y1))}
  historyDraw(){const c=this.ctx,{t0,t1}=this.view;if(!this.hist.length)return;if(!this.o.candles){c.strokeStyle='#aab3c4';c.lineWidth=1.2;c.beginPath();let s=false;this.hist.forEach(h=>{if(h.t<t0-DAY||h.t>t1+DAY)return;s?c.lineTo(this.x(h.t),this.y(h.v)):c.moveTo(this.x(h.t),this.y(h.v));s=true});c.stroke();return}this.hist.forEach(h=>{if(h.t>=t0-DAY&&h.t<=t1+DAY)this.candle(this.x(h.t),h)})}
  futureDraw(){const{t0,t1}=this.view;const c=this.ctx;c.save();c.strokeStyle='rgba(209,212,220,.13)';c.lineWidth=1;this.paths.forEach(p=>{c.beginPath();c.moveTo(this.x(this.now),this.y(this.o.spot));p.forEach(([t,v])=>c.lineTo(this.x(t),this.y(v)));c.stroke()});c.restore();this.future.forEach(k=>{if(k.t>=t0-DAY&&k.t<=t1+DAY)this.candle(this.x(k.t),k)})}
  marks(){// 만기마다 최빈값 점 + (간격이 넉넉할 때만) 라벨. 작은 패널은 현재값에서 점까지 얇은 점선.
    const c=this.ctx,hs=this.o.horizons;if(!hs.length)return;const xs=hs.map(h=>this.x(Date.parse(h.t))),lab=candleLabels(xs,80);
    if(this.o.small&&this.o.connect!==false){c.setLineDash([2,3]);c.strokeStyle='rgba(245,165,36,.6)';c.beginPath();c.moveTo(this.x(this.now),this.y(this.o.spot));hs.forEach((h,i)=>{const m=modeBin(h.bins);c.lineTo(xs[i],this.y((m.lo+m.hi)/2))});c.stroke();c.setLineDash([])}
    hs.forEach((h,i)=>{const m=modeBin(h.bins),mid=(m.lo+m.hi)/2;c.fillStyle=C.orange;c.beginPath();c.arc(xs[i],this.y(mid),3,0,Math.PI*2);c.fill();c.strokeStyle='#0b0e14';c.lineWidth=1;c.stroke();if(lab[i]&&xs[i]>this.L&&xs[i]<this.L+this.pw){c.fillStyle=C.text;c.font='10px system-ui';c.textAlign='center';c.fillText(`${fmt(m.lo,this.o.decimals,this.o.unit)}–${fmt(m.hi,this.o.decimals,this.o.unit)} · ${(m.p*100).toFixed(0)}%`,xs[i],Math.max(this.T+10,this.y(mid)-9))}})}
  axes(){const c=this.ctx;c.fillStyle='#0f1420';c.fillRect(this.L+this.pw,0,this.w-this.L-this.pw,this.h);c.fillRect(0,this.T+this.ph,this.w,this.h-this.T-this.ph);c.strokeStyle=C.axis;c.beginPath();c.moveTo(this.L+this.pw+.5,this.T);c.lineTo(this.L+this.pw+.5,this.T+this.ph);c.moveTo(this.L,this.T+this.ph+.5);c.lineTo(this.L+this.pw,this.T+this.ph+.5);c.stroke();
    c.fillStyle=C.muted;c.font='11px ui-monospace, Menlo, Consolas, monospace';c.textAlign='left';for(let i=0;i<=5;i++){const v=this.hi-(this.hi-this.lo)*i/5;c.fillText(fmt(v,this.o.decimals,this.o.unit),this.L+this.pw+6,this.T+this.ph*i/5+4)}
    c.textAlign='center';for(const t of this.ticks()){if(Math.abs(this.x(t)-this.x(this.now))<34)continue;const d=new Date(t);c.fillText(d.getUTCDate()===1||(this.view.t1-this.view.t0)>150*DAY?`${d.getUTCMonth()+1}월${d.getUTCDate()===1?'':' '+d.getUTCDate()+'일'}`:dateLabel(t),this.x(t),this.T+this.ph+14)}
    c.fillStyle=C.orange;c.fillText('지금',this.x(this.now),this.T+this.ph+14);
    const hs=this.o.horizons,xs=hs.map(h=>this.x(Date.parse(h.t))),ok=spacedLabels(xs,40);c.fillStyle=C.text;c.font='10px system-ui';hs.forEach((h,i)=>{if(ok[i]&&xs[i]>=this.L&&xs[i]<=this.L+this.pw)c.fillText(h.label+(h.low_liquidity?'*':''),xs[i],this.T+this.ph+28)});
    this.tag(this.o.spot,C.orange,'#111')}
  tag(v,bg,fg){if(!finite(v))return;const c=this.ctx,y=this.y(v);if(y<this.T||y>this.T+this.ph)return;const s=fmtFull(v,this.o.decimals);c.font='10px ui-monospace, Menlo, Consolas, monospace';const w=c.measureText(s).width+8;c.fillStyle=bg;c.fillRect(this.L+this.pw+1,y-8,Math.max(w,this.w-this.L-this.pw-2),16);c.fillStyle=fg;c.textAlign='left';c.fillText(s,this.L+this.pw+5,y+4)}
  crosshair(){if(!this.cross)return;const c=this.ctx,{x,y}=this.cross;c.save();c.setLineDash([3,3]);c.strokeStyle=C.cross;c.beginPath();c.moveTo(this.L,y+.5);c.lineTo(this.L+this.pw,y+.5);c.moveTo(x+.5,this.T);c.lineTo(x+.5,this.T+this.ph);c.stroke();c.restore();this.tag(this.vAt(y),'#3a4250','#fff')}
  nearestCandle(t){const all=this.o.candles?this.hist.concat(this.future):[];if(!all.length)return null;return all.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a)}
  legendText(){if(!this.o.candles){this.legend.textContent='';return}const k=this.cross?this.nearestCandle(this.tAt(this.cross.x)):this.hist[this.hist.length-1];if(!k){this.legend.textContent='';return}const fut=k.t>this.now,col=k.c>=k.o?C.up:C.down,d=this.o.decimals;this.legend.innerHTML=`<span class="lg-t">${this.o.title} · 1D${fut?' · <em>예시 경로(중앙값 닻)</em>':''} · ${dateLabel(k.t)}</span> <span style="color:${col}">O ${fmtFull(k.o,d)} H ${fmtFull(k.h,d)} L ${fmtFull(k.l,d)} C ${fmtFull(k.c,d)}</span>`}
  move(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    if(this.drag&&e.buttons){const dt=(this.drag.x-e.clientX)/this.pw*(this.drag.t1-this.drag.t0);this.view={t0:this.drag.t0+dt,t1:this.drag.t1+dt};this.cross={x,y};this.requestDraw();return}
    if(x<this.L||x>this.L+this.pw||y<this.T||y>this.T+this.ph){this.cross=null;this.tip.style.display='none';this.requestDraw();return}
    this.cross={x,y};const t=this.tAt(x),v=this.vAt(y);let html='';
    if(t>this.now&&this.o.horizons.length){const h=this.o.horizons.reduce((a,b)=>Math.abs(Date.parse(b.t)-t)<Math.abs(Date.parse(a.t)-t)?b:a),b=closeBins(h.bins).find(z=>v>=z.lo&&v<=z.hi),d=this.o.decimals,u=this.o.unit;html=`<b>${h.label} 만기</b> · ${h.source}${h.kind==='touch-approx'?' · 도달근사':''}<br>${b?`${fmt(b.lo,d,u)}–${fmt(b.hi,d,u)} 구간: ${(b.p*100).toFixed(1)}%`:'구간 밖'}<br>P(만기 &lt; ${fmt(v,d,u)}) ${(cdfAt(h.bins,v)*100).toFixed(1)}%`}
    else if(!this.o.candles&&this.hist.length){const k=this.hist.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a);html=`${dateLabel(k.t)} · ${fmtFull(k.v,this.o.decimals)}`}
    if(html){this.tip.innerHTML=html;this.tip.style.display='block';this.tip.style.left=Math.min(this.w-230,x+12)+'px';this.tip.style.top=Math.min(this.h-70,y+10)+'px'}else this.tip.style.display='none';
    this.requestDraw()}
}

// ---------- 데이터 ----------
async function candles(){try{const r=await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=60');if(!r.ok)throw 0;return(await r.json()).map(x=>[x[0],+x[1],+x[2],+x[3],+x[4]])}catch(_){try{const r=await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440');const d=await r.json(),k=Object.values(d.result).find(Array.isArray)||[];return k.slice(-60).map(x=>[x[0]*1000,+x[1],+x[2],+x[3],+x[4]])}catch(__){return[]}}}
// ---------- 도달 확률 표: 네 표의 「현재」 구분선 높이를 맞추고, 확률을 막대로 ----------
function touchTable(p,spot,d,u){const tables=selectTouchTables(p.touch).map(t=>{const lv=(t.levels||[]).filter(z=>z.p>.002&&z.p<.995);const up=lv.filter(z=>z.dir==='up'&&z.price>spot).sort((a,b)=>a.price-b.price).slice(0,10).sort((a,b)=>b.price-a.price),dn=lv.filter(z=>z.dir==='down'&&z.price<spot).sort((a,b)=>b.price-a.price).slice(0,10);return{t,up,dn}});
  const nUp=Math.max(0,...tables.map(x=>x.up.length)),nDn=Math.max(0,...tables.map(x=>x.dn.length));
  const row=(z,cls)=>`<div class="touchrow ${cls}"><span class="lv">${cls==='up'?'↑':'↓'} ${fmt(z.price,d,u)}</span><span class="bar"><i style="width:${Math.min(100,z.p*100).toFixed(1)}%"></i></span><b>${(z.p*100).toFixed(1)}%</b></div>`,empty='<div class="touchrow empty"></div>';
  return`<div class="touch-grid">${tables.map(({t,up,dn})=>`<div class="touchbox"><h3>${t.label} 도달 확률</h3>${empty.repeat(nUp-up.length)}${up.map(z=>row(z,'up')).join('')}<div class="touch-divider">현재 ${fmt(spot,d,u)}</div>${dn.map(z=>row(z,'down')).join('')}${empty.repeat(nDn-dn.length)}</div>`).join('')}</div>`}
async function boot(){try{const d=await(await fetch(DATA_URL+'?t='+Date.now())).json(),now=Date.now(),p=d.panels.BTC,e=document.querySelector('#btc-panel'),hs=selectHorizons(p.horizons,now,d.generated_at,'BTC'),ag=document.querySelector('#data-age');
    if(ag){const m=Math.max(0,Math.round((now-Date.parse(d.generated_at))/60000));ag.textContent=`데이터 ${m}분 전 · 10분마다 갱신`;if(m>60)ag.classList.add('warn')}
    const hist=await candles(),spot=hist.length?hist[hist.length-1][4]:d.spot.BTC;
    new Chart(e,{title:'BTC/USD',spot,unit:'USD',decimals:0,horizons:hs,history:hist,candles:true,generatedAt:d.generated_at});
    e.insertAdjacentHTML('beforeend',touchTable(p,spot,0,'USD'));
    for(const[k,t]of[['FED','기준금리'],['USDKRW','USD/KRW'],['USDJPY','USD/JPY'],['EURUSD','EUR/USD']]){try{const el=document.createElement('section'),q=d.panels[k];el.className='panel small';document.querySelector('#small-grid').append(el);const sh=selectHorizons(q.horizons,now,d.generated_at,k).slice(0,6);if(!finite(d.spot[k])){el.innerHTML=`<div class="panel-head"><h2>${t}</h2></div><p class="muted">현물값 없음</p>`;continue}if(!sh.length){el.innerHTML=`<div class="panel-head"><h2>${t}</h2><span class="spot">${fmt(d.spot[k],q.decimals,q.unit)}</span></div><p class="muted">예측시장 없음</p>`;continue}new Chart(el,{title:t,spot:d.spot[k],unit:q.unit,decimals:q.decimals,horizons:sh,history:(d.history[k]||[]).slice(-60),small:true,connect:k!=='FED',generatedAt:d.generated_at});
      if(k==='FED'&&q.decision&&q.decision.length){const ko={'No change':'동결','25 bps increase':'+25bp','25 bps decrease':'−25bp','50+ bps increase':'+50bp+','50+ bps decrease':'−50bp+','Cut 25bps':'−25bp','Cut >25bps':'−50bp+','Hike 25bps':'+25bp','Hike >25bps':'+50bp+','Fed maintains rate':'동결'};el.insertAdjacentHTML('beforeend',`<p class="muted small-note">${q.decision.filter(x=>x.source==='polymarket').slice(0,2).map(x=>`${x.label} FOMC: ${x.items.filter(i=>i.p>=.01).map(i=>`${ko[i.name]||i.name} ${(i.p*100).toFixed(0)}%`).join(' · ')}`).join('<br>')}</p>`)}}catch(err){console.error(k,err)}}
  }catch(e){console.error(e);const el=document.querySelector('#btc-panel');if(el)el.innerHTML='<p class="muted">데이터를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>'}}
if(typeof document!=='undefined')boot();
if(typeof module!=='undefined')module.exports={closeBins,densityAt,cdfAt,quantile,interpolateDensity,modeBin,selectHorizons,logTimeRatio,logTimeX,chartRange,columnAlphas,spacedLabels,candleLabels,selectTouchTables,binSum,bandAt,futureCandles,realizedVol};
