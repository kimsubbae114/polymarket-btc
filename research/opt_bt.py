# -*- coding: utf-8 -*-
"""민수님 가설 백테스트 — 옵션편 (Deribit, 이 PC 에서 실행 가능)

가설(2026-10-27 민수님): 먼 만기일수록 시장은 가격이 위/아래로 크게 움직일 확률을 높게 매기지만,
  실제로는 '지금 가격 근처'에 머무를 확률이 가장 높다 → 현재가 근처에 거는 쪽이 이긴다.

★사전 등록(결과 보기 전에 고정, 바꾸면 기록):
  진입: 2023-06-02 부터 매주 금요일 08:00 UTC(=Deribit 정산 시각). 만기까지 보유, 중간 청산 없음.
  기간(목표 일수): 7, 30, 60, 90, 180. 각 진입일에 목표에 가장 가까운 실제 만기(차이 ≤ 목표의 40%).
  전략 A 「가운데에 건다」= 콜 버터플라이 K0−w, K0, K0+w (K0 = 현물에 가장 가까운 행사가, w ≈ 밴드 b×현물, 양쪽 행사가가 상장돼 있어야 함).
       → 폴리마켓 '현재가가 든 구간 YES 매수'와 같은 모양(손실 한정).
  전략 B 「양끝을 판다」= 숏 스트랭글 콜 K+ ≈ S(1+b), 풋 K− ≈ S(1−b). (손실 무한 — 참고용)
  밴드 b: 5%, 10%, 20%.
  가격: 진입 ±24시간 안 체결들의 mark_price 중앙값(BTC) × 그때 지수 → 달러 중간값. 체결 없는 다리가 있으면 그 진입은 결측.
  비용(실측): 같은 체결들에서 |체결가 − mark| 중앙값 = 당시 실제 반스프레드(테이커가 낸 값) + 수수료
       (거래 0.03%×지수, 옵션값의 12.5% 상한) + 정산 수수료 0.015%(내가격 다리, 12.5% 상한).
  정산: Deribit btc_usd 정산가(만기일).
  판정 지표: 기대값(비용 후, 1세트당 $, 비용 대비 %), 시장 내재 확률 vs 실제 적중률, 겹치지 않는 표본(간격 ≥ 기간)으로 t값.
결과: research/out/opt_bt.json + 표 출력."""
import json, os, sys, time, math, statistics as st, urllib.request, datetime as dt
D=86400000; OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'); CACHE=os.path.join(OUT,'deribit_cache'); os.makedirs(CACHE,exist_ok=True)
H='https://history.deribit.com/api/v2/public/'; M='https://www.deribit.com/api/v2/public/'
TENORS=[7,30,60,90,180]; BANDS=[.05,.10,.20]; START=dt.datetime(2023,6,2,8,tzinfo=dt.timezone.utc)
def get(url,key=None):
    if key:
        p=os.path.join(CACHE,key+'.json')
        if os.path.exists(p):
            with open(p,encoding='utf-8') as f: return json.load(f)
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'research'}),timeout=60) as r: j=json.loads(r.read().decode())
            break
        except Exception as e:
            if i==3: print('FAIL',url[:110],e,file=sys.stderr); return None
            time.sleep(2*(i+1))
    time.sleep(.06)
    if key and j is not None:
        with open(os.path.join(CACHE,key+'.json'),'w',encoding='utf-8') as f: json.dump(j,f)
    return j
def deliveries():
    out={};off=0
    while True:
        j=get(M+'get_delivery_prices?index_name=btc_usd&offset=%d&count=100'%off,'deliv100_%d'%off)
        rows=(j or {}).get('result',{}).get('data',[])
        for r in rows: out[r['date']]=r['delivery_price']
        if len(rows)<100 or off>4000: break   # API 는 한 번에 100개까지
        off+=100
    return out
def instruments():
    j=get(H+'get_instruments?currency=BTC&kind=option&expired=true','instruments_expired')
    by={}
    for x in (j or {}).get('result',[]):
        e=by.setdefault(x['expiration_timestamp'],{'C':set(),'P':set(),'born':x['creation_timestamp']})
        e['C' if x['option_type']=='call' else 'P'].add(x['strike']);e['born']=min(e['born'],x['creation_timestamp'])
    return by
def name(exp_ms,K,cp):
    d=dt.datetime.fromtimestamp(exp_ms/1000,dt.timezone.utc);mon=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.month-1]
    k=int(K) if float(K).is_integer() else K
    return 'BTC-%d%s%02d-%s-%s'%(d.day,mon,d.year%100,k,cp)
