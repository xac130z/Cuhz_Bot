import {
  Download,
  Save,
  MessageCircle,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

const DISCORD_INVITE = "https://discord.gg/eNxDKkxQdN";

export function ActionButtons({
  sourceUrl,
  handleDownload,
  handleSaveToGallery,
  isSaving,
  error,
  lastSavedUrl,
}) {
  return (
    <div className="mt-6">
      {error && (
        <div
          className="mb-4 rounded-2xl border border-red-500/30 p-4 flex items-center gap-3"
          style={{ background: "rgba(239,68,68,0.08)" }}
        >
          <AlertCircle size={16} className="text-red-400 shrink-0" />
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      {lastSavedUrl && (
        <div
          className="mb-4 rounded-2xl border border-[#00f5ff]/30 p-4 flex items-center gap-3"
          style={{ background: "rgba(0,245,255,0.05)" }}
        >
          <Save size={16} className="text-[#00f5ff] shrink-0" />
          <span className="text-sm text-white/80">
            Saved!{" "}
            <a
              href="/gallery"
              className="text-[#00f5ff] hover:underline font-medium"
            >
              View in Gallery
            </a>
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleDownload}
          disabled={!sourceUrl}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-black disabled:opacity-40 transition-all duration-300"
          style={{
            background: sourceUrl
              ? "linear-gradient(135deg,#00f5ff,#b24bf3 50%,#ff1493)"
              : "rgba(255,255,255,0.1)",
            boxShadow: sourceUrl ? "0 0 30px rgba(178,75,243,0.3)" : "none",
            color: sourceUrl ? "black" : "rgba(255,255,255,0.3)",
          }}
        >
          <Download size={18} />
          Download
        </button>

        <button
          onClick={handleSaveToGallery}
          disabled={!sourceUrl || isSaving}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold border border-white/15 hover:border-[#b24bf3]/50 text-white disabled:opacity-40 transition-all duration-300 backdrop-blur-sm"
          style={{ background: "rgba(15,23,42,0.6)" }}
        >
          <Save size={18} />
          {isSaving ? "Saving…" : "Save to Gallery"}
        </button>

        <a
          href={DISCORD_INVITE}
          target="_blank"
          rel="noreferrer"
          className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold border border-white/15 hover:border-[#00f5ff]/50 text-white transition-all duration-300 backdrop-blur-sm"
          style={{ background: "rgba(15,23,42,0.6)" }}
        >
          <MessageCircle size={18} />
          Discord
          <ExternalLink size={12} className="text-white/40" />
        </a>
      </div>
    </div>
  );
}
