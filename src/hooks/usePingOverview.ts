import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMinuteClock } from "@/hooks/useClock";
import { useVisibleNodeUuids } from "@/hooks/useNode";
import { useHiddenNodeUuids } from "@/hooks/useVisibleNodes";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  getPingOverview,
  prewarmPingOverviewDependencies,
} from "@/services/api";
import type {
  HomepagePingLine,
  PingOverviewBucket,
  PingOverviewItem,
  PingOverviewTaskLoadState,
  PingRecord,
  PingTaskStats,
} from "@/types/models";
import { withTimeoutSignal } from "@/utils/abort";
import { resolvePingSampleCounts } from "@/utils/pingMetrics";
import {
  invertHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

const DEFAULT_PING_REFRESH_INTERVAL = 60_000;
const MIN_PING_REFRESH_INTERVAL = 10_000;
const MAX_PING_REFRESH_INTERVAL = 300_000;
// 首页延迟图表最多显示 24 个 bucket。metric API 返回的是聚合区间而不是瞬时点，
// 绘制时要把较粗的后端区间投影到它覆盖的可视 bucket，同时保持卡片密度一致。
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: false,
  loadState: "pending",
  lastValue: null,
  samples: [],
  max: 1,
  loss: null,
};
const EMPTY_PING_LINES: HomepagePingLine[] = [];
const EMPTY_PING_BUCKETS: PingOverviewBucket[] = [];

export interface PingOverviewMapResult {
  assignmentKey: string;
  intervalMs: number;
  singleItems: Map<string, PingOverviewItem>;
  multiLines: Map<string, HomepagePingLine[]>;
  successfulRequest: boolean;
  failedUuids: string[];
}

export type PingOverviewLoadState = "idle" | "loading" | "ready" | "error";

export interface PingOverviewStatusSnapshot {
  status: PingOverviewLoadState;
  isRefreshing: boolean;
}

const EMPTY_PING_STATUS: PingOverviewStatusSnapshot = {
  status: "idle",
  isRefreshing: false,
};

type Listener = () => void;

function toTimestamp(value: string | number) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRefreshInterval(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    return DEFAULT_PING_REFRESH_INTERVAL;
  }

  return Math.min(
    MAX_PING_REFRESH_INTERVAL,
    Math.max(MIN_PING_REFRESH_INTERVAL, seconds * 1000),
  );
}

function normalizeVisibleUuids(uuids: string[]) {
  return Array.from(new Set(uuids.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function equalSamples(
  a: PingOverviewItem["samples"],
  b: PingOverviewItem["samples"],
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]?.time !== b[i]?.time ||
      a[i]?.value !== b[i]?.value ||
      a[i]?.count !== b[i]?.count ||
      a[i]?.loss !== b[i]?.loss
    ) {
      return false;
    }
  }
  return true;
}

function equalPingItem(a: PingOverviewItem | undefined, b: PingOverviewItem | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.client === b.client &&
    a.isAssigned === b.isAssigned &&
    a.loadState === b.loadState &&
    a.lastValue === b.lastValue &&
    a.metricIntervalMs === b.metricIntervalMs &&
    a.max === b.max &&
    a.loss === b.loss &&
    equalSamples(a.samples, b.samples)
  );
}

function equalPingLine(a: HomepagePingLine | undefined, b: HomepagePingLine | undefined) {
  return (
    a?.taskId === b?.taskId &&
    a?.taskName === b?.taskName &&
    equalPingItem(a, b)
  );
}

