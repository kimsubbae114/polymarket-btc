"""예측시장 가격 구간을 작고 검증 가능한 확률질량함수로 수집한다."""
# 데이터 규칙: PM 구간 Yes, 문턱은 P(종가>=행사가), touch는 별도 보존/반사 근사,
# KX 구간/문턱은 strike_type으로 분류한다. 모든 bins는 정규화하고 원래 합은 raw_sum에 둔다.
import argparse, csv, io, json, math, os, re, sys, time
import datetime as 날짜시간
import urllib.error, urllib.request

루트=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); 데이터=os.path.join(루트,'data'); 원본=os.path.join(데이터,'raw')
사용자에이전트={'User-Agent':'Mozilla/5.0 (prediction-distribution collector)','Accept':'application/json'}
패널정보={'BTC':('USD',0),'USDJPY':('JPY',2),'USDKRW':('KRW',0),'EURUSD':('USD',4),'FED':('%',2)}

def 숫자(값, 기본값=None):
    """★ API 문자열과 빈값을 안전한 숫자로 바꾸기 위해 있다."""
    try: return float(값)
    except (TypeError,ValueError): return 기본값
def 요청(url, 재시도=3):
    """★ 미국 러너에서만 시장 API를 안정적으로 읽기 위해 있다."""
    for 차수 in range(재시도):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=사용자에이전트),timeout=40) as r: 결과=json.loads(r.read().decode())
            time.sleep(.4); return 결과
        except urllib.error.HTTPError as e:
            print('HTTP',e.code,url[:100],file=sys.stderr)
            if e.code==429 and 차수<재시도-1: time.sleep(3*(차수+1)); continue
            return None
        except Exception as e: print('요청 실패',url[:100],e,file=sys.stderr); return None
    return None
def 저장(경로, 내용):
    """★ UTF-8 JSON을 작고 읽기 쉬운 형태로 남기기 위해 있다."""
    os.makedirs(os.path.dirname(경로),exist_ok=True)
    with open(경로,'w',encoding='utf-8') as f: json.dump(내용,f,ensure_ascii=False,separators=(',',':'))
def 읽기(이름, 기본값):
    """★ 오프라인 검사에서 기존 원본만 사용하기 위해 있다."""
    try:
        with open(os.path.join(원본,이름),encoding='utf-8') as f: return json.load(f)
    except (OSError,json.JSONDecodeError): return 기본값
def 가격_pm(m, 건너뜀, 이벤트):
    """★ PM의 신뢰 가능한 중간호가 또는 Yes 가격을 택하기 위해 있다."""
    bid,ask=숫자(m.get('bestBid')),숫자(m.get('bestAsk'))
    if bid is not None and ask is not None and ask-bid<=.2: return (bid+ask)/2
    try: return float(json.loads(m.get('outcomePrices','[]'))[0])
    except (ValueError,IndexError,TypeError): 건너뜀.append({'event':이벤트,'reason':'Polymarket Yes 가격 없음'}); return None
def 가격_kx(m):
    """★ 0 유동성 Kalshi 호가에 지정된 완화 규칙을 적용하기 위해 있다."""
    bid,ask=숫자(m.get('yes_bid_dollars'),0),숫자(m.get('yes_ask_dollars'),0)
    last=숫자(m.get('last_price_dollars'),0) or 0
    return (bid+ask)/2 if bid>0 and ask>0 else last if last>0 else 0  # 무호가(bid 0) 구간은 확률 0 — ask/2 는 미거래 호가를 확률로 증폭한다(GPT 지적)
def 자산_pm(slug):
    """★ slug 접두만으로 PM 자산을 판별하기 위해 있다."""
    for p,a in [('bitcoin-','BTC'),('what-price-will-bitcoin-','BTC'),('will-bitcoin-','BTC'),('usdjpy-','USDJPY'),('will-usdjpy-','USDJPY'),('usdkrw-','USDKRW'),('will-usdkrw-','USDKRW'),('eurusd-','EURUSD'),('will-eurusd-','EURUSD'),('fed-decision-','FED')]:
        if slug.startswith(p): return a
    return None
