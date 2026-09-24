import type {
  AdminClient,
  LoadRecord,
  LoadRecordsResponse,
  Me,
  NodeInfo,
  PingOverviewItem,
  PingRecord,
  PingRecordsResponse,
  PingTask,
  PingTaskStats,
  PublicConfig,
} from "@/types/models";
import { fetchWithTimeout } from "@/utils/abort";
import type { TrafficMetricSeries } from "@/utils/trafficStats";

const DEFAULT_API_TIMEOUT_MS = 12_000;
const SETTINGS_KEY = "monitor-theme-luminaplus:settings";
const DEV_MOCK_SESSION_KEY = "monitor-luminaplus:dev-mock";
const THEME_SHORT = "LuminaPlus";

interface ApiCallOptions {
  signal?: AbortSignal;
  timeout?: number;
}

interface LoadRecordsOptions extends ApiCallOptions {
  skipMetricQuery?: boolean;
}

interface MonitorMe {
  authed?: boolean;
  github?: boolean;
  site_name?: string;
  public_page?: boolean;
}

interface MonitorMetrics {
  uptime?: number;
  cpu?: number;
  load?: number[];
  mem_total?: number;
  mem_used?: number;
  swap_total?: number;
  swap_used?: number;
  disk_total?: number;
  disk_used?: number;
  net_rx?: number;
  net_tx?: number;
  month_rx?: number;
  month_tx?: number;
  tcp?: number;
  udp?: number;
  procs?: number;
}

interface MonitorNode {
  id: number;
  name?: string;
  group?: string;
  sort?: number;
  public?: boolean;
  online?: boolean;
  country?: string;
  last_seen?: number;
  metrics?: MonitorMetrics | null;
  os?: string;
  kernel?: string;
  arch?: string;
  virt?: string;
  cpu_name?: string;
  cpu_cores?: number;
  mem_total?: number;
  swap_total?: number;
  disk_total?: number;
  price?: number;
  currency?: string;
  billing_cycle?: string;
  expires_at?: string | null;
  traffic_limit?: number;
  traffic_mode?: string;
  total_rx?: number;
  total_tx?: number;
  month_rx?: number;
  month_tx?: number;
  day_rx?: number;
  day_tx?: number;
  hostname?: string;
  ip?: string;
  ipv4?: string;
  ipv6?: string;
  remark?: string;
}

interface MonitorMetricPoint {
  ts: number;
  cpu?: number;
  mem_used?: number;
  disk_used?: number;
  net_rx?: number;
  net_tx?: number;
}

interface MonitorPingPoint {
  task_id: number;
  ts: number;
  latency: number | null;
  loss?: number;
}

interface MonitorHistory {
  metrics?: MonitorMetricPoint[];
  ping?: MonitorPingPoint[];
  probes?: Record<string, string>;
  loss?: Record<string, number>;
}

