# 01 `stdin-callback.test.ts`가 `run_sync` 래퍼를 원복 없이 겹쌓는다

Status: done

## 현상

`packages/pyodide-repl/src/worker/stdin-callback.test.ts`는 `loadPyodide()` 인스턴스 하나에 `setupConsole()`을
13회 부른다. `installSigintHandler`는 설치할 때마다 `pyodide.webloop.run_sync`·`pyodide.ffi.run_sync`(모듈 전역)를
래퍼로 바꾸는데, 이 파일에는 원복이 없다. `src/test/sigint-setup.ts`의 `teardownConsoleRunner`만 첫 설치 전 값을
`pyodide.ffi._test_original_run_sync`에 붙잡아 두고 되돌린다. 그래서 이 파일에서는 반복 설치마다 래퍼가 13겹
쌓인다.

## 왜 지금은 안 보이나

이 파일이 `run_sync` 경로(`asyncio.run`·`run_until_complete`·`from pyodide.ffi import run_sync`)를 쓰지 않아
전부 GREEN이다. 그런 시나리오가 이 파일에 추가되는 순간 겹쌓인 래퍼가 동작을 바꾼다(각 층이 자기 `guard` Task를
만들고 자기 `waiters`를 본다). 통과하는 스위트만 보고는 알 수 없다.

## 선택지

1. `sigint-setup.ts`의 SAVE/RESTORE를 공용 도우미(예: `saveRunSync(pyodide)` / `restoreRunSync(pyodide)`)로 뽑아
   `stdin-callback.test.ts`의 `afterEach`도 쓰게 한다.
2. `stdin-callback.test.ts`가 `setupConsole()`을 파일당 1회만 부르도록 조립을 바꾼다.
3. `run_sync`를 쓰지 않는 한 방치하고, 이 파일에 `run_sync` 시나리오를 추가할 때 같이 고친다.

## 판단 근거

RD-009 범위 밖(시험 조립 정리)이라 ROADMAP 항목으로 등록하지 않았다. 다음에 이 시험 파일을 만질 때 1 또는 2를
고른다.

## 해결

2026-09-23, 선택지 1. `sigint-setup.ts`의 SAVE/RESTORE를 `saveRunSync(pyodide)` / `restoreRunSync(pyodide)`로
export하고(`setupConsoleRunner`·`teardownConsoleRunner`도 이것을 쓴다), `stdin-callback.test.ts`의
`setupConsole()`이 `installSigintHandler` 앞에서 `saveRunSync`, 첫 `afterEach`가 `restoreRunSync`를 부른다.
선택지 2는 시험마다 새 콘솔·버퍼·`screen`이 필요해 맞지 않고, 3은 `run_sync` 시나리오 추가 때 조용히 깨진다.

- 검증: 임시 시험(삭제함)으로 원복 없이 3회 설치하면 `pyodide.ffi.run_sync`·`pyodide.webloop.run_sync`가 원본과 다르고
  (대조), 설치·`restoreRunSync` 3회 반복은 매번 원본과 같음을 확인. `pnpm check-types`·`pnpm lint` 통과,
  `pnpm test` 41 파일 939건 통과.
- 관찰: `stdin-callback.test.ts`와 `sigint-handler.test.ts`를 병렬로 돌리면 변경 전에도 10회 중 1회
  `sigint-handler.test.ts:368`(`"20\n"` 기대, `"19\n"` 수신)이 실패한다(변경 후 5회 중 1회). 이 변경과 무관한
  기존 현상이며 이슈 02의 범위다.

## 리뷰 정정

2026-09-23. `restoreRunSync`가 Python을 돌리는데 두 해체(`stdin-callback.test.ts`의 첫 `afterEach`,
`teardownConsoleRunner`) 모두 버퍼를 떼기 전에 불렀다. 남은 SIGINT가 있으면 이 실행이 그것을 받는다(해체 주석의
"버퍼를 먼저 떼고" 불변식 위반). 두 곳 모두 SIGINT 핸들러를 기본으로 되돌린 뒤로 옮겼다.

- 검증: 파일 끝 임시 시험(삭제함)이 앞선 `setupConsole()` 반복 뒤 `pyodide.ffi.run_sync`·`pyodide.webloop.run_sync`가
  `_test_original_run_sync`와 같음을 확인(27건 통과). 대조로 `restoreRunSync`를 주석 처리하면 `[false, false]`로 실패.
  `pnpm check-types`·`pnpm lint` 통과, `pnpm test` 41 파일 939건 통과.
- 남김: `stdin-callback.test.ts`의 `setupConsole()`은 `installSigintHandler`가 돌려준 `interrupt_idle` proxy를
  destroy하지 않는다(`teardownConsoleRunner`는 한다). 겹쌓임은 아니라 동작 영향이 없어 이 이슈에서는 고치지 않았다.
