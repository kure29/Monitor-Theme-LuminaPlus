import {
  invertHomepagePingTaskBindings,
  normalizeHomepagePingTaskBindings,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

type AssignedTask = { id: number; clients: string[] };

export function pruneHomepagePingBindings(
  bindings: HomepagePingTaskBindings,
): HomepagePingTaskBindings {
  return Object.fromEntries(
    Object.entries(normalizeHomepagePingTaskBindings(bindings))
      .filter(([, clients]) => clients.length > 0)
      .map(([taskId, clients]) => [taskId, [...clients].sort()]),
  );
}

/** 全选与单选使用相同的规则：把目标节点从旧任务移到新任务。 */
export function assignHomepagePingClients(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuids: string[],
): HomepagePingTaskBindings {
  const next = pruneHomepagePingBindings(bindings);
  const target = new Set(clientUuids);
  if (target.size === 0) return next;
  for (const [key, clients] of Object.entries(next)) {
    next[key] = clients.filter((uuid) => !target.has(uuid));
  }
  const key = String(taskId);
  next[key] = [...new Set([...(next[key] ?? []), ...target])].sort();
  return pruneHomepagePingBindings(next);
}

export function removeHomepagePingClient(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuid: string,
): HomepagePingTaskBindings {
  const next = pruneHomepagePingBindings(bindings);
  const key = String(taskId);
  next[key] = (next[key] ?? []).filter((uuid) => uuid !== clientUuid);
  return pruneHomepagePingBindings(next);
}

/** 根据 hub 的真实分配补齐唯一线路，保留仍有效的单线路偏好。 */
export function syncHomepagePingBindings(
  bindings: HomepagePingTaskBindings,
  tasks: AssignedTask[],
  clientUuids: string[],
): HomepagePingTaskBindings {
  const allowedClients = new Set(clientUuids);
  const availableByClient = new Map<string, number[]>();
  for (const task of [...tasks].sort((a, b) => a.id - b.id)) {
    for (const uuid of task.clients) {
      if (!allowedClients.has(uuid)) continue;
      const available = availableByClient.get(uuid) ?? [];
      available.push(task.id);
      availableByClient.set(uuid, available);
    }
  }
  const chosen = invertHomepagePingTaskBindings(bindings);
  const next: HomepagePingTaskBindings = {};
  for (const uuid of clientUuids) {
    const available = availableByClient.get(uuid) ?? [];
    const preferred = chosen.get(uuid);
    const taskId = preferred != null && available.includes(preferred)
      ? preferred
      : available.length === 1 ? available[0] : undefined;
    if (taskId == null) continue;
    (next[String(taskId)] ??= []).push(uuid);
  }
  return pruneHomepagePingBindings(next);
}

/** 找出单独配置中已不再分配给该节点的任务，供设置页提示。 */
export function getInvalidHomepageMultiPingOverrides(
  tasks: AssignedTask[],
  clientUuids: string[],
  nodeTaskIds: HomepageMultiPingNodeTaskIds,
): string[] {
  const assignedByTask = new Map(
    tasks.map((task) => [task.id, new Set(task.clients)]),
  );
  return clientUuids.filter((uuid) =>
    (nodeTaskIds[uuid] ?? []).some(
      (taskId) => !assignedByTask.get(taskId)?.has(uuid),
    ),
  );
}