interface PingOverviewResponse {
  records: PingRecord[];
  tasks: PingTask[];
  taskAssignmentsKnown?: boolean;
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
  stats?: PingTaskStats[];
  /** 每个节点各自的窗口丢包率(节点 uuid → 任务 id → 百分比)。 */
  clientWindowLoss?: Record<string, Record<number, number>>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export class MetricApiUnavailableError extends Error {
  constructor() {
    super("Metric API is unavailable on this server");
    this.name = "MetricApiUnavailableError";
  }
}

const warned = new Set<string>();
export function warnDegradedOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[LuminaPlus] ${message}`);
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function requestJson<T>(path: string, options?: ApiCallOptions): Promise<T> {
  const response = await fetchWithTimeout(
    path,
    { credentials: "include", headers: { Accept: "application/json" } },
    options?.timeout ?? DEFAULT_API_TIMEOUT_MS,
    options?.signal,
  );
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new ApiRequestError(detail || `Request failed: ${response.status}`, response.status, path);
  }
  return response.json() as Promise<T>;
}

let cachedNodes: MonitorNode[] = [];
let cachedAt = 0;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

function acceptSnapshot(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const nodes = (payload as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  cachedNodes = nodes.filter(
    (node): node is MonitorNode =>
      Boolean(node) && typeof node === "object" && Number.isInteger((node as MonitorNode).id),
  );
  cachedAt = Date.now();
  return true;
}

function ensureLiveSocket() {
  if (typeof window === "undefined" || typeof WebSocket === "undefined" || socket) return;
  if (
    import.meta.env.DEV &&
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem(DEV_MOCK_SESSION_KEY) === "1"
  ) return;
  const connect = () => {
    reconnectTimer = null;
    if (socket) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      const next = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      socket = next;
      next.onmessage = (event) => {
        try {
          acceptSnapshot(JSON.parse(String(event.data)));
        } catch {
          // A broken frame is ignored; the next two-second snapshot can recover.
        }
      };
      next.onerror = () => next.close();
      next.onclose = () => {
        if (socket === next) socket = null;
        if (reconnectTimer == null) reconnectTimer = window.setTimeout(connect, 5_000);
      };
    } catch {
      if (reconnectTimer == null) reconnectTimer = window.setTimeout(connect, 5_000);
    }
  };
  connect();
}

async function loadMonitorNodes(options?: ApiCallOptions, allowFreshCache = true) {
  ensureLiveSocket();
  if (allowFreshCache && cachedNodes.length > 0 && Date.now() - cachedAt < 7_000) {
    return cachedNodes;
  }
  const payload = await requestJson<{ nodes?: MonitorNode[] }>("/api/nodes", options);
  acceptSnapshot(payload);
  return cachedNodes;
}

/** 旧版本保存在浏览器里的设置，只用于站长手动迁移到 hub。 */
export function readLegacyThemeSettings(): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const THEME_CONFIG_PATH = `/api/themes/${encodeURIComponent(THEME_SHORT)}/config`;

export async function loadThemeSettings(options?: ApiCallOptions): Promise<Record<string, unknown>> {
  const settings = await requestJson<unknown>(THEME_CONFIG_PATH, options);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("主题配置接口返回的内容不是 JSON 对象");
  }
  return settings as Record<string, unknown>;
}

export function monitorNodeToInfo(node: MonitorNode): NodeInfo {
  return {
    uuid: String(node.id),
    name: string(node.name),
    group: string(node.group),
    region: string(node.country).toUpperCase(),
    hidden: node.public === false,
    cpu_name: string(node.cpu_name),
    cpu_cores: number(node.cpu_cores),
    arch: string(node.arch),
    virtualization: string(node.virt),
    os: string(node.os),
    kernel_version: string(node.kernel),
    gpu_name: "",
    mem_total: number(node.mem_total),
    swap_total: number(node.swap_total),
    disk_total: number(node.disk_total),
    weight: number(node.sort),
    price: number(node.price),
    billing_cycle: string(node.billing_cycle),
    auto_renewal: false,
    currency: string(node.currency),
    expired_at: string(node.expires_at),
    tags: "",
    public_remark: string(node.remark),
    traffic_limit: number(node.traffic_limit),
    traffic_limit_type: string(node.traffic_mode) || "sum",
    ipv4: string(node.ipv4),
    ipv6: string(node.ipv6),
    created_at: "",
    updated_at: node.last_seen ? new Date(node.last_seen * 1_000).toISOString() : "",
  };
}

export function monitorNodeToRealtime(node: MonitorNode): Record<string, unknown> {
  const metrics = node.metrics;
  const monthUp = number(node.month_tx, number(metrics?.month_tx));
  const monthDown = number(node.month_rx, number(metrics?.month_rx));
  if (!node.online || !metrics) {
    return {
      online: false,
      network: { up: 0, down: 0, totalUp: monthUp, totalDown: monthDown },
      ram: { total: number(node.mem_total), used: 0 },
      swap: { total: number(node.swap_total), used: 0 },
      disk: { total: number(node.disk_total), used: 0 },
      updated_at: number(node.last_seen),
    };
  }
  const load = Array.isArray(metrics.load) ? metrics.load : [];
  return {
    online: true,
    cpu: { usage: number(metrics.cpu) },
    ram: { total: number(metrics.mem_total, number(node.mem_total)), used: number(metrics.mem_used) },
    swap: { total: number(metrics.swap_total, number(node.swap_total)), used: number(metrics.swap_used) },
    load: { load1: number(load[0]), load5: number(load[1]), load15: number(load[2]) },
    disk: { total: number(metrics.disk_total, number(node.disk_total)), used: number(metrics.disk_used) },
    network: {
      up: number(metrics.net_tx),
      down: number(metrics.net_rx),
      totalUp: monthUp,
      totalDown: monthDown,
    },
    connections: { tcp: number(metrics.tcp), udp: number(metrics.udp) },
    uptime: number(metrics.uptime),
    process: number(metrics.procs),
    updated_at: Date.now(),
  };
}

function parseNodeId(uuid: string) {
  const id = Number(uuid);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid monitor node id: ${uuid}`);
  return id;
}

