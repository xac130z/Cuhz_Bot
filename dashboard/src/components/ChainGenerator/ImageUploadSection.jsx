import { Upload, Loader2 } from "lucide-react";
import { useRef } from "react";

export function ImageUploadSection({ handleFileChange, uploading }) {
  const inputRef = useRef(null);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full group relative rounded-2xl border-2 border-dashed border-white/15 hover:border-[#00f5ff]/50 transition-all duration-300 p-6 flex flex-col items-center justify-center gap-3 backdrop-blur-sm cursor-pointer"
        style={{ background: "rgba(15,23,42,0.6)" }}
      >
        {uploading ? (
          <>
            <Loader2 size={28} className="text-[#00f5ff] animate-spin" />
            <span className="text-sm text-white/70">Uploading…</span>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#00f5ff]/20 to-[#b24bf3]/20 flex items-center justify-center group-hover:from-[#00f5ff]/30 group-hover:to-[#b24bf3]/30 transition-all">
              <Upload size={22} className="text-[#00f5ff]" />
            </div>
            <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">
              Upload Photo
            </span>
            <span className="text-xs text-white/40">
              Click or drop an image
            </span>
          </>
        )}
      </button>
    </div>
  );
}
