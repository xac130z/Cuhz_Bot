"use client";
import { useState } from "react";
import { useTwitchAuth } from "@/utils/useTwitchAuth";

export default function PromoteFirstAdminPage() {
  const { user, loading } = useTwitchAuth();
  const [promoting, setPromoting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handlePromoteToAdmin = async () => {
    if (!user) {
      setError("You must be logged in to promote yourself to admin");
      return;
    }

    setPromoting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/promote-first-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to promote to admin");
      }

      setSuccess(true);
      // Refresh the page after a delay to show the updated user role
      setTimeout(() => {
        window.location.href = "/admin";
      }, 2000);
    } catch (err) {
      console.error("Error promoting to admin:", err);
      setError(err.message);
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e27] text-white flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e27] text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-3xl font-bold mb-6">Promote First Admin</h1>

          <div className="space-y-6">
            <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
              <h2 className="text-yellow-400 font-semibold mb-2">
                ⚠️ Important Security Notice
              </h2>
              <p className="text-sm text-yellow-200">
                This page allows you to promote yourself to admin status. This
                should only be used once to create the first admin user. After
                you become admin, you should delete this page for security
                reasons.
              </p>
            </div>

            {!user ? (
              <div className="text-center">
                <p className="mb-4">
                  You must be logged in with Twitch to promote yourself to
                  admin.
                </p>
                {/* UPDATED: route to page-based redirect */}
                <a
                  href="/auth/twitch"
                  className="inline-block px-6 py-3 rounded-xl font-semibold text-black"
                  style={{
                    background:
                      "linear-gradient(90deg, #00f5ff, #b24bf3, #ff1493, #ffd700)",
                  }}
                >
                  Login with Twitch
                </a>
              </div>
            ) : user.role === "admin" ? (
              <div className="text-center">
                <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 mb-4">
                  <h2 className="text-green-400 font-semibold mb-2">
                    ✅ Already Admin
                  </h2>
                  <p className="text-sm text-green-200">
                    You are already an admin! You can now delete this page for
                    security.
                  </p>
                </div>
                <a
                  href="/admin"
                  className="inline-block px-6 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors"
                >
                  Go to Admin Panel
                </a>
              </div>
            ) : success ? (
              <div className="text-center">
                <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 mb-4">
                  <h2 className="text-green-400 font-semibold mb-2">
                    ✅ Success!
                  </h2>
                  <p className="text-sm text-green-200">
                    You have been promoted to admin. Redirecting to admin
                    panel...
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="mb-6">
                  <p className="text-lg mb-2">Current User:</p>
                  <div className="flex items-center justify-center gap-3">
                    {user.profile_image_url && (
                      <img
                        src={user.profile_image_url}
                        alt={user.display_name || user.username}
                        className="w-12 h-12 rounded-full"
                      />
                    )}
                    <div>
                      <div className="font-semibold">
                        {user.display_name || user.username}
                      </div>
                      <div className="text-sm text-white/60">
                        Role: {user.role}
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 mb-4">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <button
                  onClick={handlePromoteToAdmin}
                  disabled={promoting}
                  className="px-8 py-4 rounded-xl font-semibold text-black disabled:opacity-50"
                  style={{
                    background:
                      "linear-gradient(90deg, #00f5ff, #b24bf3, #ff1493, #ffd700)",
                  }}
                >
                  {promoting ? "Promoting..." : "Promote Me to Admin"}
                </button>

                <div className="mt-6 text-sm text-white/60">
                  <p>After becoming admin, you can:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>Generate unlimited AI images</li>
                    <li>Manage other users</li>
                    <li>View admin dashboard</li>
                    <li>Promote other users to admin or streamer roles</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
