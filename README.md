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

## 옵션(Deribit) 위험중립 밀도

수집기는 Deribit BTC 옵션을 만기별로 모아, 선도 `F` 기준 OTM 콜/풋의 mark IV를 로그머니니스에서 선형 보간한다. 그 IV로 Black-76 콜 가격(`r=0`, 할인 무시)을 계산하고 Breeden–Litzenberger 2차 차분으로 위험중립 밀도를 얻는다. 음수 곡률은 0으로 자른 뒤, 누적확률 0.5%~99.5%를 덮는 `F`의 2% 폭 닫힌 가격 bins에 적분·정규화한다.

이는 **위험중립 확률**이지 실제 가격 확률이 아니다. 특히 헤지 수요 때문에 하락 꼬리가 실제 신념 분포보다 두껍게 나타날 수 있다. 옵션 horizon에는 `forward`(만기 선도 F)와 `atm_iv`(F에서 보간한 mark IV, %)가 추가되며, `raw_sum`은 정규화 전 밀도 적분값이다. `--no-deribit`으로 옵션 수집을 끌 수 있고, `--offline`에서도 Deribit 공개 API는 조회한다.


## 신뢰도 규칙 추가 (2026-09-22 저녁)
- 각 horizon 에 `volume`(폴리마켓 이벤트 volume, 칼시는 market 별 `volume_fp` 합)을 기록하고, 칼시 `liquidity` 는 `open_interest_fp` 합으로 바꿨다(이전엔 event 에 없는 필드를 읽어 전부 0).
- **거래량 규칙**: 같은 (자산, 출처, 종류) 묶음 안에서 거래량이 최대의 2% 미만이거나 100 미만이면 `unreliable=true` + note. 한 번도 거래되지 않은 먼 만기(예: 칼시 KXFED 2027-06 이후, 최빈 5.75~6.0%)의 기본 호가가 화면에 잡음으로 뜨던 문제를 막는다. 도달근사(touch-approx)는 원천 도달 시장이 활발해 이 규칙에서 제외.
