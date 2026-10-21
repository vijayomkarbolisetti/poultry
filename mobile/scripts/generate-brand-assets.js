const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const root = path.join(__dirname, "..");
const assets = path.join(root, "assets");
const raw = fs.readFileSync(path.join(assets, "brand-logo.svg"), "utf8");
const inner = raw.replace(/<\?xml[^>]*>/i, "").replace(/<svg[^>]*>/i, "").replace(/<\/svg>/i, "");

function squareSvg(size, bg) {
  const logoW = 153;
  const logoH = 138;
  const scale = (size * 0.72) / Math.max(logoW, logoH);
  const bgRect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
${bgRect}
<g transform="translate(${size / 2},${size / 2}) scale(${scale}) translate(${-logoW / 2},${-logoH / 2})">
${inner}
</g>
</svg>`;
}

function writePng(file, size, bg) {
  const svg = squareSvg(size, bg);
  const png = new Resvg(Buffer.from(svg), { fitTo: { mode: "width", value: size } }).render().asPng();
  fs.writeFileSync(path.join(assets, file), png);
  console.log("wrote", file, png.length);
}

writePng("icon.png", 1024, "#0F7A45");
writePng("favicon.png", 48, "#0F7A45");
writePng("adaptive-icon.png", 1024, null);
writePng("android-icon-foreground.png", 1024, null);
writePng("splash-icon.png", 512, null);

const natural = new Resvg(fs.readFileSync(path.join(assets, "brand-logo.svg")), {
  fitTo: { mode: "width", value: 512 },
}).render().asPng();
fs.writeFileSync(path.join(assets, "brand-logo.png"), natural);
console.log("wrote brand-logo.png", natural.length);
