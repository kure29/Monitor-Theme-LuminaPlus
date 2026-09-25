export type HomepagePingTaskBindings = Record<string, string[]>;
export type HomepageMultiPingNodeTaskIds = Record<string, number[]>;

const invertedBindingsCache = new WeakMap<HomepagePingTaskBindings, Map<string, number>>();

function parseTaskId(taskId: string) {
  if (!/^\d+$/.test(taskId)) return null;
  const parsed = Number(taskId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeHomepageMultiPingTaskIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const normalized: number[] = [];
  for (const raw of value) {
    const taskId =
      typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : typeof raw === "string"
          ? parseTaskId(raw)
          : null;
    if (taskId == null || normalized.includes(taskId)) continue;
    normalized.push(taskId);
  }
  return normalized;
}

export function normalizeHomepageMultiPingNodeTaskIds(
  value: unknown,
): HomepageMultiPingNodeTaskIds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepageMultiPingNodeTaskIds = {};
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.trim().localeCompare(right.trim()),
  );
  for (const [rawUuid, rawTaskIds] of entries) {
    const uuid = rawUuid.trim();
    const taskIds = normalizeHomepageMultiPingTaskIds(rawTaskIds);
    if (!uuid || taskIds.length === 0) continue;
    normalized[uuid] = taskIds;
  }
  return normalized;
}

export function createHomepageMultiPingTaskOverride(
  currentTaskIds: number[] | undefined,
  globalTaskIds: number[],
  availableTaskIds: number[],
): number[] | null {
  if (currentTaskIds) return null;

  const available = new Set(
    availableTaskIds.filter(
      (taskId) => Number.isSafeInteger(taskId) && taskId > 0,
    ),
  );
  const orderedTaskIds = orderHomepagePingTaskIds([...available], globalTaskIds);
  return orderedTaskIds.length > 0 ? orderedTaskIds : null;
}

/** 后台分配是任务来源；全局配置只把指定任务排在前面，未列出的任务继续显示。 */
export function orderHomepagePingTaskIds(
  assignedTaskIds: number[],
  preferredTaskIds: number[],
): number[] {
  const assigned = normalizeHomepageMultiPingTaskIds(assignedTaskIds);
  const assignedSet = new Set(assigned);
  const preferred = normalizeHomepageMultiPingTaskIds(preferredTaskIds)
    .filter((taskId) => assignedSet.has(taskId));
  const preferredSet = new Set(preferred);
  return [...preferred, ...assigned.filter((taskId) => !preferredSet.has(taskId))];
}

/** 单独配置显式选择要显示的任务，其余服务器始终显示后台分配的全部任务。 */
export function resolveVisibleHomepagePingTaskIds(
  uuid: string,
  assignedTaskIds: number[],
  preferredTaskIds: number[],
  nodeTaskIds: HomepageMultiPingNodeTaskIds,
): number[] {
  const ordered = orderHomepagePingTaskIds(assignedTaskIds, preferredTaskIds);
  const override = normalizeHomepageMultiPingTaskIds(nodeTaskIds[uuid]);
  if (override.length === 0) return ordered;
  const assigned = new Set(ordered);
  return override.filter((taskId) => assigned.has(taskId));
}

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null || !Array.isArray(clients)) continue;

    const uniqueClients = Array.from(
      new Set(
        clients
          .map((client) => (typeof client === "string" ? client.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (uniqueClients.length === 0) {
      continue;
    }

    const normalizedTaskId = String(numericTaskId);
    normalized[normalizedTaskId] = Array.from(
      new Set([...(normalized[normalizedTaskId] ?? []), ...uniqueClients]),
    );
  }

  return normalized;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const cached = invertedBindingsCache.get(bindings);
  if (cached) return cached;

  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(normalizeHomepagePingTaskBindings(bindings)).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null) continue;
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  invertedBindingsCache.set(bindings, selectedTaskByClient);
  return selectedTaskByClient;
}