def quote(inst,t):
    """진입 시각 ±24h 체결 → (mark 중앙값 BTC, 지수 중앙값, 반스프레드 BTC 중앙값, 체결 수)"""
    j=get(H+'get_last_trades_by_instrument_and_time?instrument_name=%s&start_timestamp=%d&end_timestamp=%d&count=200&sorting=asc'%(inst,t-D,t+D),'tr_%s_%d'%(inst,t))
    tr=(j or {}).get('result',{}).get('trades',[])
    if not tr: return None
    mk=[x['mark_price'] for x in tr if x.get('mark_price') is not None];ix=[x['index_price'] for x in tr if x.get('index_price')]
    hs=[abs(x['price']-x['mark_price']) for x in tr if x.get('mark_price') is not None]
    if not mk or not ix: return None
    return st.median(mk),st.median(ix),st.median(hs),len(tr)
def fee_trade(opt_usd,S): return min(.0003*S,.125*opt_usd)
def fee_deliv(payoff_usd,S): return min(.00015*S,.125*payoff_usd) if payoff_usd>0 else 0
def nearest(ks,x): return min(ks,key=lambda k:abs(k-x)) if ks else None
def main():
    dl=deliveries();ins=instruments();exps=sorted(e for e in ins if dt.datetime.fromtimestamp(e/1000,dt.timezone.utc).strftime('%Y-%m-%d') in dl)
    print('deliveries',len(dl),'expiries with settlement',len(exps))
    now=dt.datetime.now(dt.timezone.utc);rows=[];t=START
    while t<now:
        tms=int(t.timestamp()*1000);S=dl.get(t.strftime('%Y-%m-%d'))
        if S:
            for h in TENORS:
                tgt=tms+h*D;cand=[e for e in exps if e>tms+D and abs(e-tgt)<=.4*h*D and ins[e]['born']<=tms-D]  # 진입일에 이미 상장돼 있던 만기만(사후 정보 금지)
                if not cand: continue
                E=min(cand,key=lambda e:abs(e-tgt));ST=dl[dt.datetime.fromtimestamp(E/1000,dt.timezone.utc).strftime('%Y-%m-%d')];days=(E-tms)/D
                calls=sorted(ins[E]['C']);puts=sorted(ins[E]['P']);K0=nearest(calls,S)
                for b in BANDS:
                    # A: 버터플라이
                    ws=[k-K0 for k in calls if k>K0 and (2*K0-k) in ins[E]['C']]
                    if ws:
                        w=min(ws,key=lambda x:abs(x-b*S));legs=[(K0-w,1),(K0,-2),(K0+w,1)];q=[quote(name(E,k,'C'),tms) for k,_ in legs]
                        if all(q):
                            ix=st.median([x[1] for x in q]);mid=sum(n*x[0]*x[1] for (k,n),x in zip(legs,q));hs=sum(abs(n)*x[2]*x[1] for (k,n),x in zip(legs,q))
                            fee=sum(abs(n)*fee_trade(x[0]*x[1],ix) for (k,n),x in zip(legs,q));pay=sum(n*max(ST-k,0) for k,n in legs)
                            dfee=sum(abs(n)*fee_deliv(max(ST-k,0),ST) for k,n in legs)
                            rows.append({'s':'A','t':tms,'h':h,'days':days,'b':b,'S':S,'ST':ST,'K0':K0,'w':w,'mid':mid,'hs':hs,'fee':fee+dfee,'pay':pay,'implied':mid/w,'hit':pay/w})
                    # B: 숏 스트랭글
                    Kc=nearest([k for k in calls if k>S],S*(1+b));Kp=nearest([k for k in puts if k<S],S*(1-b))
                    if Kc and Kp:
                        qc=quote(name(E,Kc,'C'),tms);qp=quote(name(E,Kp,'P'),tms)
                        if qc and qp:
                            ix=(qc[1]+qp[1])/2;prem=qc[0]*qc[1]+qp[0]*qp[1];hs=qc[2]*qc[1]+qp[2]*qp[1];fee=fee_trade(qc[0]*qc[1],ix)+fee_trade(qp[0]*qp[1],ix)
                            loss=max(ST-Kc,0)+max(Kp-ST,0);dfee=fee_deliv(max(ST-Kc,0),ST)+fee_deliv(max(Kp-ST,0),ST)
                            rows.append({'s':'B','t':tms,'h':h,'days':days,'b':b,'S':S,'ST':ST,'Kc':Kc,'Kp':Kp,'prem':prem,'hs':hs,'fee':fee+dfee,'loss':loss})
        t+=dt.timedelta(days=7)
    with open(os.path.join(OUT,'opt_bt.json'),'w',encoding='utf-8') as f: json.dump(rows,f)
    print('rows',len(rows))
if __name__=='__main__': main()
