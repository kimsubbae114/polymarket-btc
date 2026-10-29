# -*- coding: utf-8 -*-
"""지금 Deribit 호가창: 기간별(7/30/60/90/180일) 현재가·±10%·±20% 행사가의 매수·매도 호가, 스프레드(가격 대비 %), 최우선 잔량(BTC)."""
import json,urllib.request,time,datetime as dt,sys
sys.stdout.reconfigure(encoding='utf-8')
g=lambda u:json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'research'}),timeout=30).read().decode())['result']
ins=g('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false')
S=g('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd')['index_price'];now=time.time()*1000
by={}
for x in ins: by.setdefault(x['expiration_timestamp'],[]).append(x)
out=[]
print('현물',round(S))
print('기간  만기      행사가   종류  매수     매도     스프레드(옵션가 대비)  최우선 잔량 매수/매도(BTC)  상위5호가 합(BTC)')
for h in [7,30,60,90,180]:
    E=min(by,key=lambda e:abs(e-now-h*86400000))
    for m,cp in [(1,'C'),(1.1,'C'),(1.2,'C'),(.9,'P'),(.8,'P')]:
        xs=[x for x in by[E] if x['option_type']==('call' if cp=='C' else 'put')];x=min(xs,key=lambda x:abs(x['strike']-S*m))
        b=g('https://www.deribit.com/api/v2/public/get_order_book?instrument_name=%s&depth=5'%x['instrument_name']);time.sleep(.1)
        bb,ba=b.get('best_bid_price') or 0,b.get('best_ask_price') or 0;mid=(bb+ba)/2 if bb and ba else b.get('mark_price')
        sp=(ba-bb)/mid if bb and ba and mid else None;d5=sum(q for p,q in b.get('bids',[]))+sum(q for p,q in b.get('asks',[]))
        r=dict(h=h,exp=dt.datetime.utcfromtimestamp(E/1000).strftime('%Y-%m-%d'),K=x['strike'],cp=cp,bid=bb,ask=ba,spread=sp,bq=b.get('best_bid_amount'),aq=b.get('best_ask_amount'),depth5=d5);out.append(r)
        print('%3d일 %s %8.0f %s  %.4f  %.4f  %s  %s/%s  %.1f'%(h,r['exp'],r['K'],cp,bb,ba,('%5.1f%%'%(sp*100)) if sp is not None else '  —  ',r['bq'],r['aq'],d5))
json.dump(out,open('research/out/opt_depth.json','w'),indent=0)
