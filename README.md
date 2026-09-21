# runo-pyodide-repl

브라우저에서 pyodide(Python 3.14)를 Web Worker로 실행하고 xterm.js 터미널로 CPython 3.14 기본 REPL과 같은 조작감을 제공하는 라이브러리(`@cp949/runo-pyodide-repl`)와 데모 앱.

상태: **설계 단계**. 코드는 스켈레톤이고 구현은 `ROADMAP.md` 순서로 진행한다.

## 문서

| 문서 | 내용 |
| --- | --- |
| `DESIGN.md` | 설계 색인, 결정된 스택, 읽기 순서 |
| `docs/design/00-architecture.md` | 프로세스 모델·채널 3종·생명주기·패키지·공개 인터페이스 |
| `docs/design/01-protocols.md` | RPC 메시지, stdin 메일박스, interrupt buffer, 초기화 프레임 |
| `docs/design/02~08` | 기능별 규칙(콘솔, Ctrl+C, stdin, 출력, 편집, Tab, 세션) |
| `docs/design/09~12` | 테스트 전략, 3.14 편차·범위 밖, 알려진 함정, 이전 구현 인벤토리 |
| `docs/adr/` | 결정 기록(동기 브리지 미채택, 메일박스, readline 벤더링, cross-origin isolation, input 동기 유지) |
| `ROADMAP.md` | 구현 순서와 완료 기준 |
| `CONTEXT-MAP.md` | 용어 사전 위치 |
| `docs/agents/` | 에이전트 작업 절차(rubber-workflow, issue tracker, domain docs) |

## 구조

```text
apps/demo                Vite + React 19 데모
packages/pyodide-repl    @cp949/runo-pyodide-repl — 코어(main 쪽 + worker 쪽 + 프로토콜 + Python 스크립트)
packages/xterm-readline  @cp949/runo-xterm-readline — strtok/xterm-readline 1.2.2 벤더링(MIT), RD-001에서 생성
packages/eslint-config, packages/typescript-config
```

## 실행

```bash
pnpm install
pnpm dev          # turbo: 패키지 watch + apps/demo dev 서버
pnpm build
pnpm test
pnpm lint
pnpm check-types
```

## 호스팅 요구

페이지가 cross-origin isolated여야 한다(`SharedArrayBuffer`). 응답 헤더:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

dev·preview·정적 배포 모두 필요하다. 격리되지 않은 페이지에서는 Ctrl+C와 `input()`이 동작하지 않는다. pyodide는 jsdelivr CDN에서 로드한다(CORP 헤더 제공).

## 이전 구현

`/work/cp949/pyodide-samples/apps/repl`. coincident 동기 브리지 위에 만든 이전 구현이며 읽기 전용 참고다. 기능 규칙과 측정치는 `docs/design/`에 이관했다.

## 라이선스

`packages/xterm-readline`은 Erik Bremen의 xterm-readline(MIT)을 벤더링한 것이다. 원본 고지는 그 패키지의 `LICENSE-MIT`에 있다.
