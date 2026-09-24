import { useMemo } from "react";
import { useMinuteClock } from "@/hooks/useClock";
import { buildFakePingItem } from "@/utils/fakePing";
import type { PingOverviewItem } from "@/types/models";

export function useFakePingFallback(
  uuid: string,
  ping: PingOverviewItem,
  isOnline: boolean,
  fakePingForUnbound: boolean,
): PingOverviewItem {
  const shouldFake =
    isOnline &&
    fakePingForUnbound &&
    ping.loadState === "ready" &&
    !ping.isAssigned;

  const minuteIndex = Math.floor(useMinuteClock(shouldFake) / 60_000);

  return useMemo(
    () => (shouldFake ? buildFakePingItem(uuid, minuteIndex) : ping),
    [shouldFake, uuid, minuteIndex, ping],
  );
}
