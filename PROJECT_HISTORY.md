# 프로젝트 변경 이력

## 2026-09-22 — Deribit BTC 옵션 위험중립 만기분포

- 요청/목적: 기존 예측시장 bins에 Deribit BTC 옵션의 Breeden–Litzenberger 위험중립 만기분포를 추가해 월말·분기 만기를 보완.
- 주요 변경: `collector/collect.py`에 공개 API 원본 수집, OTM mark IV 선형 보간, Black-76(`r=0`) 가격의 비균등 중앙차분, 닫힌 2% F bins 적분, `forward`·`atm_iv`·음수 질량 정보를 추가했다. `--no-deribit`, `spot_sources.deribit_index`, OI 기반 신뢰도 규칙과 Deribit 전용 검사를 넣었다. `README.md`에 방법·위험중립 해석 경고를 보탰다.
- AI 판단: 선형 IV 스마일의 수치 곡률에서 음수 절단 질량이 5% 이상이면 저장은 유지하되 `unreliable`로 표시했다. 이는 검사 대상에서만 제외하며, 행사가 부족/OI 부족 규칙과 별개인 수치 품질 표시다.
- 검증 사실: 2026-09-22에 `python collector/collect.py --offline --raw --check`, `python collector/collect.py --check`, `python -m py_compile collector/collect.py`가 통과했다. 생성 `latest.json`은 127,648 bytes, Deribit 원본은 436,224 bytes였다.
- 미완료: 위험중립 분포를 실제 확률로 보정하지 않았으며, 변동성 스마일의 무차익 보정은 요청 방식(선형 보간·음수 절단)에 포함하지 않았다.

## 2026-09-22 — 예측시장 분포 차트 화면

- 요청/목적: `data/latest.json`의 예측시장 확률질량을 이용해 모바일 대응 한국어 다크 테마 가격발견 화면을 구축.
- 주요 변경: `public/index.html`에 레이아웃·스타일을, `public/app.js`에 데이터 로드, Binance/Kraken BTC 캔들 폴백, 확률밀도·최빈/분위·호버 캔버스 렌더러 및 4개 소형 패널을 구현. `tests/test_app.js`에 순수 계산 및 실제 BTC 데이터 점검을 추가.
- AI 판단: 열린 최빈 구간, 비정상 raw 합계, 신뢰 불가 horizon을 제외하고 UTC 날짜별 출처/종류 우선순위로 하나를 선택하도록 구현. 원본 열린 구간 여부로 제외한 뒤 나머지 구간만 시각 계산에서 닫았다.
- 검증 사실: `node tests/test_app.js` 통과. `python -m http.server 8765`로 `public/index.html?data=/data/latest.json` HTTP 200 확인.
- 미완료: 실제 브라우저의 시각 렌더링은 사용자 확인 범위로 남음.
