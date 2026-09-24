# 출력: sink 4종·전역 스트림·배너

> 이 문서의 규칙·상수는 이전 구현(`/work/cp949/pyodide-samples/apps/repl`, 읽기 전용 참고)이 CPython 3.14.4 pty 실측과 브라우저 회귀로 확정한 것이다. 새 구현은 통신 계층만 바꾸고(`docs/design/00-architecture.md`, `01-protocols.md`) 이 규칙은 그대로 지킨다. 절 끝의 "참고:" 경로는 이전 구현의 근거 위치다.

새 구현에서 sink 4종은 worker→main **단방향 RPC 알림**(`notify`)으로 전달된다. 이전 구현은 조각마다 worker를 멈추는 동기 호출이었고, 그 동기성은 요구사항이 아니었다. 순서 보장은 같은 MessagePort의 FIFO에 의존한다(`01-protocols.md` 1절).

## 4.1 sink 4종(`createTerminalSinks(readline)`)
sink 4종은 repl `terminal/sinks.ts`(REPL main driver가 세션마다 만든다)가 소유한다. `write`·`writeErrorRaw`는 core 세션이 `write`·`writeErrorRaw` 알림을 `{ stream: "stdout" | "stderr", text }`로 넘기는 `output` 콜백을 REPL main driver가 연결한 것이고(`stdout` → `write`, `stderr` → `writeErrorRaw`), `writeOutput`·`writeError`는 core가 아니라 REPL main driver의 RPC 핸들러가 부른다(`01-protocols.md` 1.2, `00-architecture.md` 4.1 core export). 꼬리 추적기 `createOutputTail`(`output-tail`)은 터미널에 의존하지 않는 순수 모듈이라 core `terminal/output-tail.ts`에 있고 `sinks.ts`가 import한다.

| sink | 구현 | 개행 | 색 | 용도 |
| --- | --- | --- | --- | --- |
| `writeOutput` | `readline.println(text)` | 강제 `\r\n` | 없음 | 식 값 에코, 시작 배너 |
| `writeError` | `println("\x1b[31m…\x1b[0m")` | 강제 `\r\n` | 빨강(한 번 감쌈) | 트레이스백, SyntaxError, 붙여넣기 파싱 오류, 취소 `KeyboardInterrupt` |
| `write` | `readline.print(text)` | 없음 | 없음 | `stdout_callback` 조각, `^C` 에코, 전역 stdout |
| `writeErrorRaw` | `print("\x1b[31m…\x1b[0m")` | 없음 | 조각마다 열고 닫음 | `stderr_callback` 조각, 전역 stderr |

- **개행 계약**: println 계열 sink가 `\r\n`을 붙이므로 호출부는 **끝 개행 없는 텍스트**를 넘긴다. 붙이면
  프롬프트 앞에 빈 줄이 하나 더 생긴다(TRP-012). 트레이스백/SyntaxError는 `formatted_error`의 **끝 개행
  하나만** 제거하고 메시지 자체의 개행은 보존한다.
- `writeErrorRaw`는 Python이 쓴 조각 그대로(개행 추가·제거 없음) 낸다. **빈 조각(`print(end="")`의 `end`,
  `write("")`)은 아무것도 내지 않는다.** 빨강은 조각마다 열고 닫는 무상태 방식이고 main sink가 입힌다
  (worker는 텍스트만 넘긴다). 한계: stderr 텍스트 자체의 SGR이 조각 경계를 넘으면 조각 끝 `\x1b[0m`에서 끊긴다.
- `\r` 진행률: `write`/`writeErrorRaw`가 개행을 강제하지 않으므로 `\r30%` 같은 한 줄 갱신이 그대로 반영된다.
  꼬리 계산은 마지막 `\r` 뒤를 취한다.
- 모든 sink는 화면에 낸 바이트를 `output-tail`(core `terminal/output-tail.ts`)에 먹인다(`println`은 `text + '\n'`을 먹인다).
  `tail()`/`resetTail()`을 함께 노출한다. **sink 세트는 worker(세션)마다 새로 만든다** — 새 세션이 이전
  꼬리를 물려받지 않게.
