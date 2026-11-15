# KeshTune

[![Testes](https://github.com/dev-kesh2k/KeshTune/actions/workflows/ci.yml/badge.svg)](https://github.com/dev-kesh2k/KeshTune/actions/workflows/ci.yml)

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

## Ouvir e baixar do YouTube

A busca do app mostra também a seção **Do YouTube**. Tocar um resultado, ou abrir o menu ⋯ dele, cadastra a faixa no catálogo (`source = 'youtube'`, toca pelo player oficial e só online). No menu da faixa, **Baixar (salvar no app)** faz o servidor baixar o áudio com o yt-dlp. A faixa vira arquivo próprio sem trocar de id (curtidas e playlists continuam valendo) e já entra em Downloads para ouvir offline. Código em `backend/src/routes/youtube.js`; os downloads usam a mesma fila da importação do Spotify e aparecem na aba do admin.

- Busca: usa a YouTube Data API quando há `YOUTUBE_API_KEY` (cota gratuita de cerca de 100 buscas por dia; resultados ficam em cache por 6 h). Sem chave, ou quando a cota acaba, usa o yt-dlp.
- Download: `YTDLP_BIN` (padrão `yt-dlp`, instalado junto com o spotDL) e `YTDLP_ARGS` (ex.: `--ffmpeg-location /usr/bin/ffmpeg`).
- O admin desliga tudo isso em Configurações → faixas do YouTube.

## Gêneros em alta, "Minhas músicas" e download de playlists

- **Admin → Gêneros → 🔥**: busca no YouTube as músicas em alta do gênero (até 100; yt-dlp primeiro, para poupar a cota da API) e cadastra como faixas do YouTube, que tocam online. Nada é baixado. Os cards de gênero na Busca mostram a capa da música mais popular.
- **Minhas músicas**: playlist do sistema (`playlists.system_key = 'my_music'`), criada no primeiro download. Recebe cada faixa baixada, com as mais recentes no topo.
- **Baixar playlist/álbum inteiro**: o botão de download da coleção também baixa as faixas do YouTube (`POST /youtube/downloads` em lote; o servidor baixa uma por vez e o app leva cada uma para Downloads assim que fica pronta).
- O yt-dlp usa o Node do backend como runtime de JavaScript (`--js-runtimes`); sem isso o YouTube recusa vários vídeos.

## App Android (central multimídia do carro)

**android/**: app nativo em Kotlin + Jetpack Compose. Usa Media3 (ExoPlayer + MediaLibraryService) para tocar, com áudio em segundo plano, notificação, foco de áudio, botões do volante e Android Auto. Também usa Room (cópia local de playlists e curtidas), Coroutines/Flow, Hilt e Retrofit. Ele conversa com a mesma API do web (`APP_URL` em `android/app/build.gradle`).

- **O servidor não guarda o que já foi baixado no Android:** depois de salvar a música no aparelho, o app chama `POST /youtube/offload`; o servidor apaga o áudio e a faixa volta a ser `youtube` (mesmo id; curtidas e playlists continuam). Vale para os dois apps Android (este e o APK do Hub em `deploy/apk-builder/native/keshtune`). Se alguém precisar do arquivo de novo (site, outro aparelho, tocar sem ter baixado), o servidor reconverte. Envio manual do admin (sem `youtube_id`) nunca é apagado.
- **Limpeza de 48 h:** o que sobrar no servidor (ouvida sem baixar, baixada pelo site, aviso do app que não chegou) sai 48 h depois da última conversão (`sweepOffload` em `backend/src/routes/youtube.js`, roda de hora em hora; prazo em `OFFLOAD_AFTER_H`). Cada reconversão recomeça o prazo.
- Faixas do YouTube não tocam direto: na hora de tocar, o app pede a conversão urgente (`POST /youtube/downloads`) e espera ficar pronta.
- Gerar o APK: `cd android && ./gradlew assembleRelease` (JDK 17 a 21). O APK sai em `android/app/build/outputs/apk/prod/release/`. `assembleDevRelease` gera o "KeshTune Dev", que usa o ambiente de testes (`/keshtune-dev/`) e instala lado a lado.
- Assinatura: `android/keystore.properties` + `android/keshtune-release.jks`, ambos fora do git. Guarde uma cópia: sem essa chave, as próximas versões não instalam por cima da atual. (A chave antiga se perdeu; a atual foi criada em 2026-11-10 no servidor do Hub, com cópia em `/root/.config/keshtune/`.)
- Compilar no servidor do Hub: `docker run --rm -v "$PWD/android":/work -w /work -v hub-gradle-cache:/root/.gradle hub-keshtune-builder ./gradlew --no-daemon -q assembleProdRelease` (imagem em `deploy/apk-builder/keshtune-kotlin` do Hub).
- **Desempenho na central (RK3326, tela 54 Hz):** capas arredondadas e recortadas no próprio bitmap (`ui/CoverShape.kt`, transformação do Coil), sem `clip` por capa; prateleiras, cards e linhas de música em `graphicsLayer()` (rolar só move a camada); fundo liso. Instalado por `adb install` o Android não aplica o baseline profile: depois de instalar rode `adb shell cmd package compile -m speed -f br.com.centralappshub.keshtune`.
- **Login automático da multimídia:** com `android/device.properties` (`deviceKey=…`, fora do git) o APK entra sozinho na conta dona da chave (`POST /auth/device`, tabela `device_keys`, só o SHA-256 no banco) e esconde o "Sair". Sem o arquivo, o app pede login normal. Revogar: `UPDATE device_keys SET revoked_at = now() WHERE label = 'Multimídia do carro'`.

## Rodar localmente

```bash
# backend (precisa de um Postgres com as extensões pg_trgm e unaccent)
cd backend && cp .env.example .env   # preencha DATABASE_URL, JWT_SECRET (32+ caracteres) e o admin inicial
npm install && npm start             # aplica as migrations e sobe em http://localhost:3000

# frontend
cd frontend && npm install && npm run dev
```

## API: saúde e formato de erro

- `GET /api/health` → `{ ok, service: "keshtune", time, uptime_s }` (consulta o banco; usado pelo balanceador).
- `GET /api/config` → opções públicas (offline, YouTube, limites), sem cache.
- Todo erro volta como `{ "error": { "code", "message", "request_id" } }`; o mesmo `request_id` sai no cabeçalho `X-Request-Id` e no log do servidor.

## Limites de requisição

Por usuário (ou por IP sem login): 100 escritas e 600 leituras por minuto, por réplica. Áudio, imagens, downloads offline e o SSE ficam fora. As respostas trazem `RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset`; acima do limite a API responde `429` com `Retry-After`.

## Estrutura do backend

- `src/server.js`: Express, limites de requisição, SSE, tratamento de erro e boot (migrations → seed → workers).
- `src/routes/*.js`: uma rota por assunto (auth, catálogo, busca, playlists, biblioteca, reprodução, offline, admin, importação, YouTube, vídeo).
- `src/security.js`: senhas, tokens JWT, sessões, 2FA e auditoria. `src/util.js`: validação, CSV, limitador e erros.
- `migrations/*.sql`: aplicadas em ordem no start (`src/migrate.js`).

## Segurança

- Nada de segredo no repositório (é público): senhas, `JWT_SECRET` e chaves ficam só no `.env` do servidor; o `.env.example` vai sempre com os valores vazios.
- Senhas com hash, sessões revogáveis, 2FA (TOTP) opcional e auditoria das ações do admin.
- Para avisar uma falha, veja o [SECURITY.md](SECURITY.md).

## Testes

Testes do backend com o executor nativo do Node (`node:test`), sem banco e sem servidor rodando:

```bash
npm ci --prefix backend   # o KeshTune importa pg e jsonwebtoken nos testes
node --test backend/test/*.test.js
```

Cobrem as regras puras do backend (csv, offline-keys, passwords, rate-limit, stream-url, totp, uuid, validate). O GitHub Actions roda os mesmos testes em cada push e pull request (workflow `Testes`); mudanças só em `backend/test/` não republicam o app.
