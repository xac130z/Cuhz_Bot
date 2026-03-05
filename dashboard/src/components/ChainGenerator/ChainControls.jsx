import { Maximize2, ArrowUpDown } from "lucide-react";

export function ChainControls({ scale, setScale, offsetY, setOffsetY }) {
  return (
    <div className="mt-6">
      <h3 className="text-lg font-bold text-white">Adjustments</h3>
      <p className="text-xs text-white/40 mt-1">Fine-tune the chain overlay</p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
        <label className="block">
          <div className="flex items-center gap-2 mb-3">
            <Maximize2 size={14} className="text-[#00f5ff]" />
            <span className="text-sm font-medium text-white/80">
              Chain Size
            </span>
            <span className="ml-auto text-xs text-white/40">
              {Math.round(scale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.25"
            step="0.01"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full accent-[#b24bf3]"
          />
        </label>

        <label className="block">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpDown size={14} className="text-[#00f5ff]" />
            <span className="text-sm font-medium text-white/80">
              Vertical Position
            </span>
            <span className="ml-auto text-xs text-white/40">
              {offsetY > 0 ? "+" : ""}
              {Math.round(offsetY * 100)}
            </span>
          </div>
          <input
            type="range"
            min="-0.12"
            max="0.12"
            step="0.005"
            value={offsetY}
            onChange={(e) => setOffsetY(parseFloat(e.target.value))}
            className="w-full accent-[#b24bf3]"
          />
        </label>
      </div>
    </div>
  );
}
