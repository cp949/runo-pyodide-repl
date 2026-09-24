#!/usr/bin/env node
// tarball 스모크: xterm-readline·core·repl을 `pnpm pack`으로 묶어 저장소 밖 임시 소비자 프로젝트에 설치하고 실제로 쓸 수 있는지 본다.
//   1. 세 패키지 `pnpm pack`, tarball 안 package.json에 `workspace:` 의존이 남지 않았는지 확인
//   2. 임시 소비자(`file:` 3개 + 작업공간 파일 `overrides`로 내부 패키지 고정 + `@xterm/xterm`·`pyodide`) `pnpm install`
//   3. node ESM `import`(세 패키지의 공개 진입점 `.`·`./worker`)
//   4. `tsc --noEmit`(`skipLibCheck: false`로 배포된 `.d.mts`의 타입 해석까지 검사)
//   5. 설치된 트리에 `coincident`·`reflected-ffi` 없음(lockfile·`.pnpm` 디렉터리·설치된 dist 문자열)
// 사용: pnpm smoke:pack (= pnpm build && node scripts/pack-smoke.mjs). 약 1분, L0 수동 실행이며 `pnpm test`·turbo 기본
// 파이프라인에는 넣지 않는다. 네트워크가 필요하다(`@xterm/xterm`·`string-width`·`typescript`·`pyodide`를 레지스트리에서 받는다,
// `--prefer-offline`이라 pnpm 저장소에 있으면 다시 받지 않는다).
// 환경 변수: SMOKE_TMPDIR(임시 폴더를 만들 상위 경로, 기본 os.tmpdir()), KEEP=1(성공해도 임시 폴더를 지우지 않음).
// 임시 폴더는 성공하면 지운다. 실패하면 원인 조사용으로 남기고 경로를 출력한다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = ["coincident", "reflected-ffi"];

/** pack 대상(의존 순서). `dir`은 저장소 루트 기준. */
const PACKAGES = [
  { name: "@cp949/runo-xterm-readline", dir: "packages/xterm-readline" },
  { name: "@cp949/runo-pyodide-core", dir: "packages/pyodide-core" },
  { name: "@cp949/runo-pyodide-repl", dir: "packages/pyodide-repl" },
];

/** 소비자가 import해서 존재를 확인할 공개 진입점과 기대 export(이름 → typeof). */
const ENTRY_POINTS = [
  [
    "@cp949/runo-xterm-readline",
    {
      Readline: "function",
      ReadCancelledError: "function",
      History: "function",
    },
  ],
  [
    "@cp949/runo-pyodide-core",
    {
      startCoreSession: "function",
      composeRpcHandlers: "function",
      createRpc: "function",
      postInitFrame: "function",
    },
  ],
  [
    "@cp949/runo-pyodide-core/worker",
    {
      runWorker: "function",
      bootWorker: "function",
      createCoreConsole: "function",
      composeRpcHandlers: "function",
    },
  ],
  [
    "@cp949/runo-pyodide-repl",
    { createRepl: "function", DEFAULT_PYODIDE_INDEX_URL: "string" },
  ],
  ["@cp949/runo-pyodide-repl/worker", { runReplWorker: "function" }],
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const step = (message) => console.log(`\n[${elapsed()}] ${message}`);

/** 자식 프로세스를 실행하고 출력을 그대로 흘린다. 실패하면 던진다. */
function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(" ")}   (cwd: ${cwd})`);
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

/** 패키지 폴더 이름(scope 제거·`/` → `-`)과 버전으로 `pnpm pack`이 만드는 tarball 파일명을 만든다. */
const tarballName = (name, version) =>
  `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;

