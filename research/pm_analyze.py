# -*- coding: utf-8 -*-
"""민수님 가설 백테스트 — 폴리마켓편. 입력 research/out/pm_hist.json(미국 러너) + 바이낸스 1시간봉(이 PC).
★사전 등록:
  진입: 각 시장 만기 7·5·3·2·1일 전(그 시각 직전 1시간 안의 가격이 있을 때만). 만기까지 보유.
  A 구간 시장: 진입 시 현물이 든 구간 YES 1주 매수 / A3: 그 구간 + 양옆 구간 1주씩.
  B 문턱 시장(○일 ○달러 위): 현물 ±b 밖 문턱에 '안 간다' 쪽 1주(위 문턱은 NO, 아래 문턱은 YES). b = 3%, 5%, 10%.
  C 월간 도달 시장: 월초 +3일 진입, 현물 ±b 밖 도달 단계에 NO 1주. b = 5%, 10%, 20%.
  비용: 지금 열린 같은 종류 시장 호가창에서 (만기까지 남은 날, 가격대)별 반스프레드 중앙값 + 주문 $100·$1,000 을 호가 따라 채울 때 추가 슬리피지. 수수료 0 가정(표시).
  지표: 시장 확률 vs 실제, 합계 수익률(총 정산금/총 매수금 −1), 진입별 독립 묶음(같은 시장 여러 진입은 시장 단위로 묶어 t값)."""
