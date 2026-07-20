# Deploy e infraestrutura

O deploy deve permanecer portável. A aplicação não pode depender de uma API exclusiva de Render, Hostinger ou Vercel.

## Fontes de verdade

- `Dockerfile`: imagem Node + ambiente Python.
- `compose.yaml`: aplicação e Caddy em VPS.
- `render.yaml`: adaptador Render.
- `deploy/Caddyfile`: TLS e reverse proxy.
- `docs/deployment-portability.md`: procedimento e migração.
- `.env.example` e `deploy/hostinger.env.example`: nomes de configuração, nunca valores reais.

## Regras

- Não copie `.env`, PDFs, `tmp`, caches ou credenciais para a imagem.
- Valores `VITE_*` entram no bundle e são públicos. Somente configuração publicável pode usar esse prefixo.
- Segredos de IA, Notion e allowlist são variáveis runtime server-side.
- Preserve health check em `/api/health` e SPA fallback para rotas do React Router.
- Produção expõe apenas 80/443 pelo Caddy; a porta do app permanece na rede interna.
- Alteração de porta, domínio ou callback precisa ser refletida em compose, Caddy, exemplos e documentação.
- Não execute deploy nem altere DNS sem autorização explícita do usuário.

## Verificação

```powershell
# Requer .env.production criado a partir do exemplo.
docker compose config
npm.cmd run build
```

Depois de mudança operacional, valide health, login, acesso direto a uma rota profunda, resumo e exportação.
