import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig 는 Next 용 jsx: "preserve" 라서, 컴포넌트를 렌더하는 테스트는 JSX 변환을 따로 지정한다
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 개발자 셸/.env 에 NSV_GRAPHQL_URLS 가 있어도 테스트가 실제 NSV 를 부르지 않게 비워 둔다 (필요한 테스트는 stubEnv 로 지정)
    env: { NSV_GRAPHQL_URLS: "" },
  },
});
