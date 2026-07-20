// One-off script to generate PWA icons from the official TDIS logo
// (public/images/Tdis_logo.jpeg), composited onto a square white background
// since the source logo is a wide horizontal lockup, not a square mark.
// Run: node scripts/generate-pwa-icons.js
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const WHITE = "#ffffff";
const SRC = path.join(__dirname, "..", "public", "images", "Tdis_logo.jpeg");
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const SIZES = [
  { name: "icon-192.png", size: 192, padding: 0.1 },
  { name: "icon-512.png", size: 512, padding: 0.1 },
  { name: "maskable-icon-512.png", size: 512, padding: 0.22 }, // safe zone for adaptive icon masks
  { name: "apple-touch-icon.png", size: 180, padding: 0.12 },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Trim the logo's own baked-in white margin first so we control the
  // padding ourselves instead of compositing a full white rectangle (which
  // read as an ugly box against any other background color).
  const trimmedLogo = await sharp(SRC).resize({ width: 1600 }).trim({ background: WHITE, threshold: 10 }).png().toBuffer();

  for (const { name, size, padding } of SIZES) {
    const logoWidth = Math.round(size * (1 - padding * 2));
    const logoBuffer = await sharp(trimmedLogo).resize({ width: logoWidth, fit: "inside" }).png().toBuffer();
    const logoMeta = await sharp(logoBuffer).metadata();

    await sharp({
      create: { width: size, height: size, channels: 4, background: WHITE },
    })
      .composite([
        {
          input: logoBuffer,
          left: Math.round((size - logoMeta.width) / 2),
          top: Math.round((size - logoMeta.height) / 2),
        },
      ])
      .png()
      .toFile(path.join(OUT_DIR, name));

    console.log(`wrote ${name} (${size}x${size})`);
  }

  // Favicon via Next.js's App Router file convention (src/app/icon.png is
  // auto-served as the site favicon/icon — no need to hand-roll a .ico).
  const faviconLogo = await sharp(trimmedLogo).resize({ width: 28, fit: "inside" }).png().toBuffer();
  const faviconMeta = await sharp(faviconLogo).metadata();
  await sharp({ create: { width: 32, height: 32, channels: 4, background: WHITE } })
    .composite([{ input: faviconLogo, left: Math.round((32 - faviconMeta.width) / 2), top: Math.round((32 - faviconMeta.height) / 2) }])
    .png()
    .toFile(path.join(__dirname, "..", "src", "app", "icon.png"));
  console.log("wrote src/app/icon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
