# @cp949/runo-pyodide-core

pyodide를 Web Worker에서 실행하는 프로토콜(RPC·`input()` 메일박스·interrupt buffer)·worker 커널·main 세션. UI·xterm·coincident에 의존하지 않는다. private이고 공개 API로 확정하지 않은 내부 계약이다. 배포는 `pnpm pack` tarball이다.

## 설치

tarball을 `file:`로 설치한다(`pnpm smoke:pack`이 이 경로를 검증한다). 진입점은 두 개다.

- `@cp949/runo-pyodide-core`: main 쪽(프로토콜, `startCoreSession`, `createRunner`, `RunRejectedError`, `PYODIDE_VERSION`, `DEFAULT_PYODIDE_INDEX_URL`).
- `@cp949/runo-pyodide-core/worker`: worker 쪽(`runWorker`, `bootWorker`, `runDriver`, driver 타입).

## 코드 실행(`createRunner`)

UI 비의존으로 코드 한 덩어리씩 실행한다. xterm 없이 `onOutput`·`InputProvider`만 채워 쓴다(xterm 실행창은 `@cp949/runo-pyodide-terminal`의 `createTerminalRunner`가 이것을 감싼다).

```ts
// runner.worker.ts — 앱의 worker 파일. Vite `worker.format`은 'es'.
import { runDriver, runWorker } from "@cp949/runo-pyodide-core/worker";
runWorker({ driver: runDriver });
```

```ts
import { createRunner, RunRejectedError } from "@cp949/runo-pyodide-core";

const runner = createRunner({
  createWorker: () => new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" }),
  onOutput: ({ stream, text }) => {}, // stdout·stderr 원문 조각. 줄 끝·색은 소비자가 정한다
  onStatus: (status) => {},           // loading | ready | running | waiting-input | restarting | load-failed | crashed | not-isolated
  inputProvider: async (prompt, signal) => "한 줄", // 생략하면 input()은 읽기 취소(KeyboardInterrupt)를 받는다
  // filename?: "main.py", topLevelAwait?: false, pyodide?: { indexURL }
});

try {
  const result = await runner.run("x = 1\nprint(x)"); // 코드는 run마다 새 globals(__main__)에서 실행된다
  // { kind: "ok" } | { kind: "error", errorType, traceback } | { kind: "interrupted", traceback }
  // | { kind: "exit", code } | { kind: "restarted" }
} catch (error) {
  if (error instanceof RunRejectedError) error.reason; // "busy" | "unavailable" | "disposed" | "crashed"
}

await runner.stop(); // "idle" | "stopped" | "restarted" — interrupt 뒤 1000ms 안에 끝나지 않으면 worker를 교체한다
runner.interrupt();  // Ctrl+C용. interrupt만 보내고 terminate하지 않는다
runner.reset();      // worker를 새로 만든다(변수·import 초기화)
runner.dispose();
```

- 한 번에 하나만 실행한다. 실행 중(대기 포함)의 `run()`은 `RunRejectedError("busy")`다. 로딩·재시작 중의 `run()`은 `ready`까지 기다린다.
- 페이지가 cross-origin isolated여야 한다. 아니면 worker를 만들지 않고 상태 `not-isolated`, `run()`은 `unavailable`이다.
- `input()`은 `InputProvider`가 받는다. provider 생략 또는 `null` 반환은 읽기 취소라서 `input()`이 `EOFError`가 아니라 `KeyboardInterrupt`이고 결과는 `interrupted`다.
- 옵션 오류(빈 `filename` 등)는 worker를 만들기 전에 동기로 던진다.
- 상태 전이표·`run()` 거부 조건·`stop()` 결말·`InputProvider` 계약은 `docs/design/14-runner.md`.

## pyodide 요구사항

- `pyodide`는 **optional peer**다(`package.json`의 `peerDependencies.pyodide`는 `^` 범위, `peerDependenciesMeta.pyodide.optional: true`). 범위는 Python 3.14 minor(`314.x`) 안의 타입 호환이다.
- `./worker`의 `.d.mts`가 `pyodide`·`pyodide/ffi` 타입을 import한다. 이 진입점을 TypeScript에서 쓰는 소비자는 같은 minor의 `pyodide`를 설치한다. `skipLibCheck: false`이면 `lib: ["ESNext", ...]`와 `types: ["node", "emscripten"]`도 필요하다(`docs/design/09-testing.md` 9.8.3).
- 런타임은 `pyodide` npm 패키지를 import하지 않는다. worker가 CDN에서 `loadPyodide`를 불러온다(기본 `DEFAULT_PYODIDE_INDEX_URL`). 타입을 쓰지 않는 소비자는 설치하지 않아도 된다.

## 지원 pyodide 버전

지원 버전은 `PYODIDE_VERSION`(export) 하나다. 값은 빌드 때 설치된 `pyodide/package.json`의 `version`이고, 저장소에서는 `pnpm-workspace.yaml` catalog가 원천이다(`docs/adr/0007-pyodide-single-version-policy.md`).

`indexURL`로 다른 버전을 로드하면 동작하지만 보장하지 않는다. 로드된 `pyodide.version`이 `PYODIDE_VERSION`과 다르면 콘솔에 경고가 1회 나온다.

```text
[session] pyodide 호환 경고 { expected, actual, degraded, details }
```

같은 버전이어도 pyodide 비공개 API 지점이 기대와 다르면 같은 경고가 나오고 `degraded`에 식별자가 실린다. `setInterruptBuffer`·`checkInterrupt`가 없으면 시작하지 않는다(`loadFailed`). 지점 목록과 업그레이드 절차는 `docs/design/13-version-upgrade.md`.
