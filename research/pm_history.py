# -*- coding: utf-8 -*-
"""백테스트 자료 수집(미국 러너 전용 — 한국에선 폴리마켓 451). v2: 시장 이름을 날짜로 직접 찍어 받는다
(v1 은 최근순 목록이 매시간 시장으로 꽉 차서 먼 만기가 하나도 안 잡혔다).
1) 날마다 생기는 BTC 가격 시장: bitcoin-above-on-<월>-<일>[-<연>], bitcoin-price-on-<월>-<일>[-<연>]  (만기 ≤ 약 7일)
2) 월간 도달 시장: what-price-will-bitcoin-hit-in-<월>[-<연>]
3) 각 시장 YES 토큰의 1시간 가격 이력, 정산 결과
4) 지금 열린 BTC 가격 시장의 호가창 — 만기 거리별 체결 비용 모형
결과: research/out/pm_hist.json"""
import json, os, sys, time, urllib.request, datetime as dt
UA={'User-Agent':'Mozilla/5.0 (research backtest)','Accept':'application/json'}
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'); os.makedirs(OUT,exist_ok=True)
MON=['january','february','march','april','may','june','july','august','september','october','november','december']
START=dt.date(2025,1,1)
def get(url,tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=40) as r: return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (404,400): return None
            if i==tries-1: print('FAIL',url[:120],e,file=sys.stderr); return None
            time.sleep(2*(i+1))
        except Exception as e:
            if i==tries-1: print('FAIL',url[:120],e,file=sys.stderr); return None
            time.sleep(2*(i+1))
def event(slug):
    d=get('https://gamma-api.polymarket.com/events?slug=%s'%slug);time.sleep(.05)
    return d[0] if isinstance(d,list) and d else None
def ts(s):
    try: return int(dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp())
    except Exception: return None
def slim(m,e):
    try: tok=json.loads(m.get('clobTokenIds') or '[]')
    except Exception: tok=[]
    try: px=[float(x) for x in json.loads(m.get('outcomePrices') or '[]')]
    except Exception: px=[]
    out={'title':m.get('groupItemTitle'),'q':m.get('question'),'final':px,'vol':m.get('volumeNum'),'yes':tok[0] if tok else None}
    a=ts(m.get('startDate') or e.get('startDate') or m.get('createdAt'));b=ts(m.get('endDate') or e.get('endDate'))
    if out['yes'] and a and b:
        h=get('https://clob.polymarket.com/prices-history?market=%s&startTs=%d&endTs=%d&fidelity=60'%(out['yes'],a-3600,b+3600)) or {}
        out['hist']=[[p['t'],p['p']] for p in h.get('history',[])];time.sleep(.04)
    return out
def grab(slugs,kind,res,seen):
    for s in slugs:
        if s in seen: continue
        e=event(s)
        if not e: continue
        seen.add(s);res['events'].append({'slug':s,'kind':kind,'start':e.get('startDate'),'end':e.get('endDate'),'markets':[slim(m,e) for m in e.get('markets',[])]})
        return True
    return False
def main():
    t0=time.time();res={'fetched_at':dt.datetime.utcnow().isoformat()+'Z','events':[],'open_books':[]};seen=set()
    d=START;today=dt.date.today()
    while d<today and time.time()-t0<4.3*3600:
        md='%s-%d'%(MON[d.month-1],d.day)
        grab(['bitcoin-above-on-%s-%d'%(md,d.year),'bitcoin-above-on-%s'%md],'above',res,seen)
        grab(['bitcoin-price-on-%s-%d'%(md,d.year),'bitcoin-price-on-%s'%md],'bracket',res,seen)
        if d.day==1: grab(['what-price-will-bitcoin-hit-in-%s-%d'%(MON[d.month-1],d.year),'what-price-will-bitcoin-hit-in-%s'%MON[d.month-1]],'touch_month',res,seen)
        if d.day==1: print(d,'events',len(res['events']),'sec',int(time.time()-t0),flush=True)
        d+=dt.timedelta(days=1)
    # 지금 열린 시장 호가창(비용 모형)
    for off in (0,100,200):
        evs=get('https://gamma-api.polymarket.com/events?tag_slug=bitcoin&closed=false&limit=100&offset=%d'%off) or []
        for e in evs:
            s=e.get('slug','')
            if not (s.startswith('bitcoin-above-on-') or s.startswith('bitcoin-price-on-') or s.startswith('what-price-will-bitcoin-hit')): continue
            if s.endswith('-et'): continue
            for m in e.get('markets',[]):
                try: tok=json.loads(m.get('clobTokenIds') or '[]')
                except Exception: tok=[]
                if not tok: continue
                b=get('https://clob.polymarket.com/book?token_id=%s'%tok[0]) or {}
                res['open_books'].append({'event':s,'end':e.get('endDate'),'title':m.get('groupItemTitle'),
                  'bids':[[float(x['price']),float(x['size'])] for x in b.get('bids',[])],'asks':[[float(x['price']),float(x['size'])] for x in b.get('asks',[])]});time.sleep(.04)
    with open(os.path.join(OUT,'pm_hist.json'),'w',encoding='utf-8') as f: json.dump(res,f,ensure_ascii=False,separators=(',',':'))
    print('done events',len(res['events']),'markets',sum(len(e['markets']) for e in res['events']),'books',len(res['open_books']),'sec',int(time.time()-t0))
if __name__=='__main__': main()
