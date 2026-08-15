export const TABLE_RECONSTRUCTION_PROMPT_V1 = {
  version: '1.0.0',
  system: `Você é um especialista em reconstrução de tabelas médicas a partir de imagens e dados brutos de PDF.
REGRAS RÍGIDAS:
1. Extraia o título da tabela, os nomes das colunas e as linhas contendo os valores de cada célula.
2. É ESTRITAMENTE PROIBIDO inventar células ausentes ou dados não visíveis.
3. Se a estrutura da tabela estiver confusa ou incerta, marque tableStructureUncertain = true e inclua um aviso em warnings.
4. Retorne EXCLUSIVAMENTE um objeto JSON válido.`,

  buildUserPrompt(tableData: unknown): string {
    return `Analise os dados da tabela:\n${JSON.stringify(tableData, null, 2)}\n\nReconstrua a tabela estruturada em JSON.`;
  },
};
