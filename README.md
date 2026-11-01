# Spotify X

Streaming de música (web + celular) conforme a especificação técnica — fase 1 (P0).

- **Fonte do conteúdo:** opção D (híbrida) da seção 13.1 — biblioteca própria (arquivos enviados pelo admin; toca offline e sem anúncios) + faixas do YouTube pelo player oficial incorporado (só online).
- **frontend/**: React + Vite + TypeScript + Tailwind (PWA). Player com fila, rádio automático, Media Session (tela de bloqueio/Bluetooth), letras sincronizadas (LRC), downloads offline cifrados (AES-256-GCM) numa pasta escolhida pelo usuário (File System Access API, Chrome/Edge).
- **backend/**: Node + Express + PostgreSQL (`pg`, migrations SQL em `backend/migrations`, aplicadas no start). Busca com `pg_trgm` + `unaccent` (tolerância a erros). Eventos em tempo real por SSE com LISTEN/NOTIFY.
- Admin inicial criado no start a partir de `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (`backend/.env.example`).
- Uploads (áudio e imagens) em `backend/uploads/` (preservado pelo Hub entre deploys).
