import { drawChain } from "./drawChain";

export function drawPlaceholder(ctx, width, height, options) {
  const { style, color, scale, offsetY } = options;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a0e27");
  bg.addColorStop(0.5, "#141b44");
  bg.addColorStop(1, "#0a0e27");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const spot = ctx.createRadialGradient(
    width * 0.5,
    height * 0.35,
    10,
    width * 0.5,
    height * 0.35,
    width * 0.7,
  );
  spot.addColorStop(0, "rgba(178,75,243,0.25)");
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.ellipse(
    width / 2,
    height * 0.62,
    width * 0.22,
    height * 0.28,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  drawChain(ctx, width, height, { style, color, scale, offsetY });

  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px sans-serif";
  ctx.fillText(
    "Pick a style • Upload a photo • Or generate with AI",
    width / 2,
    height * 0.9,
  );
}
