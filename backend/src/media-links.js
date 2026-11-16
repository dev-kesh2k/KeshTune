// Regras puras de links e textos de mídia (YouTube, Spotify, busca), usadas por várias rotas. Sem banco: testáveis.

/** Entidades HTML que a API do YouTube devolve nos títulos (&amp; &quot; &#39; &lt; &gt;). */
export const decodeEntities = (s) =>
  String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, (_m, e) => ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' })[e]);

/** Duração ISO 8601 do YouTube (PT1H2M3S) em milissegundos; formato desconhecido = 0. */
export const isoDuration = (v) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v || '');
  return m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 0;
};

/** Id de 11 caracteres a partir do id puro ou de links youtube.com, youtu.be, shorts, live, embed e music.youtube.com. */
export function youtubeId(url) {
  const s = String(url || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/);
  return m ? m[1] : null;
}

/** Aceita links open.spotify.com (faixa, álbum, playlist, artista) e URIs spotify:tipo:id; devolve o link canônico. */
export function spotifyUrl(v) {
  const s = String(v || '').trim();
  const m = s.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{22})(?:[/?#].*)?$/)
    || s.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/);
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null;
}

/** Texto da busca sem acentos, minúsculo e sem espaços nas pontas (igual ao f_norm do banco). */
export function normalizeSearch(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Junta várias listas alternando os itens (um de cada), sem repetir vídeo nem incluir transmissão ao vivo. */
export function interleave(lists, max = 40) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const v = l[i];
      if (v && !seen.has(v.youtube_id) && !v.live) { seen.add(v.youtube_id); out.push(v); }
    }
  }
  return out.slice(0, max);
}
