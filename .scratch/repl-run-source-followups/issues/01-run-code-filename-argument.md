# `run_code`의 `filename` 인자를 없애 파일명 원천을 `console.filename` 하나로 만든다

Status: deferred
Origin: RD-022a 마무리(core `exec_in_console` 분리 때 결정). 내부 구조 기록.

## 현상

runner 경로는 `run_code(console, source, filename, top_level_await)`로 `filename`을 받아 `_new_globals`의 `__file__`과 `exec_in_console`의 컴파일 파일명에 쓴다. 콘솔 `filename`(`createCoreConsole(pyodide, sinks, { filename })`)과 같은 옵션에서 만들어지므로 실제로는 같지만 구조로 강제되지 않는다. 다르면 트레이스백 프레임이 전부 사라지고 SIGINT 규칙 ①이 취소를 버린다(`docs/traps/TRP-052`, `TRP-020`). REPL `runSource`는 인자를 생략해(`console.filename`) 구조로 일치한다.

## 완료 기준

`run_code`가 `console.filename`만 쓰고 `filename` 인자와 TS 호출부(`run-driver.ts`의 `options.filename` 전달)가 없다. core 시험이 그대로 통과한다.

걸림돌: 기존 시험 두 파일이 4인자 시그니처를 고정한다(`run-driver.test.ts`의 `toHaveBeenCalledWith(..., "app.py", true)`, `run-driver-classify.test.ts`의 `FakeConsole`에 `filename` 없음). 두 시험의 수정이 필요하다.

## 재개 조건

runner에서 콘솔 `filename`과 실행 파일명이 어긋난 사례가 관찰될 때, 또는 core 실행 driver의 API를 손보는 RD(RD-023·024)에서 `run_code`를 건드릴 때.

## Comments

- 2026-09-24 등록 시점 분류: 제품 결함이 아닌 구조 정리이고 어긋난 사례가 없다. 증상 기록은 TRP-052가 맡는다. 기록만 남기는 `deferred`.
