// Reduz as imagens já guardadas (capas e fotos de artista enviadas antes do redimensionamento em saveImage).
// Rodar uma vez, na pasta backend: node src/shrink-images.js
// Só mexe nas maiores que 200 KB ou com lado maior que 800 px. Mantém o MESMO nome e o MESMO formato (a extensão
// está gravada no banco), por isso não converte para JPEG como as imagens novas.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Mesmo caminho de routes/media.js (sem importar o módulo, que exige a configuração do servidor)
const IMAGE_DIR = path.join(path.resolve(process.env.UPLOAD_DIR || 'uploads'), 'images');
const MAX_SIDE = 800;
const MAX_BYTES = 200 * 1024;

const encode = {
  jpg: (s) => s.jpeg({ quality: 82, mozjpeg: true }),
  png: (s) => s.png({ compressionLevel: 9 }),
  webp: (s) => s.webp({ quality: 82 }),
};

let done = 0;
let skipped = 0;
let failed = 0;
let saved = 0;
const files = fs.existsSync(IMAGE_DIR) ? fs.readdirSync(IMAGE_DIR) : [];
for (const f of files) {
  const ext = path.extname(f).slice(1).toLowerCase();
  const file = path.join(IMAGE_DIR, f);
  if (!encode[ext] || !fs.statSync(file).isFile()) continue;
  try {
    const size = fs.statSync(file).size;
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf, { failOn: 'none', limitInputPixels: 50e6 }).metadata();
    const big = Math.max(meta.width || 0, meta.height || 0) > MAX_SIDE;
    if (size <= MAX_BYTES && !big) { skipped++; continue; }
    const out = await encode[ext](
      sharp(buf, { failOn: 'none', limitInputPixels: 50e6 }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    ).toBuffer();
    // Só pelo peso (lado já pequeno): troca apenas se ficou menor (PNG já comprimido pode crescer ao regravar)
    if (!big && out.length >= size) { skipped++; continue; }
    fs.writeFileSync(`${file}.tmp`, out);
    fs.renameSync(`${file}.tmp`, file);
    saved += size - out.length;
    done++;
  } catch (e) {
    failed++;
    fs.rmSync(`${file}.tmp`, { force: true });
    console.error('[shrink]', f, e.message);
  }
}
console.log(`[shrink] ${done} reduzidas, ${skipped} já pequenas, ${failed} com erro; ${(saved / 1024 / 1024).toFixed(1)} MB a menos`);
