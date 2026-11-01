import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { auth } from '../security.js';
import { ah, bad, uuidv7 } from '../util.js';

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || 'uploads');
export const IMAGE_DIR = path.join(UPLOAD_ROOT, 'images');
export const AUDIO_DIR = path.join(UPLOAD_ROOT, 'audio');
export const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
for (const d of [IMAGE_DIR, AUDIO_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

export const isImageRef = (v) => typeof v === 'string' && (/^images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(v) || /^https:\/\/i\.ytimg\.com\//.test(v));

/** Detecta o formato pela assinatura do arquivo (não confia no nome nem no tipo enviado). */
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export function saveImage(buf) {
  const ext = sniffImage(buf);
  if (!ext) throw bad('Imagem deve ser JPEG, PNG ou WebP');
  const name = `${uuidv7()}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, name), buf);
  return `images/${name}`;
}

const imgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

export const mediaRouter = express.Router();

mediaRouter.post('/media/images', auth(), imgUpload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Envie a imagem no campo "file"');
  res.status(201).json({ url: saveImage(req.file.buffer) });
}));

mediaRouter.get('/media/images/:name', (req, res) => {
  const name = String(req.params.name);
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.join(IMAGE_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
