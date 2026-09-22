// RD-010 DELTA-00: RD-009 하니시(`_works/_completed/20260922-09-rd-009-idle-ctrl-c/verify/lib.mjs`)를
// 저장소 devDependency(`playwright`, apps/demo/package.json)로 옮긴 것. 이후 각 RD의 브라우저 확인
// 스크립트는 `_works/<작업>/verify/`에 두고 이 파일만 import한다(복사하지 않는다).
//
// 사용법:
//   import { open, hasFg, same, show } from "<repo>/apps/demo/e2e/lib.mjs";
//   const h = await open("http://localhost:5173"); // dev 서버 URL
//   await h.waitPrompt(">>>");
//   ...
//   await h.finish(); // pageErrors 계수 포함 결과를 JSON으로 출력하고 브라우저를 닫는다
//
// 전제: `pnpm --filter demo dev`(또는 `preview`)가 떠 있고, `pnpm exec playwright install chromium`이
// 끝나 있어야 한다.
//
// 규칙(RD-004 DELTA-08 계승): 고정 sleep 대신 조건이 참이 될 때까지 폴링한다. 행 텍스트는 `.xterm-rows > div`(NBSP → 공백,
// 행 끝 공백 제거), 색은 span 클래스(`xterm-fg-1` 빨강, `xterm-fg-2` 초록). 개행 수는 커서 행 번호로 단언한다(TRP-006).
// 입력은 새 프롬프트 행(`>>> ` 또는 꼬리+`>>> `)이 보인 뒤에 보낸다(TRP-005).
import { chromium } from "playwright";

