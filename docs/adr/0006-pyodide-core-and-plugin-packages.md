# pyodide-core를 한 벌로 두고 REPL·실행창·DOM 브리지·React를 그 위의 패키지로 나눈다

REPL 외에 두 소비자가 생겼다. (1) host(`example.com`)의 monaco에서 작성한 코드를 iframe(`sandbox.example.com`)에서 실행하고 `input()`·Ctrl+C만 받는 **실행창**, (2) coincident로 worker에서 main의 DOM을 동기 프록시로 쓰는 **DOM 실행창**(`/work/cp949/runo/runo-pyodide-canvas`, canvas는 예시). 두 소비자 모두 이 저장소가 RD-002~009에서 확정한 `input()`(메일박스)·Ctrl+C(interrupt buffer·SIGINT 핸들러·`time.sleep` 조각)가 필요하고, canvas 저장소는 같은 사실(`time.sleep` interrupt 무시, 20ms 조각, SIGINT 핸들러 누락 시 누수)을 다시 발견하던 중이었다. 모드 플래그로 REPL/실행창을 한 패키지에서 분기하면 이미 큰 `session.ts`·`worker/boot.ts`가 더 커진다.

결정: 패키지를 다음으로 나눈다(이름 `@cp949/runo-pyodide-*`, 전부 이 저장소 `packages/`, 버전 동기).

| 패키지 | 내용 | xterm | coincident |
| --- | --- | --- | --- |
| `xterm-readline` | 벤더링 줄 편집기(기존) | O | X |
| `pyodide-core` | 프로토콜(RPC·메일박스·interrupt), worker 커널(로드·출력·stdin·SIGINT·sleep 조각·webloop), 실행 driver, main 세션. UI 비의존 | X | X |
| `pyodide-terminal` | xterm 실행창: `input()` 중에만 한 줄 입력, 그 외 키 무시, Ctrl+C | O | X |
| `pyodide-repl` | REPL driver + REPL 프런트(기존 패키지 축소, 공개 API 유지) | O | X |
| `pyodide-dom-bridge` | coincident로 `runo.browser`(window/document) 프록시만 | X | O |
| `pyodide-react` | `<PythonRepl>`·`<PythonRunner>`·hook | — | — |

- core는 한 벌이다. coincident는 core의 변형이 아니라 DOM 접근 전용 플러그인이며, `input()`·출력·중단은 coincident를 거치지 않고 core 채널로 간다. core·repl·terminal·react는 coincident에 의존하지 않는다(시험으로 강제).
- REPL + dom-bridge 조합은 지원하지 않는다(문서화만). REPL은 프롬프트 대기 중 main→worker 요청(Tab 완성)이 필요한데 coincident 동기 대기가 그것을 막는다(이전 구현 TRP-005, [ADR-0001](./0001-no-sync-bridge-library.md)).
- 입력 UI seam은 main 쪽 `InputProvider(prompt, signal) => Promise<string | null>`이다. `prompt`는 pyodide가 이미 stdout에 쓴 미종결 꼬리(참고값)다.
- worker 파일은 앱이 조립한다(`runWorker({ driver, plugins })`, `createWorker` 주입 유지). dom-bridge를 쓰면 worker 첫 import가 `coincident/window/worker`여야 하고, core init 리스너는 모듈 본문에서 동기 등록하며 `kind: "init"` 객체만 받는다(첫 메시지를 무조건 소비하지 않는다).
- 배포는 당분간 `pnpm pack` tarball이다. npm 공개 배포는 하지 않는다(`ROADMAP.md` 범위 밖 항목 유지).

근거: 2026-09-24 공존 스파이크(Chromium, `_tmp/spike-coincident-core/RESULT.md`, 저장소 밖 기록)에서 같은 worker의 coincident 부트스트랩과 core 초기화·메일박스 `input()`·interrupt Ctrl+C·DOM 프록시가 공존했다. 조건은 core init 리스너의 동기 등록이다(매크로태스크 뒤 등록은 프레임 소실).

## Considered Options

- 모드 플래그(`mode: "repl" | "run"`)로 한 패키지에서 분기: 기각. 공통과 REPL 전용이 한 파일에 섞인 상태가 커진다.
- coincident가 있는 core와 없는 core 두 벌: 기각. `input()`·Ctrl+C 구현이 두 벌이 된다.
- coincident 경로에서 `input()`을 `window.prompt`로 대체: 기각. 모달이 main을 멈추고, `allow-modals` 없는 iframe·cross-origin iframe에서 막힐 수 있으며(canvas D7), 실행창의 `input()`은 REPL 읽기와 경쟁하지 않아 메일박스로 충분히 단순하다.
- terminal 코어와 worker 코어를 별도 패키지로: 기각. Ctrl+C 한 동작이 main 송신기·SAB·worker 핸들러를 관통한다. 대신 core는 UI 비의존으로 두고 xterm 부분만 terminal·repl로 뺀다.

## Consequences

RD-020(core 추출)은 완료된 RD 17건의 코드를 옮기므로 전체 기준선(`e2e:baseline`)으로 판정한다. coincident 동기 호출 중에는 Ctrl+C가 닿지 않는다(호출 반환 직후 `KeyboardInterrupt`, 대기 중 `Atomics.pause` busy-wait) — 끝나지 않는 main 함수는 terminate 폴백뿐이다. Firefox·`native: false` 환경의 공존은 미실측이며 RD-023 착수 조건이다.
