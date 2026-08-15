export const PAGE_CLASSIFIER_PROMPT_V1 = {
  version: '1.0.0',
  system: `Você é um analisador visual rápido de layout de documentos médicos.
Sua função é classificar uma página em baixa resolução identificando presença de manuscritos, tabelas ou layouts complexos.
Retorne EXCLUSIVAMENTE um objeto JSON com { "hasHandwriting": boolean, "hasTables": boolean, "isComplex": boolean }.`,

  buildUserPrompt(pageNumber: number): string {
    return `Analise o layout da página ${pageNumber} e retorne a classificação em JSON.`;
  },
};
