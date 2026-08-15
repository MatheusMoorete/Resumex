# Worker Python de PDF

`process_pdf.py` é um processo filho chamado por `server/summaryJobs.ts` e `server/quizJobs.ts`.

Leia `../docs/backend-technical-debt.md` antes de alterar o protocolo. Os jobs ativos ainda usam a interface legada; a interface `--input/--output/--artifacts-dir` e o `Document IR` novo ainda não estão integrados a eles.

## Contrato

- Entrada: caminhos de PDFs, `--output-dir`, `--vision-mode` e `--vision-pages`.
- Saída normal: um único JSON UTF-8 em `stdout` com `pageCount` e `pages`.
- Cada página mantém `page`, `sourceIndex`, `sourceName`, `sourcePage`, `text`, `needsVision`, `reasons` e `imagePath`.
- Logs e diagnóstico devem ir para `stderr`; qualquer texto extra em `stdout` quebra `JSON.parse` no Node.
- A numeração `page` é global entre todos os arquivos. Não a reinicie por documento.

## Regras

- Não use OCR ou visão quando texto selecionável basta; renderize somente páginas marcadas.
- Preserve os modos `off`, `auto`, `all` e `manual`.
- Rejeite PDF protegido e mantenha limite total de 300 páginas.
- Imagens são temporárias, JPEG e ficam exclusivamente em `--output-dir`.
- Não faça chamadas de rede nem leia chaves aqui; provedores pertencem ao servidor.
- Dependências Python ficam em `requirements.txt`; não adicione pacote se PyMuPDF/Pillow ou stdlib resolver.
- Não versione `__pycache__`, PDFs, imagens ou manifests locais.

## Verificação

```powershell
# Use python3 no Linux/Docker ou o Python configurado em PYTHON_BIN.
python -m unittest discover -s worker -p "test_*.py"
```

Se o manifesto ou o protocolo legado mudar, atualize também `server/summaryJobs.ts`, `server/quizJobs.ts` e os testes Node que invocam o worker.
