# Resumex

Aplicação React + Vite para transformar PDFs médicos em resumos e quizzes com IA.

## Requisitos

- Node.js 20.9 ou superior (Node 22 LTS recomendado)
- npm

## Desenvolvimento

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

Em outro terminal, inicie a API local:

```powershell
npm.cmd run dev:api
```

## Autenticação e banco

1. Crie um projeto no Supabase.
2. Em Authentication > Providers, habilite Google.
3. Em Authentication > URL Configuration, adicione `http://localhost:5173` e a URL de produção.
4. Copie `.env.example` para `.env` e preencha a URL e a publishable key do projeto.

A API Express valida o access token e aplica `ALLOWED_EMAILS`. Tabelas expostas ao navegador devem usar Row Level Security.

O domínio da aplicação não importa tipos ou clientes do Supabase. O SDK fica isolado nos adaptadores de `src/features/auth/adapters` e `server/auth/adapters`. Para trocar de fornecedor, implemente os mesmos contratos, registre o novo adaptador nos pontos de composição e altere `AUTH_PROVIDER`/`VITE_AUTH_PROVIDER`.

## Verificação

```powershell
npm.cmd run typecheck
npm.cmd run build
```

O build executa o typecheck antes de gerar `dist/`.

## Qualidade de IA

O roteamento por função, os pipelines de auditoria e reparo, as regras de falha fechada e os critérios de aceite estão documentados em [`docs/ai-quality-architecture.md`](docs/ai-quality-architecture.md).

## Estrutura do frontend

```text
src/
├── app/                 # composição principal e estilos globais
├── features/
│   ├── auth/            # autenticação e chaves locais
│   ├── notion/          # exportação para o Notion
│   ├── pdf/             # leitura, renderização e visualização de PDF
│   ├── quiz/            # upload, geração e exibição de quizzes
│   └── summary/         # preferências, SPEC, prompts e geração do resumo
└── shared/              # componentes e utilitários reutilizados
```

O frontend usa TypeScript. O servidor Express permanece em JavaScript para preservar o runtime atual de desenvolvimento e deploy.
