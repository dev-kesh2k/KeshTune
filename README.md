# Spotify X

Streaming de música (web + celular) conforme a especificação técnica — fase 1 (P0).

- **Fonte do conteúdo:** opção D (híbrida) da seção 13.1 — biblioteca própria (arquivos enviados pelo admin; toca offline e sem anúncios) + faixas do YouTube pelo player oficial incorporado (só online).
- **frontend/**: React + Vite + TypeScript + Tailwind (PWA). Player com fila, rádio automático, Media Session (tela de bloqueio/Bluetooth), letras sincronizadas (LRC), downloads offline cifrados (AES-256-GCM) numa pasta escolhida pelo usuário (File System Access API, Chrome/Edge).
- **backend/**: Node + Express + PostgreSQL (`pg`, migrations SQL em `backend/migrations`, aplicadas no start). Busca com `pg_trgm` + `unaccent` (tolerância a erros). Eventos em tempo real por SSE com LISTEN/NOTIFY.
- Admin inicial criado no start a partir de `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (`backend/.env.example`).
- Uploads (áudio e imagens) em `backend/uploads/` (preservado pelo Hub entre deploys).

## Importar do Spotify (spotDL)

Admin → **Importar do Spotify**: cole links de faixa, álbum, playlist ou artista. O backend roda o [spotDL](https://github.com/spotDL/spotify-downloader) (MIT), que busca cada música no YouTube e baixa o MP3 já com as tags (capa, álbum, ISRC, letra). Cada arquivo entra no catálogo como faixa própria (`source = 'file'`), igual a um envio manual. Faixas com ISRC ou áudio já cadastrados são puladas. A fila fica na tabela `import_jobs` (`backend/src/routes/imports.js`); roda um link por vez e funciona com várias réplicas.

Pré-requisitos no servidor (sem eles a aba mostra um aviso e não aceita links):

```sh
pipx install spotdl          # ou: pip install spotdl  (Python 3.11+)
sudo apt install ffmpeg      # ou: spotdl --download-ffmpeg
```

Variáveis opcionais (`backend/.env.example`): `SPOTDL_BIN` (caminho do executável), `SPOTDL_ARGS` (opções extras, ex.: `--client-id X --client-secret Y` com credenciais próprias do Spotify para evitar limite de requisições) e `SPOTDL_TIMEOUT_MIN` (padrão 180).

O áudio vem do YouTube, não do Spotify. Baixar conteúdo do YouTube vai contra os termos de uso dele, e as músicas continuam protegidas por direito autoral. Use apenas com conteúdo que você tem direito de distribuir.