export function buildPingOverviewItems(
  taskId: number,
  records: PingRecord[],
  metricStats: PingTaskStats[] = [],
  metricIntervalSeconds?: number,
  windowLossByClient?: Map<string, number>,
) {
  const metricIntervalMs =
    typeof metricIntervalSeconds === "number" &&
    Number.isFinite(metricIntervalSeconds) &&
    metricIntervalSeconds > 0
      ? metricIntervalSeconds * 1000
      : undefined;
  const selectedRecords = records.filter((record) => record.task_id === taskId);
  const grouped = new Map<string, Array<(typeof selectedRecords)[number]>>();
  const lossStatsByClient = new Map<string, { total: number; lost: number }>();

  for (const record of selectedRecords) {
    if (!record.client) continue;
    const current = grouped.get(record.client);
    if (current) current.push(record);
    else grouped.set(record.client, [record]);

    const stats = lossStatsByClient.get(record.client) ?? { total: 0, lost: 0 };
    const counts = resolvePingSampleCounts(record);
    stats.total += counts.total;
    stats.lost += counts.lost;
    lossStatsByClient.set(record.client, stats);
  }

  const result = new Map<string, PingOverviewItem>();
  const statsByClient = new Map(
    metricStats
      .filter((stat) => stat.taskId === taskId)
      .map((stat) => [stat.client, stat] as const),
  );
  const clients = new Set([...grouped.keys(), ...statsByClient.keys()]);

  for (const client of clients) {
    const clientRecords = grouped.get(client) ?? [];
    const sorted = [...clientRecords].sort(
      (left, right) => toTimestamp(left.time) - toTimestamp(right.time),
    );
    const latestRecord = sorted[sorted.length - 1];
    const samples: PingOverviewItem["samples"] = [];
    let max = 1;

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      const value = record.value;
      const time = toTimestamp(record.time);
      if (time > 0) {
        samples.push({
          time,
          value,
          count: "count" in record && typeof record.count === "number" ? record.count : undefined,
          loss: "loss" in record && typeof record.loss === "number" ? record.loss : undefined,
        });
      }
      if (value > max) {
        max = value;
      }
    }

    const lossStats = lossStatsByClient.get(client);
    const serverStats = statsByClient.get(client);
    // monitor 只给窗口丢包率(逐桶百分比的分母已经丢了,不能自己平均),所以它优先于本地
    // 由逐桶 loss 推出来的值;zero-loss 的探测不在 map 里,回落到本地计算得到的 0。
    const windowLoss = windowLossByClient?.get(client);
    result.set(client, {
      client,
      isAssigned: true,
      lastValue:
        serverStats?.latest ??
        (latestRecord && latestRecord.value >= 0 ? latestRecord.value : null),
      metricIntervalMs,
      samples,
      max: serverStats?.max ?? max,
      loss:
        serverStats?.loss ??
        windowLoss ??
        (lossStats?.total ? (lossStats.lost / lossStats.total) * 100 : null),
    });
  }

  return result;
}

function buildAssignmentKey(selectedTaskIdsByClient: Map<string, number[]>) {
  return Array.from(selectedTaskIdsByClient.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([uuid, taskIds]) => `${uuid}:${taskIds.join(",")}`)
    .join("|");
}

function resolvePingAssignmentKey(clientUuids: string[], bindings: HomepagePingTaskBindings) {
  const normalizedUuids = normalizeVisibleUuids(clientUuids);
  if (normalizedUuids.length === 0) return "";
  const preferred = invertHomepagePingTaskBindings(bindings);
  const singlePreferences = new Map(
    normalizedUuids.flatMap((uuid) => {
      const taskId = preferred.get(uuid);
      return taskId == null ? [] : [[uuid, [taskId]] as [string, number[]]];
    }),
  );
  return `backend:${normalizedUuids.join("|")}|preferred:${buildAssignmentKey(singlePreferences)}`;
}

// 限制首页多节点历史请求的整条调用链，避免一次刷新长期占住轮询。
const PING_REQUEST_TIMEOUT_MS = 35_000;
const PING_CACHE_STORAGE_KEY = "monitor:luminaplus:homepage-ping:v1";
const PING_CACHE_TTL_MS = 5 * 60_000;

interface PingOverviewCachePayload {
  version: 1;
  savedAt: number;
  assignmentKey: string;
  intervalMs: number;
  singleItems: Array<[string, PingOverviewItem]>;
  multiLines: Array<[string, HomepagePingLine[]]>;
}

export interface PersistablePingOverviewData {
  singleItems: Array<[string, PingOverviewItem]>;
  multiLines: Array<[string, HomepagePingLine[]]>;
}

interface PreviousPingOverview {
  assignmentKey: string;
  singleItems: ReadonlyMap<string, PingOverviewItem>;
  multiLines: ReadonlyMap<string, HomepagePingLine[]>;
}

function assignedEmptyPing(
  client: string,
  loadState: PingOverviewTaskLoadState = "pending",
): PingOverviewItem {
  return {
    client,
    isAssigned: true,
    loadState,
    lastValue: null,
    samples: [],
    max: 1,
    loss: null,
  };
}

