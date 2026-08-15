import { OcrProvider, PlanningProvider, SummaryProvider, VisionProvider } from './types.js';
import { GlmVisionProvider } from './providers/glmVisionProvider.js';
import { DeepSeekPlanningProvider } from './providers/deepseekPlanningProvider.js';
import { DeepSeekSummaryProvider } from './providers/deepseekSummaryProvider.js';
import { TesseractOcrProvider } from './providers/tesseractOcrProvider.js';
import { CompositeOcrProvider } from './providers/compositeOcrProvider.js';
import { MockOcrProvider, MockPlanningProvider, MockSummaryProvider, MockVisionProvider } from './providers/mockProviders.js';

export interface AIRouterOptions {
  useMocks?: boolean;
  forcePlanning?: boolean;
}

export class AIRouter {
  readonly ocr: OcrProvider;
  readonly vision: VisionProvider;
  readonly planning: PlanningProvider;
  readonly summary: SummaryProvider;

  constructor(options: AIRouterOptions = {}) {
    if (options.useMocks || process.env.NODE_ENV === 'test') {
      this.ocr = new MockOcrProvider();
      this.vision = new MockVisionProvider();
      this.planning = new MockPlanningProvider();
      this.summary = new MockSummaryProvider();
    } else {
      const tesseract = new TesseractOcrProvider();
      this.vision = new GlmVisionProvider();
      this.ocr = new CompositeOcrProvider(tesseract, this.vision);
      this.planning = new DeepSeekPlanningProvider();
      this.summary = new DeepSeekSummaryProvider();
    }
  }

  selectModelsForDocument(params: { pageCount: number; isComplex: boolean; hasHandwriting: boolean }) {
    const isLongDocument = params.pageCount > 5;
    const isPlanningMandatory = isLongDocument || params.isComplex;

    return {
      planningModel: isPlanningMandatory ? 'deepseek-v4-flash' : null,
      summaryModel: params.isComplex ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
      visionModel: params.hasHandwriting ? 'glm-4.5v' : 'glm-4.5v',
      isPlanningMandatory,
    };
  }
}
