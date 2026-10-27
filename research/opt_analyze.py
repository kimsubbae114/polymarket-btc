# -*- coding: utf-8 -*-
"""opt_bt.json → 표. 겹치지 않는 표본(진입 간격 ≥ 기간)으로 평균·t값. 비용 전/후 둘 다."""
import json, os, statistics as st, math, sys
sys.stdout.reconfigure(encoding='utf-8')
P=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out','opt_bt.json'); R=json.load(open(P,encoding='utf-8'))
def nonover(rs,h):
    out=[];last=None
    for r in sorted(rs,key=lambda r:r['t']):
        if last is None or r['t']-last>=h*86400000: out.append(r);last=r['t']
    return out
def tstat(xs):
    if len(xs)<3: return float('nan')
    sd=st.stdev(xs);return st.mean(xs)/(sd/math.sqrt(len(xs))) if sd>0 else float('nan')
def pct(x): return '%+.1f%%'%(x*100)
print('== A 「가운데에 건다」 콜 버터플라이 (손실 한정, 폴리마켓 현재가 구간 YES 매수와 같은 모양)')
print('기간 밴드  N(겹침X)  시장확률  실제적중  비용비율  수익률(비용전)  수익률(비용후)  t(비용후)')
summary={'A':[],'B':[]}
for h in [7,30,60,90,180]:
    for b in [.05,.1,.2]:
        rs=[r for r in R if r['s']=='A' and r['h']==h and r['b']==b]
        if not rs: continue
        cost=lambda r:r['mid']+r['hs']+r['fee']
        gross=[(r['pay']-r['mid'])/r['mid'] for r in rs if r['mid']>0];net=[(r['pay']-cost(r))/cost(r) for r in rs if r['mid']>0]
        no=nonover([r for r in rs if r['mid']>0],h);nn=[(r['pay']-cost(r))/cost(r) for r in no]
        imp=st.mean(r['implied'] for r in rs);hit=st.mean(r['hit'] for r in rs);cr=st.median((r['hs']+r['fee'])/r['mid'] for r in rs if r['mid']>0)
        row=dict(h=h,b=b,n=len(rs),n_nonover=len(no),implied=imp,realized=hit,cost_ratio=cr,ret_gross=st.mean(gross),ret_net=st.mean(net),ret_net_nonover=st.mean(nn) if nn else None,t_nonover=tstat(nn))
        summary['A'].append(row)
        print('%3d일 ±%2d%%  %3d(%3d)  %6.1f%%  %6.1f%%  %6.0f%%  %12s  %12s  %6.2f'%(h,b*100,len(rs),len(no),imp*100,hit*100,cr*100,pct(row['ret_gross']),pct(row['ret_net']),row['t_nonover']))
print()
print('== B 「양끝을 판다」 숏 스트랭글 (손실 무한, 참고) — 현물 대비 %, 비용 후')
print('기간 밴드  N(겹침X)  받은 프리미엄  평균 손익  최악  승률  t(비용후)')
for h in [7,30,60,90,180]:
    for b in [.05,.1,.2]:
        rs=[r for r in R if r['s']=='B' and r['h']==h and r['b']==b]
        if not rs: continue
        pnl=[(r['prem']-r['hs']-r['fee']-r['loss'])/r['S'] for r in rs];no=nonover(rs,h);pn=[(r['prem']-r['hs']-r['fee']-r['loss'])/r['S'] for r in no]
        row=dict(h=h,b=b,n=len(rs),n_nonover=len(no),prem=st.mean(r['prem']/r['S'] for r in rs),pnl=st.mean(pnl),worst=min(pnl),win=sum(x>0 for x in pnl)/len(pnl),t_nonover=tstat(pn))
        summary['B'].append(row)
        print('%3d일 ±%2d%%  %3d(%3d)  %10s  %8s  %7s  %4.0f%%  %6.2f'%(h,b*100,len(rs),len(no),pct(row['prem']),pct(row['pnl']),pct(row['worst']),row['win']*100,row['t_nonover']))
json.dump(summary,open(os.path.join(os.path.dirname(P),'opt_summary.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