/** 与详情页读取同一份节点 Ping 历史，并以 probes 的后台分配关系生成首页线路。 */
export async function buildBackendPingOverviewMap(
  hours: number,
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  signal?: AbortSignal,
  loadOverview: typeof getPingOverview = getPingOverview,
  previous?: PreviousPingOverview,
): Promise<PingOverviewMapResult> {
  const uuids = normalizeVisibleUuids(clientUuids);
  const preferredSingleTaskByClient = invertHomepagePingTaskBindings(bindings);
  const assignmentKey = resolvePingAssignmentKey(uuids, bindings);
  if (uuids.length === 0) {
    return {
      assignmentKey,
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      singleItems: new Map(),
      multiLines: new Map(),
      successfulRequest: true,
      failedUuids: [],
    };
  }

  const overview = await withTimeoutSignal(
    (requestSignal) => loadOverview(hours, undefined, {
      signal: requestSignal,
      entityIds: uuids,
    }),
    PING_REQUEST_TIMEOUT_MS,
    signal,
  );
  const itemsByTask = new Map<number, Map<string, PingOverviewItem>>();
  for (const task of overview.tasks) {
    const windowLoss = new Map<string, number>();
    for (const uuid of uuids) {
      const loss = overview.clientWindowLoss?.[uuid]?.[task.id];
      if (typeof loss === "number" && Number.isFinite(loss)) windowLoss.set(uuid, loss);
    }
    itemsByTask.set(
      task.id,
      buildPingOverviewItems(task.id, overview.records, overview.stats, overview.intervalSeconds, windowLoss),
    );
  }

  const singleItems = new Map<string, PingOverviewItem>();
  const multiLines = new Map<string, HomepagePingLine[]>();
  const failedUuids = overview.failedEntityIds?.filter((uuid) => uuids.includes(uuid)) ?? [];
  const failedSet = new Set(failedUuids);
  const hasPrevious = previous?.assignmentKey === assignmentKey;
  for (const uuid of uuids) {
    if (failedSet.has(uuid)) {
      const priorItem = hasPrevious ? previous?.singleItems.get(uuid) : undefined;
      singleItems.set(uuid, priorItem
        ? { ...priorItem, loadState: "error" }
        : { client: uuid, isAssigned: false, loadState: "error", lastValue: null, samples: [], max: 1, loss: null });
      const priorLines = hasPrevious ? previous?.multiLines.get(uuid) : undefined;
      multiLines.set(uuid, priorLines?.map((line) => ({ ...line, loadState: "error" })) ?? []);
      continue;
    }
    const assignedTasks = overview.tasks
      .filter((task) => task.clients.includes(uuid))
      .sort((left, right) => left.id - right.id);
    const lines = assignedTasks.map((task) => ({
      taskId: task.id,
      taskName: task.name || `任务 #${task.id}`,
      ...(itemsByTask.get(task.id)?.get(uuid) ?? assignedEmptyPing(uuid, "ready")),
      loadState: "ready" as const,
    }));
    multiLines.set(uuid, lines);
    const preferredTaskId = preferredSingleTaskByClient.get(uuid);
    const singleLine = lines.find((line) => line.taskId === preferredTaskId) ?? lines[0];
    singleItems.set(uuid, singleLine ?? {
      client: uuid,
      isAssigned: false,
      loadState: "ready",
      lastValue: null,
      samples: [],
      max: 1,
      loss: null,
    });
  }

  const intervals = overview.tasks.map((task) => task.interval).filter((value) => value > 0);
  const intervalSeconds = overview.intervalSeconds ?? (intervals.length > 0 ? Math.min(...intervals) : undefined);
  return {
    assignmentKey,
    intervalMs: normalizeRefreshInterval(intervalSeconds),
    singleItems,
    multiLines,
    successfulRequest: uuids.length > failedSet.size,
    failedUuids,
  };
}

interface PingOverviewStoreState {
  assignmentKey: string;
  intervalMs: number;
  singleItems: Map<string, PingOverviewItem>;
  multiLines: Map<string, HomepagePingLine[]>;
}

let pingOverviewState: PingOverviewStoreState = {
  assignmentKey: "",
  intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
  singleItems: new Map(),
  multiLines: new Map(),
};
let pingOverviewStatus: PingOverviewStatusSnapshot = EMPTY_PING_STATUS;
let scheduledVisibleUuids: string[] = [];
let scheduledVisibleKey = "";
let scheduledBindings: HomepagePingTaskBindings = {};
let scheduledSelectionKey = "";
let pingRefreshInFlight = false;
let pingRefreshTimer: number | null = null;
let pingAbortController: AbortController | null = null;
let activeConsumers = 0;
// HMR dispose 后置真:阻止 in-flight 请求的 finally 恢复逻辑在旧模块实例上复活轮询。
let pingPollingDisposed = false;
const pingListeners = new Map<string, Set<Listener>>();