def 경계(text):
    """★ 쉼표/통화기호가 섞인 제목을 일반 정규식으로 읽기 위해 있다."""
    return [float(x.replace(',','')) for x in re.findall(r'\d+(?:,\d{3})*(?:\.\d+)?',str(text))]
def 정규화(bins):
    """★ horizon 확률질량을 정확히 1로 맞추기 위해 있다."""
    raw=sum(x['p'] for x in bins)
    if raw<=0:return [],raw
    for x in bins:x['p']/=raw
    bins[-1]['p']+=1-sum(x['p'] for x in bins)
    return bins,raw
def 문턱_구간(항목):
    """★ 감소해야 할 P(>=X)를 보정해 차분 분포로 만들기 위해 있다."""
    항목=sorted(항목); 보정=[]; 이전=1.; 횟수=0
    for x,p in 항목:
        q=min(max(p,0),이전); 횟수+=q!=p; 보정.append((x,q)); 이전=q
    bins=[{'lo':None,'hi':보정[0][0],'p':1-보정[0][1]}]
    for (x,p),(y,q) in zip(보정,보정[1:]): bins.append({'lo':x,'hi':y,'p':max(0,p-q)})
    bins.append({'lo':보정[-1][0],'hi':None,'p':보정[-1][1]})
    return 정규화(bins)[0],횟수
def 라벨(t):
    """★ 화면에 짧은 만기 날짜를 주기 위해 있다."""
    try:
        d=날짜시간.datetime.fromisoformat(str(t).replace('Z','+00:00')); return '%d/%d'%(d.month,d.day)
    except ValueError:return str(t)[:10]
def horizon(자산,t,source,kind,event,title,n,raw,liq,bins,note='',volume=0):
    """★ 출처별 결과를 공통 horizon 계약으로 만들기 위해 있다."""
    return {'t':t,'label':라벨(t),'source':source,'kind':kind,'event':event,'title':title,'n_markets':n,'raw_sum':round(raw,8),'liquidity':round(liq,2),'volume':round(volume or 0,2),'low_liquidity':liq<500,'unreliable':False,'bins':bins,'note':note}
