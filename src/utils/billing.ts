import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";

const INT_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const DECIMAL_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPriceNumber(value: number) {
  return (Number.isInteger(value) ? INT_PRICE_FORMATTER : DECIMAL_PRICE_FORMATTER).format(value);
}

const currencyFormatters = new Map<string, Intl.NumberFormat | null>();

function currencyFormatter(code: string, integer: boolean) {
  const key = `${code}:${integer ? "int" : "dec"}`;
  if (!currencyFormatters.has(key)) {
    let formatter: Intl.NumberFormat | null = null;
    try {
      formatter = new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: code,
        currencyDisplay: "symbol",
        minimumFractionDigits: integer ? 0 : 2,
        maximumFractionDigits: 2,
      });
    } catch {
      formatter = null;
    }
    currencyFormatters.set(key, formatter);
  }
  return currencyFormatters.get(key) ?? null;
}

/**
 * 与 monitor 后台一致：按 zh-CN 的写法显示货币，符号或代码在数字前
 * (`¥48`、`US$18`、`HK$38`、`JP¥1,200`、`SGD 12.50`)。
 * hub 1.3.1 起货币一律是三个大写字母；更早的数据可能是 `$`、`港币` 之类的自由文本，
 * 此时照原样放在数字前。
 */
export function formatCurrencyAmount(value: number, currency: string | null | undefined) {
  const raw = currency?.trim() || "CNY";
  const code = raw.toUpperCase();
  const integer = Number.isInteger(value);
  if (/^[A-Z]{3}$/.test(code)) {
    const formatter = currencyFormatter(code, integer);
    if (formatter) return formatter.format(value).replace(/\u00a0/g, " ");
  }
  return `${raw}${formatPriceNumber(value)}`;
}

function isLongTermExpire(value: string | number | null | undefined) {
  if (value == null) return false;
  const days = getExpireDaysRemaining(value);
  return days != null && days > LONG_TERM_EXPIRE_DAYS;
}

type BillingCycleKind = "month" | "quarter" | "halfYear" | "year" | "lifetime";

/** 一个月按 30 天摊销，与「月 = 30 天、季 = 90 天、半年 = 180 天」保持一致。 */
const DAYS_PER_MONTH = 30;

export interface ClassifiedBillingCycleWord {
  kind: BillingCycleKind;
  /** kind === "year" 时的整年数;两年付/三年付按 2/3 摊销,而不是当成年付。 */
  years?: number;
}

/**
 * 把自由文本的账单周期关键词(须预先 lowercase/trim)归类成标准周期,识别不出时返回 null。
 * 这里的标签格式化和 utils/cost.ts 里的天数解析共用它,让这套正则只存在一处。
 */
export function classifyBillingCycleWord(
  normalized: string,
): ClassifiedBillingCycleWord | null {
  if (/^(monthly|month|mo|月|每月|月付)$/.test(normalized)) return { kind: "month" };
  if (/^(quarterly|quarter|季|季度|每季|季付)$/.test(normalized)) return { kind: "quarter" };
  if (/^(semi-?annual(ly)?|halfyear|half-year|半年|半年付)$/.test(normalized)) {
    return { kind: "halfYear" };
  }
  // monitor 后台的付款周期选项是 biennial/triennial(见 web-admin 的 CYCLES),它们是
  // 整年倍数而不是年付:当成 365 天会把三年付 1095 元显示成「1095/年」,月摊也会高三倍。
  if (/^(biennial(ly)?|biannual(ly)?|two-?year(ly)?|2-?year(ly)?|两年|两年付|2年|2年付)$/.test(normalized)) {
    return { kind: "year", years: 2 };
  }
  if (/^(triennial(ly)?|three-?year(ly)?|3-?year(ly)?|三年|三年付|3年|3年付)$/.test(normalized)) {
    return { kind: "year", years: 3 };
  }
  if (/^(annual(ly)?|yearly|year|yr|年|每年|年付)$/.test(normalized)) {
    return { kind: "year", years: 1 };
  }
  if (/^(lifetime|once|one-time|永久|一次性|买断)$/.test(normalized)) {
    return { kind: "lifetime" };
  }
  return null;
}

export interface NormalizedBillingCycle {
  kind: BillingCycleKind | "months" | "days";
  /** 摊销天数;lifetime 为 -1 哨兵。 */
  days: number;
  /** kind === "year" 时的整年数(365/360 天均视为 1 年)。 */
  years?: number;
  /** kind === "months" 时的月数。 */
  months?: number;
}

/**
 * 按月数归类：1/3/6 个月对应月/季/半年，整年对应 N 年，其余是「N 个月」。
 * 整年按 365 天/年摊销，与具名的 yearly/biennial/triennial 一致。
 */
