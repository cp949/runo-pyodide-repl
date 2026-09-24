#!/usr/bin/env node
// 빌드 산출물(dist)에 동기 브리지 라이브러리 이름(coincident·reflected-ffi, ADR-0001)이 들어 있지 않은지 검사한다.
// 사용: node scripts/check-dist.mjs <dist 폴더>...   (패키지 폴더에서는 `node ../../scripts/check-dist.mjs dist`)
// 폴더가 없거나 파일이 하나도 없으면 건너뛰지 않고 실패한다 — 빌드 전에 돌린 것을 통과로 착각하지 않게 한다(turbo `check-dist`가
// `build` 뒤에 돌린다). 소스맵(.map)까지 모든 파일을 본다. 대소문자는 구분하지 않는다.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN = ["coincident", "reflected-ffi"];

/** `dir` 아래 모든 파일 경로(하위 폴더 포함). 폴더가 없으면 ENOENT를 그대로 던진다. */
async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

function fail(message) {
  console.error(`check-dist 실패: ${message}`);
  process.exitCode = 1;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  fail(
    "검사할 dist 폴더를 인자로 준다(예: node scripts/check-dist.mjs packages/pyodide-repl/dist)",
  );
} else {
  for (const target of targets) {
    let files;
    try {
      files = await listFiles(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fail(`${target} 폴더가 없다. 먼저 pnpm build를 실행한다`);
      continue;
    }
    if (files.length === 0) {
      fail(`${target}에 파일이 없다. 먼저 pnpm build를 실행한다`);
      continue;
    }
    let clean = true;
    for (const file of files) {
      const text = (await readFile(file, "utf8")).toLowerCase();
      for (const needle of FORBIDDEN) {
        if (!text.includes(needle)) continue;
        clean = false;
        fail(`${file}에 금지 문자열 "${needle}"이(가) 있다`);
      }
    }
    if (clean)
      console.log(
        `check-dist 통과: ${target} (${files.length}개 파일, 금지 문자열 0)`,
      );
  }
}
