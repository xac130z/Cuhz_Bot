import { useRef, useCallback } from "react";

export function useCanvasDrag({
  sourceUrl,
  bgOffsetX,
  bgOffsetY,
  setBgOffsetX,
  setBgOffsetY,
  canvasRef,
}) {
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  });

  const clamp = useCallback((v, min, max) => {
    return Math.min(max, Math.max(min, v));
  }, []);

  const onCanvasPointerDown = useCallback(
    (e) => {
      if (!sourceUrl) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      dragRef.current.isDragging = true;
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
      dragRef.current.startOffsetX = bgOffsetX;
      dragRef.current.startOffsetY = bgOffsetY;

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    [sourceUrl, bgOffsetX, bgOffsetY, canvasRef],
  );

  const onCanvasPointerMove = useCallback(
    (e) => {
      if (!sourceUrl) return;
      if (!dragRef.current.isDragging) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      const dxNorm = rect.width ? dx / rect.width : 0;
      const dyNorm = rect.height ? dy / rect.height : 0;

      const nextX = clamp(dragRef.current.startOffsetX + dxNorm, -0.35, 0.35);
      const nextY = clamp(dragRef.current.startOffsetY + dyNorm, -0.35, 0.35);

      setBgOffsetX(nextX);
      setBgOffsetY(nextY);
    },
    [sourceUrl, clamp, canvasRef, setBgOffsetX, setBgOffsetY],
  );

  const onCanvasPointerUp = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
      dragRef.current.isDragging = false;
    },
    [canvasRef],
  );

  const onCanvasPointerCancel = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  return {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
  };
}
