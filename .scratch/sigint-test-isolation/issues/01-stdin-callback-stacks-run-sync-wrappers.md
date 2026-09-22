# 01 `stdin-callback.test.ts`가 `run_sync` 래퍼를 원복 없이 겹쌓는다

Status: open

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
