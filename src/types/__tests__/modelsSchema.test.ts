import { describe, expect, it } from "vitest";
import { NodeInfoSchema, PingRecordSchema } from "@/types/models";

describe("theme data schemas", () => {
  it("exposes transformed node fields through the schema output", () => {
    const node = NodeInfoSchema.parse({ uuid: "node-a", group: null, region: null });
    expect(node.group).toBe("");
    expect(node.region).toBe("");
  });

  it("keeps aggregate Ping fields explicit", () => {
    const record = PingRecordSchema.parse({
      task_id: 7,
      time: "2026-07-15T04:00:00Z",
      value: 35,
      count: 3,
      loss: null,
    });
    expect(record).toMatchObject({ count: 3, loss: null });
  });
});