import json, os, re, math, statistics as st, sys, time, urllib.request, datetime as dt, bisect
sys.stdout.reconfigure(encoding='utf-8')
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'); P=json.load(open(os.path.join(OUT,'pm_hist.json'),encoding='utf-8'))
def klines():
    p=os.path.join(OUT,'btc_1h.json')
    if os.path.exists(p): return json.load(open(p))
    out=[];t=int(dt.datetime(2024,12,20,tzinfo=dt.timezone.utc).timestamp()*1000);end=int(time.time()*1000)
    while t<end:
        k=json.loads(urllib.request.urlopen('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=%d'%t,timeout=30).read())
        if not k: break
        out+=[[x[0]//1000,float(x[4])] for x in k];t=k[-1][0]+3600000;time.sleep(.2)
    json.dump(out,open(p,'w'));return out
K=klines();KT=[x[0] for x in K]
def spot(ts):
    i=bisect.bisect_right(KT,ts)-1;return K[i][1] if i>=0 and ts-KT[i]<7200 else None
num=lambda s:float(s.replace(',','').replace('$','').replace('k','000')) if s else None
def parse_title(t):
    t=(t or '').replace('$','').replace(' ','')
    m=re.match(r'^<([\d,\.k]+)$',t)
    if m: return (None,num(m.group(1)))
    m=re.match(r'^>([\d,\.k]+)$',t)
    if m: return (num(m.group(1)),None)
    m=re.match(r'^([\d,\.k]+)-([\d,\.k]+)$',t)
    if m: return (num(m.group(1)),num(m.group(2)))
    m=re.match(r'^[↑↓]?([\d,\.k]+)$',t)
    if m: return num(m.group(1))
    return None
def px_at(hist,ts):
    best=None
    for t,p in hist or []:
        if t<=ts and ts-t<=3600: best=p
    return best
def yes_won(m): return len(m.get('final') or [])==2 and m['final'][0]>.5
def ts_of(s): return int(dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp())
# ── 비용 모형: 지금 열린 호가창
def book_cost(books):
    rows=[]
    now=time.time()
    for b in books:
        if not b['bids'] or not b['asks'] or not b.get('end'): continue
        bid=max(p for p,q in b['bids']);ask=min(p for p,q in b['asks']);mid=(bid+ask)/2;days=(ts_of(b['end'])-ts_of(P['fetched_at']))/86400
        def fill(usd):
            left=usd;cost=0;sh=0
            for p,q in sorted(b['asks']):
                take=min(q,left/p);cost+=take*p;sh+=take;left-=take*p
                if left<=1e-9: break
            return (cost/sh-ask) if sh and left<=1e-6 else None
        rows.append(dict(kind='touch' if 'hit' in b['event'] else 'above' if 'above' in b['event'] else 'bracket',days=days,mid=mid,half=(ask-bid)/2,s100=fill(100),s1000=fill(1000)))
    return rows
BC=book_cost(P['open_books'])
def cost_for(kind,days,p,size):
    band=lambda x:0 if x<.1 else 1 if x<.3 else 2 if x<.7 else 3
    c=[r for r in BC if r['kind']==kind and band(r['mid'])==band(p) and abs(r['days']-days)<=max(1.5,days*.5)] or [r for r in BC if r['kind']==kind and band(r['mid'])==band(p)] or [r for r in BC if r['kind']==kind]
    if not c: return .01,None
    half=st.median(r['half'] for r in c);sl=[r['s%d'%size] for r in c if r['s%d'%size] is not None]
    return half+(st.median(sl) if sl else 0),(len(sl)/len(c))
print('== 비용 모형(지금 호가창, 반스프레드 중앙값 · $100/$1000 채울 때 추가 슬리피지 · 다 채워지는 비율)')
for kind in ['bracket','above','touch']:
    for lo,hi in [(0,2),(2,4),(4,8),(8,40)]:
        c=[r for r in BC if r['kind']==kind and lo<=r['days']<hi]
        if not c: continue
        f=lambda k:[r[k] for r in c if r[k] is not None]
        print('%-7s %2d~%2d일 N=%3d 반스프레드 %.3f · $100 +%.3f(%3.0f%%) · $1000 +%.3f(%3.0f%%)'%(kind,lo,hi,len(c),st.median(f('half')),st.median(f('s100')) if f('s100') else float('nan'),100*len(f('s100'))/len(c),st.median(f('s1000')) if f('s1000') else float('nan'),100*len(f('s1000'))/len(c)))
# ── 백테스트
def run():
    T=[]
    for e in P['events']:
        if not e.get('end'): continue
        end=ts_of(e['end'])
        if e['kind']=='touch_month':
            entries=[(ts_of(e['start'])+3*86400 if e.get('start') else end-27*86400)]
        else:
            entries=[end-h*86400 for h in (7,5,3,2,1)]
        for t in entries:
            S=spot(t)
            if not S: continue
            days=(end-t)/86400
            for m in e['markets']:
                pr=parse_title(m.get('title'));p=px_at(m.get('hist'),t)
                if pr is None or p is None or not m.get('final'): continue
                T.append(dict(ev=e['slug'],kind=e['kind'],t=t,days=days,S=S,rng=pr,p=p,won=yes_won(m),dir=('down' if '↓' in (m.get('title') or '') else 'up')))
    return T
T=run();print('\n진입 기록',len(T),'시장 종류',{k:sum(1 for x in T if x['kind']==k) for k in ('bracket','above','touch_month')})
def agg(rows,label,size=100):
    if not rows: print(label,'표본 없음');return None
    pay=sum(r['pay'] for r in rows);cg=sum(r['price'] for r in rows);cn=sum(r['price_n'] for r in rows)
    ev={}
    for r in rows: ev.setdefault(r['ev'],[]).append(r['pay']-r['price_n'])
    per=[sum(v)/len(v) for v in ev.values()];t=st.mean(per)/(st.stdev(per)/math.sqrt(len(per))) if len(per)>2 and st.stdev(per)>0 else float('nan')
    imp=st.mean(r['imp'] for r in rows);real=st.mean(r['pay'] for r in rows)
    print('%-34s N=%4d 시장%3d  시장확률 %5.1f%% 실제 %5.1f%%  수익률 비용전 %+6.1f%% 비용후($%d) %+6.1f%%  t=%5.2f'%(label,len(rows),len(per),imp*100,real*100,(pay/cg-1)*100,size,(pay/cn-1)*100,t))
    return dict(label=label,n=len(rows),markets=len(per),imp=imp,real=real,ret_gross=pay/cg-1,ret_net=pay/cn-1,t=t)
res=[]
for size in (100,1000):
    print('\n── 주문 $%d 기준'%size)
    for lo,hi in [(0,1.5),(1.5,2.5),(2.5,4),(4,6),(6,8)]:
        # A: 현물 든 구간
        rows=[];rows3=[]
        for evn in {x['ev'] for x in T if x['kind']=='bracket'}:
            for t in {x['t'] for x in T if x['ev']==evn}:
                g=sorted([x for x in T if x['ev']==evn and x['t']==t and isinstance(x['rng'],tuple)],key=lambda x:(x['rng'][0] or -1e18))
                if not g or not (lo<=g[0]['days']<hi): continue
                S=g[0]['S'];idx=[i for i,x in enumerate(g) if (x['rng'][0] is None or x['rng'][0]<=S) and (x['rng'][1] is None or S<x['rng'][1])]
                if not idx: continue
                i=idx[0]
                for j,dst in [(i,rows),(i-1,rows3),(i,rows3),(i+1,rows3)]:
                    if 0<=j<len(g):
                        x=g[j];c,_=cost_for('bracket',x['days'],x['p'],size);dst.append(dict(ev=evn,price=x['p'],price_n=min(.999,x['p']+c),pay=1.0 if x['won'] else 0.0,imp=x['p']))
        res.append(agg(rows,'A 구간 현물칸 %.1f~%.1f일'%(lo,hi),size));res.append(agg(rows3,'A3 현물칸+양옆 %.1f~%.1f일'%(lo,hi),size))
        for b in (.03,.05,.10):
            rows=[]
            for x in T:
                if x['kind']!='above' or not (lo<=x['days']<hi) or isinstance(x['rng'],tuple): continue
                X=x['rng'];S=x['S']
                if X>=S*(1+b): q=1-x['p'];win=not x['won']
                elif X<=S*(1-b): q=x['p'];win=x['won']
                else: continue
                c,_=cost_for('above',x['days'],q,size);rows.append(dict(ev=x['ev'],price=q,price_n=min(.999,q+c),pay=1.0 if win else 0.0,imp=q))
            res.append(agg(rows,'B 문턱 ±%d%% 밖 안간다 %.1f~%.1f일'%(b*100,lo,hi),size))
    for b in (.05,.10,.20):
        rows=[]
        for x in T:
            if x['kind']!='touch_month' or isinstance(x['rng'],tuple): continue
            X=x['rng'];S=x['S']
            if (x['dir']=='up' and X>=S*(1+b)) or (x['dir']=='down' and X<=S*(1-b)):
                q=1-x['p'];c,_=cost_for('touch',x['days'],q,size);rows.append(dict(ev=x['ev'],price=q,price_n=min(.999,q+c),pay=0.0 if x['won'] else 1.0,imp=q))
        res.append(agg(rows,'C 월간 도달 ±%d%% 밖 NO'%(b*100),size))
json.dump([r for r in res if r],open(os.path.join(OUT,'pm_summary.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