async function main(tmp) {
  // 소비자 설치에 쓰는 외부 버전은 저장소 매니페스트가 원천이다(스모크가 따로 정하지 않는다).
  const rootManifest = readJson(join(ROOT, "package.json"));
  const versions = {
    pyodide: readJson(join(ROOT, "packages/pyodide-core/package.json"))
      .devDependencies.pyodide,
    xterm: readJson(join(ROOT, "packages/pyodide-repl/package.json"))
      .devDependencies["@xterm/xterm"],
    typescript: rootManifest.devDependencies.typescript,
    packageManager: rootManifest.packageManager,
  };

  step("dist 확인(없으면 실패: 먼저 pnpm build)");
  for (const { dir } of PACKAGES) {
    if (!existsSync(join(ROOT, dir, "dist")))
      throw new Error(`${dir}/dist가 없다. 먼저 pnpm build를 실행한다`);
  }

  step("pnpm pack 3개");
  const tarballDir = join(tmp, "tarballs");
  await mkdir(tarballDir);
  const tarballs = {};
  for (const { name, dir } of PACKAGES) {
    const version = readJson(join(ROOT, dir, "package.json")).version;
    run("pnpm", ["pack", "--pack-destination", tarballDir], join(ROOT, dir));
    const file = join(tarballDir, tarballName(name, version));
    if (!existsSync(file)) throw new Error(`tarball이 없다: ${file}`);
    tarballs[name] = file;
  }

  step(
    "tarball 안 package.json 점검: workspace: 의존이 실제 버전으로 치환됐는지",
  );
  for (const { name } of PACKAGES) {
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", tarballs[name], "package/package.json"], {
        encoding: "utf8",
      }),
    );
    const leftovers = [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
    ]
      .flatMap((field) =>
        Object.entries(manifest[field] ?? {}).map(([dep, range]) => [
          field,
          dep,
          range,
        ]),
      )
      .filter(([, , range]) => String(range).startsWith("workspace:"));
    console.log(
      `${name}@${manifest.version} private=${manifest.private} dependencies=${JSON.stringify(manifest.dependencies ?? {})}`,
    );
    if (leftovers.length > 0)
      throw new Error(
        `${name} tarball에 workspace: 의존이 남았다: ${JSON.stringify(leftovers)}`,
      );
  }

  step("임시 소비자 프로젝트 작성");
  const consumer = join(tmp, "consumer");
  await mkdir(consumer);
  const fileDep = (name) => `file:${tarballs[name]}`;
  const internalNames = PACKAGES.map((p) => p.name);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "pack-smoke-consumer",
        private: true,
        type: "module",
        // pnpm 11로 고정한다: 11은 package.json의 `pnpm` 필드(pnpm.overrides)를 읽지 않으므로 overrides는 작업공간 파일에 둔다.
        packageManager: versions.packageManager,
        dependencies: {
          ...Object.fromEntries(
            internalNames.map((name) => [name, fileDep(name)]),
          ),
          "@xterm/xterm": versions.xterm,
          // core `worker.d.mts`가 `pyodide`·`pyodide/ffi` 타입을 import한다(core는 pyodide를 배포 의존으로 선언하지 않는다).
          pyodide: versions.pyodide,
        },
        // pyodide 자체 타입(`pyodide.d.ts`)이 `node:*` 모듈 타입과 전역 `FS`(emscripten)를 참조한다. TypeScript 6은 `types`를
        // 자동 포함하지 않으므로 소비자가 직접 설치하고 tsconfig `types`에 적는다. `@types/node`는 engines 주 버전(24)에 맞춘다.
        devDependencies: {
          typescript: versions.typescript,
          "@types/node": "24",
          "@types/emscripten": "^1.41.4",
        },
      },
      null,
      2,
    ),
  );
  // repl tarball의 내부 의존(`@cp949/runo-pyodide-core@0.0.0` 등)이 레지스트리로 가지 않고 tarball을 가리키게 고정한다.
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    `overrides:\n${internalNames.map((name) => `  "${name}": "${fileDep(name)}"`).join("\n")}\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          // pyodide 타입이 `Symbol.dispose`(ES2026 explicit resource management)를 쓰므로 `ESNext`가 필요하다.
          lib: ["ESNext", "DOM", "DOM.Iterable"],
          strict: true,
          // 배포된 `.d.mts`와 그 의존 타입의 오류를 가리지 않는다.
          skipLibCheck: false,
          noEmit: true,
          types: ["node", "emscripten"],
        },
        include: ["check.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(consumer, "check.ts"),
    [
      `import { Readline, type ReadOptions } from "@cp949/runo-xterm-readline";`,
      `import { startCoreSession, composeRpcHandlers as composeMain, type MainDriver } from "@cp949/runo-pyodide-core";`,
      `import { runWorker, createCoreConsole, type WorkerDriver, type PyodideConsoleProxy } from "@cp949/runo-pyodide-core/worker";`,
      `import { createRepl, type ReplHandle, type ReplOptions } from "@cp949/runo-pyodide-repl";`,
      `import { runReplWorker } from "@cp949/runo-pyodide-repl/worker";`,
      `import type { PyodideInterface } from "pyodide";`,
      ``,
      `// core worker 타입이 소비자의 pyodide 타입으로 해석되는지(any로 무너지지 않는지) 본다.`,
      `const makeConsole: (pyodide: PyodideInterface) => PyodideConsoleProxy = (pyodide) =>`,
      `  createCoreConsole(pyodide, { write() {}, writeError() {} } as never);`,
      `export const used: unknown[] = [Readline, startCoreSession, composeMain, runWorker, makeConsole, createRepl, runReplWorker];`,
      `export type Used = [ReadOptions, MainDriver, WorkerDriver, ReplHandle, ReplOptions];`,
      ``,
    ].join("\n"),
  );
  await writeFile(
    join(consumer, "check.mjs"),
    [
      `const entries = ${JSON.stringify(ENTRY_POINTS)};`,
      `let failed = false;`,
      `for (const [specifier, expected] of entries) {`,
      `  const mod = await import(specifier);`,
      `  for (const [name, type] of Object.entries(expected)) {`,
      `    if (typeof mod[name] !== type) { failed = true; console.error(\`FAIL \${specifier}: \${name}은(는) \${type}이어야 한다(실제 \${typeof mod[name]})\`); }`,
      `  }`,
      `  console.log(\`import 통과: \${specifier} (export \${Object.keys(mod).length}개)\`);`,
      `}`,
      `if (failed) process.exit(1);`,
      ``,
    ].join("\n"),
  );

  step("pnpm install (소비자)");
  run("pnpm", ["install", "--prefer-offline"], consumer);

  step("node ESM import (공개 진입점 5개)");
  run("node", ["check.mjs"], consumer);

  step("tsc --noEmit (skipLibCheck: false)");
  run("pnpm", ["exec", "tsc", "--noEmit", "-p", "tsconfig.json"], consumer);

  step("설치된 트리에 coincident·reflected-ffi 없음");
  const lock = readFileSync(
    join(consumer, "pnpm-lock.yaml"),
    "utf8",
  ).toLowerCase();
  const storeNames = readdirSync(join(consumer, "node_modules/.pnpm")).map(
    (entry) => entry.toLowerCase(),
  );
  const topLevel = readdirSync(join(consumer, "node_modules")).map((entry) =>
    entry.toLowerCase(),
  );
  for (const needle of FORBIDDEN) {
    if (lock.includes(needle))
      throw new Error(`pnpm-lock.yaml에 ${needle}이(가) 있다`);
    const hit = [...storeNames, ...topLevel].find((entry) =>
      entry.includes(needle),
    );
    if (hit) throw new Error(`node_modules에 ${needle}이(가) 있다: ${hit}`);
  }
  console.log(
    `통과: lock·node_modules(.pnpm ${storeNames.length}개 항목)에 ${FORBIDDEN.join("·")} 없음`,
  );
  // 설치된(=tarball에서 풀린) dist 문자열도 같은 검사를 쓴다.
  const installedDists = internalNames.map((name) =>
    join(consumer, "node_modules", name, "dist"),
  );
  run(
    "node",
    [join(ROOT, "scripts/check-dist.mjs"), ...installedDists],
    consumer,
  );
}

const base = process.env.SMOKE_TMPDIR ?? tmpdir();
await mkdir(base, { recursive: true });
const tmp = await mkdtemp(join(base, "pack-smoke-"));
let ok = false;
try {
  console.log(`임시 폴더: ${tmp}`);
  await main(tmp);
  ok = true;
  console.log(`\n[${elapsed()}] pack-smoke 통과`);
} catch (error) {
  console.error(
    `\n[${elapsed()}] pack-smoke 실패: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
} finally {
  if (ok && process.env.KEEP !== "1") {
    await rm(tmp, { recursive: true, force: true });
    console.log(`임시 폴더를 지웠다: ${tmp}`);
  } else {
    console.log(`임시 폴더를 남겼다(조사용): ${tmp}`);
  }
}
