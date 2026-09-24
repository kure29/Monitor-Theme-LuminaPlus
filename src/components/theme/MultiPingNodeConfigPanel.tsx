import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminClient, PingTask } from "@/types/models";
import {
  createHomepageMultiPingTaskOverride,
  orderHomepagePingTaskIds,
  type HomepageMultiPingNodeTaskIds,
} from "@/utils/pingTasks";

type NodeFilter = "all" | "custom" | "default";
type TaskClientsById = Map<number, ReadonlySet<string>>;

const NODE_ROW_HEIGHT = 64;
const NODE_LIST_WINDOW_SIZE = 16;
const NODE_LIST_OVERSCAN = 3;
const EMPTY_TASK_IDS: number[] = [];

interface MultiPingNodeConfigPanelProps {
  open: boolean;
  clients: AdminClient[];
  tasks: PingTask[];
  globalTaskIds: number[];
  nodeTaskIds: HomepageMultiPingNodeTaskIds;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: HomepageMultiPingNodeTaskIds) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

function taskLabel(taskId: number, tasksById: Map<number, PingTask>) {
  return tasksById.get(taskId)?.name || `任务 #${taskId}`;
}

function taskSupportsClient(
  taskId: number,
  clientUuid: string,
  taskClientsById: TaskClientsById,
) {
  return taskClientsById.get(taskId)?.has(clientUuid) === true;
}

function invalidTaskIds(
  taskIds: number[],
  clientUuid: string,
  taskClientsById: TaskClientsById,
) {
  return taskIds.filter(
    (taskId) => !taskSupportsClient(taskId, clientUuid, taskClientsById),
  );
}

