# check-dist CSP 규칙의 주석 제거가 정규식이라 문자열 리터럴 속 `//`·`/*`를 파싱하지 못한다

Status: deferred
Origin: RD-023 DELTA-03(2026-09-25). 코드 읽기로 추정한 검사 도구의 한계이고 거짓 결과는 아직 관찰하지 않았다.

## 현상

`scripts/check-dist.mjs --allow-sync-bridge`는 블록 주석(`/* */`)과 줄 머리·공백 뒤의 `//` 주석을 정규식으로 지운 뒤 모듈 지정자와 금지 표현(`evaluate`·`serviceWorker`·`coincident/sync`·`window.import`·`.import(`)을 찾는다. 문자열 리터럴을 파싱하지 않으므로 문자열 안의 `/*`나 ` //`가 있으면 뒤 코드가 가려져 위반을 놓치거나, 반대로 주석 안 문구가 위반으로 잡힐 수 있다. 현재 dom-bridge 소스·dist에서는 재현되지 않았다(소스 변이 8종·dist 변이 2종 모두 killed).

넓은 토큰(`\bevaluate\b`, `.import(`)은 dom-bridge 전용이라 거짓 위반이 나면 소스 표현을 바꾸는 쪽이 싸다.

## 재개 조건

dom-bridge 소스·dist에서 주석 제거 오판으로 위반을 놓치거나 거짓 위반이 난 사례가 실측될 때. 그 전에는 조사하지 않는다(`docs/agents/issue-tracker.md` "등록·분류 기준": 코드 읽기로만 추정한 테스트 도구 문제).

## Comments

- 2026-09-25 등록 시점 분류: `deferred`. 규칙 본문은 `docs/design/16-dom-bridge.md` 16.12.
