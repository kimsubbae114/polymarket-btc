# 프로젝트 변경 이력

## 2026-09-22 — 예측시장 분포 차트 화면

- 요청/목적: `data/latest.json`의 예측시장 확률질량을 이용해 모바일 대응 한국어 다크 테마 가격발견 화면을 구축.
- 주요 변경: `public/index.html`에 레이아웃·스타일을, `public/app.js`에 데이터 로드, Binance/Kraken BTC 캔들 폴백, 확률밀도·최빈/분위·호버 캔버스 렌더러 및 4개 소형 패널을 구현. `tests/test_app.js`에 순수 계산 및 실제 BTC 데이터 점검을 추가.
- AI 판단: 열린 최빈 구간, 비정상 raw 합계, 신뢰 불가 horizon을 제외하고 UTC 날짜별 출처/종류 우선순위로 하나를 선택하도록 구현. 원본 열린 구간 여부로 제외한 뒤 나머지 구간만 시각 계산에서 닫았다.
- 검증 사실: `node tests/test_app.js` 통과. `python -m http.server 8765`로 `public/index.html?data=/data/latest.json` HTTP 200 확인.
- 미완료: 실제 브라우저의 시각 렌더링은 사용자 확인 범위로 남음.
