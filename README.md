# runo-pyodide-repl

브라우저에서 pyodide(Python 3.14)를 Web Worker로 실행하고 xterm.js 터미널로 CPython 3.14 기본 REPL과 같은 조작감을 제공하는 라이브러리(`@cp949/runo-pyodide-repl`)와 데모 앱.

상태: 구현 초기. `ROADMAP.md` 순서로 진행하며 RD-001(워크스페이스 정비, xterm-readline 벤더링)·RD-002(프로토콜 코어: RPC, stdin 메일박스, interrupt buffer, 초기화 프레임)·RD-003(터미널 마운트와 줄 편집)·RD-004(pyodide 로드, 배너, 출력 sink 4종, 전역 스트림)·RD-005(REPL 루프와 PyodideConsole 코어)·RD-006(`input()`·`sys.stdin` 읽기, 프롬프트 대기 중 배경 `input()` 가드)·RD-007(실행 중 Ctrl+C)·RD-008(입력줄 Ctrl+C 취소와 `input()` 중 Ctrl+C)·RD-009(정지한 실행 중 Ctrl+C)까지 끝났다. 데모는 pyodide를 CDN에서 worker로 로드해 배너를 낸 뒤 한 줄 REPL로 동작한다: `>>> ` 프롬프트에서 식의 값 에코, 트레이스백·SyntaxError 표시, 미완성 블록(`... `), 개행 없는 출력 뒤 `t>>> ` 이어붙임, `exit()`로 세션 종료(상태 `terminated`), `input()`·`sys.stdin` 읽기(프롬프트 뒤에서 입력을 받아 `x: abc` 한 줄로 남김)를 지원하고, `crossOriginIsolated`와 세션 상태(`loading`·`ready`·`load-failed`·`not-isolated`·`terminated`)를 표시한다. 실행 중 Ctrl+C는 `^C` 에코와 `KeyboardInterrupt` 트레이스백으로 중단하고 `>>> `로 돌아온다(연타·키 반복에도 프롬프트가 돌아오고, 부팅 중에 눌러도 시작 코드가 죽지 않는다). 개행이 든 붙여넣기·Shift+Enter 제출은 아직 분할되지 않아(RD-011) 통째로 실행되고 대개 SyntaxError가 난다. 입력줄(`>>> `·`... `)에서 Ctrl+C를 누르면 `^C` 없이 빨간 `KeyboardInterrupt` 한 줄과 함께 미완성 블록이 버려지고, `input()`·`sys.stdin` 읽기 중 Ctrl+C는 그 호출 지점의 진짜 `KeyboardInterrupt`가 되어 `try/except KeyboardInterrupt`가 잡고 `finally`가 돈다(취소한 입력은 history에 남지 않는다). 정지한 실행(`while True: time.sleep(0.1)`·`time.sleep(5)` 단발·`asyncio.run`·`run_until_complete`·`run_sync`·top-level await 대기) 중 Ctrl+C도 한 번에 끊긴다 — 20ms 감시 타이머가 깨우고 `time.sleep`은 20ms 조각마다 폴링해 복귀 중앙값이 30ms 이내다(브라우저 12조합 × N=20 = 240/240 복귀). 프롬프트 대기 중 눌린 낡은 SIGINT는 배경 콜백을 끊지 않고 버려지고, 정상 중단·`input()` 취소·`exit()`에서 브라우저 `pageerror`가 0이다. 세션 리셋(RD-010)은 후속 RD다. `sys.stdin.read()`·`readlines()`는 EOF(Ctrl+D)가 없어 끝나지 않는다(편차 34).

## 문서

