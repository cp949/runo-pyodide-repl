#!/usr/bin/env node
// tarball 스모크: xterm-readline·core·terminal·repl·react·dom-bridge를 `pnpm pack`으로 묶어 저장소 밖 임시 소비자 프로젝트에 설치하고
// 실제로 쓸 수 있는지 본다. 소비자는 둘이다: 주 소비자(dom-bridge를 뺀 다섯 패키지)와 dom-bridge 소비자(core + dom-bridge). coincident는
// dom-bridge에만 있어야 하므로, 주 소비자 트리의 "coincident·reflected-ffi 없음" 검사는 그대로 두고(다른 패키지의 금지 보장 유지)
// dom-bridge는 따로 설치해 자기 검사(정확한 버전·CSP 정적 규칙)를 받는다(RD-023).
//   1. 여섯 패키지 `pnpm pack`, tarball 안 package.json에 `workspace:`·`catalog:`가 남지 않았는지, core에 optional peer `pyodide`가
//      있는지, dom-bridge의 의존(coincident·reflected-ffi 정확한 버전, core는 peer)과 `sideEffects` 확인
//   2. 임시 소비자(`file:` 5개 + 작업공간 파일 `overrides`로 내부 패키지 고정 + `@xterm/xterm`·`react`·`react-dom`·`pyodide`) `pnpm install`
//   3. node ESM `import`(다섯 패키지의 공개 진입점 `.`·`./worker`·`./internal`)
//   4. `tsc --noEmit`(`skipLibCheck: false`로 배포된 `.d.mts`의 타입 해석까지 검사)
//   5. 설치된 트리에 `coincident`·`reflected-ffi` 없음(lockfile·`.pnpm` 디렉터리·설치된 dist 문자열)
//   6. Vite dev 해석: 소비자에 설치한 vite(demo와 같은 버전)의 client 환경 해석기로 공개 진입점을 풀어 결과 파일이 설치본에 있는지
//      확인한다(Node·tsc는 `development` 조건을 쓰지 않아 1~4단계가 놓치는 결함을 잡는다, 이슈 react-package-followups/05)
//   7. dom-bridge 소비자(core + dom-bridge tarball): 설치·import(main 진입점, worker 진입점은 `addEventListener` 스텁 뒤)·tsc(core
//      `WorkerPlugin`과 타입 호환)·Vite 해석·설치된 coincident 4.1.1·reflected-ffi 0.7.2·dom-bridge dist의 CSP 정적 규칙
//   1단계에는 tarball `exports`의 모든 대상 경로가 tarball 파일 목록에 있는지 보는 정적 검사도 들어 있다(조건 이름과 무관).
// 사용: pnpm smoke:pack (= pnpm build && node scripts/pack-smoke.mjs). 약 1분, L0 수동 실행이며 `pnpm test`·turbo 기본
// 파이프라인에는 넣지 않는다. 네트워크가 필요하다(`@xterm/xterm`·`@xterm/addon-fit`·`react`·`react-dom`·`string-width`·`typescript`·`pyodide`를 레지스트리에서 받는다,
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

const DOM_BRIDGE = {
  name: "@cp949/runo-pyodide-dom-bridge",
  dir: "packages/pyodide-dom-bridge",
};
const CORE_NAME = "@cp949/runo-pyodide-core";

/** pack 대상(의존 순서). `dir`은 저장소 루트 기준. */
const PACKAGES = [
  { name: "@cp949/runo-xterm-readline", dir: "packages/xterm-readline" },
  { name: CORE_NAME, dir: "packages/pyodide-core" },
  { name: "@cp949/runo-pyodide-terminal", dir: "packages/pyodide-terminal" },
  { name: "@cp949/runo-pyodide-repl", dir: "packages/pyodide-repl" },
  { name: "@cp949/runo-pyodide-react", dir: "packages/pyodide-react" },
  DOM_BRIDGE,
];

