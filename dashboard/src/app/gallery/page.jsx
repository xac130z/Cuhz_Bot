"use client";
import { useEffect, useMemo, useCallback, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useTwitchAuth } from "@/utils/useTwitchAuth";
import { startTwitchLogin } from "@/utils/startTwitchLogin";

export default function GalleryPage() {
  const { user, loading, logout } = useTwitchAuth();
  const queryClient = useQueryClient();

  const [methodFilter, setMethodFilter] = useState("all"); // all | ai | upload
  const [styleFilter, setStyleFilter] = useState("all"); // all | rainbow | gold | silver | iced | custom

  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
    }),
    [],
  );

  const queryKey = useMemo(
    () => ["my-generations", { methodFilter, styleFilter }],
    [methodFilter, styleFilter],
  );

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (pageParam) params.set("cursor", String(pageParam));

      if (methodFilter !== "all") params.set("method", methodFilter);
      if (styleFilter !== "all") params.set("style", styleFilter);

      const res = await fetch(`/api/chain/generations?${params.toString()}`);
      if (!res.ok) {
        throw new Error(
          `When fetching /api/chain/generations, the response was [${res.status}] ${res.statusText}`,
        );
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: !!user,
  });

  const deleteGeneration = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`/api/chain/generations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["my-generations"] });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not delete");
    },
  });

  const shareToDiscord = useMutation({
    mutationFn: async (generationId) => {
      const res = await fetch("/api/integrations/discord/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to share to Discord");
      }
      return res.json();
    },
    onSuccess: () => toast.success("Shared to Discord"),
    onError: (e) => {
      const msg = String(e?.message || "");
      if (
        msg.toLowerCase().includes("webhook") ||
        msg.toLowerCase().includes("not configured")
      ) {
        toast.error("Add a Discord webhook in Dashboard → Discord Integration");
      } else {
        toast.error("Could not share to Discord");
      }
    },
  });

  useEffect(() => {
    if (isError) {
      toast.error("Could not load your gallery");
    }
  }, [isError]);

  const items = (data?.pages || []).flatMap((p) => p.items || []);

  const onCopy = useCallback(async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch (e) {
      console.error(e);
      toast.error("Could not copy link");
    }
  }, []);

  const formatStyle = (s) => {
    if (!s) return null;
    const lower = String(s).toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  if (loading) {
    return (
      <div
        className="min-h-screen text-white"
        style={{ backgroundColor: "#0a0e27" }}
      >
        <div className="absolute inset-0 -z-10" style={bgStyle} />
        <div className="max-w-[1200px] mx-auto px-6 py-10">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="min-h-screen text-white"
        style={{ backgroundColor: "#0a0e27" }}
      >
        <div className="absolute inset-0 -z-10" style={bgStyle} />
        <div className="max-w-[1200px] mx-auto px-6 py-10">
          <header className="flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
              <img
                src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
                alt="Planet Cuhz logo"
                className="h-10 w-auto rounded-sm"
              />
              <span className="text-lg font-semibold tracking-wide">
                My Gallery
              </span>
            </a>
            <button
              onClick={startTwitchLogin}
              className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors"
            >
              Login with Twitch
            </button>
          </header>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
            Please sign in to view your creations.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div className="absolute inset-0 -z-10" style={bgStyle} />

      <div className="max-w-[1200px] mx-auto px-6 py-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img
              src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
              alt="Planet Cuhz logo"
              className="h-10 w-auto rounded-sm"
            />
            <span className="text-lg font-semibold tracking-wide">
              My Gallery
            </span>
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/chain-generator"
              className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
            >
              Create More
            </a>
            <button
              onClick={logout}
              className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Filters */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-2">
              <span className="text-white/70 text-xs">Method</span>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="all">All</option>
                <option value="ai">AI</option>
                <option value="upload">Upload</option>
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-white/70 text-xs">Style</span>
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="all">All</option>
                <option value="rainbow">Rainbow</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="iced">Iced</option>
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>

          <div className="mt-3 text-xs text-white/60">
            Tip: Filters update automatically.
          </div>
        </div>

        {/* Grid */}
        <section className="mt-8">
          {isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              Loading your gallery…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="text-white/80">
                No creations yet. Try the generator!
              </div>
              <a
                href="/chain-generator"
                className="inline-block mt-4 px-5 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors"
              >
                Open Chain Generator
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(items || []).map((item) => {
                const styleLabel = formatStyle(item.style);
                const canDelete = Boolean(user);

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden group"
                  >
                    <div className="aspect-square bg-black/20 overflow-hidden">
                      <img
                        src={item.image_url}
                        alt={item.prompt || "Generated image"}
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-white/60">
                          {item.method}
                          {styleLabel && (
                            <span className="ml-2 inline-block text-[10px] uppercase bg-white/10 border border-white/15 rounded-full px-2 py-0.5 text-white/80">
                              {styleLabel}
                            </span>
                          )}
                        </div>
                        {item.prompt && (
                          <div
                            className="mt-1 text-sm line-clamp-2 text-white/85"
                            title={item.prompt}
                          >
                            {item.prompt}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <a
                          href={item.image_url}
                          download
                          className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => onCopy(item.image_url)}
                          className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs"
                        >
                          Copy link
                        </button>
                        <button
                          onClick={() => shareToDiscord.mutate(item.id)}
                          disabled={shareToDiscord.isLoading}
                          className="px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs disabled:opacity-50"
                        >
                          Share to Discord
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => {
                              const ok = window.confirm(
                                "Delete this image from your gallery?",
                              );
                              if (!ok) return;
                              deleteGeneration.mutate(item.id);
                            }}
                            disabled={deleteGeneration.isLoading}
                            className="px-3 py-1.5 rounded-lg border border-red-400/40 hover:border-red-300 text-xs disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Load more */}
        {hasNextPage && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="px-5 py-3 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-60"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
