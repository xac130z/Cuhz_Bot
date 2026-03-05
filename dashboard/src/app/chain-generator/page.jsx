"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import useUpload from "@/utils/useUpload";
import { useTwitchAuth } from "@/utils/useTwitchAuth";
import { toast } from "sonner";
import { getClientId } from "@/utils/getClientId";
import { useChainCanvas } from "@/components/ChainGenerator/hooks/useChainCanvas";
import { useCanvasDrag } from "@/components/ChainGenerator/hooks/useCanvasDrag";
import { useUsageQuery } from "@/components/ChainGenerator/hooks/useUsageQuery";
import { useGenerateAI } from "@/components/ChainGenerator/hooks/useGenerateAI";
import { useSaveUpload } from "@/components/ChainGenerator/hooks/useSaveUpload";
import { Header } from "@/components/ChainGenerator/Header";
import { UserStatusBanner } from "@/components/ChainGenerator/UserStatusBanner";
import { ImageUploadSection } from "@/components/ChainGenerator/ImageUploadSection";
import { AIGenerationForm } from "@/components/ChainGenerator/AIGenerationForm";
import { StyleSelector } from "@/components/ChainGenerator/StyleSelector";
import { ChainControls } from "@/components/ChainGenerator/ChainControls";
import { BackgroundPositionControls } from "@/components/ChainGenerator/BackgroundPositionControls";
import { ActionButtons } from "@/components/ChainGenerator/ActionButtons";
import { CanvasPreview } from "@/components/ChainGenerator/CanvasPreview";

