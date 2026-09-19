import { describe, expect, it } from "vitest";
import {
  LOAD_METRIC_KEYS,
  mergeLoadMetricSeries,
  resolveLoadRecordTotals,
  type LoadMetricSeries,
} from "@/utils/loadMetrics";

function series(
  metricKey: string,
  time: string,
  value: number | null,
  count = 1,
): LoadMetricSeries {
  return {
    metricKey,
    client: "node-a",
    points: [{ time, value, count }],
  };
}

describe("mergeLoadMetricSeries", () => {
  it("combines metric-store series into chronological legacy load records", () => {
    const later = "2026-07-13T02:15:00Z";
    const earlier = "2026-07-13T02:00:00Z";
    const records = mergeLoadMetricSeries([
      series("cpu.usage", later, 42),
      series("memory.used", earlier, 512),
      series("net.total.down", earlier, 2048),
      series("cpu.usage", earlier, 25),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      client: "node-a",
      time: earlier,
      cpu: 25,
      ram: 512,
      ram_total: 0,
      net_total_down: 2048,
    });
    expect(records[1]).toMatchObject({ time: later, cpu: 42 });
  });

  it("ignores empty rollup buckets and unknown metrics", () => {
    expect(
      mergeLoadMetricSeries([
        series("cpu.usage", "2026-07-13T02:00:00Z", null, 0),
        series("unknown.metric", "2026-07-13T02:00:00Z", 10),
      ]),
    ).toEqual([]);
  });

  it("keeps only the metric definitions used by the chart adapter", () => {
    expect(LOAD_METRIC_KEYS).not.toContain("memory.total");
    expect(LOAD_METRIC_KEYS).not.toContain("swap.total");
    expect(LOAD_METRIC_KEYS).not.toContain("disk.total");
    expect(LOAD_METRIC_KEYS).toContain("memory.used");
    expect(LOAD_METRIC_KEYS).toContain("swap.used");
    expect(LOAD_METRIC_KEYS).toContain("disk.used");
  });
});

describe("resolveLoadRecordTotals", () => {
  it("uses node metadata totals when monitor history omits them", () => {
    expect(
      resolveLoadRecordTotals(
        { ram_total: 0, swap_total: 0, disk_total: 0 },
        { ramTotal: 1024, swapTotal: 2048, diskTotal: 4096 },
      ),
    ).toEqual({
      ramTotal: 1024,
      swapTotal: 2048,
      diskTotal: 4096,
    });
  });

  it("prefers historical totals when a compatible source includes them", () => {
    expect(
      resolveLoadRecordTotals(
        { ram_total: 512, swap_total: 1024, disk_total: 2048 },
        { ramTotal: 4096, swapTotal: 4096, diskTotal: 4096 },
      ),
    ).toEqual({
      ramTotal: 512,
      swapTotal: 1024,
      diskTotal: 2048,
    });
  });
});
