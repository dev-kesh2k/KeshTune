// Funções simples no lugar de regex com retrocesso (o SonarQube aponta risco de lentidão nelas).

/** Tira os trechos entre colchetes, como as marcas de tempo "[01:23.45]" de uma letra sincronizada. */
export function stripBrackets(s: string): string {
  let out = '';
  let from = 0;
  for (let open = s.indexOf('['); open >= 0; open = s.indexOf('[', from)) {
    const close = s.indexOf(']', open + 1);
    if (close < 0) break;
    out += s.slice(from, open);
    from = close + 1;
  }
  return out + s.slice(from);
}

const TAG_WORDS = ['official', 'clipe', 'video', 'vídeo', 'audio', 'áudio', 'lyric'];
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
// Igual à flag `i` das regex (sem `u`): caractere fora do ASCII não vira um do ASCII.
function fold(c: string) {
  const u = c.toUpperCase();
  if (u.length !== 1 || (c.charCodeAt(0) >= 128 && u.charCodeAt(0) < 128)) return c;
  return u;
}
function hasWordAt(s: string, word: string, at: number) {
  if (at + word.length > s.length) return false;
  for (let i = 0; i < word.length; i++) if (fold(s[at + i]) !== fold(word[i])) return false;
  return true;
}

/** Tira "(Official Video)", "[Áudio]", "(Lyrics)"... do título (e os espaços antes), até o primeiro ")" ou "]". */
export function stripVideoTags(s: string): string {
  let out = '';
  let from = 0;
  let j = 0;
  while (j < s.length) {
    const open = j;
    j++;
    if ((s[open] !== '(' && s[open] !== '[') || !TAG_WORDS.some((w) => hasWordAt(s, w, open + 1))) continue;
    let close = open + 1;
    while (close < s.length && s[close] !== ')' && s[close] !== ']') close++;
    if (close >= s.length) continue;
    let start = open;
    while (start > from && isSpace(s[start - 1])) start--;
    out += s.slice(from, start);
    from = close + 1;
    j = from;
  }
  return out + s.slice(from);
}
