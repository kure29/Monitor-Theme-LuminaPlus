import { memo } from "react";
import { clsx } from "clsx";

/**
 * 模拟延迟标记。
 *
 * `fakePingForUnbound` 打开后,没有 monitor 真实样本的探测点会显示前端生成的假数据
 * (延迟 1-10ms、丢包 0%)。它看起来和真实延迟一模一样,容易被当成「主题数据与后台对不上」,
 * 所以在每个展示模拟值的位置都明确标注。
 */
export const SimulatedPingBadge = memo(function SimulatedPingBadge({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx("ping-simulated-badge", compact && "is-compact", className)}
      title="模拟数据：该探测点没有 monitor 上报的真实延迟，数值由前端生成，不代表网络质量"
    >
      模拟
    </span>
  );
});
