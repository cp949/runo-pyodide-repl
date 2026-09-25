// @vitest-environment node
/**
 * 루트 `scripts/check-dist.mjs`(빌드 산출물에 `coincident`·`reflected-ffi` 문자열이 없는지, `.mjs`에 `pyodide` 런타임 import가 없는지 검사) 시험. 스크립트를 자식
 * 프로세스로 실행해 종료 코드와 메시지를 본다. 실제 패키지의 `dist`를 검사하는 것은 각 패키지의 `check-dist` 스크립트다(turbo
 * `check-dist`가 `build` 뒤에 돌린다).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../scripts/check-dist.mjs", import.meta.url),
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더를 만들고 `files`(상대 경로 → 내용)를 쓴다. */
function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-dist-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function run(...targets: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...targets], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 동기 브리지 허용 패키지(dom-bridge)용 옵션으로 실행한다. */
function runAllowSyncBridge(...targets: string[]) {
  return run("--allow-sync-bridge", ...targets);
}

/** 스크립트가 없어서(MODULE_NOT_FOUND) 종료 코드 1이 나오는 경우와 구분하려고, 검사가 스스로 실패했다는 표식을 함께 본다. */
const FAIL_MARK = "check-dist 실패";

describe("check-dist 스크립트", () => {
  test("금지 문자열이 없는 dist는 통과한다", () => {
    const dist = makeDist({
      "index.mjs": "export const a = 1;\n",
      "index.d.mts": "export declare const a: number;\n",
    });

    const { status, output } = run(dist);

    expect(status, output).toBe(0);
  });

  test("산출물 한 파일에 coincident 문자열이 있으면 실패하고 그 파일 이름을 알린다", () => {
    const dist = makeDist({
      "index.mjs": "export const a = 1;\n",
      "worker.mjs": 'import coincident from "coincident";\n',
    });

    const { status, output } = run(dist);

    expect(status).toBe(1);
    expect(output).toContain(FAIL_MARK);
    expect(output).toContain("worker.mjs");
    expect(output).toContain("coincident");
  });

  test("하위 폴더 안의 파일도 검사한다", () => {
    const dist = makeDist({
      "index.mjs": "ok\n",
      "chunks/deep/x.mjs": "// coincident\n",
    });

    expect(run(dist).output).toContain(FAIL_MARK);
  });

  test("소스맵(.map) 안의 문자열도 잡는다", () => {
    const dist = makeDist({
      "index.mjs": "ok\n",
      "index.mjs.map": '{"sources":["../node_modules/coincident/index.js"]}',
    });

    expect(run(dist).output).toContain(FAIL_MARK);
  });

  test("대문자가 섞인 표기도 잡는다", () => {
    const dist = makeDist({ "index.mjs": "// Coincident 브리지\n" });

    expect(run(dist).output).toContain(FAIL_MARK);
  });

  test("reflected-ffi 문자열도 실패시킨다", () => {
    const dist = makeDist({ "index.mjs": 'import "reflected-ffi";\n' });

    expect(run(dist).output).toContain(FAIL_MARK);
  });

  test("dist 폴더가 없으면 건너뛰지 않고 실패한다", () => {
    const dist = makeDist({});
    rmSync(dist, { recursive: true });

    const { status, output } = run(dist);

    expect(status).toBe(1);
    expect(output).toContain(FAIL_MARK);
    expect(output).toContain("pnpm build");
  });

  test.each([
    ["정적 import(큰따옴표)", 'import { loadPyodide } from "pyodide";\n'],
    ["정적 import(작은따옴표)", "import { loadPyodide } from 'pyodide';\n"],
    ["서브패스 import", 'import { x } from "pyodide/ffi";\n'],
    ["동적 import", 'const m = await import("pyodide");\n'],
    ["부수효과 import", 'import "pyodide";\n'],
  ])(
    "`.mjs`에 pyodide 런타임 import(%s)가 있으면 실패하고 그 파일 이름을 알린다",
    (_이름, 내용) => {
      const dist = makeDist({ "index.mjs": "ok\n", "worker.mjs": 내용 });

      const { status, output } = run(dist);

      expect(status).toBe(1);
      expect(output).toContain(FAIL_MARK);
      expect(output).toContain("worker.mjs");
      expect(output).toContain("pyodide 런타임 import");
    },
  );

  test("`.d.mts`의 pyodide 타입 import와 `.mjs` 안 Python 코드 문자열은 통과한다", () => {
    const dist = makeDist({
      "worker.d.mts": 'import type { PyodideInterface } from "pyodide";\n',
      "index.mjs":
        'export const py = "from pyodide.ffi import to_js";\nexport const name = "pyodide-lock";\n',
    });

    const { status, output } = run(dist);

    expect(status, output).toBe(0);
  });

  test("dist 폴더가 비어 있으면 실패한다", () => {
    const dist = makeDist({});

    expect(run(dist).output).toContain(FAIL_MARK);
  });

  test("대상 폴더를 하나도 주지 않으면 실패한다", () => {
    expect(run().output).toContain(FAIL_MARK);
  });
});