async function requestHistory(
  uuid: string,
  hours: number,
  series: "metrics" | "ping",
  options?: ApiCallOptions,
): Promise<MonitorHistory> {
  const params = new URLSearchParams({
    hours: String(Math.max(1, Math.ceil(hours))),
    points: "720",
    series,
  });
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJson<MonitorHistory>(
        `/api/nodes/${parseNodeId(uuid)}/metrics?${params}`,
        options,
      );
    } catch (error) {
      // hub 只允许 4 个历史查询并发,超出的直接 503("too many history queries in flight")。
      // 首页同时要画多台机器,偶尔撞上别人的请求很正常,短暂退避后重试一次比整块图表
      // 显示"加载失败"更合适。
      const delay = HISTORY_RETRY_DELAYS_MS[attempt];
      if (delay == null || !isHistoryBusyError(error) || options?.signal?.aborted) throw error;
      await sleep(delay, options?.signal);
    }
  }
}

const HISTORY_RETRY_DELAYS_MS = [400, 1_200];

function isHistoryBusyError(error: unknown) {
  return error instanceof ApiRequestError && error.status === 503;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 同一节点、同一窗口、同一序列的请求合并成一次。
 *
 * 首页三网模式会按任务各查一次同一个节点,而 `/api/nodes/{id}/metrics` 的响应里本来就带着
 * 该节点全部分配任务的记录:不去重时 3 个任务就是 3 份完全相同的响应,既是三倍流量,也把
 * hub 的 4 个历史查询槽位撞满,表现为卡片时不时"加载失败"。
 */
const historyRequests = new Map<string, Promise<MonitorHistory>>();

function getHistory(
  uuid: string,
  hours: number,
  series: "metrics" | "ping",
  options?: ApiCallOptions,
): Promise<MonitorHistory> {
  const key = `${uuid}\u0000${Math.max(1, Math.ceil(hours))}\u0000${series}`;
  const pending = historyRequests.get(key);
  if (pending) return pending;

  const request = requestHistory(uuid, hours, series, options).finally(() => {
    if (historyRequests.get(key) === request) historyRequests.delete(key);
  });
  historyRequests.set(key, request);
  return request;
}

function range(hours: number) {
  const end = Date.now();
  return { rangeStartMs: end - Math.max(1, hours) * 3_600_000, rangeEndMs: end };
}

function inferIntervalSeconds(times: number[]) {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((time, index) => time - sorted[index]).filter((gap) => gap > 0);
  if (gaps.length === 0) return undefined;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function taskFromProbe(id: number, name: string, clients: string[]): PingTask {
  return {
    id,
    interval: 60,
    name: name || `探测 #${id}`,
    loss: 0,
    clients,
    type: "tcp",
    target: "",
    weight: id,
  };
}

export async function getMe(options?: ApiCallOptions): Promise<Me> {
  const me = await requestJson<MonitorMe>("/api/me", options);
  return { logged_in: me.authed === true, username: "", uuid: "" };
}

export async function getPublic(options?: ApiCallOptions): Promise<PublicConfig> {
  const [me, themeSettings] = await Promise.all([
    requestJson<MonitorMe>("/api/me", options),
    loadThemeSettings(options),
  ]);
  return {
    sitename: string(me.site_name) || "Monitor",
    description: "服务器运行状态",
    theme: THEME_SHORT,
    allow_cors: false,
    disable_password_login: false,
    oauth_enable: me.github === true,
    private_site: me.public_page === false,
    record_enabled: true,
    record_preserve_time: 0,
    ping_record_preserve_time: 0,
    metric_retention_days: 7,
    custom_head: "",
    custom_body: "",
    theme_settings: themeSettings,
  };
}

export async function getNodes(options?: ApiCallOptions): Promise<NodeInfo[]> {
  const nodes = await loadMonitorNodes(options, false);
  return nodes.map(monitorNodeToInfo);
}

export async function getNodesLatestStatus(
  uuids?: string[],
  options?: ApiCallOptions,
): Promise<Record<string, unknown>> {
  const nodes = await loadMonitorNodes(options, true);
  const selected = uuids?.length ? new Set(uuids) : null;
  return Object.fromEntries(
    nodes
      .filter((node) => !selected || selected.has(String(node.id)))
      .map((node) => [String(node.id), monitorNodeToRealtime(node)]),
  );
}

export async function getAdminClients(options?: ApiCallOptions): Promise<AdminClient[]> {
  const nodes = await getNodes(options);
  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name,
    group: node.group,
    region: node.region,
    weight: node.weight,
  }));
}

