import {
  parseInitFrame,
  type InitFrame,
} from "@cp949/runo-pyodide-core/worker";
import { bootReplWorker } from "./worker/boot";
import { loadPyodideFromCdn } from "./worker/load-pyodide";

/**
 * worker 쪽 진입점. 앱의 얇은 worker 파일이 부른다('@cp949/runo-pyodide-repl/worker').
 * main이 보낸 초기화 프레임을 검증한 뒤 CDN 로더를 주입해 부팅 시퀀스(`bootReplWorker`)를 시작한다.
 * 부팅 뒤 REPL 루프는 worker 내부에서 `readLine` RPC를 요청하며 이어진다.
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
      // 부팅 중 예상하지 못한 예외가 처리되지 않은 rejection으로 새지 않게 남긴다.
      bootReplWorker(frame, { loadPyodide: loadPyodideFromCdn }).catch(
        (error: unknown) => {
          console.error("[repl.worker] 부팅 시퀀스 예외", error);
        },
      );
    },
    { once: true },
  );
}
