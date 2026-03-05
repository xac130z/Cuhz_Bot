export function drawChain(ctx, width, height, options) {
  const { style, color, scale, offsetY } = options;
  const centerX = width / 2;
  const baseY = height * (0.65 + offsetY);
  const radius = Math.min(width, height) * 0.28 * scale;

  const ringCount = 18;
  const ringRadius = Math.max(
    3,
    Math.round(Math.min(width, height) * 0.014 * scale),
  );

  let gradient;
  if (style === "rainbow" || style === "iced") {
    gradient = ctx.createLinearGradient(
      0,
      baseY - radius,
      width,
      baseY + radius,
    );
    gradient.addColorStop(0, "#00f5ff");
    gradient.addColorStop(0.33, "#b24bf3");
    gradient.addColorStop(0.66, "#ff1493");
    gradient.addColorStop(1, "#ffd700");
  }

  let stroke = "#ffd700";
  if (style === "silver") stroke = "#d1d5db";
  if (style === "custom") stroke = color || "#00f5ff";
  if (style === "rainbow" || style === "iced") stroke = gradient;

  ctx.lineWidth = Math.max(2, ringRadius * 0.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const angle = Math.PI * (0.15 + 0.7 * t);
    const x = centerX + radius * Math.cos(angle);
    const y = baseY + radius * Math.sin(angle) * 0.6;

    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (style === "iced") {
      const sparkleCount = 2;
      for (let s = 0; s < sparkleCount; s++) {
        const sx = x + (Math.random() * 2 - 1) * ringRadius * 0.6;
        const sy = y + (Math.random() * 2 - 1) * ringRadius * 0.6;
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.arc(sx, sy, ringRadius * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const plateY = baseY - radius * 0.05;
  const plateWidth = radius * 1.1;
  const plateHeight = ringRadius * 2.6;
  const plateX = centerX - plateWidth / 2;

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const r = plateHeight / 2;
  ctx.moveTo(plateX + r, plateY);
  ctx.lineTo(plateX + plateWidth - r, plateY);
  ctx.quadraticCurveTo(
    plateX + plateWidth,
    plateY,
    plateX + plateWidth,
    plateY + r,
  );
  ctx.lineTo(plateX + plateWidth, plateY + plateHeight - r);
  ctx.quadraticCurveTo(
    plateX + plateWidth,
    plateY + plateHeight,
    plateX + plateWidth - r,
    plateY + plateHeight,
  );
  ctx.lineTo(plateX + r, plateY + plateHeight);
  ctx.quadraticCurveTo(
    plateX,
    plateY + plateHeight,
    plateX,
    plateY + plateHeight - r,
  );
  ctx.lineTo(plateX, plateY + r);
  ctx.quadraticCurveTo(plateX, plateY, plateX + r, plateY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.font = `${Math.max(14, Math.round(plateHeight * 0.95))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText("CUHZ", centerX, plateY + plateHeight / 2);
}
