import { ZoomIn, MoveHorizontal, MoveVertical, RotateCcw } from "lucide-react";

export function BackgroundPositionControls({
  sourceUrl,
  bgScale,
  setBgScale,
  bgOffsetX,
  setBgOffsetX,
  bgOffsetY,
  setBgOffsetY,
  resetPosition,
}) {
  if (!sourceUrl) return null;

  return (
    <div
      className="mt-6 rounded-2xl border border-white/10 backdrop-blur-md p-5"
      style={{ background: "rgba(15,23,42,0.6)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">
            Background Position
          </div>
          <div className="text-xs text-white/40 mt-1">
            Zoom and move the photo so the chain sits right
          </div>
        </div>
        <button
          type="button"
          onClick={resetPosition}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/70 hover:text-white transition-colors border border-white/10 hover:border-white/25 backdrop-blur-sm"
          style={{ background: "rgba(15,23,42,0.6)" }}
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        <label className="block">
          <div className="flex items-center gap-2 mb-3">
            <ZoomIn size={12} className="text-[#00f5ff]" />
            <span className="text-xs font-medium text-white/70">Zoom</span>
            <span className="ml-auto text-xs text-white/40">
              {Math.round(bgScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.9"
            max="1.6"
            step="0.01"
            value={bgScale}
            onChange={(e) => setBgScale(parseFloat(e.target.value))}
            className="w-full accent-[#00f5ff]"
          />
        </label>

        <label className="block">
          <div className="flex items-center gap-2 mb-3">
            <MoveHorizontal size={12} className="text-[#00f5ff]" />
            <span className="text-xs font-medium text-white/70">
              Left / Right
            </span>
            <span className="ml-auto text-xs text-white/40">
              {bgOffsetX > 0 ? "+" : ""}
              {Math.round(bgOffsetX * 100)}
            </span>
          </div>
          <input
            type="range"
            min="-0.35"
            max="0.35"
            step="0.01"
            value={bgOffsetX}
            onChange={(e) => setBgOffsetX(parseFloat(e.target.value))}
            className="w-full accent-[#00f5ff]"
          />
        </label>

        <label className="block">
          <div className="flex items-center gap-2 mb-3">
            <MoveVertical size={12} className="text-[#00f5ff]" />
            <span className="text-xs font-medium text-white/70">Up / Down</span>
            <span className="ml-auto text-xs text-white/40">
              {bgOffsetY > 0 ? "+" : ""}
              {Math.round(bgOffsetY * 100)}
            </span>
          </div>
          <input
            type="range"
            min="-0.35"
            max="0.35"
            step="0.01"
            value={bgOffsetY}
            onChange={(e) => setBgOffsetY(parseFloat(e.target.value))}
            className="w-full accent-[#00f5ff]"
          />
        </label>
      </div>
    </div>
  );
}
