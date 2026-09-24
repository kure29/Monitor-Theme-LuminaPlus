const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

interface MockMetrics {
  uptime: number;
  cpu: number;
  load: [number, number, number];
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  net_rx: number;
  net_tx: number;
  month_rx: number;
  month_tx: number;
  tcp: number;
  udp: number;
  procs: number;
}

interface MockNode {
  id: number;
  name: string;
  sort: number;
  public: boolean;
  online: boolean;
  country: string;
  last_seen: number;
  metrics: MockMetrics | null;
  os: string;
  kernel: string;
  arch: string;
  virt: string;
  cpu_name: string;
  cpu_cores: number;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  price: number;
  currency: string;
  billing_cycle: string;
  expires_at: string;
  traffic_limit: number;
  traffic_mode: string;
  total_rx: number;
  total_tx: number;
  month_rx: number;
  month_tx: number;
  day_rx: number;
  day_tx: number;
  ipv4: string;
  ipv6: string;
  remark: string;
}

interface NodeSeed {
  name: string;
  country: string;
  os: string;
  cpuName: string;
  cores: number;
  memory: number;
  swap: number;
  disk: number;
  price: number;
  currency: string;
  expiresInDays: number;
  trafficLimit: number;
  cpu: number;
  memoryPct: number;
  diskPct: number;
  netRx: number;
  netTx: number;
  monthRx: number;
  monthTx: number;
  online?: boolean;
}

const seeds: NodeSeed[] = [
  { name: "Tokyo Edge", country: "JP", os: "debian", cpuName: "AMD EPYC 7B13", cores: 4, memory: 8 * GIB, swap: 2 * GIB, disk: 160 * GIB, price: 48, currency: "CNY", expiresInDays: 24, trafficLimit: 4 * TIB, cpu: 18, memoryPct: 36, diskPct: 34, netRx: 72_000_000, netTx: 18_000_000, monthRx: 1.1 * TIB, monthTx: 820 * GIB },
  { name: "Singapore API", country: "SG", os: "ubuntu", cpuName: "Intel Xeon Gold 6338", cores: 8, memory: 16 * GIB, swap: 4 * GIB, disk: 240 * GIB, price: 18, currency: "USD", expiresInDays: 12, trafficLimit: 6 * TIB, cpu: 46, memoryPct: 57, diskPct: 57, netRx: 98_000_000, netTx: 32_000_000, monthRx: 2.2 * TIB, monthTx: 1.8 * TIB },
  { name: "Frankfurt DB", country: "DE", os: "alma", cpuName: "AMD EPYC 7763", cores: 12, memory: 32 * GIB, swap: 8 * GIB, disk: 480 * GIB, price: 34, currency: "EUR", expiresInDays: 3, trafficLimit: 8 * TIB, cpu: 91, memoryPct: 88, diskPct: 83, netRx: 24_000_000, netTx: 8_000_000, monthRx: 2.9 * TIB, monthTx: 3.6 * TIB },
  { name: "New York Worker", country: "US", os: "rocky", cpuName: "Intel Xeon Platinum 8370C", cores: 8, memory: 16 * GIB, swap: 4 * GIB, disk: 320 * GIB, price: 22, currency: "USD", expiresInDays: 46, trafficLimit: 5 * TIB, cpu: 63, memoryPct: 66, diskPct: 66, netRx: 54_000_000, netTx: 21_000_000, monthRx: 1.7 * TIB, monthTx: 1.4 * TIB },
  { name: "Hong Kong Cache", country: "HK", os: "alpine", cpuName: "AMD EPYC 7543P", cores: 4, memory: 6 * GIB, swap: 2 * GIB, disk: 120 * GIB, price: 68, currency: "CNY", expiresInDays: 61, trafficLimit: 3 * TIB, cpu: 31, memoryPct: 42, diskPct: 42, netRx: 86_000_000, netTx: 28_000_000, monthRx: 1.3 * TIB, monthTx: 740 * GIB },
  { name: "Sydney Backup", country: "AU", os: "ubuntu", cpuName: "Ampere Altra", cores: 4, memory: 8 * GIB, swap: 2 * GIB, disk: 640 * GIB, price: 14, currency: "USD", expiresInDays: 19, trafficLimit: 2 * TIB, cpu: 0, memoryPct: 38, diskPct: 38, netRx: 0, netTx: 0, monthRx: 880 * GIB, monthTx: 1.1 * TIB, online: false },
];

