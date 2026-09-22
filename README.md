# 예측시장 가격 확률분포 수집기

한국에서는 Polymarket와 Kalshi API가 지리 차단된다. 따라서 GitHub Actions의 미국 러너가 시장을 수집해 `data` 브랜치에 올리고, 화면은 `raw.githubusercontent`에서 `latest.json`을 읽는다.

`collector/collect.py`는 가격 구간 시장의 Yes 가격을 확률질량(bin)으로 정규화한다. 문턱 시장은 `P(만기 가격 ≥ X)`를 단조 보정한 뒤 인접 차분한다. Polymarket 도달 시장은 원본 `touch`로 보존하며, 위/아래 도달확률의 절반을 이용한 반사원리 근사를 `touch-approx` horizon으로 별도 제공한다. 이는 실제 만기분포가 아니므로 `note`를 반드시 확인해야 한다. 넓은 스프레드는 Yes 가격으로, Kalshi의 0 유동성 구간은 ask/2 또는 last로 완화해 쓰며 신뢰 불가 구간은 `unreliable`로 표시한다. 유동성 500 미만 이벤트는 제외하지 않고 `low_liquidity`로 표시한다.

## 스키마

`latest.json`에는 생성 시각, `spot`, FX/FED `history`, 그리고 BTC·USDJPY·USDKRW·EURUSD·FED별 `panels`가 있다. 각 panel의 `horizons`는 `t`, `source`, `kind`, `raw_sum`, 유동성 표시와 정규화된 `bins` (`lo`, `hi`, `p`)를 가진다. 도달 시장은 `touch.levels`, 정책 결정은 `decision.items`에 별도 있다. `skipped`는 가격 또는 현물 조회 실패 이유를 기록한다.

## 로컬 검사

시장 API를 호출하지 않고 저장된 덤프로 생성하려면 다음을 실행한다.

```powershell
python collector/collect.py --offline
python collector/collect.py --check
python -m py_compile collector/collect.py
```

온라인 실행은 러너에서만 `python collector/collect.py`로 한다. `--raw`를 추가했을 때만 새 원본 덤프를 저장한다.
