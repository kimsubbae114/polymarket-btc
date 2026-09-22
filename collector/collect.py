"""v0 exploratory collector: dumps raw Polymarket + Kalshi market shapes. Runs in GitHub Actions (US egress)."""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error, datetime
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
RAW = os.path.join(OUT, 'raw')
os.makedirs(RAW, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (compatible; polymarket-btc collector)', 'Accept': 'application/json'}

def get(url, tries=3, pause=0.4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode())
            time.sleep(pause)
            return data
        except urllib.error.HTTPError as e:
            body = e.read(200).decode(errors='replace')
            print(f'HTTP {e.code} {url[:90]} {body[:80]!r}')
            if e.code == 429:
                time.sleep(3 * (i + 1)); continue
            return None
        except Exception as e:
            print(f'EXC {url[:90]} {e}'); time.sleep(2)
    return None

def save(name, obj):
    with open(os.path.join(RAW, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)

def polymarket():
    G = 'https://gamma-api.polymarket.com'
    out = {}
    for q in ['bitcoin', 'btc price', 'fed decision', 'fed rate', 'interest rate', 'usd/jpy', 'eur/usd', 'dollar']:
        d = get(f'{G}/public-search?q={urllib.parse.quote(q)}&events_status=active&limit_per_type=40')
        evs = (d or {}).get('events') or [] if isinstance(d, dict) else []
        out[q] = evs
        print(f'## PM search [{q}]: {len(evs)} events')
        for e in evs[:40]:
            ms = e.get('markets') or []
            print(f" - {e.get('slug')} | end {str(e.get('endDate'))[:10]} | mkts {len(ms)} | vol {round(float(e.get('volume') or 0))}")
            for m in ms[:6]:
                print(f"     . {(m.get('groupItemTitle') or m.get('question') or '')[:50]} | {m.get('outcomePrices')} | bid/ask {m.get('bestBid')}/{m.get('bestAsk')} | end {str(m.get('endDate'))[:10]}")
    save('pm_search.json', out)
    for tag in ['bitcoin', 'crypto', 'fed', 'forex']:
        d = get(f'{G}/events?tag_slug={tag}&closed=false&limit=100&order=volume24hr&ascending=false')
        evs = d if isinstance(d, list) else []
        print(f'## PM tag [{tag}]: {len(evs)} events')
        for e in evs[:30]:
            print(f" - {e.get('slug')} | end {str(e.get('endDate'))[:10]} | mkts {len(e.get('markets') or [])}")
        save(f'pm_tag_{tag}.json', evs)

def kalshi():
    K = 'https://api.elections.kalshi.com/trade-api/v2'
    series = {}
    for cat in ['Crypto', 'Economics', 'Financials']:
        d = get(f'{K}/series?category={cat}')
        series[cat] = (d or {}).get('series') or []
        print(f'## KX series {cat}: {len(series[cat])}')
    save('kx_series.json', series)
    btc = [s['ticker'] for s in series['Crypto'] if 'BTC' in s['ticker']]
    print('## KX BTC series:', ' '.join(btc))
    tickers = btc + ['KXFED', 'KXFEDDECISION', 'KXFEDFUNDSYEAR', 'KXUSDJPY', 'KXUSDJPYW', 'KXUSDJPYQ', 'KXUSDJPYAW',
                     'KXEURUSD', 'KXEURUSDW', 'KXEURUSDQ', 'KXFXEURO']
    evs_all = {}
    for t in tickers:
        d = get(f'{K}/events?series_ticker={t}&status=open&with_nested_markets=true&limit=8')
        evs = (d or {}).get('events') or []
        evs_all[t] = evs
        print(f'## KX events [{t}]: {len(evs)}')
        for e in evs[:4]:
            ms = e.get('markets') or []
            print(f" - {e.get('event_ticker')} | {str(e.get('title'))[:60]} | mkts {len(ms)} | strike_date {e.get('strike_date')}")
            for m in ms[:4]:
                print(f"     . {m.get('ticker')} | {str(m.get('yes_sub_title') or m.get('subtitle'))[:32]} | bid/ask {m.get('yes_bid')}/{m.get('yes_ask')} | last {m.get('last_price')} | floor/cap {m.get('floor_strike')}/{m.get('cap_strike')} | {m.get('strike_type')} | close {str(m.get('close_time'))[:16]}")
    save('kx_events.json', evs_all)

def misc():
    for url in ['https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU',
                'https://api.frankfurter.app/latest?from=USD&to=JPY,EUR,KRW',
                'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1']:
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode(errors='replace')
            print('## misc OK', url[:60], '|', txt.strip()[-120:].replace('\n', ' '))
        except Exception as e:
            print('## misc FAIL', url[:60], e)

if __name__ == '__main__':
    polymarket(); kalshi(); misc()
    with open(os.path.join(OUT, 'latest.json'), 'w', encoding='utf-8') as f:
        json.dump({'generated_at': datetime.datetime.utcnow().isoformat() + 'Z', 'note': 'v0 raw only'}, f)
    print('## DONE')
