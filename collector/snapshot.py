# -*- coding: utf-8 -*-
"""★예보 이력 보관 — 하루 1개(UTC 날짜 기준 첫 실행) 전체 latest.json 을 data/history/daily/YYYY-MM-DD.json 으로 남기고,
화면이 가볍게 읽을 요약 data/history/summary.json(날짜별 · 만기별 분위·최빈·현물)을 갱신한다.
"어제·오늘 예상이 어떻게 달라졌나"를 나중에 그리려면 지금부터 쌓여 있어야 한다. 10분마다 덮어쓰는 latest.json 은 그대로.
보관: 최소 2년(730일) — 그 뒤는 지운다(GPT 의논 2026-09-23 권고: 일 1개, 2년)."""
import datetime, json, os, shutil, sys

데이터 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
이력 = os.path.join(데이터, 'history')
일별 = os.path.join(이력, 'daily')
보관일 = 730


def 닫힌구간(bins):
    """★열린 양끝(lo/hi None)을 이웃 폭으로 닫는다 — 화면(app.js closeBins)과 같은 규칙."""
    폭 = [(b['hi'] - b['lo']) if b.get('lo') is not None and b.get('hi') is not None else 0 for b in bins]
    기본 = next((w for w in 폭 if w), 1)
    out = []
    for i, b in enumerate(bins):
        q = 폭[i] or (폭[i - 1] if i else 0) or (폭[i + 1] if i + 1 < len(폭) else 0) or 기본
        lo, hi = b.get('lo'), b.get('hi')
        if lo is None: lo = hi - q
        if hi is None: hi = lo + q
        out.append({'lo': lo, 'hi': hi, 'p': b.get('p') or 0})
    return out


def 분위(bins, q):
    s = 0.0
    for b in 닫힌구간(bins):
        if s + b['p'] >= q:
            return round(b['lo'] + (b['hi'] - b['lo']) * (q - s) / (b['p'] or 1), 2)
        s += b['p']
    return None


def 요약_한날(d):
    """★latest.json 한 장 → 화면용 작은 요약(BTC 패널만)."""
    hs = []
    for h in d.get('panels', {}).get('BTC', {}).get('horizons', []):
        bins = h.get('bins') or []
        if not bins: continue
        cb = 닫힌구간(bins); m = max(cb, key=lambda x: x['p'])
        hs.append({'k': '%s|%s|%s' % (h['source'], h['kind'], h['t']), 't': h['t'], 'label': h.get('label'),
                   'source': h['source'], 'kind': h['kind'], 'unreliable': bool(h.get('unreliable')),
                   'q': [분위(bins, x) for x in (.1, .25, .5, .75, .9)], 'mode': [m['lo'], m['hi'], round(m['p'], 4)],
                   'volume': h.get('volume', 0)})
    return {'generated_at': d.get('generated_at'), 'spot': (d.get('spot') or {}).get('BTC'), 'horizons': hs}


def 요약_갱신():
    """★daily/*.json 전부에서 summary.json 을 다시 만든다(하루 1장이라 가볍다)."""
    days = {}
    for n in sorted(os.listdir(일별)):
        if not n.endswith('.json'): continue
        try:
            with open(os.path.join(일별, n), encoding='utf-8') as f:
                days[n[:10]] = 요약_한날(json.load(f))
        except Exception as e:
            print('summary: 건너뜀', n, e)
    with open(os.path.join(이력, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump({'schema': 1, 'days': days}, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(이력, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'daily': sorted(days)}, f)
    print('summary: 날짜', len(days))


def 오늘_스냅샷():
    src = os.path.join(데이터, 'latest.json')
    if not os.path.exists(src):
        print('snapshot: latest.json 없음'); return 1
    with open(src, encoding='utf-8') as f:
        gen = json.load(f).get('generated_at', '')
    날 = (gen[:10] if len(gen) >= 10 else datetime.datetime.utcnow().strftime('%Y-%m-%d'))
    os.makedirs(일별, exist_ok=True)
    dst = os.path.join(일별, 날 + '.json')
    if os.path.exists(dst):
        print('snapshot: 이미 있음', 날)
    else:
        shutil.copyfile(src, dst); print('snapshot: 저장', 날, os.path.getsize(dst), 'bytes')
    한계 = (datetime.datetime.utcnow() - datetime.timedelta(days=보관일)).strftime('%Y-%m-%d')
    for n in sorted(os.listdir(일별)):
        if n.endswith('.json') and n[:10] < 한계:
            os.remove(os.path.join(일별, n)); print('snapshot: 삭제', n)
    요약_갱신()
    return 0


if __name__ == '__main__':
    sys.exit(오늘_스냅샷())