/** 주 소비자에 설치하는 패키지. coincident는 dom-bridge에만 있어야 하므로 dom-bridge를 뺀다(금지 판정이 이 트리에 걸린다). */
const MAIN_PACKAGES = PACKAGES.filter(({ name }) => name !== DOM_BRIDGE.name);
/** dom-bridge 소비자에 설치하는 패키지. dom-bridge는 core를 peer로 요구한다. */
const BRIDGE_PACKAGES = PACKAGES.filter(
  ({ name }) => name === CORE_NAME || name === DOM_BRIDGE.name,
);

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
      PYODIDE_VERSION: "string",
      DEFAULT_PYODIDE_INDEX_URL: "string",
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
    "@cp949/runo-pyodide-terminal",
    {
      createTerminalRunner: "function",
      RunRejectedError: "function",
    },
  ],
  [
    "@cp949/runo-pyodide-terminal/internal",
    {
      createTerminalSinks: "function",
      createInputReader: "function",
      rewindTail: "function",
      writeNotice: "function",
      createSelectionCopy: "function",
      decideKey: "function",
    },
  ],
  [
    "@cp949/runo-pyodide-repl",
    { createRepl: "function", DEFAULT_PYODIDE_INDEX_URL: "string" },
  ],
  ["@cp949/runo-pyodide-repl/worker", { runReplWorker: "function" }],
  [
    "@cp949/runo-pyodide-react",
    {
      PythonRepl: "function",
      PythonRunner: "function",
      usePythonRunner: "function",
      RunRejectedError: "function",
    },
  ],
];

/**
 * dom-bridge 소비자가 import해서 존재를 확인할 진입점. worker 진입점은 평가 때 worker 전역의 `addEventListener`를 부르므로 Node에서는
 * 그 전역만 스텁으로 세우고 import한다(coincident가 소비자 설치본에서 풀리는지와 export 모양을 본다).
 */
const BRIDGE_ENTRY_POINTS = [
  [
    "@cp949/runo-pyodide-dom-bridge",
    { createBridgeMain: "function", isDomBridgeSupported: "function" },
    false,
  ],
  [
    "@cp949/runo-pyodide-dom-bridge/worker",
    { bridge: "function", domBridge: "function" },
    true,
  ],
];

/** Vite 해석 검사 대상: 공개 진입점 지정자와 각 패키지의 `./package.json`. */
const viteEntries = (specifiers, packages) => [
  ...specifiers,
  ...packages.map(({ name }) => `${name}/package.json`),
];
const MAIN_VITE_ENTRIES = viteEntries(
  ENTRY_POINTS.map(([specifier]) => specifier),
  MAIN_PACKAGES,
);
const BRIDGE_VITE_ENTRIES = viteEntries(
  [
    "@cp949/runo-pyodide-core",
    "@cp949/runo-pyodide-core/worker",
    ...BRIDGE_ENTRY_POINTS.map(([specifier]) => specifier),
  ],
  BRIDGE_PACKAGES,
);

/** 소비자 `tsconfig.json`(`skipLibCheck: false`로 배포된 `.d.mts`와 그 의존 타입의 오류를 가리지 않는다). */
const CONSUMER_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      // pyodide 타입이 `Symbol.dispose`(ES2026 explicit resource management)를 쓰므로 `ESNext`가 필요하다.
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ["node", "emscripten"],
    },
    include: ["check.ts"],
  },
  null,
  2,
);

/**
 * Vite dev 해석 검사 스크립트: client 환경 해석기(`createServer` middleware 모드)로 `specifiers`를 풀고 결과 파일이 설치본에 있는지
 * 본다. Vite는 dev에서 `development` 조건을 기본으로 넣으므로, tarball `exports`가 배포되지 않은 `./src/…ts`를 가리키면 여기서 드러난다.
 */
