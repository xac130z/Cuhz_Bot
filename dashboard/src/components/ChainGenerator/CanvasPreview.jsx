import { Move } from "lucide-react";

export function CanvasPreview({
  canvasRef,
  sourceUrl,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasPointerCancel,
}) {
  return (
    <div className="relative">
      {/* Hero glow behind the preview */}
      <div
        className="absolute -inset-4 rounded-3xl blur-2xl opacity-40 -z-10"
        style={{
          background:
            "conic-gradient(from 180deg, #00f5ff, #b24bf3, #ff1493, #00f5ff)",
        }}
      />

      <div
        className="rounded-3xl border border-white/10 backdrop-blur-md overflow-hidden"
        style={{ background: "rgba(15,23,42,0.8)" }}
      >
        {/* Title bar */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Preview</h2>
          {sourceUrl && (
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Move size={12} />
              Drag to reposition
            </div>
          )}
        </div>

        {/* Canvas area */}
        <div className="p-4">
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerCancel}
            className="w-full h-auto rounded-2xl"
            style={
              sourceUrl ? { touchAction: "none", cursor: "grab" } : undefined
            }
          />
        </div>

        {/* Tip area */}
        <div className="px-5 pb-4">
          <div
            className="rounded-xl p-3 text-center text-xs text-white/50"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            {sourceUrl
              ? "💡 Drag the photo to reposition, use sliders to zoom"
              : "🎨 Upload a photo or generate with AI to get started"}
          </div>
        </div>
      </div>
    </div>
  );
}
