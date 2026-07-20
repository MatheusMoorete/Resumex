# Frontend

Estas instruções valem para `src/`.

## Arquitetura

- `main.tsx` declara as rotas públicas e monta `BrowserRouter`.
- `app/App.tsx` é a máquina de estados do app autenticado e sincroniza estado operacional com URL.
- Rotas públicas existentes: `/`, `/como-funciona`, `/medicina`, `/recursos`, `/planos`.
- Áreas autenticadas ficam sob `/app`; resumo, simulado e flashcards têm URLs próprias.
- Componentes específicos ficam em `features/<domínio>/components`; chamadas e regras em `services`; tipos centrais em `domain`.
- Só mova algo para `shared` quando houver pelo menos dois consumidores reais.

## UI e navegação

- O tema atual é Fichário Vivo: papel claro quadriculado, tinta verde escura, amarelo, azul e coral, bordas físicas e tipografia editorial.
- Telas operacionais devem ser mais sóbrias que a home, sem abandonar os mesmos tokens e componentes.
- Reuse `FicharioPdfDropzone`, `FicharioPanelHeader`, `FicharioAction`, `StudyModeTabs`, `Header` e o ícone `assets/pdf_icon.png`.
- Não use emoji como ícone. Prefira ausência de ícone ou `lucide-react` quando ele acrescentar informação.
- Links internos usam `Link`/`navigate`. Ao sair de trabalho ativo, passe pelo aviso central do `App`.
- Respeite `prefers-reduced-motion`, foco visível, HTML semântico e `aria-live` em progresso.
- Evite estado duplicado entre URL, `App` e componente. A URL identifica a etapa; dados grandes permanecem em memória.

## Segurança no browser

- Chaves manuais de provedor vivem apenas em `sessionStorage`; chaves do servidor são preferidas.
- Não renderize HTML bruto de Markdown. `shared/components/MarkdownPreview.tsx` converte referências em componentes React.
- URLs externas abrem com `noopener noreferrer`.
- O modo E2E só existe em `import.meta.env.DEV` e hostname local.
- Revogue cada `URL.createObjectURL` ao cancelar, substituir corpus ou sair do fluxo.

## Verificação

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Para mudanças de rota, teste acesso direto, navegação pelo browser e retorno seguro quando os dados da etapa não existem.
