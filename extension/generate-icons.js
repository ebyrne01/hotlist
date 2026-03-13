/**
 * Generate extension icons.
 * Run: node extension/generate-icons.js
 * Requires: npm install canvas (dev dependency)
 */
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Rounded rectangle background
  const radius = size * 0.18;
  ctx.fillStyle = "#d4430e";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fill();

  // "H" letterform
  ctx.fillStyle = "#faf7f2";
  ctx.font = `italic bold ${size * 0.65}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", size / 2, size / 2 + size * 0.02);

  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`Generated ${outPath}`);
}
