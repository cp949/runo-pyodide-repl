// main 쪽 프로토콜(01-protocols.md). 세션은 이후 DELTA에서 옮긴다.
export { postInitFrame } from "./protocol/init-frame";
export type { InitFrame } from "./protocol/init-frame";
export {
  ACK,
  SEQ,
  SIGNAL,
  createInterruptBuffer,
  signalInterrupt,
} from "./protocol/interrupt-protocol";
export { createInterruptSender } from "./protocol/interrupt-sender";
export type { InterruptSender } from "./protocol/interrupt-sender";
export { createRpc } from "./protocol/rpc";
export type { Rpc, RpcHandlers } from "./protocol/rpc";
export {
  createMailboxWriter,
  createStdinMailbox,
} from "./protocol/stdin-mailbox";
export { createOutputTail } from "./terminal/output-tail";
