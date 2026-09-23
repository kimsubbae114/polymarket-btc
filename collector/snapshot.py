# -*- coding: utf-8 -*-
"""★예보 이력 보관 — 하루 1개(UTC 날짜 기준 첫 실행) 전체 latest.json 을 data/history/daily/YYYY-MM-DD.json 으로 남긴다.
"어제·오늘 예상이 어떻게 달라졌나"를 나중에 그리려면 지금부터 쌓여 있어야 한다. 10분마다 덮어쓰는 latest.json 은 그대로.
보관: 최소 2년(730일) — 그 뒤는 지운다(GPT 의논 2026-09-23 권고: 일 1개, 2년)."""
import datetime, json, os, shutil, sys

데이터 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
일별 = os.path.join(데이터, 'history', 'daily')
보관일 = 730


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
        print('snapshot: 이미 있음', 날); return 0
    shutil.copyfile(src, dst)
    print('snapshot: 저장', 날, os.path.getsize(dst), 'bytes')
    # 오래된 것 정리
    한계 = (datetime.datetime.utcnow() - datetime.timedelta(days=보관일)).strftime('%Y-%m-%d')
    for n in sorted(os.listdir(일별)):
        if n.endswith('.json') and n[:10] < 한계:
            os.remove(os.path.join(일별, n)); print('snapshot: 삭제', n)
    # 목록(화면이 날짜 선택기에 쓴다)
    목록 = sorted(n[:10] for n in os.listdir(일별) if n.endswith('.json'))
    with open(os.path.join(데이터, 'history', 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'daily': 목록}, f)
    return 0


if __name__ == '__main__':
    sys.exit(오늘_스냅샷())
