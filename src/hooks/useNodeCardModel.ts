import { useMemo } from "react";
import { useFakePingFallback } from "@/hooks/useFakePing";
import { useHourlyClock, useMinuteClock } from "@/hooks/useClock";
import { useNodeCardSnapshots } from "@/hooks/useNode";
import {
  buildPingBuckets,
  useNodePingOverview,
  useNodePingOverviewLines,
  usePingBuckets,
} from "@/hooks/usePingOverview";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type {
  HomepagePingDisplayLine,
  HomepagePingLine,
  PingOverviewItem,
} from "@/types/models";
import { formatRenewalPrice } from "@/utils/billing";
import { getExpireTextColor } from "@/utils/expireStatus";
import { getTrafficResetDisplay } from "@/utils/trafficReset";
import {
  formatBytes,
  formatByteRate,
  formatExpireDays,
  formatUptimeDays,
  joinDisplayParts,
  parseTags,
} from "@/utils/format";
import {
  latencyHeatColor,
  lossHeatColor,
  trafficUsageColor,
} from "@/utils/metricTone";
import { resolveTrafficUsage, trafficTypeLabel, type TrafficDisplay } from "@/utils/traffic";
import { resolveOsInfo } from "@/components/ui/OsLogo";
import {
  resolveVisibleHomepagePingTaskIds,
  type HomepageMultiPingNodeTaskIds,
} from "@/utils/pingTasks";

interface NodeCardModelOptions {
  pingBucketCount?: number;
  includeMultiPing?: boolean;
}

export function shouldRenderHomepagePingBars(
  hasRealHomepagePingBinding: boolean,
  pingIsAssigned: boolean,
) {
  return hasRealHomepagePingBinding || pingIsAssigned;
}

export function buildHomepagePingDisplayLines(
  uuid: string,
  realLines: HomepagePingLine[],
  fallbackPing: PingOverviewItem,
  preferredTaskIds: number[],
  nodeTaskIds: HomepageMultiPingNodeTaskIds,
  bucketCount: number | undefined,
  now: number,
): HomepagePingDisplayLine[] {
  const visibleTaskIds = resolveVisibleHomepagePingTaskIds(
    uuid,
    realLines.map((line) => line.taskId),
    preferredTaskIds,
    nodeTaskIds,
  );
  const visibleLines = visibleTaskIds.flatMap((taskId) => {
    const line = realLines.find((item) => item.taskId === taskId);
    if (
      !line ||
      line.isAssigned === false ||
      (line.loadState === "pending" && line.lastValue == null && line.loss == null)
    ) return [];
    return [{ ...line, buckets: buildPingBuckets(line, bucketCount, now) }];
  });
  if (visibleLines.length > 0 || realLines.length > 0 || fallbackPing.simulated !== true) {
    return visibleLines;
  }
  return [{
    taskId: 0,
    taskName: "延迟",
    ...fallbackPing,
    buckets: buildPingBuckets(fallbackPing, bucketCount, now),
  }];
}