const viteCheckScript = (specifiers) =>
  [
    `import { existsSync } from "node:fs";`,
    `import { join } from "node:path";`,
    `import { createServer } from "vite";`,
    `const specifiers = ${JSON.stringify(specifiers)};`,
    `const server = await createServer({ root: process.cwd(), configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });`,
    `let failed = false;`,
    `try {`,
    `  for (const specifier of specifiers) {`,
    `    const resolved = await server.environments.client.pluginContainer.resolveId(specifier, join(process.cwd(), "index.js"));`,
    `    const file = resolved?.id?.split("?")[0];`,
    `    const found = typeof file === "string" && existsSync(file);`,
    `    console.log(\`\${found ? "통과" : "FAIL"} vite 해석: \${specifier} -> \${resolved?.id ?? "(해석 실패)"}\`);`,
    `    if (!found) failed = true;`,
    `  }`,
    `} finally {`,
    `  await server.close();`,
    `}`,
    `if (failed) process.exit(1);`,
    ``,
  ].join("\n");

/** 소비자 `pnpm-workspace.yaml`: 내부 패키지 의존이 레지스트리로 가지 않고 tarball을 가리키게 고정한다. */
const overridesYaml = (names, fileDep) =>
  `overrides:\n${names.map((name) => `  "${name}": "${fileDep(name)}"`).join("\n")}\n`;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * `pnpm-workspace.yaml`의 `catalog:` 절에서 `name`의 버전을 읽는다(pyodide 버전의 유일한 원천, ADR-0007). YAML 파서 의존을
 * 늘리지 않으려고 `catalog:` 절(들여쓴 줄)에서 `name: <버전>` 한 줄만 정규식으로 찾고, 못 찾으면 던진다.
 */
function readCatalogVersion(name) {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const section = yaml.match(
    /^catalog:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$)|[ \t]*\r?\n)*)/m,
  );
  const line = section?.[1].match(
    new RegExp(`^[ \\t]+["']?${name}["']?:[ \\t]*["']?([^\\s"'#]+)`, "m"),
  );
  if (!line)
    throw new Error(
      `pnpm-workspace.yaml catalog:에서 ${name} 버전을 찾지 못했다`,
    );
  return line[1];
}