/** 브라우저를 띄워 url을 연다. 반환한 객체의 헬퍼가 화면·입력·콘솔 기록·페이지 내부 시계를 다룬다. */
export async function open(url, { viewport, before, waitUntil = "load" } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage(viewport ? { viewport } : undefined);
  const logs = [];
  const pageErrors = [];
  const workers = { created: 0 };
  page.on("console", (msg) => logs.push({ source: "page", type: msg.type(), text: msg.text() }));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("worker", (w) => {
    workers.created += 1;
    w.on("console", (msg) => logs.push({ source: "worker", type: msg.type(), text: msg.text() }));
  });
  // 클립보드 붙여넣기(paste())가 쓰는 권한. headless Chromium이 거부해도(구버전 등) paste()가 fallback으로
  // 넘어가므로 여기서는 실패를 삼킨다.
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => {});
  if (before) await before(page);
  // `commit`은 문서 응답이 오자마자 돌아온다. 부팅 중(pyodide 로드 중)에 무언가를 하려면 이것이 필요하다.
  await page.goto(url, { waitUntil });

  // 페이지 내부 타이머(TRP-022): Node↔페이지 CDP 왕복을 측정값에서 빼기 위해, Ctrl+C(`c` keydown, ctrlKey)의
  // 실제 타임스탬프와 프롬프트 복귀 순간을 같은(페이지 내부) 시계로 잰다. armMeasurement()/readElapsed()가 쓴다.
  await page.evaluate(() => {
    window.__ctrlCAt = [];
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.ctrlKey && e.key === "c") window.__ctrlCAt.push(performance.now());
      },
      true,
    );
    window.__armPrompt = () => {
      window.__promptReadyAt = null;
      const root = document.querySelector(".xterm-rows");
      const text = (el) => (el.textContent ?? "").replace(/ /g, " ").replace(/\s+$/, "");
      const check = () => {
        const rowsEls = [...root.querySelectorAll(":scope > div")];
        let last = rowsEls.length - 1;
        while (last >= 0 && text(rowsEls[last]) === "") last -= 1;
        if (last >= 0 && text(rowsEls[last]) === ">>>" && rowsEls[last].querySelector(".xterm-cursor")) {
          if (window.__promptReadyAt == null) window.__promptReadyAt = performance.now();
        }
      };
      if (window.__promptObserver) window.__promptObserver.disconnect();
      window.__promptObserver = new MutationObserver(check);
      window.__promptObserver.observe(root, { childList: true, subtree: true, characterData: true });
      check();
    };
  });
  /** 눌림 전에 부른다: 복귀 관측을 무장하고 이전 눌림 기록을 비운다. */
  async function armMeasurement() {
    await page.evaluate(() => {
      window.__armPrompt();
      window.__ctrlCAt.length = 0;
    });
  }
  /** 눌림·복귀가 끝난 뒤 페이지 시계로 잰 경과(ms)를 읽는다. `which`: "last"(기본, 단발·다중 눌림의 마지막) | "first"(연타 시작). */
  async function readElapsed(which = "last") {
    const r = await page.evaluate(() => ({ promptReadyAt: window.__promptReadyAt, ctrlCAt: window.__ctrlCAt.slice() }));
    const at = which === "first" ? r.ctrlCAt[0] : r.ctrlCAt.at(-1);
    return r.promptReadyAt - at;
  }

  /** 화면 행 텍스트(NBSP는 공백으로, 행 끝 공백은 제거). */
  const rows = () =>
    page.$$eval(".xterm-rows > div", (els) =>
      els.map((e) => (e.textContent ?? "").replace(/ /g, " ").replace(/\s+$/, "")),
    );
  /** 행별 span 클래스 목록. */
  const rowClasses = () =>
    page.$$eval(".xterm-rows > div", (els) =>
      els.map((e) => [...e.querySelectorAll("span")].flatMap((s) => s.className.split(/\s+/).filter(Boolean))),
    );
  /** 텍스트를 가진 마지막 행의 span별 {text, cls}. */
  const spansOf = (needle) =>
    page.evaluate((n) => {
      const row = [...document.querySelectorAll(".xterm-rows > div")]
        .filter((d) => (d.textContent ?? "").includes(n))
        .pop();
      return row
        ? [...row.querySelectorAll("span")].map((s) => ({ text: (s.textContent ?? "").replace(/ /g, " "), cls: s.className }))
        : [];
    }, needle);
  /** 커서가 있는 행 번호(없으면 -1). */
  const cursorRow = () =>
    page.evaluate(() => [...document.querySelectorAll(".xterm-rows > div")].findIndex((el) => el.querySelector(".xterm-cursor")));
  /** 끝쪽 빈 행을 자른 행 목록(출력 사이의 빈 행은 보존한다). */
  const trimmedRows = async () => {
    const r = await rows();
    while (r.length && r[r.length - 1] === "") r.pop();
    return r;
  };
  const nonEmpty = async () => (await rows()).filter((l) => l !== "");
  const lastLine = async () => {
    const r = await nonEmpty();
    return r[r.length - 1] ?? "";
  };
  const tail = async (n) => (await trimmedRows()).slice(-n);

  /** 조건이 참이 될 때까지 폴링한다. 시간 초과면 설명과 화면 끝을 담아 던진다. */
  async function waitFor(check, description, timeoutMs = 30000, intervalMs = 40) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await check();
      if (result) return result;
      if (Date.now() > deadline) {
        throw new Error(`시간 초과: ${description} — 화면 끝 ${JSON.stringify((await trimmedRows()).slice(-6))}`);
      }
      await page.waitForTimeout(intervalMs);
    }
  }
  /**
   * 마지막 텍스트 행이 `expected`(끝 공백 무시)이고 커서가 그 행에 있을 때까지 기다린다. 프롬프트 행이 보이면 읽기가
   * 시작된 것이다(TRP-005). 첫 프롬프트는 pyodide 로드가 수 초라 기본 30초.
   */
  async function waitPrompt(expected = ">>>", timeoutMs = 30000) {
    await waitFor(
      async () => {
        const all = await rows();
        let last = all.length - 1;
        while (last >= 0 && all[last] === "") last -= 1;
        return last >= 0 && all[last] === expected && (await cursorRow()) === last;
      },
      `프롬프트 ${JSON.stringify(expected)}`,
      timeoutMs,
    );
  }
  /** 마지막 텍스트 행이 suffix로 끝나고 커서가 그 행에 있을 때까지 기다린다(꼬리가 길어 행 전체를 모를 때). */
  async function waitLastEndsWith(suffix, timeoutMs = 15000) {
    await waitFor(
      async () => {
        const all = await rows();
        let last = all.length - 1;
        while (last >= 0 && all[last] === "") last -= 1;
        return last >= 0 && all[last].endsWith(suffix) && (await cursorRow()) === last;
      },
      `마지막 행이 ${JSON.stringify(suffix)}로 끝남`,
      timeoutMs,
    );
  }

  /** `[data-testid=status]` 텍스트. */
  const statusText = () => page.locator('[data-testid="status"]').textContent();
  /** `statusText()`가 `values` 중 하나가 될 때까지 기다린다(RD-012). */
  async function waitStatus(values, label, timeoutMs = 30000) {
    await waitFor(
      async () => values.includes(await statusText()),
      label ?? `status가 ${show(values)} 중 하나`,
      timeoutMs,
    );
  }

  const focus = () => page.evaluate(() => document.querySelector(".xterm-helper-textarea")?.focus());
  /**
   * 텍스트를 입력하고 커서 행이 그 끝 글자로 끝나도록 그려질 때까지 기다린다. xterm은 키를 비동기로 그려서, 그리기 전에
   * 화면을 읽으면 낡은 프롬프트 행에 통과한다. 행을 넘겨 감기는 긴 입력은 `sync: false`로 호출자가 따로 기다린다.
   */
  const type = async (text, { sync = true } = {}) => {
    await page.keyboard.type(text);
    const tailChars = text.trimEnd().slice(-10);
    if (!sync || tailChars === "") return;
    await waitFor(async () => {
      const all = await rows();
      const cur = await cursorRow();
      return cur >= 0 && (all[cur] ?? "").endsWith(tailChars);
    }, `입력 ${JSON.stringify(tailChars)}가 커서 행에 그려짐`, 5000);
  };
  const press = (key) => page.keyboard.press(key);
  /**
   * xterm의 `paste` 이벤트 경로(RD-011): 클립보드에 쓰고 Control+V로 붙여넣는다(`\n`→`\r` 변환은 벤더
   * `readPaste`가 한다). headless Chromium은 Control+V가 실제 OS 클립보드 붙여넣기를 일으키지 않는다(실측,
   * DELTA-04 "## 결정") — 화면이 안 바뀌면 `textarea`에 `ClipboardEvent("paste")`를 직접 dispatch하는
   * fallback으로 대체한다. `page.keyboard.insertText`는 대신 쓰지 않는다: CDP `Input.insertText`가 `\n`을
   * 삽입 이벤트에서 지워버려(실측) 여러 줄 소스가 한 줄로 뭉개진다. 합성 `paste` 이벤트는 xterm이 실제로
   * 듣는 이벤트(`qs` 핸들러, `event.clipboardData.getData("text/plain")`)라 실제 붙여넣기와 같은 코드 경로를
   * 지난다. 반환값의 `usedFallback`으로 호출부가 기록할 수 있다.
   */
  const paste = async (text) => {
    const before = await snapshot();
    let usedFallback = false;
    try {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      await focus();
      await press("Control+V");
      const changed = await waitFor(
        async () => (await snapshot()) !== before,
        "붙여넣기 반영",
        1500,
      ).then(
        () => true,
        () => false,
      );
      if (!changed) throw new Error("clipboard paste가 화면을 바꾸지 않았다(headless Control+V)");
    } catch {
      usedFallback = true;
      await focus();
      await page.evaluate((t) => {
        const ta = document.querySelector(".xterm-helper-textarea");
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
        ta.dispatchEvent(ev);
      }, text);
      await waitFor(
        async () => (await snapshot()) !== before,
        "합성 paste 이벤트 반영",
        1500,
      );
    }
    return { usedFallback };
  };
  /** 화면 스냅샷(행 + 커서 행). Enter가 화면을 바꿨는지 보는 데 쓴다. */
  const snapshot = async () => JSON.stringify([await rows(), await cursorRow()]);
  /**
   * Enter를 치고 화면이 실제로 바뀔 때까지 기다린다. Enter는 항상 개행을 그리므로 바뀌지 않으면 아직 처리되지 않은 것이다.
   * 이 뒤에 새 프롬프트를 기다리면 낡은 프롬프트 행에 통과하지 않는다.
   */
  const enter = async () => {
    const before = await snapshot();
    await press("Enter");
    await waitFor(async () => (await snapshot()) !== before, "Enter 뒤 화면 변화", 5000);
  };
  /** 코드를 입력하고 Enter를 친 뒤 다음 프롬프트를 기다린다. */
  async function submit(code, expectedPrompt = ">>>") {
    await type(code);
    await enter();
    await waitPrompt(expectedPrompt);
  }
  /** 화면을 지우고(Ctrl+L) 맨 윗 행에 `>>>`가 다시 그려질 때까지 기다린다. 24행을 넘는 출력이 스크롤로 행 비교를 깨지 않게 한다. */
  async function clear() {
    await focus();
    await press("Control+l");
    await waitFor(async () => (await rows())[0] === ">>>" && (await cursorRow()) === 0, "Ctrl+L 뒤 첫 행의 >>>", 5000);
  }
  /**
   * top-level await 체크박스를 `on`에 맞춘다(RD-012). 이미 같으면 무동작. 다르면 클릭 → `reset()`이 동기로
   * 발행하는 `loading` → `ready`/`load-failed` → 새 프롬프트까지 기다린다. 클릭이 xterm의 숨은 textarea에서
   * 포커스를 가져가므로 끝에 되돌린다. `load-failed`면 던진다.
   */
  async function setTopLevelAwait(on) {
    const checked = await page.locator('[data-testid="top-level-await"]').isChecked();
    if (checked === on) return;
    await page.click('[data-testid="top-level-await"]');
    await waitStatus(["loading"], "top-level await 전환: loading 상태");
    await waitStatus(["ready", "load-failed"], "top-level await 전환: ready/load-failed 상태");
    await focus();
    if ((await statusText()) === "load-failed") {
      throw new Error("top-level await 전환 뒤 load-failed");
    }
    await waitPrompt(">>>", 30000);
  }

  /** 빈 Enter로 프롬프트를 `>>>`로 되돌린다(꼬리가 든 `t>>>` 뒤 다음 시나리오가 깨끗하게 시작하게 한다). */
  async function resetPrompt() {
    await enter();
    await waitPrompt(">>>");
  }
  /** 입력 줄을 지우고(Ctrl+U) 프롬프트만 남긴다. */
  async function killLine() {
    await press("Control+u");
  }
  /**
   * stdin 읽기가 시작되기 전에 친 키는 벤더 readline이 버린다(활성 읽기가 없다, TRP-005). 프롬프트 글자(`x: `)는 `write` 알림으로
   * 읽기 시작보다 먼저 화면에 나오고 프롬프트 없는 `input()`은 화면 신호가 없어, 화면만으로는 읽기가 시작됐는지 알 수 없다.
   * 첫 글자를 쳐서 화면이 바뀔 때까지(에코) 재시도한다. 버려진 키는 화면에 흔적이 없어 재시도가 안전하다. 나머지 글자는 그 뒤에 친다.
   */
  async function typeWhenReading(text, { attempts = 40, echoMs = 400 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const before = await snapshot();
      await page.keyboard.type(text[0]);
      const echoed = await waitFor(async () => (await snapshot()) !== before, "첫 글자 에코", echoMs).then(
        () => true,
        () => false,
      );
      if (echoed) {
        if (text.length > 1) await type(text.slice(1));
        return;
      }
    }
    throw new Error(`stdin 읽기가 시작되지 않았다(첫 글자 ${JSON.stringify(text[0])}가 ${attempts}번 버려짐)`);
  }
  /** 화면(행 + 커서 행)이 `quietMs` 동안 바뀌지 않을 때까지 기다린다. 긴 프롬프트의 재그리기가 끝난 뒤 행을 읽을 때 쓴다. */
  async function settled(quietMs = 200, timeoutMs = 5000) {
    let last = await snapshot();
    let since = Date.now();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(40);
      const now = await snapshot();
      if (now !== last) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since >= quietMs) {
        return;
      }
    }
    throw new Error("화면이 안정되지 않았다");
  }

  /**
   * 복합문 한 줄(`while True: pass`)을 제출해 실행을 시작한다. 3.14 REPL처럼 첫 Enter는 `... `를 내고
   * 빈 줄 Enter가 있어야 블록이 끝나 실행이 시작된다. 이 단계를 빼면 Ctrl+C가 활성 읽기(프롬프트)로 가
   * 벤더 경로에서 `... ^C`만 찍힌다.
   */
  async function startBlockLine(code) {
    await type(code);
    await enter();
    await waitPrompt("...");
    await enter();
  }
  /** Ctrl+C 한 번. 실행 중이면 `^C` 에코 + SIGINT 전송, 활성 읽기 중이면 벤더가 같은 프롬프트를 다시 그린다. */
  const ctrlC = () => page.keyboard.press("Control+c");
  /**
   * Ctrl을 누른 채 `c`를 `count`번 친다(키 반복·연타). `gapMs`가 0이면 브라우저가 낼 수 있는 최속으로,
   * `leadMs`는 첫 타와 나머지 사이의 간격이다(OS 키 반복의 첫 지연을 흉내낸다).
   */
  async function holdCtrlC(count, { gapMs = 0, leadMs = 0 } = {}) {
    await page.keyboard.down("Control");
    try {
      for (let i = 0; i < count; i += 1) {
        if (i === 1 && leadMs > 0) await page.waitForTimeout(leadMs);
        else if (i > 0 && gapMs > 0) await page.waitForTimeout(gapMs);
        await page.keyboard.down("c");
        await page.keyboard.up("c");
      }
    } finally {
      await page.keyboard.up("Control");
    }
  }
  /**
   * 마지막 텍스트 행이 프롬프트로 끝날 때까지 기다린다. 중단 직후의 프롬프트 행은 앞에 `^C`가 붙을 수 있고
   * (`^C>>> `, 연타면 여러 개) 꼬리가 남아 있을 수도 있다.
   */
  async function waitPromptTail(timeoutMs = 15000) {
    await waitFor(
      async () => {
        const all = await rows();
        let last = all.length - 1;
        while (last >= 0 && all[last] === "") last -= 1;
        return last >= 0 && all[last].endsWith(">>>") && (await cursorRow()) === last;
      },
      "프롬프트로 끝나는 마지막 행",
      timeoutMs,
    );
  }
  /**
   * stdin 읽기가 열린 것을 첫 글자 에코로 확인한 뒤 Ctrl+C를 누른다. 읽기가 열리기 전의 Ctrl+C는
   * 활성 읽기가 없어 `ctrlCHandler`로 가 버려지고(TRP-005), 인자 없는 `input()`은 프롬프트 글자가 없어
   * 화면만으로는 읽기 시작을 알 수 없다. `text`는 최소 한 글자이어야 한다(그 글자가 읽기 확인용이다).
   */
  async function cancelWhenReading(text) {
    if (!text) throw new Error("cancelWhenReading에는 읽기를 확인할 글자가 최소 하나 필요하다");
    await typeWhenReading(text);
    await ctrlC();
  }
  /** Ctrl+C를 `count`번 따로 누른다(누른 채 반복하는 `holdCtrlC`와 달리 매번 Control을 떼고 다시 누른다). */
  async function ctrlCBurst(count, gapMs = 0) {
    for (let i = 0; i < count; i += 1) {
      if (i > 0 && gapMs > 0) await page.waitForTimeout(gapMs);
      await ctrlC();
    }
  }
  /** 화면 전체의 `^C` 개수. 행이 감겨도 놓치지 않게 이어붙여 센다. */
  const caretCount = async () => (await rows()).join("").split("^C").length - 1;
  /** 화면의 `KeyboardInterrupt` 개수. 프롬프트 취소는 눌림을 몇 번 하든 1이어야 한다. */
  const interruptCount = async () => (await rows()).join("").split("KeyboardInterrupt").length - 1;

  /**
   * 화면의 트레이스백 머리글 수. 정상 중단은 정확히 1이어야 한다(연타가 여러 번 중단하면 늘어난다).
   * 행 단위가 아니라 이어붙인 화면에서 센다: 꼬리(`^C` 30개 = 60칸)에 머리글이 붙으면 80칸을 넘어 행이
   * 감기고(`Traceback (most rece` / `nt call last):`) 행 단위 검사는 0을 센다.
   */
  const countTracebacks = async () =>
    (await rows()).join("").split("Traceback (most recent call last):").length - 1;
  /** 화면에 핸들러 내부가 샜는지(절단 실패). 정상이면 빈 배열이다. 감긴 행을 놓치지 않게 이어붙여서도 본다. */
  const handlerLeaks = async () => {
    const all = await rows();
    const joined = all.join("");
    const leaked = /sigint_handler|<sigint-handler>/.test(joined);
    if (!leaked) return [];
    const lines = all.filter((r) => /sigint_handler|<sigint-handler>/.test(r));
    return lines.length > 0 ? lines : ["(감긴 행에 걸쳐 있음)"];
  };

  const checks = {};
  const notes = {};
  /** 확인 하나를 실행해 통과·실패와 사유를 기록한다(하나가 실패해도 뒤 확인을 계속한다). */
  async function step(name, fn) {
    // ONLY=W4,T1 처럼 이름이 그 접두어로 시작하는 확인만 실행한다(양성 대조에서 확인을 분리해 볼 때 쓴다). "초기"는 항상 실행한다.
    const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
    if (only.length > 0 && !name.startsWith("초기") && !only.some((prefix) => name.startsWith(prefix))) return;
    try {
      await fn();
      checks[name] = true;
      console.log(`PASS  ${name}`);
    } catch (e) {
      checks[name] = false;
      notes[name] = String(e.message ?? e);
      console.log(`FAIL  ${name}  — ${notes[name]}`);
    }
  }
  const problemLogs = () => logs.filter((l) => l.type === "warning" || l.type === "error");
  /**
   * webloop 재보고인지. 정상 중단·`exit()`마다 asyncio Task가 `KeyboardInterrupt`·`SystemExit`을 다시 던져
   * `run_handle`에서 JS unhandled rejection이 된다(설계 2.8, `webloop-reraise` 억제가 있으면 나지 않는다).
   */
  const isWebLoopReraise = (text) =>
    /webloop\.py/.test(text) && /(KeyboardInterrupt|SystemExit)/.test(text);
  /** 재보고를 뺀 pageerror. 진단용(판정은 `pageErrors` 총계로 한다). */
  const otherPageErrors = () => pageErrors.filter((e) => !isWebLoopReraise(e));

  /**
   * 결과를 JSON으로 출력하고 브라우저를 닫는다. 종료 코드는 호출자가 정한다.
   * `ok`는 `pageErrors`(전체, 재보고 포함) 0도 요구한다. `webLoopReraises`는 진단용으로만 남긴다.
   */
  async function finish(extra = {}) {
    const finalRows = (await rows()).filter((r) => r !== "");
    await browser.close();
    const ok = Object.values(checks).every(Boolean) && pageErrors.length === 0;
    console.log(
      JSON.stringify(
        {
          url,
          ok,
          passed: Object.values(checks).filter(Boolean).length,
          total: Object.keys(checks).length,
          failed: Object.entries(checks)
            .filter(([, v]) => !v)
            .map(([k]) => k),
          notes,
          finalRows: finalRows.slice(-8),
          problemLogs: problemLogs(),
          webLoopReraises: pageErrors.length - otherPageErrors().length,
          pageErrors,
          ...extra,
        },
        null,
        2,
      ),
    );
    return ok;
  }

  return {
    browser,
    page,
    logs,
    pageErrors,
    workers,
    rows,
    rowClasses,
    spansOf,
    cursorRow,
    trimmedRows,
    nonEmpty,
    lastLine,
    tail,
    waitFor,
    waitPrompt,
    waitLastEndsWith,
    statusText,
    waitStatus,
    setTopLevelAwait,
    waitPromptTail,
    startBlockLine,
    ctrlC,
    holdCtrlC,
    cancelWhenReading,
    ctrlCBurst,
    caretCount,
    interruptCount,
    countTracebacks,
    handlerLeaks,
    focus,
    type,
    press,
    paste,
    enter,
    submit,
    clear,
    resetPrompt,
    killLine,
    typeWhenReading,
    settled,
    snapshot,
    step,
    checks,
    notes,
    problemLogs,
    isWebLoopReraise,
    otherPageErrors,
    armMeasurement,
    readElapsed,
    finish,
  };
}

export const hasFg = (classes, n) => classes.includes(`xterm-fg-${n}`);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const show = (v) => JSON.stringify(v);
