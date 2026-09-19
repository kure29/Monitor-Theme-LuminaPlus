import type { LoadRecord } from "@/types/models";

const LOAD_METRIC_FIELD = {
  "cpu.usage": "cpu",
  "memory.used": "ram",
  "swap.used": "swap",
  "load.average": "load",
  "disk.used": "disk",
  "net.in.rate": "net_in",
  "net.out.rate": "net_out",
  "net.total.up": "net_total_up",
  "net.total.down": "net_total_down",
  "process.count": "process",
  "connections.tcp": "connections",
  "connections.udp": "connections_udp",
} as const satisfies Record<string, keyof LoadRecord>;

export const LOAD_METRIC_KEYS = Object.keys(LOAD_METRIC_FIELD);

export const LOAD_LAST_AGGREGATION = {
  "net.total.up": "last",
  "net.total.down": "last",
} as const;

export interface LoadRecordTotalFallbacks {
  ramTotal?: number;
  swapTotal?: number;
  diskTotal?: number;
}

export interface ResolvedLoadRecordTotals {
  ramTotal: number;
  swapTotal: number;
  diskTotal: number;
}

function nonNegativeFinite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 历史记录可能不包含 memory.total、swap.total、disk.total 指标。
 * 缺失时使用节点基础信息里的当前总量。
 */
export function resolveLoadRecordTotals(
  record: Pick<LoadRecord, "ram_total" | "swap_total" | "disk_total">,
  fallbacks: LoadRecordTotalFallbacks = {},
): ResolvedLoadRecordTotals {
  return {
    ramTotal: nonNegativeFinite(record.ram_total) || nonNegativeFinite(fallbacks.ramTotal),
    swapTotal: nonNegativeFinite(record.swap_total) || nonNegativeFinite(fallbacks.swapTotal),
    diskTotal: nonNegativeFinite(record.disk_total) || nonNegativeFinite(fallbacks.diskTotal),
  };
}

export interface LoadMetricSeries {
  metricKey: string;
  client: string;
  intervalSeconds?: number;
  points: Array<{ time: string; value: number | null; count: number }>;
}

function emptyLoadRecord(client: string, time: string): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time,
    client,
  };
}

export function mergeLoadMetricSeries(series: LoadMetricSeries[]): LoadRecord[] {
  const records = new Map<string, { record: LoadRecord; timeMs: number }>();
  for (const item of series) {
    const field = LOAD_METRIC_FIELD[item.metricKey as keyof typeof LOAD_METRIC_FIELD];
    if (!field || !item.client) continue;
    for (const point of item.points) {
      if (point.count <= 0 || point.value == null || !Number.isFinite(point.value)) continue;
      const timeMs = Date.parse(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const key = `${item.client}\u0000${timeMs}`;
      const entry = records.get(key) ?? {
        record: emptyLoadRecord(item.client, point.time),
        timeMs,
      };
      entry.record[field] = point.value;
      records.set(key, entry);
    }
  }
  // timeMs 在入库时已解析,排序直接用,避免比较器里重复 Date.parse。
  return [...records.values()]
    .sort((left, right) => left.timeMs - right.timeMs)
    .map(({ record }) => record);
}