export async function getLoadRecords(
  uuid: string,
  hours = 6,
  options?: LoadRecordsOptions,
): Promise<LoadRecordsResponse> {
  const payload = await getHistory(uuid, hours, "metrics", options);
  const records: LoadRecord[] = (payload.metrics ?? []).map((point) => ({
    cpu: number(point.cpu),
    gpu: 0,
    ram: number(point.mem_used),
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: number(point.disk_used),
    disk_total: 0,
    net_in: number(point.net_rx),
    net_out: number(point.net_tx),
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time: point.ts,
    client: uuid,
    history_capabilities: {
      swap: false,
      trafficTotals: false,
      connections: false,
      process: false,
      load: false,
    },
  }));
  return {
    count: records.length,
    records,
    ...range(hours),
    intervalSeconds: inferIntervalSeconds((payload.metrics ?? []).map((point) => point.ts)),
  };
}

export interface TodayTrafficMetricResponse {
  series: TrafficMetricSeries[];
  rangeStartMs: number;
  rangeEndMs: number;
  intervalSeconds?: number;
}

async function mapBatches<T, R>(items: T[], size: number, mapper: (item: T) => Promise<R>) {
  const output: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(...(await Promise.allSettled(items.slice(index, index + size).map(mapper))));
  }
  return output;
}

export async function getTodayTrafficMetrics(
  entityIds: string[],
  startMs: number,
  endMs: number,
  options?: ApiCallOptions,
): Promise<TodayTrafficMetricResponse> {
  if (entityIds.length === 0) return { series: [], rangeStartMs: startMs, rangeEndMs: endMs };
  const nodes = await loadMonitorNodes(options, true);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const hours = Math.max(1, Math.ceil((endMs - startMs) / 3_600_000));
  const histories = await mapBatches(entityIds, 4, (uuid) => getHistory(uuid, hours, "metrics", options));
  const series: TrafficMetricSeries[] = [];
  let intervalSeconds = 0;

  entityIds.forEach((uuid, index) => {
    const node = byId.get(uuid);
    const result = histories[index];
    const points = result?.status === "fulfilled" ? result.value.metrics ?? [] : [];
    const inRange = points.filter((point) => point.ts * 1_000 >= startMs && point.ts * 1_000 <= endMs);
    const nodeInterval = inferIntervalSeconds(inRange.map((point) => point.ts)) ?? 0;
    intervalSeconds = Math.max(intervalSeconds, nodeInterval);
    const point = (value: number) => [{ time: new Date(endMs).toISOString(), value, count: 1 }];
    series.push(
      { metricKey: "traffic.up", client: uuid, points: point(number(node?.day_tx)) },
      { metricKey: "traffic.down", client: uuid, points: point(number(node?.day_rx)) },
      {
        metricKey: "net.out.rate",
        client: uuid,
        intervalSeconds: nodeInterval || undefined,
        points: inRange.map((item) => ({
          time: new Date(item.ts * 1_000).toISOString(),
          value: number(item.net_tx),
          count: 1,
        })),
      },
      {
        metricKey: "net.in.rate",
        client: uuid,
        intervalSeconds: nodeInterval || undefined,
        points: inRange.map((item) => ({
          time: new Date(item.ts * 1_000).toISOString(),
          value: number(item.net_rx),
          count: 1,
        })),
      },
    );
  });

  return {
    series,
    rangeStartMs: startMs,
    rangeEndMs: endMs,
    intervalSeconds: intervalSeconds || undefined,
  };
}

