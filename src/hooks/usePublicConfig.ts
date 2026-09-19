import { useQuery } from "@tanstack/react-query";
import { getPublic } from "@/services/api";
import type { PublicConfig } from "@/types/models";

export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ["public"],
    queryFn: ({ signal }) => getPublic({ signal }),
    staleTime: 60_000,
  });
}
