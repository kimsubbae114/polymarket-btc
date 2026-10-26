# -*- coding: utf-8 -*-
"""백테스트 자료 수집(미국 러너 전용 — 한국에선 폴리마켓 451).
1) 정산 끝난 BTC 가격 시장(구간·문턱·도달) 목록 + 정산 결과
2) 각 시장 YES 토큰의 일별 가격 이력(clob prices-history)
3) 지금 열린 BTC 가격 시장의 호가창(스프레드·잔량) — 만기 거리별 체결 비용 모형용
결과: research/out/pm_hist.json (한 파일)"""
import json, os, re, sys, time, urllib.request, datetime as dt
UA={'User-Agent':'Mozilla/5.0 (research backtest)','Accept':'application/json'}
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'); os.makedirs(OUT,exist_ok=True)
PAT=re.compile(r'^(bitcoin-above-on-|bitcoin-price-on-|what-price-will-bitcoin-hit-|bitcoin-above-.*-on-)')
def get(url,tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=40) as r: return json.loads(r.read().decode())
        except Exception as e:
            if i==tries-1: print('FAIL',url[:120],e,file=sys.stderr); return None
            time.sleep(1.5*(i+1))
def events(closed):
    out=[];seen=set()
    for off in range(0,6000,100):
        d=get('https://gamma-api.polymarket.com/events?tag_slug=bitcoin&closed=%s&limit=100&offset=%d&order=endDate&ascending=false'%('true' if closed else 'false',off))
        if not d: break
        new=0
        for e in d:
            s=e.get('slug','')
            if e.get('id') in seen: continue
            seen.add(e.get('id'));new+=1
            if PAT.match(s): out.append(e)
        if new==0: break
        time.sleep(.15)
    return out
def slim_market(m):
    try: tok=json.loads(m.get('clobTokenIds') or '[]')
    except Exception: tok=[]
    try: px=[float(x) for x in json.loads(m.get('outcomePrices') or '[]')]
    except Exception: px=[]
    return {'id':m.get('id'),'q':m.get('question'),'title':m.get('groupItemTitle'),'yes':tok[0] if tok else None,'final':px,
            'start':m.get('startDate') or m.get('createdAt'),'end':m.get('endDate'),'vol':m.get('volumeNum') or m.get('volume'),'closed':m.get('closed')}
def main():
    t0=time.time();res={'fetched_at':dt.datetime.utcnow().isoformat()+'Z','closed':[],'open_books':[]}
    cl=events(True);print('closed price events',len(cl))
    for e in cl:
        ms=[slim_market(m) for m in e.get('markets',[])]
        for m in ms:
            if not m['yes']: continue
            h=get('https://clob.polymarket.com/prices-history?market=%s&interval=max&fidelity=1440'%m['yes'])
            m['hist']=[[p['t'],p['p']] for p in (h or {}).get('history',[])]
            time.sleep(.08)
        res['closed'].append({'slug':e.get('slug'),'title':e.get('title'),'start':e.get('startDate'),'end':e.get('endDate'),'markets':ms})
        if time.time()-t0>4.5*3600: print('time cap');break
    op=events(False);print('open price events',len(op))
    for e in op:
        for m in e.get('markets',[]):
            sm=slim_market(m)
            if not sm['yes']: continue
            b=get('https://clob.polymarket.com/book?token_id=%s'%sm['yes']) or {}
            sm['bids']=[[float(x['price']),float(x['size'])] for x in b.get('bids',[])]
            sm['asks']=[[float(x['price']),float(x['size'])] for x in b.get('asks',[])]
            sm['event']=e.get('slug');res['open_books'].append(sm);time.sleep(.08)
    with open(os.path.join(OUT,'pm_hist.json'),'w',encoding='utf-8') as f: json.dump(res,f,ensure_ascii=False,separators=(',',':'))
    n=sum(len(e['markets']) for e in res['closed']);print('done markets',n,'books',len(res['open_books']),'sec',int(time.time()-t0))
if __name__=='__main__': main()
