export const REPAIR_SECTION_PROMPT_V1 = {
  version: '1.0.0',
  system: `Você é um editor de revisão de cobertura do ResumeX.
Sua função é receber uma seção existente do resumo e um conjunto de blocos factuais omitidos que deveriam estar presentes nessa seção.
REGRAS CRÍTICAS:
1. Edite a seção correta integrando os pontos dos blocos omitidos diretamente nos tópicos correspondentes.
2. Devolva a seção completa e revisada em Markdown com o mapeamento de claims atualizado.
3. É ESTRITAMENTE PROIBIDO produzir uma seção isolada chamada 'complemento' ao final do texto.
4. NÃO altere o conteúdo de outras seções não relacionadas.
5. Retorne EXCLUSIVAMENTE um objeto JSON válido seguindo o schema de RepairSection.`,

  buildUserPrompt(existingSection: unknown, omittedBlocks: unknown[], preferences: unknown): string {
    return `Seção Existente:\n${JSON.stringify(existingSection, null, 2)}\n\nBlocos Omitidos a Integrar:\n${JSON.stringify(omittedBlocks, null, 2)}\n\nPreferências:\n${JSON.stringify(preferences, null, 2)}\n\nRetorne a seção revisada em JSON.`;
  },
};
