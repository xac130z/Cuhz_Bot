"use client";
import { useTwitchAuth } from "@/utils/useTwitchAuth";
import { startTwitchLogin } from "@/utils/startTwitchLogin";
// ADD: admin generations list dependencies
import { useState, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

export default function AdminPage() {
  const { user, loading, logout } = useTwitchAuth();
  const notAdmin = !loading && user && user.role !== "admin";
  const queryClient = useQueryClient();

  // ADD: Filters state for Generations view
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("all"); // all | ai | upload
  const [style, setStyle] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd
  const [dateTo, setDateTo] = useState("");

  // ADD: Users list filters
  const [userQ, setUserQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all"); // all | user | streamer | admin
  const [planFilter, setPlanFilter] = useState("all"); // all | pro | free

  // Track per-row pending changes for users table
  const [changes, setChanges] = useState({}); // { [id]: { role?, ai_limit_override? } }

  const handleChange = (id, field, value) => {
    setChanges((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
  };

  // ADD: Infinite query for recent generations (admin only)
  const {
    data: gensData,
    isLoading: gensLoading,
    isError: gensError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchGens,
  } = useInfiniteQuery({
    queryKey: ["admin-generations", { q, method, style, dateFrom, dateTo }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (q) params.set("q", q);
      if (method !== "all") params.set("method", method);
      if (style) params.set("style", style);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/generations?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin generations failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    enabled: !!user && user.role === "admin",
  });

  const gensItems = useMemo(
    () => (gensData?.pages || []).flatMap((p) => p.items || []),
    [gensData],
  );

  // ADD: Infinite query for users (admin only)
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    fetchNextPage: fetchNextUsers,
    hasNextPage: hasNextUsers,
    isFetchingNextPage: fetchingNextUsers,
    refetch: refetchUsers,
  } = useInfiniteQuery({
    queryKey: ["admin-users", { userQ, roleFilter, planFilter }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (userQ) params.set("q", userQ);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (planFilter !== "all") params.set("plan", planFilter);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin users failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    enabled: !!user && user.role === "admin",
  });

  const userItems = useMemo(
    () => (usersData?.pages || []).flatMap((p) => p.items || []),
    [usersData],
  );

  // Mutation to save a user's changes
  const saveUserMutation = useMutation({
    mutationFn: async ({ id, patch }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Update failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Saved changes");
      // Clear local change cache and refetch users
      setChanges({});
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => {
      console.error(err);
      toast.error("Could not save changes");
    },
  });

  // ADD: Bot Info query for Tiers and AI status
  const {
    data: botInfoData,
    isLoading: botInfoLoading,
    isError: botInfoError,
    refetch: refetchBotInfo,
  } = useQuery({
    queryKey: ["admin-bot-info"],
    queryFn: async () => {
      // The Next.js/Vite config may not proxy this automatically, so we'll fetch direct to port 3000 where the Bot runs or rely on the proxy.
      // Assuming localhost:3000 since they run concurrently.
      const res = await fetch("http://localhost:3000/api/system-status");
      if (!res.ok) {
        throw new Error(`Bot info failed: [${res.status}]`);
      }
      return res.json();
    },
    enabled: !!user && user.role === "admin",
    refetchInterval: 10000 // refresh every 10 seconds
  });

  const [errQ, setErrQ] = useState("");
  const [errScope, setErrScope] = useState("");
  const [errCode, setErrCode] = useState("");
  const [errFrom, setErrFrom] = useState("");
  const [errTo, setErrTo] = useState("");

  const {
    data: errsData,
    isLoading: errsLoading,
    isError: errsError,
    fetchNextPage: fetchNextErrs,
    hasNextPage: hasNextErrs,
    isFetchingNextPage: fetchingNextErrs,
    refetch: refetchErrs,
  } = useInfiniteQuery({
    queryKey: ["admin-errors", { errQ, errScope, errCode, errFrom, errTo }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (errQ) params.set("q", errQ);
      if (errScope) params.set("scope", errScope);
      if (errCode) params.set("code", errCode);
      if (errFrom) params.set("dateFrom", errFrom);
      if (errTo) params.set("dateTo", errTo);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/errors?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin errors failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    enabled: !!user && user.role === "admin",
  });

  const errItems = useMemo(
    () => (errsData?.pages || []).flatMap((p) => p.items || []),
    [errsData],
  );

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
        }}
      />

      <div className="max-w-[1200px] mx-auto px-6 py-10">
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img
              src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
              alt="Planet Cuhz logo"
              className="h-10 w-auto rounded-sm"
            />
            <span className="text-lg font-semibold tracking-wide">Admin</span>
          </a>

          {loading ? (
            <div className="px-4 py-2 rounded-xl border border-white/15">
              Loading...
            </div>
          ) : user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {user.profile_image_url && (
                  <img
                    src={user.profile_image_url}
                    alt={user.display_name || user.username}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-sm">
                  {user.display_name || user.username}
                  {user.role === "admin" && (
                    <span className="ml-1 text-xs bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] text-black px-2 py-0.5 rounded-full font-semibold">
                      ADMIN
                    </span>
                  )}
                </span>
              </div>
              <button
                onClick={logout}
                className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={startTwitchLogin}
              className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors"
            >
              Login with Twitch
            </button>
          )}
        </header>

        {notAdmin && (
          <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/80">
            You are signed in, but not an admin. If you should have access, ask
            an existing admin to promote your account.
          </div>
        )}

        {/* Users (Admin) */}
        {user && user.role === "admin" && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Users</h2>

            {/* Filters */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              <input
                value={userQ}
                onChange={(e) => setUserQ(e.target.value)}
                placeholder="Search users (name or twitch id)"
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="all">All roles</option>
                <option value="user">User</option>
                <option value="streamer">Streamer</option>
                <option value="admin">Admin</option>
              </select>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="all">Any plan</option>
                <option value="pro">Pro</option>
                <option value="free">Free</option>
              </select>
              <div className="md:col-span-2 flex gap-2">
                <button
                  onClick={() => refetchUsers()}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30"
                >
                  Apply
                </button>
                {hasNextUsers && (
                  <button
                    onClick={() => fetchNextUsers()}
                    disabled={fetchingNextUsers}
                    className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                  >
                    {fetchingNextUsers ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="mt-4 overflow-x-auto">
              {usersLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : usersError ? (
                <div className="text-sm text-red-300">Could not load users</div>
              ) : userItems.length === 0 ? (
                <div className="text-sm text-white/70">No results</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="text-left py-2 pr-3">User</th>
                      <th className="text-left py-2 pr-3">Twitch</th>
                      <th className="text-left py-2 pr-3">Role</th>
                      <th className="text-left py-2 pr-3">AI Limit</th>
                      <th className="text-left py-2 pr-3">Plan</th>
                      <th className="text-left py-2 pr-3">Totals</th>
                      <th className="text-left py-2 pr-3">Today</th>
                      <th className="text-left py-2 pr-3">Last</th>
                      <th className="text-left py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userItems.map((u) => {
                      const c = changes[u.id] || {};
                      const roleVal = c.role ?? u.role;
                      const limVal =
                        c.ai_limit_override ?? u.ai_limit_override ?? "";
                      return (
                        <tr key={u.id} className="border-t border-white/10">
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              {u.profile_image_url && (
                                <img
                                  src={u.profile_image_url}
                                  alt={u.display_name || u.username}
                                  className="w-8 h-8 rounded-full"
                                />
                              )}
                              <div>
                                <div>{u.display_name || u.username || "-"}</div>
                                <div className="text-white/50 text-xs">
                                  id: {u.id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {u.twitch_id || ""}
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={roleVal}
                              onChange={(e) =>
                                handleChange(u.id, "role", e.target.value)
                              }
                              className="rounded-xl border border-white/15 bg-transparent px-2 py-1"
                            >
                              <option value="user">User</option>
                              <option value="streamer">Streamer</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              inputMode="numeric"
                              placeholder="(null)"
                              value={limVal}
                              onChange={(e) =>
                                handleChange(
                                  u.id,
                                  "ai_limit_override",
                                  e.target.value,
                                )
                              }
                              className="w-24 rounded-xl border border-white/15 bg-transparent px-2 py-1"
                              min={0}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="uppercase">
                                {u.plan === "pro" ? "PRO" : "FREE"}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 pr-3">{u.total_generations}</td>
                          <td className="py-2 pr-3">{u.generations_today}</td>
                          <td className="py-2 pr-3">
                            {u.last_generated_at
                              ? new Date(u.last_generated_at).toLocaleString()
                              : "-"}
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              onClick={() =>
                                saveUserMutation.mutate({
                                  id: u.id,
                                  patch: changes[u.id] || {},
                                })
                              }
                              disabled={
                                !changes[u.id] || saveUserMutation.isLoading
                              }
                              className="px-3 py-1 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Global Marketing Messages</h2>
            <div className="mt-4 grid gap-3">
              <input
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
                placeholder="Message (rotates every 30m)"
                disabled={notAdmin}
              />
              <input
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
                placeholder="Another message"
                disabled={notAdmin}
              />
              <button
                className="mt-2 w-fit px-4 py-2 rounded-xl font-semibold text-black disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
                }}
                disabled={notAdmin}
              >
                Save
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Global Commands</h2>
            <div className="mt-4 grid gap-3">
              <textarea
                rows={3}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
                placeholder="!cuhz response"
                disabled={notAdmin}
              />
              <textarea
                rows={3}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
                placeholder="!chain response"
                disabled={notAdmin}
              />
              <textarea
                rows={3}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
                placeholder="!discord response"
                disabled={notAdmin}
              />
              <button
                className="mt-2 w-fit px-4 py-2 rounded-xl font-semibold text-black disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
                }}
                disabled={notAdmin}
              >
                Save
              </button>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-xl font-semibold">Channels Using CuhzBot</h2>
          <div className="mt-4 text-sm text-white/80">Coming soon</div>
        </section>

        {/* ADD: Recent Generations (Admin) */}
        {user && user.role === "admin" && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Recent Generations</h2>

            {/* Filters */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by user (name or twitch id)"
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="all">All methods</option>
                <option value="ai">AI</option>
                <option value="upload">Upload</option>
              </select>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              >
                <option value="">Any style</option>
                <option value="rainbow">Rainbow</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="iced">Iced</option>
                <option value="custom">Custom</option>
              </select>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2"
                />
                <button
                  onClick={() => refetchGens()}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* List */}
            <div className="mt-4 overflow-x-auto">
              {gensLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : gensError ? (
                <div className="text-sm text-red-300">
                  Could not load generations
                </div>
              ) : gensItems.length === 0 ? (
                <div className="text-sm text-white/70">No results</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="text-left py-2 pr-3">Image</th>
                      <th className="text-left py-2 pr-3">User</th>
                      <th className="text-left py-2 pr-3">Method</th>
                      <th className="text-left py-2 pr-3">Style</th>
                      <th className="text-left py-2 pr-3">Prompt</th>
                      <th className="text-left py-2 pr-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gensItems.map((g) => (
                      <tr key={g.id} className="border-t border-white/10">
                        <td className="py-2 pr-3">
                          <a
                            href={g.image_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={g.image_url}
                              alt={g.prompt || "generation"}
                              className="w-16 h-16 object-cover rounded"
                            />
                          </a>
                        </td>
                        <td className="py-2 pr-3">
                          <div>{g.display_name || g.username || "-"}</div>
                          <div className="text-white/50 text-xs">
                            {g.user_twitch_id || ""}
                          </div>
                        </td>
                        <td className="py-2 pr-3 uppercase">{g.method}</td>
                        <td className="py-2 pr-3">{g.style || "-"}</td>
                        <td
                          className="py-2 pr-3 max-w-[360px] truncate"
                          title={g.prompt || ""}
                        >
                          {g.prompt || ""}
                        </td>
                        <td className="py-2 pr-3">
                          {g.created_at
                            ? new Date(g.created_at).toLocaleString()
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {hasNextPage && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ADD: System Status / Bot Health (Admin) */}
        {user && user.role === "admin" && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                📡 Tri-Brain AI & Bot Tiers
              </h2>
              <button
                onClick={() => refetchBotInfo()}
                disabled={botInfoLoading}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5 transition-colors"
              >
                {botInfoLoading ? "Syncing..." : "Refresh Status"}
              </button>
            </div>

            {botInfoError ? (
              <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200">
                Could not connect to Bot core (Is `bot.js` running on port 3000?)
              </div>
            ) : botInfoLoading && !botInfoData ? (
              <div className="mt-4 text-sm text-white/50">Fetching bot intelligence...</div>
            ) : botInfoData ? (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* AI Status Panel */}
                <div>
                  <h3 className="text-sm font-semibold text-white/70 tracking-wide uppercase mb-3">Tri-Brain Status</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${botInfoData.ai?.gemini ? 'bg-[#00f5ff] shadow-[0_0_8px_#00f5ff]' : 'bg-red-500'}`} />
                        <div>
                          <div className="font-medium text-sm">The Eyes (Gemini 2.0 Flash)</div>
                          <div className="text-xs text-white/50">{botInfoData.ai?.gemini ? 'API Key Active' : 'Offline - Missing Key'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${botInfoData.ai?.claude ? 'bg-[#b24bf3] shadow-[0_0_8px_#b24bf3]' : 'bg-red-500'}`} />
                        <div>
                          <div className="font-medium text-sm">The Brain (Claude 3.5 Sonnet)</div>
                          <div className="text-xs text-white/50">{botInfoData.ai?.claude ? 'API Key Active' : 'Offline - Missing Key'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${botInfoData.ai?.qwen ? 'bg-[#ff1493] shadow-[0_0_8px_#ff1493]' : 'bg-red-500'}`} />
                        <div>
                          <div className="font-medium text-sm">The Hands (Qwen 2.5 Coder)</div>
                          <div className="text-xs text-white/50">{botInfoData.ai?.qwen ? 'API Key Active' : 'Offline - Missing Key'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tiers Panel */}
                <div>
                  <h3 className="text-sm font-semibold text-white/70 tracking-wide uppercase mb-3">Active Channel Tiers</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {botInfoData.tiers && Object.entries(botInfoData.tiers).map(([channel, tier]) => {
                      let badgeColor = "bg-white/10 text-white";
                      if (tier === 'premium') badgeColor = "bg-[#ffd700]/20 text-[#ffd700] border-[#ffd700]/50";
                      if (tier === 'pro') badgeColor = "bg-[#00f5ff]/20 text-[#00f5ff] border-[#00f5ff]/50";

                      return (
                        <div key={channel} className="p-3 rounded-xl border border-white/10 bg-black/40 flex flex-col justify-center">
                          <div className="font-medium text-sm truncate">#{channel}</div>
                          <div className="mt-1">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {tier}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

              </div>
            ) : null}
          </section>
        )}

        {/* ADD: Error Logs (Admin) */}
        {user && user.role === "admin" && (
          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Error Logs</h2>

            {/* Filters */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
              <input
                value={errQ}
                onChange={(e) => setErrQ(e.target.value)}
                placeholder="Search message / code / scope"
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <input
                value={errScope}
                onChange={(e) => setErrScope(e.target.value)}
                placeholder="Scope (e.g. ai_generate)"
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <input
                value={errCode}
                onChange={(e) => setErrCode(e.target.value)}
                placeholder="Code (e.g. UNCAUGHT)"
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <input
                type="date"
                value={errFrom}
                onChange={(e) => setErrFrom(e.target.value)}
                className="rounded-xl border border-white/15 bg-transparent px-3 py-2"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={errTo}
                  onChange={(e) => setErrTo(e.target.value)}
                  className="flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2"
                />
                <button
                  onClick={() => refetchErrs()}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30"
                >
                  Apply
                </button>
              </div>
            </div>

            {/* List */}
            <div className="mt-4 overflow-x-auto">
              {errsLoading ? (
                <div className="text-sm text-white/70">Loading…</div>
              ) : errsError ? (
                <div className="text-sm text-red-300">
                  Could not load errors
                </div>
              ) : errItems.length === 0 ? (
                <div className="text-sm text-white/70">No results</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="text-left py-2 pr-3">When</th>
                      <th className="text-left py-2 pr-3">Scope</th>
                      <th className="text-left py-2 pr-3">Code</th>
                      <th className="text-left py-2 pr-3">Message</th>
                      <th className="text-left py-2 pr-3">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errItems.map((e) => (
                      <tr key={e.id} className="border-t border-white/10">
                        <td className="py-2 pr-3">
                          {e.created_at
                            ? new Date(e.created_at).toLocaleString()
                            : ""}
                        </td>
                        <td className="py-2 pr-3">{e.scope || ""}</td>
                        <td className="py-2 pr-3">{e.code || ""}</td>
                        <td
                          className="py-2 pr-3 max-w-[420px] truncate"
                          title={e.message || ""}
                        >
                          {e.message || ""}
                        </td>
                        <td className="py-2 pr-3">
                          <div>{e.display_name || e.username || "-"}</div>
                          <div className="text-white/50 text-xs">
                            {e.user_twitch_id || ""}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {hasNextErrs && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => fetchNextErrs()}
                  disabled={fetchingNextErrs}
                  className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                >
                  {fetchingNextErrs ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