export default function ChainGeneratorPage() {
  const { user, loading: authLoading, logout } = useTwitchAuth();
  const [sourceUrl, setSourceUrl] = useState(null);
  const [style, setStyle] = useState("rainbow");
  const [customColor, setCustomColor] = useState("#00f5ff");
  const [scale, setScale] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [error, setError] = useState(null);
  const [upload, { loading: uploading }] = useUpload();
  const [activeTab, setActiveTab] = useState("upload");

  const [clientId, setClientId] = useState(null);

  const [bgScale, setBgScale] = useState(1);
  const [bgOffsetX, setBgOffsetX] = useState(0);
  const [bgOffsetY, setBgOffsetY] = useState(0);

  const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
  const [pendingAutoSave, setPendingAutoSave] = useState(false);
  const [pendingAutoSaveStyle, setPendingAutoSaveStyle] = useState(null);

  const [lastSavedUrl, setLastSavedUrl] = useState(null);
  const [autoSaveAfterUpload, setAutoSaveAfterUpload] = useState(false);

  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(ellipse 1200px 800px at 20% -10%, rgba(178,75,243,0.18), transparent), radial-gradient(ellipse 1000px 700px at 80% 0%, rgba(0,245,255,0.14), transparent), radial-gradient(ellipse 1200px 600px at 50% 100%, rgba(255,20,147,0.12), transparent)",
    }),
    [],
  );

  useEffect(() => {
    setClientId(getClientId());
  }, []);

  useEffect(() => {
    if (user) {
      setAutoSaveToGallery(true);
    }
  }, [user]);

  const { usageLoading, usageLine, refetchUsage } = useUsageQuery({
    user,
    clientId,
    authLoading,
  });

  const generateAIMutation = useGenerateAI({ clientId, refetchUsage });

  const saveUploadMutation = useSaveUpload({ setLastSavedUrl });

  const resetPosition = useCallback(() => {
    setBgScale(1);
    setBgOffsetX(0);
    setBgOffsetY(0);
  }, []);

  const handleFileChange = async (e) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const { url, error: uploadError } = await upload({ file });
    if (uploadError) {
      console.error(uploadError);
      setError(uploadError);
      return;
    }
    setSourceUrl(url);
    resetPosition();
    setLastSavedUrl(null);

    const shouldAutoSaveUpload = Boolean(autoSaveAfterUpload) && Boolean(user);
    if (shouldAutoSaveUpload) {
      setPendingAutoSave(true);
      setPendingAutoSaveStyle(style);
    }
  };

  const handleGenerateAI = async (e) => {
    e.preventDefault();
    setError(null);
    setLastSavedUrl(null);

    const rawPrompt = new FormData(e.currentTarget).get("prompt");
    const promptText = String(rawPrompt || "").trim();
    if (!promptText) {
      setError("Please enter a prompt.");
      return;
    }

    const promptFinal = `${promptText}, realistic, high quality`;

    try {
      const styleAtRequest = style;
      const data = await generateAIMutation.mutateAsync({
        prompt: promptFinal,
        chainStyle: styleAtRequest,
      });

      if (data?.imageUrl) {
        setSourceUrl(data.imageUrl);
        resetPosition();

        const canAutoSave = Boolean(user);
        const shouldAutoSave = Boolean(autoSaveToGallery) && canAutoSave;
        if (shouldAutoSave) {
          setPendingAutoSave(true);
          setPendingAutoSaveStyle(styleAtRequest);
        }
      } else {
        setError("AI generation did not return an image. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "AI generation failed. Please try again.");
    }
  };

  const { canvasRef } = useChainCanvas({
    sourceUrl,
    style,
    customColor,
    scale,
    offsetY,
    bgScale,
    bgOffsetX,
    bgOffsetY,
    pendingAutoSave,
    pendingAutoSaveStyle,
    user,
    saveUploadMutation,
    setPendingAutoSave,
    setPendingAutoSaveStyle,
    setError,
  });

  const {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
  } = useCanvasDrag({
    sourceUrl,
    bgOffsetX,
    bgOffsetY,
    setBgOffsetX,
    setBgOffsetY,
    canvasRef,
  });

  const canAutoSave = Boolean(user);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = data;
    a.download = "cuhz-chain.png";
    a.click();
  }, [canvasRef]);

  const handleSaveToGallery = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      saveUploadMutation.mutate({ dataUrl, chainStyle: style });
    } catch (e) {
      console.error(e);
      toast.error("Could not prepare image to save");
    }
  }, [canvasRef, saveUploadMutation, style]);

  const isUploadTab = activeTab === "upload";
  const isAiTab = activeTab === "ai";

  return (
    <div
      className="min-h-screen text-white relative"
      style={{ backgroundColor: "#0b1121" }}
    >
      {/* Ambient cosmic background */}
      <div className="fixed inset-0 -z-10" style={bgStyle} />

      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 pb-12">
        <Header authLoading={authLoading} user={user} logout={logout} />

        {/* Page title */}
        <div className="mt-8 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold">
            Chain{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] via-[#b24bf3] to-[#ff1493]">
              Generator
            </span>
          </h1>
          <p className="mt-2 text-sm text-white/50 max-w-md mx-auto">
            Upload or create with AI, add your signature chain, and download
            your masterpiece
          </p>
        </div>

        <UserStatusBanner
          authLoading={authLoading}
          user={user}
          usageLine={usageLine}
        />

        {/* Main 2-column layout */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* LEFT COLUMN — Controls */}
          <div
            className="rounded-3xl border border-white/10 backdrop-blur-md overflow-hidden"
            style={{ background: "rgba(15,23,42,0.8)" }}
          >
            {/* Input section header */}
            <div className="p-6 pb-0">
              <h2 className="text-xl font-bold text-white">Get an Image</h2>

              {/* Tab switcher */}
              <div
                className="mt-4 flex rounded-2xl p-1 gap-1"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <button
                  onClick={() => setActiveTab("upload")}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300"
                  style={{
                    background: isUploadTab
                      ? "linear-gradient(135deg,#00f5ff,#b24bf3)"
                      : "transparent",
                    color: isUploadTab ? "black" : "rgba(255,255,255,0.5)",
                  }}
                >
                  📷 Upload Photo
                </button>
                <button
                  onClick={() => setActiveTab("ai")}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300"
                  style={{
                    background: isAiTab
                      ? "linear-gradient(135deg,#b24bf3,#ff1493)"
                      : "transparent",
                    color: isAiTab ? "black" : "rgba(255,255,255,0.5)",
                  }}
                >
                  ✨ AI Generate
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="p-6">
              {isUploadTab && (
                <ImageUploadSection
                  handleFileChange={handleFileChange}
                  uploading={uploading}
                />
              )}

              {isAiTab && (
                <AIGenerationForm
                  handleGenerateAI={handleGenerateAI}
                  isGenerating={generateAIMutation.isLoading}
                  autoSaveToGallery={autoSaveToGallery}
                  setAutoSaveToGallery={setAutoSaveToGallery}
                  autoSaveAfterUpload={autoSaveAfterUpload}
                  setAutoSaveAfterUpload={setAutoSaveAfterUpload}
                  canAutoSave={canAutoSave}
                />
              )}

              {/* Divider */}
              <div className="my-6 border-t border-white/5" />

              <StyleSelector
                style={style}
                setStyle={setStyle}
                customColor={customColor}
                setCustomColor={setCustomColor}
              />

              {/* Divider */}
              <div className="my-6 border-t border-white/5" />

              <ChainControls
                scale={scale}
                setScale={setScale}
                offsetY={offsetY}
                setOffsetY={setOffsetY}
              />

              <BackgroundPositionControls
                sourceUrl={sourceUrl}
                bgScale={bgScale}
                setBgScale={setBgScale}
                bgOffsetX={bgOffsetX}
                setBgOffsetX={setBgOffsetX}
                bgOffsetY={bgOffsetY}
                setBgOffsetY={setBgOffsetY}
                resetPosition={resetPosition}
              />
            </div>
          </div>

          {/* RIGHT COLUMN — Preview + Actions */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-8">
            <CanvasPreview
              canvasRef={canvasRef}
              sourceUrl={sourceUrl}
              onCanvasPointerDown={onCanvasPointerDown}
              onCanvasPointerMove={onCanvasPointerMove}
              onCanvasPointerUp={onCanvasPointerUp}
              onCanvasPointerCancel={onCanvasPointerCancel}
            />

            <ActionButtons
              sourceUrl={sourceUrl}
              handleDownload={handleDownload}
              handleSaveToGallery={handleSaveToGallery}
              isSaving={saveUploadMutation.isLoading}
              error={error}
              lastSavedUrl={lastSavedUrl}
            />
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes cuhzSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes cuhzPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
