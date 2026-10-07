type TrafficPageModule = typeof import("@/pages/Traffic");

let trafficPagePromise: Promise<TrafficPageModule> | null = null;

/** 路由加载与入口悬停预取共用同一个 Promise；失败后允许下一次重新加载。 */
export function loadTrafficPage(): Promise<TrafficPageModule> {
  trafficPagePromise ??= import("@/pages/Traffic").catch((error) => {
    trafficPagePromise = null;
    throw error;
  });
  return trafficPagePromise;
}

export function preloadTrafficPage() {
  void loadTrafficPage().catch(() => {
    // 预取失败不影响当前页面；真正进入路由时 loadTrafficPage 会重新尝试。
  });
}
