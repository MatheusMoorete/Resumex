import { AIProviderCallParams, AIProviderResponse, OcrProvider, VisionProvider } from '../types.js';
import { HandwritingTranscriptionOutput } from '../schemas/handwritingSchema.js';

export class CompositeOcrProvider implements OcrProvider {
  name = 'composite';

  constructor(
    private primaryOcr: OcrProvider,
    private fallbackVision?: VisionProvider
  ) {}

  async extractPrintedText(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ text: string; confidence: number }>> {
    try {
      const res = await this.primaryOcr.extractPrintedText(params);
      if (res.output.confidence >= 0.7) return res;
    } catch {}

    return this.primaryOcr.extractPrintedText(params);
  }

  async extractHandwriting(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string; nearbyBlocks?: unknown[] }>
  ): Promise<AIProviderResponse<HandwritingTranscriptionOutput>> {
    try {
      const res = await this.primaryOcr.extractHandwriting(params);
      if (res.output.transcription && !res.output.unreadable) return res;
    } catch {}

    return this.primaryOcr.extractHandwriting(params);
  }

  async extractLayout(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ layoutType: string; blocks: unknown[] }>> {
    return this.primaryOcr.extractLayout(params);
  }
}