const pingTasks = [
  { id: 1, name: "Cloudflare", target: "1.1.1.1:443", interval: 60, nodes: [1, 2, 3, 4, 5] },
  { id: 2, name: "Google", target: "8.8.8.8:443", interval: 60, nodes: [1, 2, 3, 4, 5] },
  { id: 3, name: "Tokyo", target: "example.jp:443", interval: 60, nodes: [1, 2, 5] },
];

function dateAfter(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function buildNodes(): MockNode[] {
  const tick = Date.now() / 9_000;
  return seeds.map((seed, index) => {
    const online = seed.online !== false;
    const wave = Math.sin(tick + index) * 3;
    const monthRx = Math.round(seed.monthRx);
    const monthTx = Math.round(seed.monthTx);
    const metrics: MockMetrics | null = online
      ? {
          uptime: (index + 3) * 864_000,
          cpu: Math.max(1, Math.min(99, seed.cpu + wave)),
          load: [0.7 + index * 1.25, 0.6 + index, 0.5 + index * 0.8],
          mem_total: seed.memory,
          mem_used: seed.memory * seed.memoryPct / 100,
          swap_total: seed.swap,
          swap_used: seed.swap * (index + 1) * 0.02,
          disk_total: seed.disk,
          disk_used: seed.disk * seed.diskPct / 100,
          net_rx: Math.max(0, seed.netRx * (0.88 + Math.sin(tick * 1.3 + index) * 0.12)),
          net_tx: Math.max(0, seed.netTx * (0.86 + Math.cos(tick + index) * 0.14)),
          month_rx: monthRx,
          month_tx: monthTx,
          tcp: 180 + index * 44,
          udp: 12 + index * 3,
          procs: 96 + index * 21,
        }
      : null;
    return {
      id: index + 1,
      name: seed.name,
      sort: (index + 1) * 10,
      public: true,
      online,
      country: seed.country,
      last_seen: Math.floor(Date.now() / 1000) - (online ? 2 : 4_200),
      metrics,
      os: seed.os,
      kernel: index % 2 ? "6.8.0" : "6.1.0",
      arch: index === 5 ? "aarch64" : "x86_64",
      virt: "KVM",
      cpu_name: seed.cpuName,
      cpu_cores: seed.cores,
      mem_total: seed.memory,
      swap_total: seed.swap,
      disk_total: seed.disk,
      price: seed.price,
      currency: seed.currency,
      billing_cycle: "month",
      expires_at: dateAfter(seed.expiresInDays),
      traffic_limit: seed.trafficLimit,
      traffic_mode: "sum",
      total_rx: monthRx * 4,
      total_tx: monthTx * 4,
      month_rx: monthRx,
      month_tx: monthTx,
      day_rx: Math.round(seed.netRx * 3_600),
      day_tx: Math.round(seed.netTx * 3_600),
      ipv4: `203.0.113.${11 + index * 10}`,
      ipv6: `2001:db8::${11 + index * 10}`,
      remark: "Monitor LuminaPlus 本地预览节点",
    };
  });
}

function metricHistory(node: MockNode, hours: number, points: number) {
  const count = Math.min(points, Math.max(12, Math.ceil(hours * 12)));
  const step = Math.max(300, Math.ceil(hours * 3_600 / count / 60) * 60);
  const now = Math.floor(Date.now() / 1000);
  const seed = seeds[node.id - 1];
  return Array.from({ length: count }, (_, sample) => {
    const phase = sample / 7 + node.id;
    return {
      ts: now - (count - 1 - sample) * step,
      cpu: Math.max(1, Math.min(99, seed.cpu + Math.sin(phase) * 10)),
      mem_used: seed.memory * Math.min(0.94, seed.memoryPct / 100 + Math.cos(phase) * 0.04),
      disk_used: seed.disk * seed.diskPct / 100,
      net_rx: Math.max(0, seed.netRx * (0.7 + Math.sin(phase) * 0.24)),
      net_tx: Math.max(0, seed.netTx * (0.7 + Math.cos(phase) * 0.24)),
    };
  });
}

function pingHistory(node: MockNode, hours: number, points: number) {
  const tasks = pingTasks.filter((task) => task.nodes.includes(node.id));
  const count = Math.min(points, Math.max(12, Math.ceil(hours * 60)));
  const step = Math.max(60, Math.ceil(hours * 3_600 / count / 60) * 60);
  const now = Math.floor(Date.now() / 1000);
  return tasks.flatMap((task) =>
    Array.from({ length: count }, (_, sample) => {
      const lost = node.id === 3 && sample % 17 === 0;
      return {
        task_id: task.id,
        ts: now - (count - 1 - sample) * step,
        latency: lost ? null : Math.round(11 + node.id * 17 + task.id * 8 + Math.sin(sample / 5 + node.id) * 7),
        loss: lost ? 100 : 0,
      };
    }),
  );
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function defaultThemeSettings() {
  return {
    desktopNodeViewMode: "compact",
    mobileNodeViewMode: "compact",
    showHomeOverview: true,
    showRegionBar: true,
    showCardGroup: true,
    enableHomeSort: true,
    showCostSummary: true,
    showCostSummaryFloatingButton: true,
    showCostsToGuests: true,
    showOverviewRatings: true,
    showTrafficRating: true,
    showBandwidthRating: true,
    showAssetRating: true,
    showPingChart: true,
    showTodayTrafficPopover: true,
    homepagePingBindings: { "2": ["1", "2", "3", "4", "5"] },
  };
}

export function installDevMockApi() {
  sessionStorage.setItem("monitor-luminaplus:dev-mock", "1");
  const configKey = "monitor-luminaplus:dev-theme-config";
  let themeSettings = defaultThemeSettings() as Record<string, unknown>;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(configKey) ?? "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      themeSettings = saved as Record<string, unknown>;
    }
  } catch {
    // An invalid mock value should not prevent the preview from loading.
  }
  const nativeFetch = window.fetch.bind(window);
  const adminMode = new URLSearchParams(window.location.search).get("admin") === "1";

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.origin);

    if (url.hostname === "api.frankfurter.dev") {
      return json([
        { base: "USD", quote: "CNY", rate: 7.18 },
        { base: "USD", quote: "EUR", rate: 0.86 },
        { base: "USD", quote: "JPY", rate: 146.4 },
      ]);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return nativeFetch(input, init);
    }
    if (url.pathname === "/api/me") {
      return json({ authed: adminMode, github: false, site_name: "Lumina Ops", public_page: true });
    }
    if (url.pathname === "/api/themes/LuminaPlus/config") {
      if (request.method === "GET") return json(themeSettings);
      if (request.method === "PUT" && adminMode) {
        const next: unknown = await request.json();
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          return json({ message: "expected an object" }, { status: 400 });
        }
        themeSettings = next as Record<string, unknown>;
        sessionStorage.setItem(configKey, JSON.stringify(themeSettings));
        return new Response(null, { status: 204 });
      }
      return json({ message: "unauthorized" }, { status: 401 });
    }
    if (url.pathname === "/api/nodes") {
      return json({ nodes: buildNodes(), admin: adminMode });
    }
    if (url.pathname === "/api/ping-tasks") {
      if (!adminMode) return json({ message: "unauthorized" }, { status: 401 });
      return json({ tasks: pingTasks });
    }

    const match = url.pathname.match(/^\/api\/nodes\/(\d+)\/metrics$/);
    if (match) {
      const node = buildNodes().find((item) => item.id === Number(match[1]));
      if (!node) return json({ message: "no such node" }, { status: 404 });
      const hours = Math.max(1, Number(url.searchParams.get("hours")) || 6);
      const points = Math.max(12, Number(url.searchParams.get("points")) || 720);
      const series = url.searchParams.get("series");
      const metrics = series === "ping" ? [] : metricHistory(node, hours, points);
      const ping = series === "metrics" ? [] : pingHistory(node, hours, points);
      const probes = Object.fromEntries(
        pingTasks.filter((task) => task.nodes.includes(node.id)).map((task) => [String(task.id), task.name]),
      );
      return json({ metrics, ping, probes, loss: {} });
    }

    return json({ message: `No mock for ${url.pathname}` }, { status: 404 });
  };
}
