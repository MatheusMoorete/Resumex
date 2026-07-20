# Deploy portavel do ResumeX

O ResumeX usa a mesma imagem Docker em qualquer provedor. O codigo da
aplicacao nao depende de Render ou Hostinger:

- `Dockerfile`: imagem portavel com Node, Python e PyMuPDF.
- `render.yaml`: adaptador exclusivo do Render.
- `compose.yaml`: adaptador para VPS, incluindo Hostinger.
- `deploy/Caddyfile`: HTTPS e proxy reverso na VPS.
- Supabase: estado persistente e PDFs fora do disco efemero do servidor.

## Render

Crie um Blueprint usando o `render.yaml` e preencha as variaveis secretas no
Dashboard. O Render injeta `PORT` e termina o HTTPS para o servico.

Use um dominio proprio, como `app.resumex.com.br`, desde o primeiro deploy.
Assim, URLs de autenticacao e callbacks do Notion nao mudam na migracao; apenas
o DNS do dominio passa do Render para o IP da VPS.

## Hostinger ou outra VPS

Instale Docker Engine com o plugin Compose e clone o repositorio. Depois:

```bash
cd /opt/resumex
cp deploy/hostinger.env.example .env.production
nano .env.production
docker compose --env-file .env.production up -d --build
```

O DNS do valor definido em `APP_DOMAIN` deve apontar para o IP da VPS. O Caddy
emite e renova o certificado TLS automaticamente. Somente as portas 80 e 443
ficam publicas; a aplicacao permanece na rede interna do Compose.

## Migracao do Render para a VPS

1. Crie a VPS e valide-a temporariamente antes de alterar o dominio principal.
2. Copie para `.env.production` os mesmos valores do Environment do Render.
3. Execute `docker compose --env-file .env.production up -d --build`.
4. Valide `/api/health`, login, resumo e exportacao para o Notion.
5. Troque o DNS do dominio principal somente depois da validacao.
6. Mantenha o Render por alguns dias como rollback e depois desative-o.

Nao ha banco ou PDF para copiar entre os servidores porque os dados persistentes
ficam no Supabase. Arquivos temporarios devem ser apagados ao final de cada job.
