/**
 * worker 부팅 시퀀스(01-protocols.md 5절 S1, 00-architecture.md 3.1). 시퀀스 본체는 core `bootWorker`
 * (`@cp949/runo-pyodide-core/worker`)이고, 이 모듈은 REPL driver(`replDriver`)를 끼워 넣는 얇은 진입점이다.
 * 로더는 주입해 node에서 npm `loadPyodide`로 시험하고 브라우저에서는 CDN 로더를 쓴다(`runWorker`가 넣는다).
 */
import {
  bootWorker,
  type BootDeps,
  type InitFrame,
} from "@cp949/runo-pyodide-core/worker";
import { replDriver } from "./repl-driver";

export type { BootDeps };

export function bootReplWorker(
  frame: InitFrame,
  deps: BootDeps,
): Promise<void> {
  return bootWorker(frame, {
    driver: replDriver,
    loadPyodide: deps.loadPyodide,
  });
}
