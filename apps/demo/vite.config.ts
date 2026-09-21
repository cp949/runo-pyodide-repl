import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// SharedArrayBuffer(Ctrl+C·input())는 cross-origin isolated 페이지에서만 쓸 수 있다(ADR-0004).
// dev와 preview 둘 다에 걸어야 한다. 이전 구현은 dev에만 걸어 preview·빌드 산출물이 비격리였다.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  // worker 파일에 top-level await가 들어갈 수 있어 es여야 한다(기본 iife는 프로덕션 빌드에서 실패).
  worker: { format: "es" },
});