| 문서 | 내용 |
| --- | --- |
| `DESIGN.md` | 설계 색인, 결정된 스택, 읽기 순서 |
| `docs/design/00-architecture.md` | 프로세스 모델·채널 3종·생명주기·패키지·공개 인터페이스 |
| `docs/design/01-protocols.md` | RPC 메시지, stdin 메일박스, interrupt buffer, 초기화 프레임 |
| `docs/design/02~08` | 기능별 규칙(콘솔, Ctrl+C, stdin, 출력, 편집, Tab, 세션) |
| `docs/design/09~12` | 테스트 전략, 3.14 편차·범위 밖, 알려진 함정, 이전 구현 인벤토리 |
| `docs/design/13-version-upgrade.md` | pyodide 버전 원천(pnpm catalog), 업그레이드 절차, 부팅 시 호환 탐지 등급표 |
| `docs/adr/` | 결정 기록(동기 브리지 미채택, 메일박스, readline 벤더링, cross-origin isolation, input 동기 유지, core·플러그인 패키지 분리, pyodide 단일 버전 고정) |
| `docs/traps/` | 이 저장소에서 새로 발견한 함정(색인 `INDEX.md`). 이전 구현의 함정은 `docs/design/11-known-traps.md` |
| `ROADMAP.md` | 구현 순서와 완료 기준 |
| `CONTEXT-MAP.md` | 용어 사전 위치 |
| `docs/agents/` | 에이전트 작업 절차(rubber-workflow, issue tracker, domain docs) |

## 구조

```text
apps/demo                Vite + React 19 데모
packages/pyodide-core    @cp949/runo-pyodide-core — 프로토콜·worker 커널·main 세션(private, UI·xterm·coincident 비의존)
packages/pyodide-repl    @cp949/runo-pyodide-repl — REPL driver + REPL 프런트(main 쪽 + worker 쪽 + Python 스크립트)
packages/pyodide-testkit @repo/pyodide-testkit — 시험 전용 도우미(private, pack 제외)
packages/xterm-readline  @cp949/runo-xterm-readline — strtok/xterm-readline 1.2.2 벤더링(MIT), 변경 목록은 패키지 README
packages/eslint-config, packages/typescript-config
```

## 실행

```bash
pnpm install
pnpm dev          # apps/demo의 vite dev 서버만 띄운다. 패키지는 소스 TS를 직접 해석한다(빌드 불필요)
pnpm build        # 패키지 tsdown 빌드 뒤 데모 vite build
pnpm preview      # 빌드(필요하면 자동 실행) 뒤 apps/demo의 vite preview. 빌드 산출물 확인용
pnpm test         # 패키지 시험 + 빌드 산출물 검사(check-dist)
pnpm smoke:pack   # pnpm pack tarball을 저장소 밖에 설치해 import·tsc 확인(수동, 네트워크 필요)
pnpm lint
pnpm check-types  # 의존 패키지 빌드(d.ts) 뒤 실행된다
```

패키지 `dist`를 개별로 watch 빌드하려면 `pnpm --filter <패키지> dev`(`tsdown --watch`).

## 호스팅 요구

페이지가 cross-origin isolated여야 한다(`SharedArrayBuffer`). 응답 헤더:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

dev·preview·정적 배포 모두 필요하다. `apps/demo/vite.config.ts`가 `server.headers`와 `preview.headers` 둘 다에 설정하고, `apps/demo/src/vite-config.test.ts`가 두 곳과 `worker.format: 'es'`를 시험한다. 정적 배포는 HTML과 worker 스크립트를 포함한 모든 응답에 헤더를 붙인다(preview에서 HTML·worker 에셋 둘 다 확인). 격리되지 않은 페이지에서는 `createRepl`이 worker를 만들지 않고 터미널에 경고 한 줄만 낸다(상태 `not-isolated`, ADR-0004). pyodide는 jsdelivr CDN에서 로드한다(CORP 헤더 제공).

## 브라우저 회귀 확인

```bash
pnpm exec playwright install chromium   # 최초 1회
pnpm --filter demo e2e:baseline         # 서버를 스스로 띄우고 판정 16종 + boot-press N=30을 돌려 기준선과 대조
```

자세한 실행법·개별 스크립트 목록·기준 인터프리터 버전 차이는 `apps/demo/e2e/README.md`(기준선 표는
`apps/demo/e2e/BASELINE.md`).

## 이전 구현

`/work/cp949/pyodide-samples/apps/repl`. coincident 동기 브리지 위에 만든 이전 구현이며 읽기 전용 참고다. 기능 규칙과 측정치는 `docs/design/`에 이관했다.

## 라이선스

`packages/xterm-readline`은 Erik Bremen의 xterm-readline(MIT)을 벤더링한 것이다. 원본 고지는 그 패키지의 `LICENSE-MIT`에 있다.
