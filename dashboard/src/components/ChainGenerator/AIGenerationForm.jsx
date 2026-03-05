import { Sparkles, Loader2 } from "lucide-react";

export function AIGenerationForm({
  handleGenerateAI,
  isGenerating,
  autoSaveToGallery,
  setAutoSaveToGallery,
  autoSaveAfterUpload,
  setAutoSaveAfterUpload,
  canAutoSave,
}) {
  const autoSaveLabel = canAutoSave
    ? "Auto-save AI to Gallery"
    : "Auto-save (sign in)";

  const autoSaveUploadLabel = canAutoSave
    ? "Auto-save uploads"
    : "Auto-save uploads (sign in)";

  return (
    <form onSubmit={handleGenerateAI} className="block">
      <div className="relative">
        <textarea
          name="prompt"
          rows={3}
          placeholder="a cool cat wearing sunglasses in space..."
          className="w-full rounded-2xl border border-white/10 focus:border-[#b24bf3]/50 backdrop-blur-sm p-4 text-sm text-white placeholder-white/30 focus:outline-none transition-colors resize-none"
          style={{ background: "rgba(15,23,42,0.6)" }}
        />
      </div>

      <button
        type="submit"
        disabled={isGenerating}
        className="mt-3 w-full px-5 py-3 rounded-2xl font-bold text-black disabled:opacity-50 transition-all duration-300 relative overflow-hidden group"
        style={{
          background: "linear-gradient(135deg,#00f5ff,#b24bf3 50%,#ff1493)",
          boxShadow: "0 0 30px rgba(178,75,243,0.3)",
        }}
      >
        <span className="relative z-10 flex items-center justify-center gap-2">
          {isGenerating ? (
            <>
              <Loader2
                size={18}
                style={{ animation: "cuhzSpin 1s linear infinite" }}
              />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Generate with AI
            </>
          )}
        </span>
      </button>

      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors">
          <input
            type="checkbox"
            checked={autoSaveToGallery}
            onChange={(e) => setAutoSaveToGallery(e.target.checked)}
            disabled={!canAutoSave}
            className="accent-[#b24bf3] w-3.5 h-3.5"
          />
          {autoSaveLabel}
        </label>

        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors">
          <input
            type="checkbox"
            checked={autoSaveAfterUpload}
            onChange={(e) => setAutoSaveAfterUpload(e.target.checked)}
            disabled={!canAutoSave}
            className="accent-[#b24bf3] w-3.5 h-3.5"
          />
          {autoSaveUploadLabel}
        </label>
      </div>
    </form>
  );
}
