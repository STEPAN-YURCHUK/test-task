import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // e2e-сборка (NEXT_DIST_DIR=.next-e2e) не должна затирать сборку/кеш dev-сервера
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // проект лежит рядом с back/ без общего lockfile — корень фиксируем явно
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