/** `exports` 값에서 파일 경로 대상(`./…` 문자열)을 조건 이름과 무관하게 모두 모은다. `null`(비공개 표시)은 건너뛴다. */
function collectExportTargets(value, path = "exports") {
  if (typeof value === "string") return [{ path, target: value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      collectExportTargets(item, `${path}[${index}]`),
    );
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      collectExportTargets(item, `${path}.${key}`),
    );
  return [];
}

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
  /** 끝까지 실행한 뒤 함께 보고할 검사 실패(정적 exports 검사·Vite 해석 검사). */
  const problems = [];
  // 소비자 설치에 쓰는 외부 버전은 저장소 매니페스트가 원천이다(스모크가 따로 정하지 않는다).
  const rootManifest = readJson(join(ROOT, "package.json"));
  const reactManifest = readJson(
    join(ROOT, "packages/pyodide-react/package.json"),
  );
  const versions = {
    pyodide: readCatalogVersion("pyodide"),
    xterm: readJson(join(ROOT, "packages/pyodide-repl/package.json"))
      .devDependencies["@xterm/xterm"],
    // react 패키지는 react·react-dom을 peer로만 선언하므로 소비자가 직접 설치한다(버전은 react 패키지 devDependencies가 원천).
    react: reactManifest.devDependencies.react,
    reactDom: reactManifest.devDependencies["react-dom"],
    typesReact: reactManifest.devDependencies["@types/react"],
    typescript: rootManifest.devDependencies.typescript,
    // Vite 해석 검사는 demo가 쓰는 vite와 같은 버전으로 한다(원천은 demo 매니페스트).
    vite: readJson(join(ROOT, "apps/demo/package.json")).devDependencies.vite,
    packageManager: rootManifest.packageManager,
  };

  step("dist 확인(없으면 실패: 먼저 pnpm build)");
  for (const { dir } of PACKAGES) {
    if (!existsSync(join(ROOT, dir, "dist")))
      throw new Error(`${dir}/dist가 없다. 먼저 pnpm build를 실행한다`);
  }

  step(`pnpm pack ${PACKAGES.length}개`);
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
    "tarball 안 package.json 점검: workspace:·catalog: 의존이 실제 버전으로 치환됐는지, core의 optional peer pyodide",
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
    // pnpm이 `catalog:`를 치환하지 않으면 소비자 설치가 깨진다. 모든 필드(devDependencies 포함)에서 확인한다.
    const catalogLeft = JSON.stringify(manifest).includes("catalog:");
    console.log(
      `${name} peerDependencies=${JSON.stringify(manifest.peerDependencies ?? {})} peerDependenciesMeta=${JSON.stringify(manifest.peerDependenciesMeta ?? {})} catalog: 잔존=${catalogLeft}`,
    );
    if (catalogLeft)
      throw new Error(`${name} tarball package.json에 catalog:가 남았다`);
    // tarball `exports`의 모든 대상이 배포 파일에 있어야 한다. 작업공간 소스용 `development` 조건(`./src/…ts`)이 tarball에 남으면
    // `files: ["dist"]`라 없는 파일을 가리킨다(Vite dev가 이 조건을 쓴다).
    const packed = new Set(
      execFileSync("tar", ["-tzf", tarballs[name]], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    );
    const missing = collectExportTargets(manifest.exports)
      .filter(
        ({ target }) => !packed.has(`package/${target.replace(/^\.\//, "")}`),
      )
      .map(({ path, target }) => `${path} -> ${target}`);
    console.log(
      `${name} exports 대상 ${collectExportTargets(manifest.exports).length}개, tarball 파일 ${packed.size}개, 없는 대상 ${missing.length}개`,
    );
    // 뒤 단계(Vite 해석 검사)의 결과도 한 번에 보도록 실패는 모아 두었다가 마지막에 던진다. 뒤 단계가 먼저 던지면 모은 목록이
    // 보이지 않으므로 목록은 발견 즉시 로그로도 찍는다.
    if (missing.length > 0) {
      const problem = `${name} tarball exports에 배포 파일에 없는 대상이 있다:\n  ${missing.join("\n  ")}`;
      console.error(problem);
      problems.push(problem);
    }
    // core는 pyodide 타입을 노출하므로 optional peer로 선언한다. repl은 노출하지 않아 peer에 pyodide가 없어야 한다.
    const peerRange = manifest.peerDependencies?.pyodide;
    if (name === "@cp949/runo-pyodide-core") {
      if (typeof peerRange !== "string" || !peerRange.startsWith("^"))
        throw new Error(
          `${name} tarball에 peerDependencies.pyodide(^범위)가 없다: ${peerRange}`,
        );
      if (manifest.peerDependenciesMeta?.pyodide?.optional !== true)
        throw new Error(
          `${name} tarball에 peerDependenciesMeta.pyodide.optional=true가 없다`,
        );
    } else if (peerRange !== undefined) {
      throw new Error(
        `${name} tarball에 예상하지 않은 peerDependencies.pyodide가 있다: ${peerRange}`,
      );
    }
    // dom-bridge는 coincident·reflected-ffi를 정확한 버전으로 고정하고(upstream 그대로, 포크 없음) core는 타입만 쓰므로 peer로만 둔다.
    // `sideEffects`는 import 시점 부트스트랩 관찰 리스너(worker 진입점)가 번들에서 빠지지 않게 배열이다.
    if (name === DOM_BRIDGE.name) {
      const dependencies = manifest.dependencies ?? {};
      const source = readJson(join(ROOT, DOM_BRIDGE.dir, "package.json"));
      if (
        JSON.stringify(Object.keys(dependencies).sort()) !==
        JSON.stringify(["coincident", "reflected-ffi"])
      )
        throw new Error(
          `${name} tarball의 dependencies가 coincident·reflected-ffi 둘이 아니다: ${JSON.stringify(dependencies)}`,
        );
      for (const dep of ["coincident", "reflected-ffi"]) {
        if (!/^\d+\.\d+\.\d+$/.test(String(dependencies[dep])))
          throw new Error(
            `${name} tarball의 ${dep}가 정확 버전이 아니다: ${dependencies[dep]}`,
          );
        if (dependencies[dep] !== source.dependencies[dep])
          throw new Error(
            `${name} tarball의 ${dep}(${dependencies[dep]})가 작업공간 선언(${source.dependencies[dep]})과 다르다`,
          );
      }
      if (typeof manifest.peerDependencies?.[CORE_NAME] !== "string")
        throw new Error(
          `${name} tarball에 peerDependencies.${CORE_NAME}가 없다`,
        );
      if (dependencies[CORE_NAME] !== undefined)
        throw new Error(
          `${name} tarball의 dependencies에 peer여야 할 ${CORE_NAME}가 있다`,
        );
      if (
        !Array.isArray(manifest.sideEffects) ||
        !manifest.sideEffects.includes("./dist/worker.mjs")
      )
        throw new Error(
          `${name} tarball의 sideEffects에 ./dist/worker.mjs가 없다: ${JSON.stringify(manifest.sideEffects)}`,
        );
    }
    // react 패키지는 react·react-dom·@xterm/xterm을 소비자 것 한 벌로 쓰도록 peer로만 선언한다(15-react.md 15.1). 소비자가 셋을
    // 직접 설치하므로 선언이 빠지거나 dependencies로 옮겨져도 설치·import는 통과한다(React가 두 벌이면 hook이 깨진다). addon-fit은
    // 비공개 API를 써서(TRP-062) 정확 버전으로 고정한다.
    if (name === "@cp949/runo-pyodide-react") {
      for (const peer of ["react", "react-dom", "@xterm/xterm"]) {
        if (typeof manifest.peerDependencies?.[peer] !== "string")
          throw new Error(`${name} tarball에 peerDependencies.${peer}가 없다`);
        if (manifest.dependencies?.[peer] !== undefined)
          throw new Error(
            `${name} tarball의 dependencies에 peer여야 할 ${peer}가 있다`,
          );
      }
      const fitRange = manifest.dependencies?.["@xterm/addon-fit"];
      if (!/^\d+\.\d+\.\d+$/.test(String(fitRange)))
        throw new Error(
          `${name} tarball의 @xterm/addon-fit이 정확 버전이 아니다: ${fitRange}`,
        );
    }
  }

  step("임시 소비자 프로젝트 작성");
  const consumer = join(tmp, "consumer");
  await mkdir(consumer);
  const fileDep = (name) => `file:${tarballs[name]}`;
  const internalNames = MAIN_PACKAGES.map((p) => p.name);
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
          react: versions.react,
          "react-dom": versions.reactDom,
          // core `worker.d.mts`가 `pyodide`·`pyodide/ffi` 타입을 import한다(core는 pyodide를 배포 의존으로 선언하지 않는다).
          pyodide: versions.pyodide,
        },
        // pyodide 자체 타입(`pyodide.d.ts`)이 `node:*` 모듈 타입과 전역 `FS`(emscripten)를 참조한다. TypeScript 6은 `types`를
        // 자동 포함하지 않으므로 소비자가 직접 설치하고 tsconfig `types`에 적는다. `@types/node`는 engines 주 버전(24)에 맞춘다.
        devDependencies: {
          typescript: versions.typescript,
          "@types/node": "24",
          "@types/react": versions.typesReact,
          "@types/emscripten": "^1.41.4",
          vite: versions.vite,
        },
      },
      null,
      2,
    ),
  );
  // repl tarball의 내부 의존(`@cp949/runo-pyodide-core@0.0.0` 등)이 레지스트리로 가지 않고 tarball을 가리키게 고정한다.
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    overridesYaml(internalNames, fileDep),
  );
  await writeFile(join(consumer, "tsconfig.json"), CONSUMER_TSCONFIG);
  await writeFile(
    join(consumer, "check.ts"),
    [
      `import { Readline, type ReadOptions } from "@cp949/runo-xterm-readline";`,
      `import { startCoreSession, composeRpcHandlers as composeMain, type MainDriver } from "@cp949/runo-pyodide-core";`,
      `import { runWorker, createCoreConsole, type WorkerDriver, type PyodideConsoleProxy } from "@cp949/runo-pyodide-core/worker";`,
      `import { createTerminalSinks, type TerminalSinks } from "@cp949/runo-pyodide-terminal/internal";`,
      `import { createTerminalRunner, type TerminalRunnerHandle, type TerminalRunnerOptions } from "@cp949/runo-pyodide-terminal";`,
      `import { createRepl, type ReplHandle, type ReplOptions } from "@cp949/runo-pyodide-repl";`,
      `import { runReplWorker } from "@cp949/runo-pyodide-repl/worker";`,
      `import * as reactPackage from "@cp949/runo-pyodide-react";`,
      `import type { PythonReplHandle, PythonReplProps, PythonRunnerHandle, PythonRunnerProps, UsePythonRunnerOptions, UsePythonRunnerResult } from "@cp949/runo-pyodide-react";`,
      `import type { PyodideInterface } from "pyodide";`,
      ``,
      `// core worker 타입이 소비자의 pyodide 타입으로 해석되는지(any로 무너지지 않는지) 본다.`,
      `const makeConsole: (pyodide: PyodideInterface) => PyodideConsoleProxy = (pyodide) =>`,
      `  createCoreConsole(pyodide, { write() {}, writeError() {} } as never);`,
      `export const used: unknown[] = [Readline, startCoreSession, composeMain, runWorker, makeConsole, createTerminalSinks, createTerminalRunner, createRepl, runReplWorker, reactPackage];`,
      `export type Used = [ReadOptions, MainDriver, WorkerDriver, TerminalSinks, TerminalRunnerHandle, TerminalRunnerOptions, ReplHandle, ReplOptions, PythonReplHandle, PythonReplProps, PythonRunnerHandle, PythonRunnerProps, UsePythonRunnerOptions, UsePythonRunnerResult];`,
      // 컴포넌트 props가 소비자의 xterm·react 타입으로 해석되는지(any로 무너지지 않는지, 필수 옵션·init 전용 옵션이 맞는지) 본다.
      `export const runnerProps: PythonRunnerProps = { createWorker: () => new Worker("worker.js"), terminalOptions: { cols: 80, rows: 24, cursorBlink: true }, fit: false, onStatus: (status) => void status.length };`,
      `// @ts-expect-error createWorker는 필수다`,
      `export const missingWorker: PythonRunnerProps = {};`,
      `export const replProps: PythonReplProps = { createWorker: () => new Worker("worker.js"), terminalOptions: { cols: 80, rows: 24, cursorBlink: true }, fit: false, topLevelAwait: true, onStatus: (status) => void status.length };`,
      `// @ts-expect-error createWorker는 필수다`,
      `export const missingReplWorker: PythonReplProps = {};`,
      `export const replRun = (handle: PythonReplHandle) => handle.runSource("1 + 1");`,
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
      // core가 인라인한 고정 버전이 catalog 버전과 같은지(소비자 설치 뒤에도 값이 유지되는지) 본다.
      `const core = await import("@cp949/runo-pyodide-core");`,
      `if (core.PYODIDE_VERSION !== ${JSON.stringify(versions.pyodide)}) { failed = true; console.error(\`FAIL PYODIDE_VERSION: \${core.PYODIDE_VERSION}\`); }`,
      `if (core.DEFAULT_PYODIDE_INDEX_URL !== \`https://cdn.jsdelivr.net/pyodide/v\${core.PYODIDE_VERSION}/full/\`) { failed = true; console.error(\`FAIL DEFAULT_PYODIDE_INDEX_URL: \${core.DEFAULT_PYODIDE_INDEX_URL}\`); }`,
      `if (failed) process.exit(1);`,
      ``,
    ].join("\n"),
  );

  await writeFile(
    join(consumer, "check-vite.mjs"),
    viteCheckScript(MAIN_VITE_ENTRIES),
  );

  step("pnpm install (소비자)");
  run("pnpm", ["install", "--prefer-offline"], consumer);

  step("node ESM import (공개 진입점 8개)");
  run("node", ["check.mjs"], consumer);

  step("tsc --noEmit (skipLibCheck: false)");
  run("pnpm", ["exec", "tsc", "--noEmit", "-p", "tsconfig.json"], consumer);

  step("Vite dev 해석(client 환경, 공개 진입점)");
  try {
    run("node", ["check-vite.mjs"], consumer);
  } catch (error) {
    problems.push(
      `Vite dev 해석 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
  }

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

  // ---- dom-bridge 소비자(core + dom-bridge) ----
  // coincident는 이 소비자 트리에만 있어야 하고, dom-bridge는 upstream 정확한 버전을 끌고 온다. 위 주 소비자의 "coincident 없음" 검사는
  // 그대로라 core·terminal·repl·react·xterm-readline의 금지 보장은 약해지지 않는다.
  step("dom-bridge 소비자 프로젝트 작성(core + dom-bridge)");
  const bridgeConsumer = join(tmp, "consumer-dom-bridge");
  await mkdir(bridgeConsumer);
  const bridgeNames = BRIDGE_PACKAGES.map((p) => p.name);
  await writeFile(
    join(bridgeConsumer, "package.json"),
    JSON.stringify(
      {
        name: "pack-smoke-dom-bridge-consumer",
        private: true,
        type: "module",
        packageManager: versions.packageManager,
        dependencies: {
          ...Object.fromEntries(
            bridgeNames.map((name) => [name, fileDep(name)]),
          ),
          // core `worker.d.mts`가 `pyodide` 타입을 import한다(주 소비자와 같은 이유).
          pyodide: versions.pyodide,
        },
        devDependencies: {
          typescript: versions.typescript,
          "@types/node": "24",
          "@types/emscripten": "^1.41.4",
          vite: versions.vite,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(bridgeConsumer, "pnpm-workspace.yaml"),
    overridesYaml(bridgeNames, fileDep),
  );
  await writeFile(join(bridgeConsumer, "tsconfig.json"), CONSUMER_TSCONFIG);
  await writeFile(
    join(bridgeConsumer, "check.ts"),
    [
      `import { createBridgeMain, isDomBridgeSupported, type BridgeMain, type BridgeMainWorker } from "@cp949/runo-pyodide-dom-bridge";`,
      `import { bridge, domBridge, type WorkerBridge } from "@cp949/runo-pyodide-dom-bridge/worker";`,
      `import { runWorker, runDriver, type WorkerPlugin } from "@cp949/runo-pyodide-core/worker";`,
      ``,
      `// dom-bridge 플러그인이 소비자의 core 타입(\`WorkerPlugin\`)으로 해석되는지(any로 무너지지 않는지) 본다.`,
      `export const plugin: WorkerPlugin = domBridge();`,
      `export const start = () => runWorker({ driver: runDriver, plugins: [plugin] });`,
      `export const supported: boolean = isDomBridgeSupported();`,
      `export const main: BridgeMain = createBridgeMain();`,
      `export const makeWorker = (): BridgeMainWorker => new main.Worker("worker.js", { type: "module" });`,
      `export const loadBridge: () => Promise<WorkerBridge> = bridge;`,
      `// @ts-expect-error coincident 옵션(serviceWorker 등)은 통과시키지 않는다`,
      `export const withOptions = createBridgeMain({ serviceWorker: "/sw.js" });`,
      `export const readFfi = async () =>`,
      `  // @ts-expect-error ffi(임의 코드 평가 등)는 노출하지 않는다`,
      `  (await bridge()).ffi;`,
      ``,
    ].join("\n"),
  );
  await writeFile(
    join(bridgeConsumer, "check.mjs"),
    [
      `const entries = ${JSON.stringify(BRIDGE_ENTRY_POINTS)};`,
      `let failed = false;`,
      `for (const [specifier, expected, needsWorkerGlobal] of entries) {`,
      // worker 진입점은 평가 때 worker 전역의 addEventListener를 부른다. Node에는 없어 스텁을 세우고 import한다(coincident가 소비자
      // 설치본에서 풀리는지와 export 모양을 본다. 부트스트랩·동작은 브라우저 L1이 본다).
      `  if (needsWorkerGlobal) globalThis.addEventListener ??= () => {};`,
      `  const mod = await import(specifier);`,
      `  for (const [name, type] of Object.entries(expected)) {`,
      `    if (typeof mod[name] !== type) { failed = true; console.error(\`FAIL \${specifier}: \${name}은(는) \${type}이어야 한다(실제 \${typeof mod[name]})\`); }`,
      `  }`,
      `  console.log(\`import 통과: \${specifier} (export \${Object.keys(mod).length}개)\`);`,
      `}`,
      `const worker = await import("@cp949/runo-pyodide-dom-bridge/worker");`,
      `if (worker.domBridge().name !== "dom-bridge") { failed = true; console.error("FAIL domBridge().name"); }`,
      `if (failed) process.exit(1);`,
      ``,
    ].join("\n"),
  );
  await writeFile(
    join(bridgeConsumer, "check-vite.mjs"),
    viteCheckScript(BRIDGE_VITE_ENTRIES),
  );

  step("pnpm install (dom-bridge 소비자)");
  run("pnpm", ["install", "--prefer-offline"], bridgeConsumer);

  step("node ESM import (dom-bridge 진입점 2개)");
  run("node", ["check.mjs"], bridgeConsumer);

  step("tsc --noEmit (dom-bridge 소비자, skipLibCheck: false)");
  run(
    "pnpm",
    ["exec", "tsc", "--noEmit", "-p", "tsconfig.json"],
    bridgeConsumer,
  );

  step("Vite dev 해석(dom-bridge 소비자)");
  try {
    run("node", ["check-vite.mjs"], bridgeConsumer);
  } catch (error) {
    problems.push(
      `dom-bridge 소비자 Vite dev 해석 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
  }

  step("dom-bridge 소비자: coincident·reflected-ffi 정확한 버전, dist 검사");
  const bridgeSource = readJson(join(ROOT, DOM_BRIDGE.dir, "package.json"));
  const bridgeStore = readdirSync(
    join(bridgeConsumer, "node_modules/.pnpm"),
  ).map((entry) => entry.toLowerCase());
  for (const dep of ["coincident", "reflected-ffi"]) {
    const installed = new Set(
      bridgeStore
        .filter((entry) => entry.startsWith(`${dep}@`))
        .map((entry) => entry.slice(dep.length + 1).split("_")[0]),
    );
    const expected = bridgeSource.dependencies[dep];
    console.log(
      `${dep} 설치된 버전: ${[...installed].join(", ") || "(없음)"} (기대 ${expected})`,
    );
    if (installed.size !== 1 || !installed.has(expected))
      throw new Error(
        `dom-bridge 소비자에 설치된 ${dep} 버전이 ${expected} 하나가 아니다: ${[...installed].join(", ")}`,
      );
  }
  const installedBridgeDist = join(
    bridgeConsumer,
    "node_modules",
    DOM_BRIDGE.name,
    "dist",
  );
  // dom-bridge dist는 coincident를 허용하되 CSP 정적 규칙과 pyodide 런타임 import 금지를 받는다. core dist는 여전히 금지 문자열을 받는다.
  run(
    "node",
    [
      join(ROOT, "scripts/check-dist.mjs"),
      "--allow-sync-bridge",
      installedBridgeDist,
    ],
    bridgeConsumer,
  );
  run(
    "node",
    [
      join(ROOT, "scripts/check-dist.mjs"),
      join(bridgeConsumer, "node_modules", CORE_NAME, "dist"),
    ],
    bridgeConsumer,
  );

  if (problems.length > 0) throw new Error(problems.join("\n"));
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
