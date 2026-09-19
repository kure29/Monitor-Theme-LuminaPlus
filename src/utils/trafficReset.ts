import { LONG_TERM_EXPIRE_DAYS, resolveExpireTimestamp } from "@/utils/format";

export interface TrafficResetDisplay {
  label: string;
  title: string;
}

/** 与到期日期展示使用同一浏览器时区；只推导月度计划，不改变流量计数。 */
export function getTrafficResetDisplay(
  expiredAt: string | number | null | undefined,
  now: number,
): TrafficResetDisplay | null {
  const timestamp = resolveExpireTimestamp(expiredAt);
  if (timestamp == null || !Number.isFinite(now)) return null;
  if ((timestamp - now) / 86_400_000 > LONG_TERM_EXPIRE_DAYS) return null;

  const day = new Date(timestamp).getDate();
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthlyDate = (monthIndex: number) =>
    new Date(year, monthIndex, Math.min(day, new Date(year, monthIndex + 1, 0).getDate()));
  let next = monthlyDate(month);
  // 当天整天显示“今日重置”，次日再滚动至下一月。
  if (next.getDate() < today.getDate()) next = monthlyDate(month + 1);
  // 用日历日计算，避免夏令时切换造成 23/25 小时的一天被取整错算。
  const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = (ordinal(next) - ordinal(today)) / 86_400_000;
  const dateLabel = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  return {
    label: days === 0 ? "今日重置" : `${days}天后重置`,
    title: `流量重置日：${dateLabel} · 默认按到期日，每月${day}日重置（不足该日取月末）`,
  };
}