function setPingOverviewStatus(
  status: PingOverviewLoadState,
  isRefreshing: boolean,
) {
  if (
    pingOverviewStatus.status === status &&
    pingOverviewStatus.isRefreshing === isRefreshing
  ) {
    return;
  }
  pingOverviewStatus = { status, isRefreshing };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCachedPingItem(value: unknown): PingOverviewItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.client !== "string" || value.client.length === 0) return null;
  if (typeof value.isAssigned !== "boolean") return null;
  if (!Array.isArray(value.samples)) return null;
  const samples = value.samples.map((sample) => {
    if (!isRecord(sample)) return null;
    if (
      typeof sample.time !== "number" ||
      !Number.isFinite(sample.time) ||
      typeof sample.value !== "number" ||
      !Number.isFinite(sample.value)
    ) {
      return null;
    }
    return {
      time: sample.time,
      value: sample.value,
      ...(typeof sample.count === "number" && Number.isFinite(sample.count)
        ? { count: sample.count }
        : {}),
      ...(typeof sample.loss === "number" && Number.isFinite(sample.loss)
        ? { loss: sample.loss }
        : {}),
    };
  });
  if (samples.some((sample) => sample == null)) return null;

  const lastValue =
    value.lastValue == null
      ? null
      : typeof value.lastValue === "number" && Number.isFinite(value.lastValue)
        ? value.lastValue
        : undefined;
  const loss =
    value.loss == null
      ? null
      : typeof value.loss === "number" && Number.isFinite(value.loss)
        ? value.loss
        : undefined;
  if (lastValue === undefined || loss === undefined) return null;

  return {
    client: value.client,
    isAssigned: value.isAssigned,
    loadState: "ready",
    lastValue,
    ...(typeof value.metricIntervalMs === "number" &&
    Number.isFinite(value.metricIntervalMs) &&
    value.metricIntervalMs > 0
      ? { metricIntervalMs: value.metricIntervalMs }
      : {}),
    samples: samples as PingOverviewItem["samples"],
    max:
      typeof value.max === "number" && Number.isFinite(value.max) && value.max >= 0
        ? value.max
        : 1,
    loss,
  };
}

function readPingOverviewCache(
  assignmentKey: string,
): Omit<PingOverviewCachePayload, "version" | "savedAt" | "assignmentKey"> | null {
  if (!assignmentKey || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PING_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (
      parsed.version !== 1 ||
      parsed.assignmentKey !== assignmentKey ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > PING_CACHE_TTL_MS ||
      !Array.isArray(parsed.singleItems) ||
      !Array.isArray(parsed.multiLines)
    ) {
      return null;
    }

    const singleItems: Array<[string, PingOverviewItem]> = [];
    for (const entry of parsed.singleItems) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        return null;
      }
      const item = parseCachedPingItem(entry[1]);
      if (!item || item.client !== entry[0]) return null;
      singleItems.push([entry[0], item]);
    }

    const multiLines: Array<[string, HomepagePingLine[]]> = [];
    for (const entry of parsed.multiLines) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        return null;
      }
      if (!Array.isArray(entry[1])) return null;
      const lines: HomepagePingLine[] = [];
      for (const line of entry[1]) {
        if (
          !isRecord(line) ||
          typeof line.taskId !== "number" ||
          !Number.isSafeInteger(line.taskId) ||
          line.taskId <= 0
        ) {
          return null;
        }
        if (typeof line.taskName !== "string") return null;
        const item = parseCachedPingItem(line);
        if (!item || item.client !== entry[0]) return null;
        lines.push({ taskId: line.taskId, taskName: line.taskName, ...item });
      }
      multiLines.push([entry[0], lines]);
    }

    return {
      intervalMs:
        typeof parsed.intervalMs === "number" &&
        Number.isFinite(parsed.intervalMs) &&
        parsed.intervalMs > 0
          ? parsed.intervalMs
          : DEFAULT_PING_REFRESH_INTERVAL,
      singleItems,
      multiLines,
    };
  } catch {
    return null;
  }
}

