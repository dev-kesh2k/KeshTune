import { api } from './api';

/** Recorta a imagem em quadrado (centro), reduz e envia; devolve a referência gravável. */
export async function uploadSquareImage(file: File, size = 800): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPEG, PNG ou WebP');
  if (file.size > 4 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 4 MB');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao processar a imagem'))), 'image/jpeg', 0.88));
  const fd = new FormData();
  fd.append('file', blob, 'imagem.jpg');
  const r = await api<{ url: string }>('media/images', { form: fd });
  return r.url;
}
