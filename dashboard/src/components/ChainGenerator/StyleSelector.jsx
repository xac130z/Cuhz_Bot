import { HexColorPicker } from "react-colorful";

export function StyleSelector({
  style,
  setStyle,
  customColor,
  setCustomColor,
}) {
  const styleOptions = [
    {
      id: "rainbow",
      label: "Rainbow",
      tag: "OG",
      gradient: "linear-gradient(135deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
      borderActive: "#b24bf3",
    },
    {
      id: "gold",
      label: "Gold",
      tag: null,
      gradient: "linear-gradient(135deg,#ffd700,#f59e0b,#fbbf24)",
      borderActive: "#ffd700",
    },
    {
      id: "silver",
      label: "Silver",
      tag: null,
      gradient: "linear-gradient(135deg,#d1d5db,#9ca3af,#e5e7eb)",
      borderActive: "#d1d5db",
    },
    {
      id: "iced",
      label: "Iced Out",
      tag: "✨",
      gradient: "linear-gradient(135deg,#00f5ff,#818cf8,#c084fc)",
      borderActive: "#00f5ff",
    },
    {
      id: "custom",
      label: "Custom",
      tag: null,
      gradient: null,
      borderActive: customColor,
    },
  ];

  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold text-white">Chain Style</h3>
      <p className="text-xs text-white/40 mt-1">Pick your vibe</p>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
        {styleOptions.map((opt) => {
          const isActive = style === opt.id;
          const previewBg =
            opt.gradient ||
            `linear-gradient(135deg,${customColor},${customColor}88)`;

          return (
            <button
              key={opt.id}
              onClick={() => setStyle(opt.id)}
              className="relative rounded-2xl p-[1px] transition-all duration-300 group"
              style={{
                background: isActive
                  ? opt.borderActive
                  : "rgba(255,255,255,0.08)",
                boxShadow: isActive ? `0 0 20px ${opt.borderActive}40` : "none",
              }}
            >
              <div
                className="rounded-2xl px-3 py-3 flex flex-col items-center gap-2 backdrop-blur-sm transition-all"
                style={{ background: "rgba(10,14,39,0.9)" }}
              >
                <div
                  className="w-8 h-8 rounded-full"
                  style={{ background: previewBg }}
                />
                <span className="text-xs font-medium text-white/90">
                  {opt.label}
                </span>
                {opt.tag && (
                  <span className="absolute -top-1 -right-1 text-[10px] bg-[#b24bf3] text-white px-1.5 py-0.5 rounded-full font-bold">
                    {opt.tag}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {style === "custom" && (
        <div
          className="mt-5 rounded-2xl border border-white/10 backdrop-blur-md p-5"
          style={{ background: "rgba(15,23,42,0.6)" }}
        >
          <div className="text-sm text-white/80 mb-3 font-medium">
            Pick your color
          </div>
          <div className="flex items-start gap-5">
            <HexColorPicker color={customColor} onChange={setCustomColor} />
            <div className="text-sm text-white/80 flex flex-col gap-3">
              <div
                className="w-16 h-16 rounded-xl border border-white/10"
                style={{ background: customColor }}
              />
              <input
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="w-[140px] rounded-xl border border-white/10 backdrop-blur-sm px-3 py-2 text-sm focus:outline-none focus:border-[#b24bf3]/50 transition-colors"
                style={{ background: "rgba(15,23,42,0.6)" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