export function selectPersistablePingOverview(
  result: PingOverviewMapResult,
): PersistablePingOverviewData | null {
  // 任一节点失败时不刷新整份缓存的时间戳；否则旧值会被当成新鲜数据。
  if (!result.assignmentKey || !result.successfulRequest || result.failedUuids.length > 0) {
    return null;
  }

  const singleItems = Array.from(result.singleItems.entries()).filter(
    ([, item]) => item.loadState === "ready",
  );
  const multiLines = Array.from(result.multiLines.entries())
    .map(([uuid, lines]) => [
      uuid,
      lines.filter((line) => line.loadState === "ready"),
    ] as [string, HomepagePingLine[]])
    .filter(([, lines]) => lines.length > 0);

  return { singleItems, multiLines };
}

function persistPingOverviewCache(result: PingOverviewMapResult) {
  if (!result.assignmentKey || typeof window === "undefined") return;
  try {
    const persistable = selectPersistablePingOverview(result);
    if (!persistable) return;
    const payload: PingOverviewCachePayload = {
      version: 1,
      savedAt: Date.now(),
      assignmentKey: result.assignmentKey,
      intervalMs: result.intervalMs,
      ...persistable,
    };
    window.sessionStorage.setItem(PING_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 隐私模式或存储配额不足时继续使用内存数据。
  }
}

function schedulePingRefresh(intervalMs: number) {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 没有组件消费 overview 时就停止轮询。等有消费者再次挂载时，
  // 由 ensurePingOverviewStarted 重新启动整条链路。
  if (pingPollingDisposed || activeConsumers <= 0) return;
  pingRefreshTimer = window.setTimeout(() => {
    pingRefreshTimer = null;
    void refreshPingOverview();
  }, intervalMs);
}

function stopPingPolling() {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 中止进行中的 refresh（如果有），让它的请求和带宽在 teardown 时立刻释放；
  // refreshPingOverview 会把已 abort 的 signal 当成非当前，跳过 commit/重新调度。
  if (pingAbortController) {
    pingAbortController.abort();
    pingAbortController = null;
  }
}

function commitPingOverview(
  assignmentKey: string,
  intervalMs: number,
  singleItems: Map<string, PingOverviewItem>,
  multiLines: Map<string, HomepagePingLine[]>,
  options: {
    status?: PingOverviewLoadState;
    isRefreshing?: boolean;
  } = {},
) {
  const touched = new Set<string>();
  const prevSingleItems = pingOverviewState.singleItems;
  const prevMultiLines = pingOverviewState.multiLines;
  const keysToCompare = new Set<string>([
    ...prevSingleItems.keys(),
    ...singleItems.keys(),
    ...prevMultiLines.keys(),
    ...multiLines.keys(),
  ]);
  let nextSingleItems = prevSingleItems;
  let nextMultiLines = prevMultiLines;
  let singleCloned = false;
  let multiCloned = false;

  for (const key of keysToCompare) {
    const prev = prevSingleItems.get(key);
    const next = singleItems.get(key);
    if (!next) {
      if (prev) {
        if (!singleCloned) {
          nextSingleItems = new Map(prevSingleItems);
          singleCloned = true;
        }
        nextSingleItems.delete(key);
        touched.add(key);
      }
    } else if (!equalPingItem(prev, next)) {
      if (!singleCloned) {
        nextSingleItems = new Map(prevSingleItems);
        singleCloned = true;
      }
      nextSingleItems.set(key, next);
      touched.add(key);
    }

    const prevLines = prevMultiLines.get(key);
    const nextLines = multiLines.get(key);
    if (!nextLines) {
      if (prevLines) {
        if (!multiCloned) {
          nextMultiLines = new Map(prevMultiLines);
          multiCloned = true;
        }
        nextMultiLines.delete(key);
        touched.add(key);
      }
      continue;
    }
    const stable = nextLines.map((line, index) =>
      equalPingLine(prevLines?.[index], line) ? (prevLines?.[index] ?? line) : line,
    );
    const unchanged =
      prevLines?.length === stable.length &&
      stable.every((line, index) => line === prevLines[index]);
    if (!unchanged || !prevLines) {
      if (!multiCloned) {
        nextMultiLines = new Map(prevMultiLines);
        multiCloned = true;
      }
      nextMultiLines.set(key, stable);
      touched.add(key);
    }
  }

  const nextStatus =
    options.status ?? (options.isRefreshing ? "loading" : "ready");
  const nextIsRefreshing = options.isRefreshing ?? false;
  const dataUnchanged =
    pingOverviewState.assignmentKey === assignmentKey &&
    pingOverviewState.intervalMs === intervalMs &&
    touched.size === 0 &&
    nextSingleItems.size === prevSingleItems.size &&
    nextMultiLines.size === prevMultiLines.size;
  const statusUnchanged =
    pingOverviewStatus.status === nextStatus &&
    pingOverviewStatus.isRefreshing === nextIsRefreshing;

  if (dataUnchanged && statusUnchanged) {
    return;
  }

  if (!dataUnchanged) {
    pingOverviewState = {
      assignmentKey,
      intervalMs,
      singleItems: nextSingleItems,
      multiLines: nextMultiLines,
    };
  }

  setPingOverviewStatus(nextStatus, nextIsRefreshing);

  for (const key of touched) {
    const listeners = pingListeners.get(key);
    if (!listeners) continue;
    for (const listener of listeners) listener();
  }
}

async function refreshPingOverview() {
  if (pingPollingDisposed || pingRefreshInFlight) return;

  pingRefreshInFlight = true;
  const hasCachedOverview =
    pingOverviewStatus.status === "ready" &&
    (pingOverviewState.singleItems.size > 0 || pingOverviewState.multiLines.size > 0);
  setPingOverviewStatus(hasCachedOverview ? "ready" : "loading", true);
  const visibleKey = scheduledVisibleKey;
  const selectionKey = scheduledSelectionKey;
  const controller = new AbortController();
  pingAbortController = controller;
  const { signal } = controller;
  // 判断当前请求是否仍然有效（没被 stopPingPolling 中止，
  // 且 visible/binding 分配在执行期间没有被改掉）。
  const isCurrent = () =>
    !signal.aborted &&
    visibleKey === scheduledVisibleKey &&
    selectionKey === scheduledSelectionKey;

  try {
    if (scheduledVisibleUuids.length === 0) {
      commitPingOverview(
        "",
        DEFAULT_PING_REFRESH_INTERVAL,
        new Map(),
        new Map(),
      );
      return;
    }

    const next = await buildBackendPingOverviewMap(
      1,
      scheduledVisibleUuids,
      scheduledBindings,
      signal,
      getPingOverview,
      pingOverviewState,
    );
    if (isCurrent()) {
      const nextStatus: PingOverviewLoadState = next.successfulRequest ? "ready" : "error";
      commitPingOverview(
        next.assignmentKey,
        next.intervalMs,
        next.singleItems,
        next.multiLines,
        {
          status: nextStatus,
          isRefreshing: false,
        },
      );
      persistPingOverviewCache(next);
      schedulePingRefresh(
        next.successfulRequest
          ? next.intervalMs
          : DEFAULT_PING_REFRESH_INTERVAL,
      );
    }
  } catch {
    if (isCurrent()) {
      setPingOverviewStatus(
        hasCachedOverview ? "ready" : "error",
        false,
      );
      schedulePingRefresh(DEFAULT_PING_REFRESH_INTERVAL);
    }
  } finally {
    pingRefreshInFlight = false;
    if (pingAbortController === controller) pingAbortController = null;
    // 只要消费者还想轮询但队列里没有任务，就恢复轮询。这覆盖了执行中途 assignment
    // 变化（上面那次跑会跳过 commit）以及 abort/重新挂载竞态（如 StrictMode:
    // mount→stop(abort)→mount），后者里被 abort 的那次不能负责重新调度。成功或失败
    // 的一次已经设过 timer，所以稳态下这里是 no-op。
    if (
      activeConsumers > 0 &&
      scheduledVisibleUuids.length > 0 &&
      pingRefreshTimer == null
    ) {
      void refreshPingOverview();
    }
  }
}

function ensurePingOverviewStarted(
  visibleUuids: string[],
  bindings: HomepagePingTaskBindings,
) {
  const normalizedVisibleUuids = normalizeVisibleUuids(visibleUuids);
  const visibleKey = normalizedVisibleUuids.join("|");
  const selectionKey = resolvePingAssignmentKey(normalizedVisibleUuids, bindings);

  if (
    scheduledVisibleKey !== visibleKey ||
    scheduledSelectionKey !== selectionKey
  ) {
    scheduledVisibleUuids = normalizedVisibleUuids;
    scheduledVisibleKey = visibleKey;
    scheduledBindings = bindings;
    scheduledSelectionKey = selectionKey;

    pingAbortController?.abort();

    if (pingRefreshTimer != null) {
      window.clearTimeout(pingRefreshTimer);
      pingRefreshTimer = null;
    }
    const assignmentKey = selectionKey;
    const cached = readPingOverviewCache(assignmentKey);
    commitPingOverview(
      assignmentKey,
      cached?.intervalMs ?? DEFAULT_PING_REFRESH_INTERVAL,
      cached ? new Map(cached.singleItems) : new Map(),
      cached ? new Map(cached.multiLines) : new Map(),
      {
        status: cached ? "ready" : "loading",
        isRefreshing: true,
      },
    );
    void refreshPingOverview();
    return;
  }

  // 只要没有待处理请求、也没有已调度的 tick 就重启——这同时覆盖首次挂载
  // 和轮询被停止后的恢复。
  if (
    normalizedVisibleUuids.length > 0 &&
    !pingRefreshInFlight &&
    pingRefreshTimer == null
  ) {
    void refreshPingOverview();
  }
}

function subscribeToPingItem(uuid: string, listener: Listener) {
  let listeners = pingListeners.get(uuid);
  if (!listeners) {
    listeners = new Set();
    pingListeners.set(uuid, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      pingListeners.delete(uuid);
    }
  };
}

function getPingSnapshot(uuid: string) {
  return pingOverviewState.singleItems.get(uuid) ?? EMPTY_PING;
}

function getPingLinesSnapshot(uuid: string) {
  return pingOverviewState.multiLines.get(uuid) ?? EMPTY_PING_LINES;
}

export function useHomepagePingOverview() {
  const { data: me } = useAuth();
  const visibleUuids = useVisibleNodeUuids(me?.logged_in === true);
  const themeSettings = useThemeSettings();

  // 主题级隐藏节点首页已不渲染,这里也从 overview 拉取里剔除——否则仍会为其绑定的
  // ping 任务发请求、做聚合,纯属无效网络/计算开销。
  const hiddenUuids = useHiddenNodeUuids();
  const effectiveUuids = useMemo(
    () =>
      hiddenUuids.size > 0
        ? visibleUuids.filter((uuid) => !hiddenUuids.has(uuid))
        : visibleUuids,
    [visibleUuids, hiddenUuids],
  );
  const requestedBindings = themeSettings.homepagePingBindings;
  const hasRequestedVisiblePing = effectiveUuids.length > 0;

  useLayoutEffect(() => {
    if (!themeSettings.isReady) return;
    // 空首页或全部节点被隐藏时不应触发 capability probe / 公开任务列表请求。
    if (hasRequestedVisiblePing) {
      prewarmPingOverviewDependencies();
    }
    activeConsumers += 1;
    ensurePingOverviewStarted(
      effectiveUuids,
      requestedBindings,
    );
    return () => {
      activeConsumers -= 1;
      if (activeConsumers <= 0) {
        activeConsumers = 0;
        stopPingPolling();
      }
    };
  }, [
    effectiveUuids,
    requestedBindings,
    hasRequestedVisiblePing,
    themeSettings.isReady,
  ]);
}

export function useNodePingOverview(
  uuid: string,
  enabled = true,
): PingOverviewItem {
  const subscribe = useCallback(
    (cb: Listener) =>
      uuid && enabled ? subscribeToPingItem(uuid, cb) : () => undefined,
    [enabled, uuid],
  );
  const getSnapshot = useCallback(
    () => (uuid && enabled ? getPingSnapshot(uuid) : EMPTY_PING),
    [enabled, uuid],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNodePingOverviewLines(
  uuid: string,
  enabled = true,
): HomepagePingLine[] {
  const subscribe = useCallback(
    (cb: Listener) =>
      uuid && enabled ? subscribeToPingItem(uuid, cb) : () => undefined,
    [enabled, uuid],
  );
  const getSnapshot = useCallback(
    () => (uuid && enabled ? getPingLinesSnapshot(uuid) : EMPTY_PING_LINES),
    [enabled, uuid],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function buildPingBuckets(
  ping: Pick<PingOverviewItem, "samples" | "metricIntervalMs">,
  count?: number,
  now = Date.now(),
): PingOverviewBucket[] {
  const totalWindowMs = 60 * 60 * 1000;
  const requestedCount = count ?? MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
  const boundedRequestedCount =
    Number.isFinite(requestedCount) && requestedCount > 0
      ? Math.min(240, Math.max(1, Math.round(requestedCount)))
      : MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
  const metricIntervalMs =
    typeof ping.metricIntervalMs === "number" &&
    Number.isFinite(ping.metricIntervalMs) &&
    ping.metricIntervalMs > 0
      ? ping.metricIntervalMs
      : 0;
  const resolvedCount = boundedRequestedCount;
  const bucketMs = totalWindowMs / resolvedCount;
  const windowStart = now - totalWindowMs;
  const totals = new Array<number>(resolvedCount).fill(0);
  const losts = new Array<number>(resolvedCount).fill(0);
  const positiveSums = new Array<number>(resolvedCount).fill(0);
  const positiveCounts = new Array<number>(resolvedCount).fill(0);

  const addSampleToBucket = (
    bucketIndex: number,
    sample: PingOverviewItem["samples"][number],
  ) => {
    const { total: sampleCount, lost: sampleLost, valid: sampleValid } =
      resolvePingSampleCounts(sample);

    totals[bucketIndex] += sampleCount;
    losts[bucketIndex] += sampleLost;
    // 聚合点的 value 已由 metric 适配层恢复为“成功样本均值”，这里按 valid count
    // 加权；旧接口/模拟数据没有 count，仍等价于单样本累加。
    if (sample.value >= 0 && sampleValid > 0) {
      positiveSums[bucketIndex] += sample.value * sampleValid;
      positiveCounts[bucketIndex] += sampleValid;
    }
  };

  for (const sample of ping.samples ?? []) {
    if (metricIntervalMs > bucketMs) {
      const sampleEnd = sample.time + metricIntervalMs;
      if (sampleEnd <= windowStart || sample.time > now) continue;

      // 后端时间戳是聚合桶起点。以每个可视 bucket 的中点判断它属于哪个
      // 聚合区间，相当于对粗粒度数据做 sample-and-hold：不会制造规律性空洞，
      // 也不会因为减少 DOM 数量而让不同节点的柱宽不一致。
      for (let index = 0; index < resolvedCount; index += 1) {
        const midpoint = windowStart + (index + 0.5) * bucketMs;
        if (midpoint >= sample.time && midpoint < sampleEnd) {
          addSampleToBucket(index, sample);
        }
      }
      continue;
    }

    let sampleTime = sample.time;
    if (metricIntervalMs > 0) {
      const sampleEnd = sample.time + metricIntervalMs;
      if (sampleEnd <= windowStart || sample.time > now) continue;
      const overlapStart = Math.max(sample.time, windowStart);
      const overlapEnd = Math.min(sampleEnd, now);
      if (overlapEnd < overlapStart) continue;
      sampleTime = overlapStart + (overlapEnd - overlapStart) / 2;
    } else if (sample.time < windowStart || sample.time > now) {
      continue;
    }

    let bucketIndex = Math.floor((sampleTime - windowStart) / bucketMs);
    if (bucketIndex < 0) continue;
    if (bucketIndex >= resolvedCount) bucketIndex = resolvedCount - 1;
    addSampleToBucket(bucketIndex, sample);
  }

  return Array.from({ length: resolvedCount }, (_, index) => {
    const startAt = windowStart + index * bucketMs;
    const endAt = startAt + bucketMs;
    const total = totals[index];
    const lost = Math.round(losts[index]);
    const positiveCount = positiveCounts[index];

    return {
      index,
      value: positiveCount > 0 ? positiveSums[index] / positiveCount : null,
      loss: total > 0 ? (lost / total) * 100 : null,
      total,
      lost,
      startAt,
      endAt,
    };
  });
}

export function usePingBuckets(
  ping: Pick<PingOverviewItem, "samples" | "metricIntervalMs">,
  count?: number,
  enabled = true,
): PingOverviewBucket[] {
  const { samples, metricIntervalMs } = ping;
  // 轮询返回同引用数据时窗口也要随时间前移,否则时间轴最多滞后约 2 个桶;分钟粒度足够
  // (桶宽 ≥150s),也避免每个 ws tick 都重算。
  const now = useMinuteClock(enabled);
  return useMemo(
    () =>
      enabled
        ? buildPingBuckets({ samples, metricIntervalMs }, count, now)
        : EMPTY_PING_BUCKETS,
    [count, enabled, metricIntervalMs, now, samples],
  );
}

// 模块级定时器/请求在热更新时必须停掉,否则新旧两个模块实例会并行轮询。
// disposed 标志 + 清零消费者计数:in-flight 请求的 finally 恢复逻辑不会再重启旧模块的轮询。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pingPollingDisposed = true;
    activeConsumers = 0;
    stopPingPolling();
  });
}
