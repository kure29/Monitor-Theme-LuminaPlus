import { describe, expect, it } from "vitest";
import { monitorNodeToInfo, monitorNodeToRealtime } from "@/services/api";

const node = {
  id: 7,
  name: "Tokyo",
  group: "Asia",
  sort: 20,
  public: true,
  online: true,
  country: "jp",
  last_seen: 1_760_000_000,
  os: "debian",
  kernel: "6.8.0",
  arch: "x86_64",
  virt: "KVM",
  cpu_name: "EPYC",
  cpu_cores: 4,
  mem_total: 8_000,
  swap_total: 2_000,
  disk_total: 16_000,
  price: 12,
  currency: "USD",
  billing_cycle: "month",
  expires_at: "2027-01-01T00:00:00Z",
  traffic_limit: 10_000,
  traffic_mode: "sum",
  month_rx: 400,
  month_tx: 600,
  ipv4: "203.0.113.7",
  ipv6: "2001:db8::7",
  remark: "edge",
  metrics: {
    uptime: 99,
    cpu: 37.5,
    load: [1, 0.8, 0.6],
    mem_total: 8_000,
    mem_used: 3_000,
    swap_total: 2_000,
    swap_used: 100,
    disk_total: 16_000,
    disk_used: 4_000,
    net_rx: 222,
    net_tx: 111,
    month_rx: 400,
    month_tx: 600,
    tcp: 12,
    udp: 4,
    procs: 88,
  },
};

describe("monitor node adapter", () => {
  it("maps monitor metadata to the LuminaPlus display model", () => {
    expect(monitorNodeToInfo(node)).toMatchObject({
      uuid: "7",
      name: "Tokyo",
      group: "Asia",
      region: "JP",
      virtualization: "KVM",
      traffic_limit_type: "sum",
      ipv4: "203.0.113.7",
    });
  });

  it("maps rates, resources and monthly traffic without swapping directions", () => {
    expect(monitorNodeToRealtime(node)).toMatchObject({
      online: true,
      cpu: { usage: 37.5 },
      ram: { total: 8_000, used: 3_000 },
      network: { up: 111, down: 222, totalUp: 600, totalDown: 400 },
      connections: { tcp: 12, udp: 4 },
    });
  });

  it("keeps monthly counters for an offline node", () => {
    expect(monitorNodeToRealtime({ ...node, online: false, metrics: null })).toMatchObject({
      online: false,
      network: { up: 0, down: 0, totalUp: 600, totalDown: 400 },
    });
  });
});
