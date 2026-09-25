// S5 시험 worker(`?view=dom-bridge&mode=slow`): `dom-bridge.worker.ts`에 시험 플러그인을 더한다. dom-bridge `./worker`가 첫 import다.
import { bridge, domBridge } from "@cp949/runo-pyodide-dom-bridge/worker";
import { runDriver, runWorker } from "@cp949/runo-pyodide-core/worker";
import type { WorkerPlugin } from "@cp949/runo-pyodide-core/worker";

// main이 `worker.proxy.slow`에 등록한 Promise 핸들러를 Python에 `runo_test.slow(ms)`로 노출한다. coincident 동기 호출이라 main이
// Promise를 정착시킬 때까지 worker가 막힌다(호출 도중 `interrupt()`가 전달되지 않는 S5 동작의 재현 장치).
const slowPlugin: WorkerPlugin = {
  name: "dom-bridge-test-slow",
  async prepare({ pyodide }) {
    const { proxy } = await bridge();
    pyodide.registerJsModule("runo_test", { slow: proxy.slow });
  },
};

runWorker({ driver: runDriver, plugins: [domBridge(), slowPlugin] });
