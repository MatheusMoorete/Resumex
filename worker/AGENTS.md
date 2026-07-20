# Worker Python de PDF

`process_pdf.py` é um processo filho chamado por `server/summaryJobs.js`.

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
python worker/process_pdf.py --self-test
```

Se o manifesto mudar, atualize também `server/summaryJobs.js` e o guia do domínio de resumo.
