import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useTwitchAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          `When fetching /api/auth/me, the response was [${response.status}] ${response.statusText}`,
        );
      }
      return response.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error(
          `When logging out, the response was [${response.status}] ${response.statusText}`,
        );
      }
      return response.json();
    },
    onSuccess: () => {
      // Clear cached user
      queryClient.invalidateQueries({ queryKey: ["me"] });
      // Hard refresh to reset all client state
      window.location.href = "/";
    },
    onError: (err) => {
      console.error(err);
      alert("Could not log out. Please try again.");
    },
  });

  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  return {
    user: data?.user ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    error,
    logout,
    refetch,
  };
}
