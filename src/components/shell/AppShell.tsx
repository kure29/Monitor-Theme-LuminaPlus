import { Outlet, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import { BackgroundLayer } from "./BackgroundLayer";
import { AmbientEffectLayer } from "./AmbientEffectLayer";
import { Spinner } from "@/components/ui/Spinner";
import { useAppearance } from "@/hooks/useAppearance";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useSiteMetadata } from "@/hooks/useSiteMetadata";
import { useMetricColorsSync } from "@/hooks/useMetricColors";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { ApiRequestError } from "@/services/api";
import { PwaPullToRefresh } from "./PwaPullToRefresh";

export function AppShell() {
  useAppearance();
  useSiteMetadata();
  useMetricColorsSync();
  const { pathname, search } = useLocation();
  const publicConfig = usePublicConfig();
  const auth = useAuth();
  const normalizedPath = (pathname.replace(/\/+$/, "") || "/").toLowerCase();
  const isDataRoute =
    normalizedPath === "/" ||
    normalizedPath === "/assets" ||
    normalizedPath === "/traffic" ||
    normalizedPath.startsWith("/instance/");
  const isCheckingAccess =
    isDataRoute &&
    (publicConfig.isPending ||
      (publicConfig.data?.private_site === true && auth.isPending));
  const accessError = isDataRoute && publicConfig.isError && !publicConfig.data;
  const isPrivateVisitor =
    isDataRoute &&
    publicConfig.data?.private_site === true &&
    !auth.isPending &&
    auth.data?.logged_in !== true;
  const isHomeDashboard =
    normalizedPath === "/" && new URLSearchParams(search).get("view") !== "theme-manage";
  const pullRefreshActive = isDataRoute && (normalizedPath !== "/" || isHomeDashboard);
  const canHydrateHome =
    isHomeDashboard && !isCheckingAccess && !accessError && !isPrivateVisitor;
  const homeStoreStatus = useNodeStoreStatus(canHydrateHome);
  const isCheckingHomeData =
    canHydrateHome && !homeStoreStatus.hydrated && !homeStoreStatus.nodeInfoError;
  const isCheckingShell = isCheckingAccess || isCheckingHomeData;
  return (
    <div className="relative flex min-h-screen flex-col">
      <PwaPullToRefresh active={pullRefreshActive} />
      <BackgroundLayer />
      <AmbientEffectLayer />
      <main className="app-main flex-1 px-3 pb-8 sm:px-5 md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1720px]">
          {isCheckingShell ? (
            <div className="flex min-h-[60vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          ) : accessError ? (
            <AccessError error={publicConfig.error} onRetry={() => void publicConfig.refetch()} />
          ) : isPrivateVisitor ? (
            <PrivateSiteGate />
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}

function siteConfigErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `站点接口返回 HTTP ${error.status}，请检查 monitor 服务后重试。`;
  }
  if (error instanceof SyntaxError) {
    return "站点接口未返回有效的配置数据，请检查 monitor 版本或反向代理。";
  }
  return "站点接口暂时无法连接，请检查网络后重试。";
}

function AccessError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-2">
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">
          无法读取站点配置
        </div>
        <p className="text-[13px] text-[var(--text-secondary)]">{siteConfigErrorMessage(error)}</p>
      </div>
      <button type="button" onClick={onRetry} className="control-button px-4 py-2 text-[13px] font-medium">
        重试
      </button>
    </div>
  );
}

function PrivateSiteGate() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-elev)] text-[var(--text-tertiary)]">
        <Lock size={22} strokeWidth={2} />
      </div>
      <div className="space-y-2">
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">站点已设为私有</div>
        <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
          登录后即可查看节点数据。
        </p>
      </div>
      <a
        href="/admin"
        target="_blank"
        rel="noopener noreferrer"
        className="control-button px-4 py-2 text-[13px] font-medium"
      >
        前往登录
      </a>
    </div>
  );
}
