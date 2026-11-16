# Changelog

Mudanças relevantes do app, da mais nova para a mais antiga. Cada item é um pull request mesclado na `main` (que publica o app).

## 2026-11-15

- **Segurança:** sharp 0.35.5 (falhas em libvips, libheif e librsvg ao processar capas enviadas) (#95)
- **Código:** regras de links e textos de mídia (YouTube, Spotify, busca, mistura de listas) num módulo só, `media-links.js`, com testes; as rotas de vídeo, YouTube, admin, importação e busca deixaram de ter cópias (#96–#102)
- **Saúde:** `/api/health` responde 503 (`db: erro`) quando o Postgres não responde; o Hub mostra e avisa "banco fora do ar"
- **CI:** lint no-undef do backend (pega import esquecido)
- Segurança: compression atualizado no backend (npm audit) (#79)
- CI: roda os testes do backend no GitHub Actions (#78)
- Testes: limite de requisições por chave (#77)
- Testes: exportar e importar CSV (inclui bloqueio de fórmula) (#76)
- Testes: UUID v7 e listas de ids (#75)
- Testes: validação de texto, número, data e e-mail (#74)
- 2FA: segredo TOTP novo com 160 bits (RFC 4226; antes eram 100) (#73)
- Deploy: mudanças só em testes não republicam o app (#72)
