const HOUR_MS = 60 * 60 * 1000;
const TRAFFIC_STATS_REFRESH_MS = 5 * 60 * 1000;
const TRAFFIC_STATS_ERROR_RETRY_MS = 60 * 1000;

export function selectActiveTodayTrafficUuids(
  uuids: string[],
  activeUuids: ReadonlySet<string>,
) {
  return [...new Set(uuids.filter((uuid) => activeUuids.has(uuid)))];
}

export function getTodayTrafficRecordRangeHours(startMs: number, endMs: number) {
  // records 以累计 counter 计算增量，必须额外覆盖午夜前至少一个采样点作为基线。
  return Math.max(1, Math.ceil((endMs - startMs) / HOUR_MS) + 1);
}

export function getTodayTrafficRefreshInterval(
  source: "metrics" | "records" | undefined,
  hasError: boolean,
) {
  if (hasError) return TRAFFIC_STATS_ERROR_RETRY_MS;
  return source == null ? false : TRAFFIC_STATS_REFRESH_MS;
}
