# 프롬프트가 그려지기 전 구간에서 `runSource`는 `busy`로 거부한다(대기로 바꿀 수 있다)

Status: deferred
Origin: RD-022a 마무리(사양 결정 기록, `docs/design/02-console-core.md` 5.6.2·5.6.7).

## 현상

`readLine` 요청이 도착해 main이 읽기를 열었지만 벤더 write 콜백(그리기)이 오기 전(수 ms, 긴 꼬리면 `rewindTail`의 flush까지) `runSource()`를 부르면 `RunRejectedError("busy")`다. 벤더 `takeRead()`는 그리기 전 읽기도 가져갈 수 있지만(텍스트 `""`·커서 0) 그때는 화면에서 지울 것과 꼬리 위치를 알 수 없어 거부로 정했다. 명령 출력 직후 곧바로 `runSource()`를 부르는 소비자는 드물게 `busy`를 받는다. 브라우저 확인(`e2e:run-source` 개발 3회 + 공식 1회)에서는 관찰되지 않았다.

## 완료 기준

이 구간의 호출이 `loading`처럼 대기가 되어 읽기가 그려진 콜백(`terminal/source-bridge.ts`의 `readOpened`)에서 실행된다. 이 구간에서 부른 `runSource`가 `busy`가 아니라 `ok`로 끝난다는 jsdom 시험, `busy` 게터·`02-console-core.md` 5.6.2 표·`ReplHandle.runSource` 주석을 함께 고친다.

## 재개 조건

소비자(RD-024 `<PythonRepl>`, 앱 코드)나 e2e에서 프롬프트가 보이기 전 호출이 `busy`로 거부되는 것이 관찰될 때(호출 시각과 화면 상태 기록).

## Comments

- 2026-09-24 등록 시점 분류: 1회도 관찰되지 않은 추정이라 `open` 조건(재현 가능한 시나리오)을 충족하지 못한다. `deferred`.
- 2026-09-25 판정: `deferred` 유지(RD-026 범위 밖). 사양 선택(거부 vs 대기)이고 소비자·e2e 관찰이 없다. 재개 조건 그대로.
