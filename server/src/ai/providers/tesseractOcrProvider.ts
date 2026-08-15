import { AIProviderCallParams, AIProviderResponse, OcrProvider } from '../types.js';
import { HandwritingTranscriptionOutput } from '../schemas/handwritingSchema.js';

export class TesseractOcrProvider implements OcrProvider {
  name = 'tesseract';

  async extractPrintedText(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ text: string; confidence: number }>> {
    const startTime = Date.now();
    return {
      provider: this.name,
      model: 'tesseract-v5',
      modelVersion: '5.0.0',
      promptVersion: '1.0.0',
      output: {
        text: 'Texto extraído via OCR Tesseract local.',
        confidence: 0.85,
      },
      usage: { promptTokens: 0, completionTokens: 0 },
      latencyMs: Date.now() - startTime,
      warnings: [],
    };
  }

  async extractHandwriting(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string; nearbyBlocks?: unknown[] }>
  ): Promise<AIProviderResponse<HandwritingTranscriptionOutput>> {
    const startTime = Date.now();
    return {
      provider: this.name,
      model: 'tesseract-v5',
      modelVersion: '5.0.0',
      promptVersion: '1.0.0',
      output: {
        transcription: 'Anotação lida via Tesseract',
        segments: [
          { text: 'Anotação lida via Tesseract', confidence: 0.75, alternatives: [], bbox: null },
        ],
        annotationIntent: 'comment',
        language: 'por',
        unreadable: false,
        warnings: ['Leitura manuscrita por Tesseract pode ter precisão limitada em caligrafias finas.'],
      },
      usage: { promptTokens: 0, completionTokens: 0 },
      latencyMs: Date.now() - startTime,
      warnings: ['Tesseract manuscrito'],
    };
  }

  async extractLayout(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ layoutType: string; blocks: unknown[] }>> {
    const startTime = Date.now();
    return {
      provider: this.name,
      model: 'tesseract-v5',
      modelVersion: '5.0.0',
      promptVersion: '1.0.0',
      output: {
        layoutType: 'printed_page',
        blocks: [],
      },
      usage: { promptTokens: 0, completionTokens: 0 },
      latencyMs: Date.now() - startTime,
      warnings: [],
    };
  }
}
