import { useEffect, useRef } from "react";
import { drawPlaceholder } from "../canvas/drawPlaceholder";
import { drawChain } from "../canvas/drawChain";

export function useChainCanvas({
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
}) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 640;
    const H = 640;
    canvas.width = W;
    canvas.height = H;

    ctx.clearRect(0, 0, W, H);

    if (!sourceUrl) {
      drawPlaceholder(ctx, W, H, {
        style,
        color: customColor,
        scale,
        offsetY,
      });
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const imgRatio = img.width / img.height;
      const canvasRatio = W / H;
      let drawW;
      let drawH;
      let dx;
      let dy;

      if (imgRatio > canvasRatio) {
        drawH = H;
        drawW = img.width * (H / img.height);
      } else {
        drawW = W;
        drawH = img.height * (W / img.width);
      }

      const nextDrawW = drawW * bgScale;
      const nextDrawH = drawH * bgScale;
      const baseDx = (W - nextDrawW) / 2;
      const baseDy = (H - nextDrawH) / 2;
      dx = baseDx + bgOffsetX * W;
      dy = baseDy + bgOffsetY * H;

      ctx.drawImage(img, dx, dy, nextDrawW, nextDrawH);

      drawChain(ctx, W, H, { style, color: customColor, scale, offsetY });

      const canAutoSave = Boolean(user);
      const shouldAutoSave = Boolean(pendingAutoSave) && canAutoSave;
      if (shouldAutoSave) {
        const saveStyle = pendingAutoSaveStyle || style;
        setPendingAutoSave(false);
        setPendingAutoSaveStyle(null);
        try {
          const dataUrl = canvas.toDataURL("image/png");
          saveUploadMutation.mutate({ dataUrl, chainStyle: saveStyle });
        } catch (e) {
          console.error(e);
        }
      }
    };
    img.onerror = () => {
      setError("Could not load image. Try another file.");
    };
    img.src = sourceUrl;
    imgRef.current = img;
  }, [
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
  ]);

  return { canvasRef, imgRef };
}
