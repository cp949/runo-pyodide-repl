/**
 * 세션 밖 안내 줄(비격리 경고, RD-010의 리셋 안내). 세션 sink 세트가 아니라 이 함수로 낸다.
 * TRAP-12("sink 밖 출력 경로 금지")의 유일한 예외이며, 개행으로 끝나는 한 줄만 내므로 꼬리에 영향이 없다.
 */
import type { Readline } from "@cp949/runo-xterm-readline";

export type NoticeKind = "warning" | "info";

const COLOR: Record<NoticeKind, string> = {
  warning: "\x1b[33m",
  info: "\x1b[36m",
};
const RESET = "\x1b[0m";

/** 노랑(`warning`)·청록(`info`)으로 감싼 한 줄을 낸다. 끝 개행 없는 텍스트를 넘긴다. */
export function writeNotice(
  readline: Pick<Readline, "println">,
  text: string,
  kind: NoticeKind,
): void {
  readline.println(`${COLOR[kind]}${text}${RESET}`);
}