export function useNodeCardModel(
  uuid: string,
  {
    pingBucketCount,
    includeMultiPing = false,
  }: NodeCardModelOptions = {},
) {
  const { meta, metrics, trafficTrend } = useNodeCardSnapshots(uuid);
  const {
    showCardGroup,
    fakePingForUnbound,
    enableHomepageMultiPing,
    homepageMultiPingTaskIds,
    homepageMultiPingNodeTaskIds,
  } = useThemeSettings();
  const multiPingActive = includeMultiPing && enableHomepageMultiPing;
  const realPing = useNodePingOverview(uuid, !multiPingActive || fakePingForUnbound);
  const realPingLines = useNodePingOverviewLines(uuid, multiPingActive);
  const hasRealHomepagePingBinding = useMemo(
    () => multiPingActive || realPing.isAssigned || realPing.loadState === "error",
    [multiPingActive, realPing.isAssigned, realPing.loadState],
  );
  const now = useHourlyClock();
  const ping = useFakePingFallback(
    uuid,
    realPing,
    metrics?.online === true,
    fakePingForUnbound,
  );
  // 状态跟随每条任务数据进入 Store,不再订阅全局 isRefreshing。这样后台轮询开始/结束
  // 时不会让所有节点卡片仅因一个布尔值变化而重渲染。
  const pingLoading =
    hasRealHomepagePingBinding && (ping.loadState ?? "pending") === "pending";
  const pingError =
    hasRealHomepagePingBinding && ping.loadState === "error";
  const shouldRenderPingBars = shouldRenderHomepagePingBars(
    hasRealHomepagePingBinding,
    ping.isAssigned,
  );
  const pingBuckets = usePingBuckets(
    ping,
    pingBucketCount,
    !multiPingActive,
  );
  // 与 usePingBuckets 同理:窗口按分钟前移,不依赖数据刷新才滑动。
  const bucketNow = useMinuteClock(multiPingActive);
  const homepagePingLines = useMemo<HomepagePingDisplayLine[]>(() => {
    if (
      !multiPingActive
    ) {
      return [];
    }
    return buildHomepagePingDisplayLines(
      uuid,
      realPingLines,
      ping,
      homepageMultiPingTaskIds,
      homepageMultiPingNodeTaskIds,
      pingBucketCount,
      bucketNow,
    );
  }, [
    bucketNow,
    homepageMultiPingNodeTaskIds,
    homepageMultiPingTaskIds,
    multiPingActive,
    ping,
    pingBucketCount,
    realPingLines,
    uuid,
  ]);

  const metaModel = useMemo(() => {
    if (!meta) return null;
    const tags = parseTags(meta.tags);
    const group = showCardGroup ? meta.group : undefined;
    const subtitleParts = [group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const subtitleLabels = new Set(subtitleParts.map((part) => part.toLowerCase()));
    const compactFooterTags = tags.filter(
      (tag) => !subtitleLabels.has(tag.label.trim().toLowerCase()),
    );
    const fallbackFooterTags =
      tags.length > 0
        ? tags
        : group
          ? [{ label: group, color: "gray" }]
          : [];
    return {
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle: joinDisplayParts(subtitleParts),
      expire: formatExpireDays(meta.expired_at, now),
      expireColor: getExpireTextColor(meta.expired_at, now),
      trafficReset: getTrafficResetDisplay(meta.expired_at, now),
      renewalPrice: formatRenewalPrice(meta),
      osName: resolveOsInfo(meta.os).name,
      loadBaseline: meta.cpu_cores > 0 ? meta.cpu_cores : 4,
    };
  }, [meta, now, showCardGroup]);

  // ping 派生的颜色只在 ping item 变化时才变。
  const pingModel = useMemo(
    () => ({
      latencyColor: latencyHeatColor(ping.lastValue),
      lossColor: lossHeatColor(ping.loss),
      hasRealHomepagePingBinding,
      // 保留旧字段供外部模型消费者兼容；它表示后台当前分配状态。
      hasHomepagePingBinding: hasRealHomepagePingBinding,
      shouldRenderPingBars,
      pingLoading,
      pingError,
    }),
    [
      hasRealHomepagePingBinding,
      ping,
      pingError,
      pingLoading,
      shouldRenderPingBars,
    ],
  );

  return useMemo(() => {
    if (!meta || !metrics || !metaModel) {
      return {
        node: undefined,
        trafficTrend,
        ping,
        pingBuckets,
        homepagePingLines,
        multiPingActive,
      };
    }

    const { loadBaseline } = metaModel;

    // 流量配额：按节点的 traffic_limit_type（与后端一致）把累计上/下行算成"已用"，
    // 在这里一次性算出剩余和使用占比，让两种卡片布局共用这套计算。
    const trafficUsage = resolveTrafficUsage(
      meta.traffic_limit_type,
      metrics.trafficUp,
      metrics.trafficDown,
      meta.traffic_limit,
    );
    const trafficUsedLabel = formatBytes(trafficUsage.used);
    // 不限量时渲染成 ∞，让剩余值和"已用/上限"那行与限量情况保持一致
    //（"剩余 ∞" + "2.73 GB / ∞"）。
    const trafficLimitLabel = trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.limit);
    const trafficColor = trafficUsage.unlimited
      ? "var(--status-success)"
      : trafficUsageColor(trafficUsage.fraction);
    const traffic: TrafficDisplay = {
      fraction: trafficUsage.fraction,
      color: trafficColor,
      remainingLabel: trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.remaining),
      detail: `${trafficUsedLabel} / ${trafficLimitLabel}`,
      typeLabel: trafficTypeLabel(meta.traffic_limit_type),
    };

    return {
      node: { ...meta, ...metrics },
      trafficTrend,
      ping,
      pingBuckets,
      homepagePingLines,
      multiPingActive,
      traffic,
      ...metaModel,
      ...pingModel,
      uptime: formatUptimeDays(metrics.uptime),
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatByteRate(metrics.netUp),
      downRate: formatByteRate(metrics.netDown),
      isOnline: metrics.online === true,
      isOffline: metrics.online === false,
    };
  }, [
    homepagePingLines,
    multiPingActive,
    meta,
    metrics,
    metaModel,
    pingModel,
    ping,
    pingBuckets,
    trafficTrend,
  ]);
}
