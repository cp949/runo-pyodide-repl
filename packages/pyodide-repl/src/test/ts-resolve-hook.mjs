/**
 * worker 스레드 시험 전용 해석 훅. `--import`로 스레드에 등록한다(`src/test/thread.ts`).
 * 프로덕션 소스는 번들러 해석을 전제로 확장자 없이 상대 import를 쓴다(`../protocol/rpc`). Node의 타입 제거 실행은 그
 * 확장자를 풀지 못하므로 `.ts`를 붙여 다시 푼다.
 */
import { registerHooks } from "node:module";

const RELATIVE = /^\.\.?\//;
const HAS_SCRIPT_EXTENSION = /\.[cm]?[jt]s$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (RELATIVE.test(specifier) && !HAS_SCRIPT_EXTENSION.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // 확장자를 붙여도 없으면 원래 지정자로 다시 시도해 Node의 원래 오류를 낸다.
      }
    }
    return nextResolve(specifier, context);
  },
});