def deribit_처리(결과, 건너뜀, raw=False):
    """★ Deribit BTC 옵션의 Black-76 가격 곡률을 만기 위험중립 분포로 바꾸기 위해 있다."""
    index=요청('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd')
    summary=요청('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option')
    if raw: 저장(os.path.join(원본,'deribit_btc.json'),{'index':index,'summary':summary})
    if not isinstance(summary,dict) or not isinstance(summary.get('result'),list):
        건너뜀.append({'event':'Deribit BTC options','reason':'Deribit 옵션 요약 조회 실패'}); return None
    index_price=숫자((index or {}).get('result',{}).get('index_price'))
    groups={}; now=날짜시간.datetime.now(날짜시간.timezone.utc)
    for item in summary['result']:
        m=re.match(r'^BTC-(\d{2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-(C|P)$',str(item.get('instrument_name','')))
        if not m: continue
        try: expiry=날짜시간.datetime.strptime(m.group(1),'%d%b%y').replace(tzinfo=날짜시간.timezone.utc,hour=8)
        except ValueError: continue
        if (expiry-now).total_seconds()<86400: continue
        iv=숫자(item.get('mark_iv')); strike=숫자(m.group(2))
        if iv is None or iv<=0 or strike is None: continue
        groups.setdefault((m.group(1),expiry),[]).append((strike,m.group(3),iv,item))
    if not groups:
        건너뜀.append({'event':'Deribit BTC options','reason':'사용 가능한 만기 1일 이상 mark_iv 옵션 없음'}); return index_price
    for (expiry_name,expiry), rows in groups.items():
        forwards=sorted(숫자(row[3].get('underlying_price')) for row in rows if 숫자(row[3].get('underlying_price')) is not None)
        forward=forwards[len(forwards)//2] if forwards else index_price
        if forward is None or forward<=0:
            건너뜀.append({'event':'BTC-'+expiry_name,'reason':'Deribit 선도·지수 가격 없음'}); continue
        strikes={}
        for strike,side,iv,item in rows: strikes.setdefault(strike,{})[side]=(iv,item)
        smile=[]
        for strike,sides in strikes.items():
            chosen=sides.get('C') if strike>=forward else sides.get('P')
            if chosen is None: chosen=sides.get('C') or sides.get('P')
            if chosen: smile.append((math.log(strike/forward),chosen[0]))
        smile.sort()
        if len(smile)<3:
            건너뜀.append({'event':'BTC-'+expiry_name,'reason':'IV 행사가가 3개 미만'}); continue
        # 같은 행사가의 중복 레코드는 평균내어 선형 보간 입력을 단조로 만든다.
        merged=[]
        for x,iv in smile:
            if merged and x==merged[-1][0]: merged[-1]=(x,(merged[-1][1]+iv)/2)
            else: merged.append((x,iv))
        smile=merged
        def iv_at(x):
            if x<=smile[0][0]: return smile[0][1]
            if x>=smile[-1][0]: return smile[-1][1]
            for (xa,ia),(xb,ib) in zip(smile,smile[1:]):
                if xa<=x<=xb: return ia+(ib-ia)*(x-xa)/(xb-xa)
        years=(expiry-now).total_seconds()/(365*86400)
        xs=[math.log(.35)+(math.log(3.0)-math.log(.35))*i/400 for i in range(401)]
        ks=[forward*math.exp(x) for x in xs]; calls=[]
        for x,k in zip(xs,ks):
            sigma=max(iv_at(x)/100,1e-8); root=sigma*math.sqrt(years); d1=(-x+.5*sigma*sigma*years)/root; d2=d1-root
            norm=lambda z:(1+math.erf(z/math.sqrt(2)))/2
            calls.append(forward*norm(d1)-k*norm(d2))
        density=[0.0]*len(ks)
        for i in range(1,len(ks)-1):
            left=(calls[i]-calls[i-1])/(ks[i]-ks[i-1]); right=(calls[i+1]-calls[i])/(ks[i+1]-ks[i])
            density[i]=2*(right-left)/(ks[i+1]-ks[i-1])
        cells=[]; positive=negative=0.0
        for i in range(len(ks)-1):
            width=ks[i+1]-ks[i]; signed=(density[i]+density[i+1])*width/2
            if signed<0: negative-=signed
            clipped=max(0,density[i])+max(0,density[i+1]); mass=clipped*width/2; positive+=mass
            cells.append(((ks[i]+ks[i+1])/2,mass))
        if positive<=0:
            건너뜀.append({'event':'BTC-'+expiry_name,'reason':'B-L 밀도 적분값 0'}); continue
        clipped_pct=100*negative/(positive+negative) if positive+negative else 0
        cumulative=0; qlo=qhi=None
        for price,mass in cells:
            cumulative+=mass/positive
            if qlo is None and cumulative>=.005:qlo=price
            if qhi is None and cumulative>=.995:qhi=price; break
        step=.02*forward; lo=max(ks[0],math.floor(qlo/step)*step); hi=min(ks[-1],math.ceil(qhi/step)*step)
        edges=[lo]
        while edges[-1]<hi: edges.append(min(hi,edges[-1]+step))
        weights=[0.0]*(len(edges)-1)
        for price,mass in cells:
            if lo<=price<=hi:
                slot=min(len(weights)-1,int((price-lo)/step)); weights[slot]+=mass
        bins=[{'lo':round(edges[i],2),'hi':round(edges[i+1],2),'p':weight} for i,weight in enumerate(weights)]
        bins,_=정규화(bins)
        oi=sum(숫자(row[3].get('open_interest'),0) or 0 for row in rows); volume=sum(숫자(row[3].get('volume'),0) or 0 for row in rows)
        note='위험중립 밀도(Black-76·B-L), r=0, 음수 질량 %.1f%% 절단, F=%.2f'%(clipped_pct,forward)
        if years>1: note+='; 잔존기간 1년 초과'
        h=horizon('BTC',expiry.isoformat().replace('+00:00','Z'),'deribit','options-rnd','BTC-'+expiry_name,'Deribit BTC 옵션 '+expiry_name,len(smile),positive,oi,bins,note,volume)
        h['forward']=round(forward,2); h['atm_iv']=round(iv_at(0),4); h['negative_mass_pct']=round(clipped_pct,6); h['unreliable']=len(smile)<8 or clipped_pct>=5
        if clipped_pct>=5: h['note']+='; 음수 질량 절단이 5%% 이상이라 신뢰 낮음'
        _m=max(bins,key=lambda b:b['p']); _mid=((_m['lo'] if _m['lo'] is not None else _m['hi'])+(_m['hi'] if _m['hi'] is not None else _m['lo']))/2
        if forward and abs(_mid/forward-1)>.15: h['unreliable']=True; h['note']+='; 최빈 구간이 선도가격 ±15% 밖 — 스마일 꼬리 수치 잡음'
        결과['BTC']['horizons'].append(h)
    return index_price
def touch_근사(자산,event,t,title,levels,spot):
    """★ 도달 확률을 반사원리의 거친 만기분포 근사로 분리하기 위해 있다."""
    if spot is None:return None
    low=sorted((x['price'],.5*x['p']) for x in levels if x['dir']=='down' and x['price']<spot); high=sorted((x['price'],.5*x['p']) for x in levels if x['dir']=='up' and x['price']>spot)
    if len(low)<2 or len(high)<2:return None
    out=[]; prev=0
    for x,p in low:prev=max(prev,min(.5,p));out.append((x,prev))
    up=[];prev=.5
    for x,p in high:prev=min(prev,max(0,p));up.append((x,prev))
    bins=[{'lo':None,'hi':out[0][0],'p':out[0][1]}]
    for (x,p),(y,q) in zip(out,out[1:]):bins.append({'lo':x,'hi':y,'p':q-p})
    bins += [{'lo':out[-1][0],'hi':spot,'p':.5-out[-1][1]},{'lo':spot,'hi':up[0][0],'p':.5-up[0][1]}]
    for (x,p),(y,q) in zip(up,up[1:]):bins.append({'lo':x,'hi':y,'p':p-q})
    bins.append({'lo':up[-1][0],'hi':None,'p':up[-1][1]}); bins,raw=정규화(bins)
    return horizon(자산,t,'polymarket','touch-approx',event,title,len(levels),raw,0,bins,'도달 확률의 0.5배를 반사원리로 종가 꼬리에 근사; 실제 만기분포가 아님')
def pm_처리(events,결과,spot,건너뜀):
    """★ PM 이벤트를 구간·문턱·도달·결정으로 분류하기 위해 있다."""
    seen=set()
    for e in events:
        slug=e.get('slug',''); asset=자산_pm(slug)
        if slug in seen or e.get('closed') or not asset:continue
        seen.add(slug); ms=[m for m in e.get('markets',[]) if not m.get('closed') and m.get('active',True)]
        if asset=='FED':
            items=[{'name':m.get('groupItemTitle') or m.get('question',''),'p':가격_pm(m,건너뜀,slug)} for m in ms];items=[x for x in items if x['p'] is not None]
            if items:결과['FED']['decision'].append({'t':e.get('endDate'),'label':라벨(e.get('endDate')),'source':'polymarket','items':items})
            continue
        if '-above-on-' in slug and not re.search(r'-\d{4}$',slug):continue
        touch=('hit' in slug or 'reach' in slug) and '-above-on-' not in slug
        if touch:
            levels=[]
            for m in ms:
                p=가격_pm(m,건너뜀,slug); text=m.get('groupItemTitle') or m.get('question') or '';v=경계(text)
                if p is not None and v: levels.append({'price':v[0],'dir':'down' if ('↓' in text or re.search(r'below|fall|drop',text,re.I)) else 'up','p':p})
            if levels:
                t=e.get('endDate');결과[asset]['touch'].append({'event':slug,'label':라벨(t),'t':t,'levels':levels});h=touch_근사(asset,slug,t,e.get('title',''),levels,spot.get(asset))
                if h:결과[asset]['horizons'].append(h)
            continue
        bracket=[];threshold=[]
        for m in ms:
            p=가격_pm(m,건너뜀,slug);text=m.get('groupItemTitle') or '';v=경계(text)
            if p is None or not v:continue
            # 날짜 문장 속 숫자를 구간으로 오인하지 않도록 제목 전체가 가격 문법일 때만 채택한다.
            가격문법=r'^\s*(?:[<>]\s*)?[\$€¥₩]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*-\s*[\$€¥₩]?\d+(?:,\d{3})*(?:\.\d+)?)?\s*$'
            if not re.match(가격문법,text):continue
            if re.search(r'^\s*(?:<|>)',text) or len(v)>=2:bracket.append({'lo':None if '<' in text else v[0],'hi':None if '>' in text else v[-1],'p':p})
            else:threshold.append((v[0],p))
        t=e.get('endDate') or (ms[0].get('endDate') if ms else None);liq=숫자(e.get('liquidity'),0)
        if bracket:
            bracket.sort(key=lambda x:float('-inf') if x['lo'] is None else x['lo']);bins,raw=정규화(bracket)
            if bins:결과[asset]['horizons'].append(horizon(asset,t,'polymarket','bracket',slug,e.get('title',''),len(bracket),raw,liq,bins,volume=숫자(e.get('volume'),0)))
        elif len(threshold)>=2:
            bins,n=문턱_구간(threshold);결과['_보정']+=n;결과[asset]['horizons'].append(horizon(asset,t,'polymarket','threshold',slug,e.get('title',''),len(threshold),1,liq,bins,'단조 보정 %d회'%n if n else '',volume=숫자(e.get('volume'),0)))
def kx_처리(groups,결과,건너뜀):
    """★ 필요한 Kalshi series만 자산별 분포로 바꾸기 위해 있다."""
    for series,events in groups.items():
        if not series.startswith(('KXBTC','KXBTCD','KXFED','KXUSDJPY','KXUSDJPYAW','KXEURUSD')) or series.startswith(('KXBTC15M','KXBTCMAX','KXBTCPRICE')):continue
        asset='FED' if series.startswith('KXFED') else 'BTC' if series.startswith('KXBTC') else 'USDJPY' if series.startswith('KXUSDJPY') else 'EURUSD'
        for e in events:
            if e.get('status') not in ('open','active',None):continue
            ms=e.get('markets',[]);t=e.get('strike_date') or (ms[0].get('close_time') if ms else None);ticker=e.get('event_ticker','')
            if series.startswith('KXFEDDECISION'):
                items=[{'name':m.get('yes_sub_title') or m.get('title',''),'p':가격_kx(m)} for m in ms]
                if items:결과['FED']['decision'].append({'t':t,'label':라벨(t),'source':'kalshi','items':items})
                continue
            kx_vol=sum((숫자(m.get('volume_fp'),0) or 0) for m in ms);kx_oi=sum((숫자(m.get('open_interest_fp'),0) or 0) for m in ms)
            bracket=[];threshold=[]
            for m in ms:
                p=가격_kx(m);typ=m.get('strike_type');lo,hi=숫자(m.get('floor_strike')),숫자(m.get('cap_strike'))
                if typ=='between':bracket.append({'lo':lo,'hi':hi,'p':p})
                elif typ=='greater' and lo is not None:threshold.append((lo,p))
                elif typ=='less' and hi is not None:threshold.append((hi,1-p))
            if bracket:
                for m in ms:
                    if m.get('strike_type')=='less':bracket.append({'lo':None,'hi':숫자(m.get('cap_strike')),'p':가격_kx(m)})
                    if m.get('strike_type')=='greater':bracket.append({'lo':숫자(m.get('floor_strike')),'hi':None,'p':가격_kx(m)})
                bracket=[b for b in bracket if b['lo'] is not None or b['hi'] is not None];bracket.sort(key=lambda x:float('-inf') if x['lo'] is None else x['lo']);bins,raw=정규화(bracket)
                h=horizon(asset,t,'kalshi','bracket',ticker,e.get('title',''),len(bracket),raw,kx_oi,bins,volume=kx_vol);h['unreliable']=raw<.5;결과[asset]['horizons'].append(h)
            elif len(threshold)>=2:
                bins,n=문턱_구간(threshold);결과['_보정']+=n;note='촘촘한 0.002 문턱이라 분포 해석이 제한적' if series.startswith('KXUSDJPYAW') else '';결과[asset]['horizons'].append(horizon(asset,t,'kalshi','threshold',ticker,e.get('title',''),len(threshold),1,kx_oi,bins,note,volume=kx_vol))

def 시장원본(offline,raw):
    """★ 오프라인 덤프와 미국 러너 온라인 수집을 분리하기 위해 있다."""
    if offline:
        pm=sum((읽기('pm_tag_%s.json'%x,[]) for x in ('bitcoin','crypto','fed','forex')),[]); search=읽기('pm_search.json',{})
        return pm+(sum(search.values(),[]) if isinstance(search,dict) else []),읽기('kx_events.json',{})
    pm=[]
    for tag in ('bitcoin','forex','fed'):
        for offset in (0,100):
            d=요청('https://gamma-api.polymarket.com/events?tag_slug=%s&closed=false&limit=100&order=volume24hr&ascending=false&offset=%d'%(tag,offset)) or [];pm+=d
            if raw:저장(os.path.join(원본,'pm_tag_%s_%d.json'%(tag,offset)),d)
    kx={}
    for s in ('KXBTC','KXBTCD','KXFED','KXFEDDECISION','KXUSDJPY','KXUSDJPYAW','KXEURUSD'):
        d=요청('https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=%s&status=open&with_nested_markets=true&limit=20'%s) or {};kx[s]=d.get('events',[])
    if raw:저장(os.path.join(원본,'kx_events.json'),kx)
    return pm,kx
def 현물과_이력(skipped):
    """★ 화면의 기준 현물과 비교 이력을 공개 API에서 얻기 위해 있다."""
    spot={x:None for x in 패널정보};hist={x:[] for x in ('FED','USDJPY','USDKRW','EURUSD')}
    try:
        d=요청('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');spot['BTC']=숫자(next(iter(d['result'].values()))['c'][0])
    except Exception:skipped.append({'event':'spot BTC','reason':'Kraken 현물 조회 실패'})
    try:
        end=날짜시간.date.today();start=end-날짜시간.timedelta(days=180);d=요청('https://api.frankfurter.app/%s..%s?from=USD&to=JPY,KRW,EUR'%(start,end)) or {}
        for day,row in d.get('rates',{}).items():
            for cur,asset in [('JPY','USDJPY'),('KRW','USDKRW'),('EUR','EURUSD')]:
                if cur in row:hist[asset].append([day,round(1/row[cur],5) if asset=='EURUSD' else row[cur]])  # EUR/USD 는 USD->EUR 의 역수
        for a in ('USDJPY','USDKRW','EURUSD'):
            if hist[a]:spot[a]=hist[a][-1][1]
    except Exception:skipped.append({'event':'spot FX','reason':'Frankfurter 조회 실패'})
    try:
        raw=urllib.request.urlopen(urllib.request.Request('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU',headers=사용자에이전트),timeout=40).read().decode();rows=list(csv.reader(io.StringIO(raw)))[1:]
        hist['FED']=[[r[0],float(r[1])] for r in rows[-365:] if len(r)>1 and r[1] not in ('.','')]
        if hist['FED']:spot['FED']=hist['FED'][-1][1]
    except Exception:skipped.append({'event':'spot FED','reason':'FRED 조회 실패'})
    return spot,hist
def 검사(data):
    """★ 배포 전 확률 계약과 300KB 제한을 실패 코드로 보장하기 위해 있다."""
    errors=[]
    for asset,panel in data.get('panels',{}).items():
        if not panel['horizons']:errors.append('%s horizons 없음'%asset)
        for h in panel['horizons']:
            if abs(sum(b['p'] for b in h['bins'])-1)>1e-6:errors.append('%s 확률합'%h['event'])
            prev=None
            for b in h['bins']:
                if b['lo'] is not None and prev is not None and b['lo']<prev:errors.append('%s 경계 순서'%h['event'])
                if b['hi'] is not None:prev=b['hi']
            if h.get('source')=='deribit' and not h.get('unreliable'):
                raw=h.get('raw_sum',0); forward=h.get('forward'); cut=h.get('negative_mass_pct',100)
                if not .85<=raw<=1.15:errors.append('%s raw_sum'%h['event'])
                if cut>=5:errors.append('%s 음수 절단 질량'%h['event'])
                cumulative=0; median=None
                for b in h['bins']:
                    cumulative+=b['p']
                    if cumulative>=.5:
                        median=(b['lo']+b['hi'])/2; break
                if forward is None or median is None or abs(median-forward)/forward>.08:errors.append('%s 중앙값/선도'%h['event'])
    btc=[h for h in data['panels']['BTC']['horizons'] if h['kind']=='bracket']
    if btc:
        h=btc[0];b=max(h['bins'],key=lambda x:x['p']);mid=((b['lo'] or b['hi'])+(b['hi'] or b['lo']))/2;spot=data['spot']['BTC'] or 86000
        if abs(mid-spot)/spot>.1:print('경고: BTC 최빈 구간이 spot에서 10% 밖',file=sys.stderr)
    size=os.path.getsize(os.path.join(데이터,'latest.json'));print('단조보정 횟수:',data.get('_monotone_corrections',0),'파일:',size,'bytes')
    if size>300*1024:errors.append('파일 크기 %d bytes'%size)
    if errors:print('CHECK FAIL:','; '.join(errors),file=sys.stderr);return False
    print('CHECK OK');return True
def 거래량_규칙(result):
    """★ 한 번도(거의) 거래되지 않은 시장의 기본 호가를 분포로 오독하지 않기 위해 있다 — 같은 (자산, 출처, 종류) 묶음 최대 거래량의 2% 미만 또는 100 미만이면 unreliable."""
    for x in 패널정보:
        묶음={}
        for h in result[x]['horizons']:
            if h['kind']=='touch-approx':continue
            묶음.setdefault((h['source'],h['kind']),[]).append(h)
        for hs in 묶음.values():
            deribit=hs[0].get('source')=='deribit'
            gmax=max((h.get('liquidity',0) if deribit else h.get('volume',0)) or 0 for h in hs)
            for h in hs:
                v=(h.get('liquidity',0) if deribit else h.get('volume',0)) or 0
                if v<max(0 if deribit else 100,gmax*.02):
                    h['unreliable']=True;h['note']=((h.get('note') or '')+' ' if h.get('note') else '')+('OI' if deribit else '거래량')+' %g — 같은 묶음 최대(%g)의 2%% 미만이라 미거래 잡음으로 제외'%(v,gmax)
def main():
    """★ 옵션에 따라 수집 또는 기존 latest 검사만 실행하기 위해 있다."""
    p=argparse.ArgumentParser();p.add_argument('--offline',action='store_true');p.add_argument('--raw',action='store_true');p.add_argument('--check',action='store_true');p.add_argument('--no-deribit',action='store_true');a=p.parse_args()
    if a.check and not a.offline:
        try:
            with open(os.path.join(데이터,'latest.json'),encoding='utf-8') as f:sys.exit(0 if 검사(json.load(f)) else 1)
        except OSError:print('CHECK FAIL: latest.json 없음',file=sys.stderr);sys.exit(1)
    skipped=[];spot,hist=현물과_이력(skipped);pm,kx=시장원본(a.offline,a.raw);result={x:{'unit':u,'decimals':d,'horizons':[],'touch':[],'decision':[]} for x,(u,d) in 패널정보.items()};result['_보정']=0
    pm_처리(pm,result,spot,skipped);kx_처리(kx,result,skipped)
    deribit_index=None if a.no_deribit else deribit_처리(result,skipped,a.raw)
    거래량_규칙(result)
    for x in 패널정보:result[x]['horizons'].sort(key=lambda h:h['t'] or '')
    data={'generated_at':날짜시간.datetime.utcnow().replace(microsecond=0).isoformat()+'Z','spot':spot,'spot_sources':{'deribit_index':deribit_index},'history':hist,'panels':{x:result[x] for x in 패널정보},'skipped':skipped,'sources':{'polymarket':'https://gamma-api.polymarket.com','kalshi':'https://api.elections.kalshi.com/trade-api/v2','deribit':'https://www.deribit.com/api/v2/public','fred':'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU','frankfurter':'https://api.frankfurter.app','kraken':'https://api.kraken.com'},'_monotone_corrections':result['_보정']}
    저장(os.path.join(데이터,'latest.json'),data)
    if a.check:sys.exit(0 if 검사(data) else 1)
if __name__=='__main__':main()