function cycleFromMonths(months: number): NormalizedBillingCycle {
  if (months === 1) return { kind: "month", days: 30 };
  if (months === 3) return { kind: "quarter", days: 90 };
  if (months === 6) return { kind: "halfYear", days: 180 };
  if (months % 12 === 0) return { kind: "year", days: 365 * (months / 12), years: months / 12 };
  return { kind: "months", days: months * DAYS_PER_MONTH, months };
}

/** monitor 1.3.1 起非具名周期存为 `<n>m`(n 为 1–1200 个月)。 */
const MONITOR_MONTHS_PATTERN = /^(\d{1,4})\s*(m|mo|months?|个月|月)$/;
const MONITOR_YEARS_PATTERN = /^(\d{1,3})\s*(y|yr|years?|年)$/;

/**
 * 数字/文本账单周期的唯一归一化入口,标签渲染(formatBillingCycle)与成本摊销
 * (cost.ts billingCycleDays)共用,周期档位政策只存在这一处。
 * 注意:360 天(商用年)按「年」展示,但 days 保留原值 360,摊销不悄悄改成 365;
 * 0/负数/不可解析视为未设置,回退年付。
 */
export function normalizeBillingCycle(
  value: string | number | null | undefined,
): NormalizedBillingCycle {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  // 仅当源是真实的非空数字时才当成天数。`Number("")` 是 0(有限值),以前会让未设置的周期渲染成 "0天"。
  if (raw !== "" && Number.isFinite(numeric)) {
    if (numeric === -1) return { kind: "lifetime", days: -1 };
    if (numeric === 30) return { kind: "month", days: 30 };
    if (numeric === 90) return { kind: "quarter", days: 90 };
    if (numeric === 180) return { kind: "halfYear", days: 180 };
    if (numeric === 365 || numeric === 360) return { kind: "year", days: numeric, years: 1 };
    if (numeric > 0 && numeric % 365 === 0) {
      return { kind: "year", days: numeric, years: numeric / 365 };
    }
    // 费用明细按天数回传周期(如 18 个月 = 540 天)，整月倍数按「N 个月」显示。
    if (numeric > 0 && numeric % DAYS_PER_MONTH === 0) {
      return { kind: "months", days: numeric, months: numeric / DAYS_PER_MONTH };
    }
    if (numeric > 0) return { kind: "days", days: numeric };
    // numeric <= 0(如 0)落到下面的标签兜底分支。
  }

  const lowered = raw.toLowerCase();
  const monthsMatch = MONITOR_MONTHS_PATTERN.exec(lowered);
  if (monthsMatch) {
    const months = Number(monthsMatch[1]);
    if (months > 0) return cycleFromMonths(months);
  }
  const yearsMatch = MONITOR_YEARS_PATTERN.exec(lowered);
  if (yearsMatch) {
    const years = Number(yearsMatch[1]);
    if (years > 0) return cycleFromMonths(years * 12);
  }

  const word = classifyBillingCycleWord(lowered);
  switch (word?.kind) {
    case "month":
      return { kind: "month", days: 30 };
    case "quarter":
      return { kind: "quarter", days: 90 };
    case "halfYear":
      return { kind: "halfYear", days: 180 };
    case "lifetime":
      return { kind: "lifetime", days: -1 };
    case "year":
      return { kind: "year", days: 365 * (word.years ?? 1), years: word.years ?? 1 };
    default:
      return { kind: "year", days: 365, years: 1 };
  }
}

export function formatBillingCycle(value: string | number | null | undefined) {
  const cycle = normalizeBillingCycle(value);
  switch (cycle.kind) {
    case "lifetime":
      return "永久";
    case "month":
      return "月";
    case "quarter":
      return "季";
    case "halfYear":
      return "半年";
    case "year":
      return (cycle.years ?? 1) === 1 ? "年" : `${cycle.years}年`;
    case "months":
      return `${cycle.months}个月`;
    case "days":
      return `${cycle.days}天`;
  }
}

export function formatRenewalPrice({
  price,
  currency,
  billing_cycle,
  expired_at,
}: {
  price: number;
  currency: string;
  billing_cycle?: string | number | null;
  expired_at?: string | number | null;
}) {
  if (!Number.isFinite(price)) return null;
  if (price === -1) return "免费";
  if (price === 0) return isLongTermExpire(expired_at) ? "免费" : null;
  if (price < 0) return null;

  const cycle = formatBillingCycle(billing_cycle);
  return `${formatCurrencyAmount(price, currency)}/${cycle}`;
}
