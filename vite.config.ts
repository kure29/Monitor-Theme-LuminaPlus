import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9911",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // 与 CSS 实际基线对齐:全站大量 color-mix()/oklch(需 Chrome 111 / Safari 16.2+),
    // JS 没必要为更老的引擎转译。
    target: ["es2022", "chrome111", "safari16.2", "firefox113"],
    rolldownOptions: {
      output: {
        // 分组会把依赖一并拉进来:没有 priority 时 uplot-react 会把 react 核心带进 charts,
        // 首页主包随之静态依赖 charts、白白加载 uPlot。react 组优先级最高,先认领共享依赖。
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "query",
              test: /[\\/]node_modules[\\/]@tanstack[\\/](?:react-query|query-core)[\\/]/,
              priority: 20,
            },
            {
              name: "charts",
              test: /[\\/]node_modules[\\/](?:uplot|uplot-react)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
