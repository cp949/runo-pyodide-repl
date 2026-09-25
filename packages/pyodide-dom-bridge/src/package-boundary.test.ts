// @vitest-environment node
/**
 * dom-bridge 패키지 경계. coincident는 이 패키지에만 있다(ADR-0006). 여기서는 두 가지를 강제한다.
 * ① dom-bridge 자신의 의존 선언: coincident·reflected-ffi 정확한 버전, core는 peer(타입만 쓴다), REPL·터미널·pyodide 비의존.
 * ② 다른 패키지(core·terminal·repl·react·xterm-readline)의 의존 트리에 dom-bridge·coincident가 새지 않는다(기존 금지 보장 유지).
 * core·terminal·repl·react 자신의 `package-boundary.test.ts`는 그대로 두고, 여기서는 반대 방향(dom-bridge가 생긴 뒤에도
 * 그 트리들에 dom-bridge가 없다)을 본다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  collectInstalledDependencyNames,
  findForbiddenDependencies,
  type PackageManifest,
} from "@repo/pyodide-testkit/package-boundary";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
  readFileSync(`${PACKAGE_DIR}/package.json`, "utf8"),
) as PackageManifest & {
  sideEffects?: unknown;
  exports?: Record<string, Record<string, string> | string>;
  publishConfig?: { exports?: Record<string, Record<string, string> | string> };
};

describe("dom-bridge 자신의 의존 선언", () => {
  test("coincident 4.1.1·reflected-ffi 0.7.2를 정확한 버전으로 고정한다", () => {
    expect(manifest.dependencies).toEqual({
      coincident: "4.1.1",
      "reflected-ffi": "0.7.2",
    });
  });

  test("core는 peer + dev로 두고 dependencies에 넣지 않는다(WorkerPlugin 타입만 쓴다)", () => {
    expect(manifest.peerDependencies?.["@cp949/runo-pyodide-core"]).toBe(
      "workspace:*",
    );
    expect(manifest.devDependencies?.["@cp949/runo-pyodide-core"]).toBe(
      "workspace:*",
    );
    expect(manifest.dependencies?.["@cp949/runo-pyodide-core"]).toBeUndefined();
  });

  test("의존 트리에 REPL·터미널·xterm이 없고 pyodide를 직접 의존으로 선언하지 않는다", () => {
    const { names } = collectInstalledDependencyNames(PACKAGE_DIR);

    for (const name of [
      "@cp949/runo-pyodide-repl",
      "@cp949/runo-pyodide-terminal",
      "@cp949/runo-pyodide-react",
      "@cp949/runo-xterm-readline",
      "@xterm/xterm",
    ])
      expect(names.has(name), name).toBe(false);
    // `pyodide`는 core의 optional peer라 트리에 이름이 잡힐 수 있다. 이 패키지가 직접 선언하는 것은 devDependencies(시험용)뿐이다.
    expect(manifest.dependencies?.pyodide).toBeUndefined();
    expect(manifest.peerDependencies?.pyodide).toBeUndefined();
  });

  test("의존 트리를 실제로 따라갔다(coincident·reflected-ffi·core가 잡힌다)", () => {
    // 아무것도 따라가지 못해 빈 집합이 되면 위 단언이 항상 통과하므로, 트리를 걸었다는 증거를 함께 단언한다.
    const { names } = collectInstalledDependencyNames(PACKAGE_DIR);

    expect(names).toContain("coincident");
    expect(names).toContain("reflected-ffi");
    expect(names).toContain("@cp949/runo-pyodide-core");
    expect(findForbiddenDependencies(names)).toEqual([
      "coincident",
      "reflected-ffi",
    ]);
  });

  test("sideEffects는 worker 진입점(import 시점 리스너)을 트리셰이킹에서 지키는 배열이다", () => {
    expect(manifest.sideEffects).toEqual([
      "./dist/worker.mjs",
      "./src/worker.ts",
    ]);
  });

  test("tarball exports(publishConfig)는 development 조건을 뺀 같은 진입점이다", () => {
    const workspaceExports = manifest.exports ?? {};
    const publishExports = manifest.publishConfig?.exports ?? {};

    expect(Object.keys(publishExports)).toEqual(Object.keys(workspaceExports));
    expect(Object.keys(workspaceExports)).toEqual([
      ".",
      "./worker",
      "./package.json",
    ]);
    expect(JSON.stringify(publishExports)).not.toContain("development");
    expect(JSON.stringify(publishExports)).not.toContain("/src/");
  });
});

describe("다른 패키지의 의존 트리에는 dom-bridge·coincident가 없다", () => {
  test.each([
    ["core", "../../pyodide-core"],
    ["terminal", "../../pyodide-terminal"],
    ["repl", "../../pyodide-repl"],
    ["react", "../../pyodide-react"],
    ["xterm-readline", "../../xterm-readline"],
  ])("%s", (_이름, relative) => {
    const dir = fileURLToPath(new URL(`${relative}/`, import.meta.url));

    const { names } = collectInstalledDependencyNames(dir);

    expect(findForbiddenDependencies(names)).toEqual([]);
    expect(names.has("@cp949/runo-pyodide-dom-bridge")).toBe(false);
  });
});