describe("check-dist 스크립트: --allow-sync-bridge(dom-bridge 예외)", () => {
  test("허용 진입점(coincident/window/main·worker) import는 통과한다", () => {
    const dist = makeDist({
      "index.mjs": 'import coincident from "coincident/window/main";\n',
      "worker.mjs": 'import coincident from "coincident/window/worker";\n',
    });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status, output).toBe(0);
  });

  test("옵션 없이는 같은 dist가 그대로 실패한다(다른 패키지의 금지 보장은 약해지지 않는다)", () => {
    const dist = makeDist({
      "index.mjs": 'import coincident from "coincident/window/main";\n',
    });

    const { status, output } = run(dist);

    expect(status).toBe(1);
    expect(output).toContain(FAIL_MARK);
  });

  test.each([
    ["coincident/sync", 'import "coincident/sync";\n'],
    ["coincident/sw", 'import "coincident/sw";\n'],
    ["coincident/main", 'import c from "coincident/main";\n'],
    ["coincident/server/worker", 'import c from "coincident/server/worker";\n'],
    ["coincident/window/sync", 'import c from "coincident/window/sync";\n'],
    ["coincident", 'import c from "coincident";\n'],
    ["동적 import", 'const c = await import("coincident/sync");\n'],
    ["reflected-ffi", 'import r from "reflected-ffi/remote";\n'],
  ])("허용 밖 진입점(%s)은 실패한다", (이름, 내용) => {
    const dist = makeDist({ "worker.mjs": 내용 });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status, 이름).toBe(1);
    expect(output).toContain(FAIL_MARK);
    expect(output).toContain("worker.mjs");
    expect(output).toContain("CSP");
  });

  test.each([
    ["evaluate", "const r = ffi.evaluate('1');\n"],
    ["serviceWorker", "const o = { serviceWorker: '/sw.js' };\n"],
    ["window.import", "await window.import('x');\n"],
    ["멤버 import 호출", "await w.import('x');\n"],
  ])("CSP 금지 사용(%s)이 있으면 실패한다", (이름, 내용) => {
    const dist = makeDist({ "worker.mjs": 내용 });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status, 이름).toBe(1);
    expect(output).toContain("CSP");
  });

  test("주석 안의 금지 표현과 동적 import()는 통과한다", () => {
    const dist = makeDist({
      "worker.mjs":
        "// ffi.evaluate와 serviceWorker는 쓰지 않는다\n/* window.import, coincident/sync */\nconst m = await import('./x.mjs');\n",
    });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status, output).toBe(0);
  });

  test("소스맵과 시험 파일은 CSP 검사에서 제외한다", () => {
    const dist = makeDist({
      "worker.mjs": "ok\n",
      "worker.mjs.map": '{"sourcesContent":["import \\"coincident/sync\\""]}',
      "worker.test.ts": 'import "coincident/sync";\n',
    });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status, output).toBe(0);
  });

  test(".ts 소스도 검사한다(src 폴더 검사)", () => {
    const src = makeDist({
      "worker.ts": 'import "coincident/sync";\n',
      "coincident.d.ts": 'declare module "coincident/window/main" {}\n',
    });

    const { status, output } = runAllowSyncBridge(src);

    expect(status).toBe(1);
    expect(output).toContain("worker.ts");
    expect(output).not.toContain("coincident.d.ts");
  });

  test("pyodide 런타임 import는 이 옵션에서도 실패한다", () => {
    const dist = makeDist({
      "worker.mjs": 'import { loadPyodide } from "pyodide";\n',
    });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status).toBe(1);
    expect(output).toContain("pyodide 런타임 import");
  });

  test("dist 폴더가 없으면 이 옵션에서도 건너뛰지 않고 실패한다", () => {
    const dist = makeDist({});
    rmSync(dist, { recursive: true });

    const { status, output } = runAllowSyncBridge(dist);

    expect(status).toBe(1);
    expect(output).toContain("pnpm build");
  });

  test("옵션만 주고 폴더를 주지 않으면 실패한다", () => {
    expect(runAllowSyncBridge().output).toContain(FAIL_MARK);
  });
});
