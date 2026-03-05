import { useQuery } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";

export function useUsageQuery({ user, clientId, authLoading }) {
  const {
    data: usage,
    isLoading: usageLoading,
    error: usageError,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ["ai-usage", user?.id || null, clientId || null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!user && clientId) params.set("clientId", clientId);

      const url = params.toString()
        ? `/api/chain/usage?${params.toString()}`
        : "/api/chain/usage";

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data?.error ||
          `When fetching ${url}, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return res.json();
    },
    enabled:
      typeof window !== "undefined" && (Boolean(user) || Boolean(clientId)),
    retry: 1,
  });

  useEffect(() => {
    if (usageError) {
      console.error(usageError);
    }
  }, [usageError]);

  const usageLine = useMemo(() => {
    if (authLoading || usageLoading) return null;
    if (!usage?.ok) return null;

    if (usage.isUnlimited) {
      return "Unlimited generations";
    }

    const used = Number(usage.todayCount || 0);
    const limit = Number(usage.dailyLimit || 10);
    const remaining = Number.isFinite(usage.remaining)
      ? usage.remaining
      : Math.max(0, limit - used);

    return `${used}/${limit} used today • ${remaining} left`;
  }, [authLoading, usageLoading, usage]);

  return { usage, usageLoading, usageError, refetchUsage, usageLine };
}