export function normalizePingHistory(uuid: string, hours: number, payload: MonitorHistory): PingRecordsResponse {
  const records: PingRecord[] = (payload.ping ?? []).map((point) => ({
    task_id: point.task_id,
    time: point.ts,
    value: point.latency == null ? -1 : point.latency,
    client: uuid,
    count: 1,
    loss: point.loss ?? (point.latency == null ? 100 : 0),
  }));
  // monitor 只把有丢包的探测放进 loss 里,缺席即 0%;逐桶 loss 是桶内百分比,分母已经丢了,
  // 平均它们会得到错误的窗口丢包率(见 monitor-theme-default 的接口说明)。
  const windowLoss: Record<number, number> = {};
  for (const [rawTaskId, value] of Object.entries(payload.loss ?? {})) {
    const parsedTaskId = Number(rawTaskId);
    if (
      Number.isSafeInteger(parsedTaskId) &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      windowLoss[parsedTaskId] = Math.min(100, Math.max(0, value));
    }
  }
  const ids = new Set(records.map((record) => record.task_id));
  const interval = inferIntervalSeconds((payload.ping ?? []).map((point) => point.ts));
  const tasks = [...ids]
    .sort((left, right) => left - right)
    .map((id) => ({
      ...taskFromProbe(id, payload.probes?.[String(id)] ?? "", [uuid]),
      interval: interval ?? 60,
      loss: windowLoss[id] ?? 0,
    }));
  return {
    count: records.length,
    records,
    tasks,
    windowLoss,
    ...range(hours),
    intervalSeconds: interval,
  };
}

export async function getPingRecords(
  uuid: string,
  hours = 6,
  options?: ApiCallOptions,
): Promise<PingRecordsResponse> {
  return normalizePingHistory(uuid, hours, await getHistory(uuid, hours, "ping", options));
}

export async function getAdminPingTasks(options?: ApiCallOptions): Promise<PingTask[]> {
  const payload = await requestJson<{
    tasks?: Array<{ id: number; name?: string; target?: string; interval?: number; nodes?: number[] }>;
  }>("/api/ping-tasks", options);
  return (payload.tasks ?? []).map((task) => ({
    id: task.id,
    interval: number(task.interval, 60),
    name: string(task.name) || `探测 #${task.id}`,
    loss: 0,
    clients: (task.nodes ?? []).map(String),
    type: "tcp",
    target: string(task.target),
    weight: task.id,
  }));
}

export async function saveThemeSettings(
  theme: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const path = `/api/themes/${encodeURIComponent(theme)}/config`;
  const response = await fetchWithTimeout(path, {
    method: "PUT",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }, DEFAULT_API_TIMEOUT_MS);
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new ApiRequestError(detail || `Request failed: ${response.status}`, response.status, path);
  }
}

/** 迁移成功后清理旧版浏览器配置。 */
export function clearLegacyThemeSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // 存储不可用时本来就没有本机设置可清。
  }
}

export function prewarmPingOverviewDependencies() {
  ensureLiveSocket();
}

export async function getPingOverviewStats(
  hours: number,
  taskIds: number[],
  options?: ApiCallOptions & { entityIds?: string[] },
): Promise<PingTaskStats[]> {
  void hours;
  void taskIds;
  void options;
  return [];
}

export async function getPingOverview(
  hours = 1,
  taskId?: number,
  options?: { signal?: AbortSignal; entityIds?: string[]; includeStats?: boolean },
): Promise<PingOverviewResponse> {
  const entityIds = options?.entityIds?.length
    ? options.entityIds
    : (await loadMonitorNodes({ signal: options?.signal }, true)).map((node) => String(node.id));
  const responses = await mapBatches(entityIds, 4, (uuid) =>
    getPingRecords(uuid, hours, { signal: options?.signal }),
  );
  const records: PingRecord[] = [];
  const tasks = new Map<number, PingTask>();
  const clientWindowLoss: Record<string, Record<number, number>> = {};
  responses.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    for (const record of result.value.records) {
      if (taskId == null || record.task_id === taskId) records.push(record);
    }
    const windowLoss = result.value.windowLoss;
    if (windowLoss && Object.keys(windowLoss).length > 0) {
      // mapBatches 按 entityIds 顺序返回,所以下标就是节点 uuid。
      const client = entityIds[index];
      if (client) clientWindowLoss[client] = { ...windowLoss };
    }
    for (const task of result.value.tasks) {
      if (taskId != null && task.id !== taskId) continue;
      const previous = tasks.get(task.id);
      tasks.set(task.id, {
        ...task,
        clients: [...new Set([...(previous?.clients ?? []), ...task.clients])],
      });
    }
  });
  return {
    records,
    tasks: [...tasks.values()],
    taskAssignmentsKnown: true,
    clientWindowLoss,
    ...range(hours),
  };
}

// Kept for the public type used by the homepage store.
export type { PingOverviewItem };
