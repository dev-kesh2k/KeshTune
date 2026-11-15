# Changelog

Mudanças relevantes do app, da mais nova para a mais antiga. Cada item é um pull request mesclado na `main` (que publica o app).

## 2026-11-15

- Segurança: compression atualizado no backend (npm audit) (#79)
- CI: roda os testes do backend no GitHub Actions (#78)
- Testes: limite de requisições por chave (#77)
- Testes: exportar e importar CSV (inclui bloqueio de fórmula) (#76)
- Testes: UUID v7 e listas de ids (#75)
- Testes: validação de texto, número, data e e-mail (#74)
- 2FA: segredo TOTP novo com 160 bits (RFC 4226; antes eram 100) (#73)
- Deploy: mudanças só em testes não republicam o app (#72)
