import { parseInitFrame } from "./protocol/init-frame";
import type { InitFrame } from "./protocol/init-frame";

/**
 * worker 쪽 진입점. 앱의 얇은 worker 파일이 부른다('@cp949/runo-pyodide-repl/worker').
 * 이 단계(RD-002)는 main이 보낸 초기화 프레임을 검증해 console.log로 에코하는 데까지만 간다.
 * pyodide 로드는 RD-004, REPL 루프는 RD-005가 채운다.
 */
export function runReplWorker(): void {
  // 첫 await 이전에 리스너를 건다. 첫 메시지 뒤에는 네이티브 message 채널을 쓰지 않는다(01-protocols.md 4절).
  self.addEventListener(
    "message",
    (event) => {
      let frame: InitFrame;
      try {
        frame = parseInitFrame(event.data);
      } catch (error) {
        console.error("[repl.worker] 초기화 프레임이 올바르지 않다", error);
        return;
      }
      console.log("[repl.worker] 초기화 프레임 수신", frame);
    },
    { once: true },
  );
}