- **안내 줄**(`terminal/notice.ts`의 `writeNotice(readline, text, kind)`): 세션 밖에서 main이 찍는 개행으로 끝나는
  한 줄이다. 비격리 경고는 노랑(`warning`, `\x1b[33m…\x1b[0m`), RD-010의 리셋 안내는 청록(`info`, `\x1b[36m`)이다.
  sink 세트가 아니므로 꼬리에 먹이지 않는다. 끝 개행 없는 텍스트를 받아 `println`으로 개행을 붙이고 부분 줄은 내지
  않는다. `11-known-traps.md`의 TRAP-12 규칙(sink를 거치지 않는 출력 경로 금지)의 유일한 예외 함수이며, 세션이 없거나(비격리) 리셋으로
  sink 세트를 새로 만드는 자리에서만 쓴다 — 꼬리가 남은 sink 세트 옆에서 부르면 화면과 꼬리가 어긋난다.

## 4.2 batched vs raw, 전역 스트림
- `PyodideConsole`은 `runcode()` 동안에만 `sys.stdout`/`sys.stderr`를 `stdout_callback`/`stderr_callback`
  (순수 Python `_WriteStream`)으로 리다이렉트한다. 이 콜백은 `write()` 호출마다 버퍼링 없이 즉시 실행되며
  FS 레벨 `setStdout`의 `batched`/`raw` 설정과 **완전히 독립**이다. 스트리밍 문제의 원인은 pyodide 설정이
  아니라 브리지가 `println`(개행 강제)을 거치는 것이었다.
- 콘솔 리다이렉트 **밖**(프롬프트 대기 중 배경 콜백 출력, asyncio 예외 로그, 패키지 로딩 메시지)은 전역
  스트림을 탄다. `createSinkWriter(sink)`(core `worker/sink-writer.ts`)가 pyodide `Writer`로 바이트를 받아
  `TextDecoder({ stream: true })`로 조각 경계를 잇고 콘솔 콜백과 **같은 sink**(`write`, `writeErrorRaw`)로
  보낸다. `write`는 받은 바이트 수를 돌려줘야 한다(0을 돌려주면 호출한 쪽이 같은 바이트를 다시 쓴다).
  잘린 상태는 Writer마다 따로 둔다.
- Python 쪽 stdout 버퍼는 건드리지 않는다: `flush=True` 없는 `print(..., end='')`는 CPython처럼 개행·flush
  까지 보이지 않는다.
- 전역 스트림은 `isatty()`가 False여도 pyodide 기본으로 `line_buffering=True`, `write_through=False`다(node 프로브,
  pyodide 314.0.7). 그래서 전역 stdout의 `print("t", end="")`는 다음 개행까지 Writer에 오지 않고(`"tline\n"` 한
  조각) 개행·`\r`·`flush=True`에서 나온다. 전역 stderr도 같아 `sys.stderr.write("raw-err")`는 flush 전까지 오지
  않는다. 버퍼링이 없는 쪽은 콘솔 콜백 경로(`runcode()` 중)뿐이다.
- stderr 버퍼링(`line_buffering=True`)은 모사하지 않는다 — 콘솔 콜백 경로의 웹은 즉시 낸다(TRP-013).

## 4.3 BANNER / 프롬프트 문자열
- 시작 배너는 `pyodide.console` 모듈의 `BANNER`를 `writeOutput`으로 그대로 낸다(sink가 개행을 붙이므로
  배너에 개행을 더하지 않는다). 가짜 리눅스/GCC 배너를 흉내내지 않는다. `BANNER`는 `pyodide.pyimport("pyodide.console")`
  모듈의 속성이고 끝 개행이 없다: `Python 3.14.2 (main, Sep 14 2026 03:03:51) on WebAssembly/Emscripten\nType "help",
  "copyright", "credits" or "license" for more information.`(pyodide 314.0.7, 2행).
- worker 시작 시 `sys.ps1 = ">>> "`, `sys.ps2 = "... "`를 직접 설정한다(pyodide 기본은 `None`이라
  `hasattr(sys, 'ps1')`로 REPL을 판정하는 코드가 어긋난다).

참고: `/work/cp949/pyodide-samples/apps/repl/docs/design/05-output-streaming.md`,
`/work/cp949/pyodide-samples/apps/repl/src/repl/{terminal-sinks,sink-writer,output-tail}.ts`