export function MultiPingNodeConfigPanel({
  open,
  clients,
  tasks,
  globalTaskIds,
  nodeTaskIds,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onClose,
  onSave,
}: MultiPingNodeConfigPanelProps) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [filter, setFilter] = useState<NodeFilter>("all");
  const [selectedUuid, setSelectedUuid] = useState(() => clients[0]?.uuid ?? "");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [firstVisibleNodeIndex, setFirstVisibleNodeIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const nodeListRef = useRef<HTMLDivElement>(null);

  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const taskClientsById = useMemo<TaskClientsById>(
    () => new Map(tasks.map((task) => [task.id, new Set(task.clients)])),
    [tasks],
  );
  const groups = useMemo(
    () =>
      Array.from(
        new Set(clients.map((client) => String(client.group || "").trim()).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    [clients],
  );
  const customCount = useMemo(
    () => clients.filter((client) => nodeTaskIds[client.uuid]).length,
    [clients, nodeTaskIds],
  );
  const invalidTaskIdsByClient = useMemo(() => {
    const next = new Map<string, number[]>();
    clients.forEach((client) => {
      const taskIds = nodeTaskIds[client.uuid] ?? EMPTY_TASK_IDS;
      const invalidIds = invalidTaskIds(taskIds, client.uuid, taskClientsById);
      if (invalidIds.length > 0) next.set(client.uuid, invalidIds);
    });
    return next;
  }, [clients, nodeTaskIds, taskClientsById]);
  const invalidClientCount = invalidTaskIdsByClient.size;
  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return clients.filter((client) => {
      const isCustom = Boolean(nodeTaskIds[client.uuid]);
      if (filter === "custom" && !isCustom) return false;
      if (filter === "default" && isCustom) return false;
      if (group && String(client.group || "").trim() !== group) return false;
      if (!keyword) return true;
      return [client.name, client.uuid, client.group, client.region].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      );
    });
  }, [clients, filter, group, nodeTaskIds, search]);
  const selectedClient = useMemo(
    () =>
      filteredClients.find((client) => client.uuid === selectedUuid) ??
      filteredClients[0],
    [filteredClients, selectedUuid],
  );
  const selectedTaskIds = selectedClient ? nodeTaskIds[selectedClient.uuid] : undefined;
  const selectedInvalidTaskIds = selectedClient
    ? (invalidTaskIdsByClient.get(selectedClient.uuid) ?? EMPTY_TASK_IDS)
    : EMPTY_TASK_IDS;
  const availableTaskIds = selectedClient
    ? tasks.filter((task) => taskSupportsClient(task.id, selectedClient.uuid, taskClientsById)).map((task) => task.id)
    : EMPTY_TASK_IDS;
  const effectiveTaskIds = selectedTaskIds ?? orderHomepagePingTaskIds(availableTaskIds, globalTaskIds);
  const selectableTaskIds = availableTaskIds;
  const canEnableOverride = selectableTaskIds.length > 0;
  const nodeWindowStart = Math.max(
    0,
    Math.min(
      firstVisibleNodeIndex - NODE_LIST_OVERSCAN,
      Math.max(0, filteredClients.length - NODE_LIST_WINDOW_SIZE),
    ),
  );
  const visibleNodeWindow = filteredClients.slice(
    nodeWindowStart,
    Math.min(
      filteredClients.length,
      nodeWindowStart + NODE_LIST_WINDOW_SIZE + NODE_LIST_OVERSCAN * 2,
    ),
  );

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const nextUuid = selectedClient?.uuid ?? "";
    if (nextUuid !== selectedUuid) setSelectedUuid(nextUuid);
  }, [open, selectedClient?.uuid, selectedUuid]);

  useEffect(() => {
    setFirstVisibleNodeIndex(0);
    if (nodeListRef.current) nodeListRef.current.scrollTop = 0;
  }, [filter, group, search]);

  if (!open || typeof document === "undefined") return null;

  const selectClient = (uuid: string) => {
    setSelectedUuid(uuid);
    setMobileEditorOpen(true);
  };
  const enableOverride = () => {
    if (!selectedClient || !canEnableOverride) return;
    const nextTaskIds = createHomepageMultiPingTaskOverride(
      selectedTaskIds,
      globalTaskIds,
      selectableTaskIds,
    );
    if (!nextTaskIds) return;
    onChange({
      ...nodeTaskIds,
      [selectedClient.uuid]: nextTaskIds,
    });
  };
  const clearOverride = () => {
    if (!selectedClient || !nodeTaskIds[selectedClient.uuid]) return;
    const next = { ...nodeTaskIds };
    delete next[selectedClient.uuid];
    onChange(next);
  };
  const patchTask = (slot: number, rawValue: string) => {
    if (!selectedClient || !selectedTaskIds || rawValue === "") return;
    const nextTaskIds = [...selectedTaskIds];
    const nextTaskId = Number(rawValue);
    if (!selectableTaskIds.includes(nextTaskId)) return;
    const previousTaskId = nextTaskIds[slot];
    const occupiedSlot = nextTaskIds.indexOf(nextTaskId);
    nextTaskIds[slot] = nextTaskId;
    if (occupiedSlot >= 0 && occupiedSlot !== slot && previousTaskId != null) {
      nextTaskIds[occupiedSlot] = previousTaskId;
    }
    onChange({ ...nodeTaskIds, [selectedClient.uuid]: nextTaskIds });
  };
  const updateSelectedTasks = (update: (taskIds: number[]) => number[]) => {
    if (!selectedClient || !selectedTaskIds) return;
    const nextTaskIds = update(selectedTaskIds);
    if (nextTaskIds.length === 0) return;
    onChange({ ...nodeTaskIds, [selectedClient.uuid]: nextTaskIds });
  };

  return createPortal(
    <div className="multi-ping-config-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-ping-config-title"
        className="multi-ping-config-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="multi-ping-config-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
              <SlidersHorizontal size={14} />
              多线路延迟
            </div>
            <h2
              id="multi-ping-config-title"
              className="mt-1 text-[19px] font-semibold text-[var(--text-primary)]"
            >
              按服务器配置探测点
            </h2>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              已单独配置 {customCount} / {clients.length} 台，其余自动显示后台分配的全部线路
              {invalidClientCount > 0
                ? `，${invalidClientCount} 台含后台未分配的探测点，首页会隐藏这些线路。`
                : "。"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="multi-ping-config-icon-button"
            aria-label="关闭配置面板"
            title="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="multi-ping-config-body">
          <aside
            className={clsx(
              "multi-ping-config-sidebar",
              mobileEditorOpen && "is-mobile-hidden",
            )}
          >
            <div className="multi-ping-config-sidebar-tools">
              <label className="surface-inset flex items-center gap-2 px-3 py-2">
                <Search size={14} className="text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索服务器 / UUID / 地区"
                  aria-label="搜索服务器"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </label>

              <div className="multi-ping-config-filters" aria-label="配置状态筛选">
                {(
                  [
                    ["all", `全部 ${clients.length}`],
                    ["custom", `已自定义 ${customCount}`],
                    ["default", `后台自动 ${clients.length - customCount}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={clsx(filter === value && "is-active")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                aria-label="按分组筛选服务器"
                className="surface-inset w-full px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none"
              >
                <option value="">全部分组</option>
                {groups.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div
              ref={nodeListRef}
              className="multi-ping-config-node-list"
              onScroll={(event) => {
                const nextIndex = Math.floor(
                  event.currentTarget.scrollTop / NODE_ROW_HEIGHT,
                );
                setFirstVisibleNodeIndex((current) =>
                  current === nextIndex ? current : nextIndex,
                );
              }}
            >
              <div
                className="multi-ping-config-node-list-window"
                style={{ height: filteredClients.length * NODE_ROW_HEIGHT }}
              >
                {visibleNodeWindow.map((client, windowIndex) => {
                  const clientIndex = nodeWindowStart + windowIndex;
                  const override = nodeTaskIds[client.uuid];
                  const invalidIds =
                    invalidTaskIdsByClient.get(client.uuid) ?? EMPTY_TASK_IDS;
                  const active = selectedClient?.uuid === client.uuid;
                  return (
                    <button
                      key={client.uuid}
                      type="button"
                      onClick={() => selectClient(client.uuid)}
                      className={clsx("multi-ping-config-node", active && "is-active")}
                      style={{ transform: `translateY(${clientIndex * NODE_ROW_HEIGHT}px)` }}
                      aria-posinset={clientIndex + 1}
                      aria-setsize={filteredClients.length}
                    >
                      <Flag region={client.region} size={15} />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                          {client.name || client.uuid}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-[var(--text-tertiary)]">
                          {override
                            ? override
                                .map((taskId) => taskLabel(taskId, tasksById))
                                .join(" · ")
                            : [client.group, client.region]
                                .filter(Boolean)
                                .join(" · ") || "后台自动同步"}
                        </span>
                      </span>
                      {invalidIds.length > 0 ? (
                        <span
                          className="multi-ping-config-status is-warning"
                          title={
                            `${invalidIds.map((taskId) => taskLabel(taskId, tasksById)).join("、")} 未在后台分配给此服务器，首页会隐藏这些线路`
                          }
                        >
                          <AlertTriangle size={12} />
                          未分配
                        </span>
                      ) : override ? (
                        <span className="multi-ping-config-status" title="已单独配置">
                          <Check size={12} />
                          已自定义
                        </span>
                      ) : (
                        <ChevronRight
                          size={15}
                          className="text-[var(--text-tertiary)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {filteredClients.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--text-tertiary)]">
                  没有匹配的服务器。
                </div>
              )}
            </div>
          </aside>

          <main
            className={clsx(
              "multi-ping-config-editor",
              mobileEditorOpen && "is-mobile-open",
            )}
          >
            {selectedClient ? (
              <>
                <div className="multi-ping-config-editor-head">
                  <button
                    type="button"
                    onClick={() => setMobileEditorOpen(false)}
                    className="multi-ping-config-mobile-back"
                  >
                    <ArrowLeft size={15} />
                    服务器列表
                  </button>
                  <div className="flex items-start gap-3">
                    <Flag region={selectedClient.region} size={20} />
                    <div className="min-w-0">
                      <h3 className="truncate text-[17px] font-semibold text-[var(--text-primary)]">
                        {selectedClient.name || selectedClient.uuid}
                      </h3>
                      <p className="mt-1 break-all text-[11px] text-[var(--text-tertiary)]">
                        {[selectedClient.group, selectedClient.region, selectedClient.uuid]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="multi-ping-config-editor-content">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-medium text-[var(--text-primary)]">
                        探测点来源
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                        自定义仅影响当前服务器；未选择的后台任务会在这台服务器的卡片上隐藏。
                      </p>
                    </div>
                    <div className="multi-ping-config-mode" aria-label="探测点来源">
                      <button
                        type="button"
                        aria-pressed={!selectedTaskIds}
                        onClick={clearOverride}
                        className={clsx(!selectedTaskIds && "is-active")}
                      >
                        后台自动
                      </button>
                      <button
                        type="button"
                        aria-pressed={Boolean(selectedTaskIds)}
                        disabled={!canEnableOverride}
                        onClick={enableOverride}
                        className={clsx(selectedTaskIds && "is-active")}
                        title={
                          canEnableOverride
                            ? "为当前服务器单独选择探测点"
                            : "这台服务器没有可选择的 Ping 任务，请先在 monitor 后台分配"
                        }
                      >
                        自定义显示
                      </button>
                    </div>
                  </div>

                  {selectedInvalidTaskIds.length > 0 && (
                    <div className="multi-ping-config-warning" role="status">
                      <AlertTriangle size={16} />
                      <div>
                        <strong>
                          后台未分配探测点
                        </strong>
                        <span>
                          {selectedInvalidTaskIds
                            .map((taskId) => taskLabel(taskId, tasksById))
                            .join("、")} 未在 monitor 后台分配给此服务器。
                          {canEnableOverride
                            ? "首页会隐藏这些线路；请更新自定义显示，选择后台已分配的探测点。"
                            : "首页会隐藏这些线路；请先在 monitor 后台为此服务器分配 Ping 任务。"}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="multi-ping-config-lines">
                    {effectiveTaskIds.length === 0 && (
                      <p className="text-[12px] text-[var(--text-tertiary)]">monitor 后台尚未给这台服务器分配 Ping 任务。</p>
                    )}
                    {effectiveTaskIds.map((_, slot) => {
                        const selectedTaskId = effectiveTaskIds[slot];
                        const selectedTaskSupported =
                          selectedTaskId != null &&
                          taskSupportsClient(
                            selectedTaskId,
                            selectedClient.uuid,
                            taskClientsById,
                          );
                        return (
                          <div
                            key={slot}
                            className={clsx(
                              "multi-ping-config-line",
                              selectedTaskId != null && !selectedTaskSupported && "is-invalid",
                            )}
                          >
                            <span className="multi-ping-config-line-number">{slot + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                                线路 {slot + 1}
                              </span>
                              {selectedTaskIds ? (
                                <select
                                  value={selectedTaskId ?? ""}
                                  onChange={(event) => patchTask(slot, event.target.value)}
                                  aria-label={`${selectedClient.name} 线路 ${slot + 1}`}
                                  className="surface-inset mt-1.5 w-full px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
                                >
                                  {selectedTaskId != null && !tasksById.has(selectedTaskId) && (
                                    <option value={selectedTaskId} disabled>
                                      {taskLabel(selectedTaskId, tasksById)}（当前不可用）
                                    </option>
                                  )}
                                  {tasks.map((task) => (
                                    <option
                                      key={task.id}
                                      value={task.id}
                                      disabled={!taskSupportsClient(
                                        task.id,
                                        selectedClient.uuid,
                                        taskClientsById,
                                      )}
                                    >
                                      {task.name || `任务 #${task.id}`}
                                      {!taskSupportsClient(
                                        task.id,
                                        selectedClient.uuid,
                                        taskClientsById,
                                      ) && "（后台未分配）"}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-primary)]">
                                  <span className="truncate">
                                    {selectedTaskId != null
                                      ? taskLabel(selectedTaskId, tasksById)
                                      : "后台未分配任务"}
                                  </span>
                                  {selectedTaskId != null && !selectedTaskSupported && (
                                    <span className="multi-ping-config-inline-warning">未分配</span>
                                  )}
                                </span>
                              )}
                            </span>
                            {selectedTaskIds && (
                              <span className="multi-ping-config-line-actions">
                                <button type="button" disabled={slot === 0} onClick={() => updateSelectedTasks((ids) => { const next = [...ids]; [next[slot - 1], next[slot]] = [next[slot], next[slot - 1]]; return next; })} aria-label={`上移线路 ${slot + 1}`} className="multi-ping-config-mini-action"><ArrowUp size={13} /></button>
                                <button type="button" disabled={slot === selectedTaskIds.length - 1} onClick={() => updateSelectedTasks((ids) => { const next = [...ids]; [next[slot], next[slot + 1]] = [next[slot + 1], next[slot]]; return next; })} aria-label={`下移线路 ${slot + 1}`} className="multi-ping-config-mini-action"><ArrowDown size={13} /></button>
                                <button type="button" disabled={selectedTaskIds.length === 1} onClick={() => updateSelectedTasks((ids) => ids.filter((__, index) => index !== slot))} aria-label={`移除线路 ${slot + 1}`} className="multi-ping-config-mini-action"><Trash2 size={13} /></button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {selectedTaskIds && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={selectableTaskIds.every((id) => selectedTaskIds.includes(id))} onClick={() => updateSelectedTasks((ids) => { const nextId = selectableTaskIds.find((id) => !ids.includes(id)); return nextId == null ? ids : [...ids, nextId]; })} className="theme-manage-button is-compact"><Plus size={13} />添加线路</button>
                      <button type="button" disabled={availableTaskIds.length === 0 || availableTaskIds.every((id) => selectedTaskIds.includes(id)) && selectedTaskIds.length === availableTaskIds.length} onClick={() => updateSelectedTasks(() => availableTaskIds)} className="theme-manage-button is-compact">选用全部已分配</button>
                      <button type="button" onClick={clearOverride} className="theme-manage-button is-compact"><RotateCcw size={13} />恢复后台自动</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-[18rem] items-center justify-center text-[13px] text-[var(--text-tertiary)]">
                选择一台服务器开始配置。
              </div>
            )}
          </main>
        </div>

        <footer className="multi-ping-config-footer">
          {saveError ? (
            <span
              role="alert"
              className="multi-ping-config-footer-error text-[11px] text-[var(--status-error)]"
            >
              {saveError}
            </span>
          ) : (
            <span className="multi-ping-config-footer-hint text-[11px] text-[var(--text-tertiary)]">
              这里的修改会和其他主题设置一起保存。
            </span>
          )}
          <div className="multi-ping-config-footer-actions flex items-center gap-2">
            <button type="button" onClick={onClose} className="theme-manage-button">
              关闭
            </button>
            <button
              type="button"
              disabled={saveDisabled || saving}
              onClick={() => void onSave().then((saved) => saved && onClose())}
              className="theme-manage-button is-primary"
            >
              {saving ? <Spinner size={14} /> : <Save size={14} />}
              {saving ? "保存中" : "保存设置"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
