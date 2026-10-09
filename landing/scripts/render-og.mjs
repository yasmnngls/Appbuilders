// Renders scripts/og.svg to public/og.png (1200x630) for the social preview (LP-008).
// Run once after editing og.svg: npm run og
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./og.svg", import.meta.url));
const out = fileURLToPath(new URL("../public/og.png", import.meta.url));
const info = await sharp(src, { density: 72 }).resize(1200, 630).png({ compressionLevel: 9, palette: true }).toFile(out);
console.log(`og.png ${info.width}x${info.height}, ${info.size} bytes`);
