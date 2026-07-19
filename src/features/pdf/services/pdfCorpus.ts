export function createPdfCorpus(processedFiles) {
  let nextGlobalPage = 1;

  const files = processedFiles.map((processedFile, sourceIndex) => {
    const startPage = nextGlobalPage;
    const pageMetadata = processedFile.pageMetadata.map((page) => {
      const globalPage = nextGlobalPage++;
      return {
        ...page,
        pageNum: globalPage,
        globalPage,
        sourcePageNum: page.pageNum,
        sourceIndex,
        sourceName: processedFile.name,
      };
    });

    return {
      ...processedFile,
      sourceIndex,
      startPage,
      endPage: nextGlobalPage - 1,
      pageMetadata,
    };
  });

  const pageMetadata = files.flatMap((file) => file.pageMetadata);
  const pageTexts = pageMetadata.map((page) => page.text);
  const text = pageMetadata.map((page) => (
    `--- Documento: ${page.sourceName} · Página ${page.sourcePageNum} · Página global ${page.pageNum} ---\n${page.text}`
  )).join('\n\n');
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const firstFile = files[0];

  return {
    files,
    file: firstFile?.file ?? null,
    pdfUrl: firstFile?.pdfUrl ?? null,
    name: files.length === 1 ? firstFile.name : `${files.length} PDFs selecionados`,
    size: totalSize,
    numPages: pageMetadata.length,
    text,
    pageTexts,
    pageMetadata,
  };
}

export function resolveCorpusPage(fileData, globalPage) {
  const page = fileData?.pageMetadata?.find((item) => item.pageNum === globalPage);
  if (!page) {
    return {
      pdfUrl: fileData?.pdfUrl ?? null,
      pageNum: globalPage || 1,
      sourceName: fileData?.name ?? 'PDF',
    };
  }

  const sourceFile = fileData?.files?.[page.sourceIndex];
  return {
    pdfUrl: sourceFile?.pdfUrl ?? fileData?.pdfUrl ?? null,
    pageNum: page.sourcePageNum ?? globalPage,
    sourceName: page.sourceName ?? sourceFile?.name ?? fileData?.name ?? 'PDF',
  };
}

export function revokePdfCorpusUrls(fileData) {
  const urls: Array<string | null | undefined> = fileData?.files?.length
    ? fileData.files.map((file) => file.pdfUrl)
    : [fileData?.pdfUrl];

  [...new Set(urls.filter((url): url is string => Boolean(url)))]
    .forEach((url) => URL.revokeObjectURL(url));
}
