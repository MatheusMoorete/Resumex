import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Camera, CircleX, FileText, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthSession } from '../features/auth/domain/auth';
import Header from '../shared/components/Header';
import ApiKeyModal from '../features/auth/components/ApiKeyModal';
import AccountButton from '../features/auth/components/AccountButton';
import AuthScreen from '../features/auth/components/AuthScreen';
import { authService } from '../features/auth/services/authService';
import UploadZone from '../features/pdf/components/UploadZone';
import PreferencesPanel from '../features/summary/components/PreferencesPanel';
import SpecEditor from '../features/summary/components/SpecEditor';
import ProcessingView from '../features/summary/components/ProcessingView';
import ResultView from '../features/summary/components/ResultView';
import {
  finalizeSummaryJob,
  prepareSummaryJob,
  type VisualQuestion,
} from '../features/summary/services/summaryJobApi';
import QuizView from '../features/quiz/components/QuizView';
import QuizProcessingTimeline from '../features/quiz/components/QuizProcessingTimeline';
import { generateSummary } from '../features/summary/services/deepseekApi';
import { buildQuizFromCorpus } from '../features/quiz/services/quizApi';
import { transcribePDFWithGLM } from '../features/summary/services/zhipuApi';
import { renderPDFPagesToImages } from '../features/pdf/services/pdfExtractor';
import { revokePdfCorpusUrls } from '../features/pdf/services/pdfCorpus';
import { generateFlashcardsFromSummary } from '../features/flashcards/services/flashcardGenerator';
import { assessCorpusComplexity } from '../features/ai/services/aiOrchestrator';
import { setAuthTokenGetter } from '../features/auth/services/authClient';
import { 
  buildSpecPrompt, 
  buildSummaryPrompt, 
  buildSummaryUserMessage, 
  buildAuditPrompt, 
  buildAuditUserMessage,
  buildSummaryRepairPrompt,
  buildSummaryRepairUserMessage,
} from '../features/summary/prompts/templates';
import {
  buildEvidenceMapPrompt,
  buildEvidenceMapUserMessage,
  buildSpecCorrectionPrompt,
  buildSpecCorrectionUserMessage,
  buildSpecAuditPrompt,
  buildSpecAuditUserMessage,
  buildSpecFromEvidenceUserMessage,
} from '../features/summary/prompts/evidence';
import {
  createMockFileData,
  mockEvidenceMap,
  mockFlashcardDrafts,
  mockSpec,
  mockSpecAudit,
  mockSummary,
  mockSummaryLog,
} from '../shared/mocks/e2eMock';

function isLocalBrowserHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

const isE2EMockMode = import.meta.env.DEV
  && import.meta.env.VITE_E2E_MOCK === 'true'
  && isLocalBrowserHost();
const canUseLocalTestFlow = import.meta.env.DEV && isLocalBrowserHost();

const waitForLocalTest = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

function getSessionApiKey(key: string) {
  localStorage.removeItem(key);
  return sessionStorage.getItem(key) || '';
}

const APP_STATE_ROUTES = {
  upload: '/app',
  preferences: '/app/resumo/configurar',
  'rendering-pdf': '/app/resumo/preparando',
  'transcribing-pdf': '/app/resumo/lendo',
  'generating-spec': '/app/resumo/analisando',
  'edit-spec': '/app/resumo/plano',
  processing: '/app/resumo/gerando',
  result: '/app/resumo/resultado',
  'quiz-processing': '/app/simulado/gerando',
  'quiz-result': '/app/simulado/resultado',
  error: '/app/erro',
} as const;

type AppState = keyof typeof APP_STATE_ROUTES;
type HomeMode = 'summary' | 'quiz' | 'flashcards';

const HOME_MODE_ROUTES: Record<HomeMode, string> = {
  summary: '/app/resumo',
  quiz: '/app/simulado',
  flashcards: '/app/flashcards',
};

function getRouteState(pathname: string): AppState | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/app' || Object.values(HOME_MODE_ROUTES).includes(path)) return 'upload';
  return (Object.entries(APP_STATE_ROUTES).find(([, route]) => route === path)?.[0] as AppState | undefined) || null;
}

function getRouteMode(pathname: string): HomeMode {
  const path = pathname.replace(/\/+$/, '') || '/';
  return (Object.entries(HOME_MODE_ROUTES).find(([, route]) => route === path)?.[0] as HomeMode | undefined) || 'summary';
}

/**
 * App States:
 * - 'upload'           → Landing page with upload zone
 * - 'preferences'      → User selects method, format, and detail level
 * - 'rendering-pdf'    → Rendering pages as image for handwriting (selective)
 * - 'transcribing-pdf' → GLM-4V transcribing images to Markdown (selective)
 * - 'generating-spec'  → AI is reading context-base and generating a SPEC
 * - 'edit-spec'        → User is editing the SPEC
 * - 'processing'       → AI is generating the final summary from SPEC + Audit
 * - 'result'           → Summary ready
 * - 'error'            → Error occurred
 */

/**
 * Helper to programmatically scan generated text for page references.
 * Returns an array of missing page numbers.
 */
function getMissingPages(summaryText, totalPages) {
  if (!summaryText) return [];
  const mentionedPages = [];

  // 1. Matches citations in format: (p. X) or (p. X-Y) or (p.X)
  const pRefRegex = /\(p\.\s*(\d+)(?:-(\d+))?\)/gi;
  let match;
  while ((match = pRefRegex.exec(summaryText)) !== null) {
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    for (let p = start; p <= end; p++) {
      if (!mentionedPages.includes(p)) {
        mentionedPages.push(p);
      }
    }
  }

  // 2. Matches general mentions: página X, pág X, p. X
  const pageRegex = /(?:página|pág|p\.)\s*(\d+)/gi;
  while ((match = pageRegex.exec(summaryText)) !== null) {
    const p = parseInt(match[1], 10);
    if (p <= totalPages && !mentionedPages.includes(p)) {
      mentionedPages.push(p);
    }
  }

  // Find which pages from 1 to totalPages are missing
  const missing = [];
  for (let p = 1; p <= totalPages; p++) {
    if (!mentionedPages.includes(p)) {
      missing.push(p);
    }
  }
  return missing;
}

function getSpecAuditStatus(auditText) {
  if (!auditText) return 'PENDENTE';
  const match = auditText.match(/\*\*Status:\*\*\s*([^\n]+)/i);
  if (!match) return 'PENDENTE';
  return match[1].trim().toUpperCase();
}

const HIGH_RISK_PATTERN = /(dose|dosagem|mg|mcg|ml|mmhg|cm3|cm|mm|grau|graus|°|>=|<=|>|<|=|\d|paco2|pao2|sat|pas|pam|pic|ppc|glasgow|gcs|tce|grave|moderado|leve|apneia|eeg|arteriografia|doppler|cintilografia|protocolo|conduta|cirurgia|drenagem|manitol|salina|fenitoina|barbit|cortico|anticoagul|iot|sedacao|seda|bnm|xabcde)/i;
const UNCERTAIN_PATTERN = /(incerto|duvid|ilegivel|ilegível|falha|conflito|possivel|possível|nao identificado|não identificado|significado)/i;
const SECTION_PATTERN = /^###\s+(.+)/;
const PAGE_PATTERN = /^##\s+P[aá]gina\s+(\d+)/i;

function extractHighRiskEvidenceItems(evidenceMap) {
  if (!evidenceMap) return [];

  const items = [];
  let page = null;
  let section = '';

  const lines = evidenceMap.split('\n');

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) return;

    const pageMatch = line.match(PAGE_PATTERN);
    if (pageMatch) {
      page = Number(pageMatch[1]);
      section = '';
      return;
    }

    const sectionMatch = line.match(SECTION_PATTERN);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      return;
    }

    const inUncertainSection = /manuscritos incertos|falhas e riscos|valores/i.test(section);
    const inCriticalManuscriptSection = /manuscritos legiveis|manuscritos legíveis/i.test(section) && HIGH_RISK_PATTERN.test(line);
    const inRiskSection = inUncertainSection || inCriticalManuscriptSection;
    const isPotentiallyUncertain = UNCERTAIN_PATTERN.test(line) || /manuscritos legiveis|manuscritos legíveis/i.test(section);
    const isHighRisk = HIGH_RISK_PATTERN.test(line);

    if (page && inRiskSection && isPotentiallyUncertain && isHighRisk) {
      const context = lines
        .slice(Math.max(0, lineIndex - 3), Math.min(lines.length, lineIndex + 4))
        .map((contextLine) => contextLine.trim())
        .filter((contextLine) => (
          contextLine
          && contextLine !== line
          && !/^#{1,3}\s+/.test(contextLine)
          && !/^---/.test(contextLine)
        ))
        .slice(0, 4)
        .map((contextLine) => contextLine.replace(/^[-*]\s*/, ''))
        .join('\n');

      items.push({
        id: `p${page}-${items.length}`,
        page,
        section,
        text: line.replace(/^[-*]\s*/, ''),
        context,
        reason: 'Pode alterar valor, conduta, classificacao, protocolo ou interpretacao clinica.',
      });
    }
  });

  return items;
}

function buildRiskReviewNotes(highRiskItems, riskDecisions) {
  if (!highRiskItems.length) return '';

  const lines = highRiskItems.map((item) => {
    const decision = riskDecisions[item.id];
    if (!decision) {
      return `- Pagina ${item.page}: "${item.text}" -> sem decisao; nao usar no resumo principal.`;
    }
    if (decision.action === 'ignore') {
      return `- Pagina ${item.page}: "${item.text}" -> ignorar no resumo principal; manter como revisao humana se necessario.`;
    }
    if (decision.action === 'use') {
      return `- Pagina ${item.page}: usar literalmente: "${item.text}". Nao expandir nem interpretar.`;
    }
    return `- Pagina ${item.page}: substituir trecho incerto por: "${decision.value}". Usar apenas esta correcao confirmada.`;
  });

  return `## DECISOES HUMANAS SOBRE MANUSCRITOS/VALORES INCERTOS\n\n${lines.join('\n')}`;
}

function splitOperationalSections(markdown) {
  const source = String(markdown || '').trim();
  if (!source) return { summary: '', log: '' };

  const operationalHeadingRegex = /^#{2,3}\s*(?:[^\n\wÀ-ÿ#]*\s*)?(Pontos que exigem revisão humana|Pontos que exigem revisao humana|Cobertura das Páginas|Cobertura das Paginas|Relatório de Auditoria Automática|Relatorio de Auditoria Automatica)\b/im;
  const match = operationalHeadingRegex.exec(source);

  if (!match) return { summary: source, log: '' };

  return {
    summary: source.slice(0, match.index).trim(),
    log: source.slice(match.index).trim(),
  };
}

function buildOutputPreferenceInstructions(preferences) {
  const method = preferences?.method?.name || 'Livre';
  const detail = preferences?.detailLevel?.label || 'Equilibrado';
  const formats = preferences?.formats || [];
  const formatIds = formats.map((format) => format.id);
  const formatLabels = formats.map((format) => format.label).join(', ') || 'nao definido';

  const rules = [
    '## PREFERENCIAS DE SAIDA DO USUARIO',
    `- Metodo selecionado: ${method}.`,
    `- Formatos selecionados: ${formatLabels}.`,
    `- Profundidade selecionada: ${detail}.`,
    '',
    'Estas preferencias tem prioridade sobre instrucoes genericas de formatacao.',
  ];

  if (formatIds.includes('text') && !formatIds.includes('bullets')) {
    rules.push('- Usar texto corrido como formato principal. Evitar listas longas de bullets.');
  }
  if (formatIds.includes('bullets')) {
    rules.push('- Usar bullet points para organizar informacoes e revisao rapida.');
  }
  if (formatIds.includes('tables')) {
    rules.push('- Usar tabelas somente para comparacoes, classificacoes, criterios ou condutas paralelas.');
  } else {
    rules.push('- Nao usar tabelas, salvo se a SPEC editada pelo usuario pedir explicitamente uma tabela especifica.');
  }
  if (formatIds.includes('qa')) {
    rules.push('- Incluir blocos de perguntas e respostas para recordacao ativa.');
  }
  if (formatIds.includes('mnemonics')) {
    rules.push('- Incluir mnemonicos apenas quando forem diretamente derivados do conteudo do PDF.');
  }
  if (formatIds.includes('flashcards')) {
    rules.push('- Incluir flashcards curtos no formato Frente / Verso.');
  }
  if (formatIds.length === 1 && formatIds[0] === 'text') {
    rules.push('- Nao transformar o resumo em bullet points. Use paragrafos com subtitulos.');
  }

  if (preferences?.detailLevel?.id === 'concise') {
    rules.push('- Ser conciso: priorizar o essencial, sem expandir explicacoes alem do necessario.');
  } else if (preferences?.detailLevel?.id === 'detailed') {
    rules.push('- Ser detalhado: preservar explicacoes, excecoes, criterios e pontos finos do material.');
  } else {
    rules.push('- Manter equilibrio: detalhar criterios e condutas sem expandir conteudo desnecessario.');
  }

  if (preferences?.method?.id === 'clinical') {
    rules.push('- Estruturar com foco clinico: definicao, achados, criterios, conduta e pontos de atencao.');
  } else if (preferences?.method?.id === 'active-recall') {
    rules.push('- Priorizar perguntas de verificacao e recuperacao ativa ao final de cada grande secao.');
  } else if (preferences?.method?.id === 'cornell') {
    rules.push('- Organizar em formato Cornell: pistas/perguntas, anotacoes principais e resumo curto por bloco.');
  } else if (preferences?.method?.id === 'cheatsheet') {
    rules.push('- Organizar como consulta rapida: criterios, limiares, condutas e comparacoes essenciais.');
  }

  return rules.join('\n');
}

function isRiskDecisionResolved(decision) {
  if (!decision) return false;
  if (decision.action === 'correct') return Boolean(decision.value?.trim());
  return true;
}

const QUIZ_VISUAL_MAX_PAGES = 60;

function getQuizVisualPages(file) {
  const totalPages = Number(file?.numPages) || 0;
  return Array.from({ length: Math.min(totalPages, QUIZ_VISUAL_MAX_PAGES) }, (_, index) => index + 1);
}

function getQuizTextLength(text) {
  return String(text || '').replace(/---[^\n]*---/g, '').trim().length;
}

function mergeQuizVisualText(file, transcribedTextMap, pagesToTranscribe) {
  const pageSet = new Set(pagesToTranscribe);
  const totalPages = Number(file?.numPages) || pagesToTranscribe.length;

  return Array.from({ length: totalPages }, (_, index) => {
    const pageNum = index + 1;
    const visualText = transcribedTextMap?.[pageNum];
    const textFallback = file.pageTexts?.[index] || '';
    const pageText = pageSet.has(pageNum) && visualText ? visualText : textFallback;
    return `--- Pagina ${pageNum} ---\n${pageText}`;
  }).join('\n\n');
}

function needsQuizVisionPreparation(file) {
  const visualRequested = file?.requiresVision || file?.readMode === 'visual';
  return Boolean(visualRequested && !file?.visualStatus);
}

function getSummaryAuditStatus(auditText) {
  if (!auditText) return 'PENDENTE';
  const match = auditText.match(/\*\*Status final:\*\*\s*(?:\[)?([^\]\n]+)/i);
  if (!match) return 'PENDENTE';
  return match[1].trim().toUpperCase();
}

async function renderSummaryCorpusPages(fileInfo, globalPages, options) {
  const { onProgress, ...renderOptions } = options;
  const globalPageSet = new Set(globalPages);
  const sources = fileInfo.files?.length
    ? fileInfo.files
    : [{ file: fileInfo.file, sourceIndex: 0 }];
  const images = {};
  let completedPages = 0;

  for (const source of sources) {
    const mappings = fileInfo.pageMetadata.filter((page) => (
      globalPageSet.has(page.pageNum)
      && (fileInfo.files?.length ? page.sourceIndex === source.sourceIndex : true)
    ));
    if (!mappings.length) continue;

    const localPages = mappings.map((page) => page.sourcePageNum ?? page.pageNum);
    const result = await renderPDFPagesToImages(source.file, {
      ...renderOptions,
      pageNumbersToRender: localPages,
      onProgress: ({ current }) => {
        onProgress?.({ current: completedPages + current, total: globalPages.length });
      },
    });

    mappings.forEach((page) => {
      const localPage = page.sourcePageNum ?? page.pageNum;
      if (result.images[localPage]) images[page.pageNum] = result.images[localPage];
    });
    completedPages += mappings.length;
  }

  return { images };
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const isSignedIn = Boolean(session);
  const getToken = useCallback(async () => session?.accessToken || null, [session]);

  useEffect(() => {
    authService.getSession().then((nextSession) => {
      setSession(nextSession);
      setIsLoaded(true);
    }).catch(() => {
      setSession(null);
      setIsLoaded(true);
    });

    return authService.onAuthStateChange((nextSession) => {
      setSession(nextSession);
      setIsLoaded(true);
    });
  }, []);

  // Core state - DeepSeek generates text; GLM transcribes visual/handwritten pages.
  // Local keys are optional overrides. Server-side env keys are preferred.
  const [appState, setAppStateValue] = useState<AppState>(() => getRouteState(location.pathname) || 'upload');
  const setAppState = useCallback((nextState: AppState) => {
    setAppStateValue(nextState);
    navigate(APP_STATE_ROUTES[nextState], { replace: true });
  }, [navigate]);
  const [deepseekKey, setDeepseekKey] = useState(() => 
    getSessionApiKey('resumex_api_key')
  );
  const [zhipuKey, setZhipuKey] = useState(() => 
    getSessionApiKey('resumex_zhipu_key')
  );
  const [serverConfig, setServerConfig] = useState({
    deepseekConfigured: false,
    zhipuConfigured: false,
    kimiConfigured: false,
    auditorConfigured: false,
    auditorProvider: null as string | null,
    loaded: false,
  });
  const [accessDenied, setAccessDenied] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  // Data state
  const [fileData, setFileData] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [renderingProgress, setRenderingProgress] = useState(0);
  const [transcriptionProgress, setTranscriptionProgress] = useState({ current: 0, total: 0 });
  const [contextBase, setContextBase] = useState('');
  const [evidenceMap, setEvidenceMap] = useState('');
  const [spec, setSpec] = useState('');
  const [specAudit, setSpecAudit] = useState('');
  const [specCorrectionCount, setSpecCorrectionCount] = useState(0);
  const [specGenerationStage, setSpecGenerationStage] = useState('evidence');
  const [riskDecisions, setRiskDecisions] = useState({});
  const [activeSummaryJobId, setActiveSummaryJobId] = useState<string | null>(null);
  const [visualQuestions, setVisualQuestions] = useState<VisualQuestion[]>([]);
  const [summary, setSummary] = useState('');
  const [summaryLog, setSummaryLog] = useState('');
  const [summaryJob, setSummaryJob] = useState({ stage: 'queued', progress: 0 });
  const [isAuditing, setIsAuditing] = useState(false);
  const [missingPages, setMissingPages] = useState([]);
  const [coverageReinforcementInstruction, setCoverageReinforcementInstruction] = useState('');
  const [quizFiles, setQuizFiles] = useState([]);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizAnalysis, setQuizAnalysis] = useState(null);
  const [quizOptions, setQuizOptions] = useState({ questionMode: 'generated_only', questionCount: 15 });
  const [quizProcessingMessage, setQuizProcessingMessage] = useState('');
  const [quizProcessingStage, setQuizProcessingStage] = useState('files');
  const [flashcardDrafts, setFlashcardDrafts] = useState([]);
  const [homeInitialMode, setHomeInitialMode] = useState<HomeMode>(() => getRouteMode(location.pathname));
  const [hasWorkspaceActivity, setHasWorkspaceActivity] = useState(false);
  const [workspaceResetKey, setWorkspaceResetKey] = useState(0);
  const [showHomeConfirmation, setShowHomeConfirmation] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isLocalTestFlow, setIsLocalTestFlow] = useState(false);

  const openHomeMode = useCallback((mode: HomeMode) => {
    setAppStateValue('upload');
    setHomeInitialMode(mode);
    navigate(HOME_MODE_ROUTES[mode]);
  }, [navigate]);

  useEffect(() => {
    const routeState = getRouteState(location.pathname);
    if (!routeState) {
      navigate('/app', { replace: true });
      return;
    }

    const needsSummaryData = ['preferences', 'rendering-pdf', 'transcribing-pdf', 'generating-spec', 'edit-spec', 'processing', 'result'].includes(routeState);
    const needsQuizData = routeState === 'quiz-processing' || routeState === 'quiz-result';

    if ((!isE2EMockMode && needsSummaryData && !fileData) || (needsQuizData && !quizFiles.length)) {
      setAppStateValue('upload');
      setHomeInitialMode(needsQuizData ? 'quiz' : 'summary');
      navigate(needsQuizData ? HOME_MODE_ROUTES.quiz : '/app', { replace: true });
      return;
    }

    setAppStateValue(routeState);
    if (routeState === 'upload') setHomeInitialMode(getRouteMode(location.pathname));
  }, [fileData, location.pathname, navigate, quizFiles.length]);

  // Abort controller
  const abortControllerRef = useRef(null);
  const hasDeepseekAccess = Boolean(deepseekKey || serverConfig.deepseekConfigured);
  const hasZhipuAccess = Boolean(zhipuKey || serverConfig.zhipuConfigured);
  const hasIndependentAuditor = Boolean(serverConfig.auditorConfigured);
  const highRiskItems = useMemo(
    () => visualQuestions.length
      ? visualQuestions
      : extractHighRiskEvidenceItems(evidenceMap || fileData?.evidenceMap || ''),
    [evidenceMap, fileData, visualQuestions]
  );
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;

  useEffect(() => {
    let isMounted = true;

    if (isE2EMockMode) {
      setAuthTokenGetter(null);
      setServerConfig({
        deepseekConfigured: true,
        zhipuConfigured: true,
        kimiConfigured: true,
        auditorConfigured: true,
        auditorProvider: 'mock',
        loaded: true,
      });
      setAccessDenied(false);
      return () => {
        isMounted = false;
      };
    }

    if (!isLoaded) return () => {
      isMounted = false;
    };

    if (!isSignedIn) {
      setAuthTokenGetter(null);
      setServerConfig((prev) => ({ ...prev, loaded: true }));
      setAccessDenied(false);
      return () => {
        isMounted = false;
      };
    }

    setAuthTokenGetter(getToken);
    setAccessDenied(false);

    getToken()
      .then((token) => {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        return fetch('/api/config', {
          credentials: 'same-origin',
          headers,
        });
      })
      .then(async (configResponse) => {
        if (!configResponse.ok) {
          if (configResponse.status === 403) setAccessDenied(true);
          setServerConfig((prev) => ({ ...prev, loaded: true }));
          return;
        }
        const config = configResponse.ok ? await configResponse.json() : null;
        if (!isMounted || !config) return;
        setServerConfig({
          deepseekConfigured: Boolean(config.deepseekConfigured),
          zhipuConfigured: Boolean(config.zhipuConfigured),
          kimiConfigured: Boolean(config.kimiConfigured),
          auditorConfigured: Boolean(config.auditorConfigured),
          auditorProvider: config.auditorProvider || null,
          loaded: true,
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setServerConfig((prev) => ({ ...prev, loaded: true }));
      });

    return () => {
      isMounted = false;
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isE2EMockMode) return;

    setFileData(createMockFileData());
    setPreferences({
      provider: 'mock-e2e',
      readHandwriting: false,
      handwritingMode: 'manual',
      manualVisionPages: [],
      method: { id: 'free', name: 'Livre' },
      formats: [{ id: 'bullets', label: 'Bullet points' }],
      source: { id: 'mock', label: 'Mock E2E' },
      detailLevel: { id: 'balanced', label: 'Equilibrado' },
    });
    setSpec('# SPEC Mock E2E\n\nValidar exportacao para o Notion sem consumir tokens.');
    setSummary(mockSummary);
    setSummaryLog('');
    setMissingPages([]);
    setAppState('result');
  }, []);

  const refreshServerConfig = useCallback(async () => {
    const token = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const configResponse = await fetch('/api/config', {
      credentials: 'same-origin',
      headers,
    });
    if (!configResponse.ok) return;

    const config = await configResponse.json();
    setServerConfig({
      deepseekConfigured: Boolean(config.deepseekConfigured),
      zhipuConfigured: Boolean(config.zhipuConfigured),
      kimiConfigured: Boolean(config.kimiConfigured),
      auditorConfigured: Boolean(config.auditorConfigured),
      auditorProvider: config.auditorProvider || null,
      loaded: true,
    });
  }, [getToken]);

  // --- API Key saving ---
  const handleSaveApiKey = useCallback((keys) => {
    setDeepseekKey(keys.deepseek);
    setZhipuKey(keys.zhipu);
    sessionStorage.setItem('resumex_api_key', keys.deepseek);
    sessionStorage.setItem('resumex_zhipu_key', keys.zhipu);
    setShowApiKeyModal(false);
  }, []);

  // --- Upload complete → go to preferences ---
  const handleUploadComplete = useCallback((data) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    revokePdfCorpusUrls(fileData);
    setFileData(data);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setError('');
    setAppState('preferences');
  }, [fileData]);

  const handleStartLocalTest = useCallback(() => {
    setIsLocalTestFlow(true);
    handleUploadComplete(createMockFileData());
  }, [handleUploadComplete]);

  const handleStartQuiz = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions({ questionMode: 'generated_only', questionCount: 15 });
    setQuizProcessingMessage('');
    setQuizProcessingStage('files');
    setError('');
    setIsLocalTestFlow(false);
    openHomeMode('quiz');
  }, [openHomeMode]);

  const handleCreateFlashcardsFromSummary = useCallback(async () => {
    if (isLocalTestFlow) {
      setFlashcardDrafts(mockFlashcardDrafts);
      openHomeMode('flashcards');
      return;
    }

    if (!hasDeepseekAccess) {
      setShowApiKeyModal(true);
      throw new Error('Configure o DeepSeek para gerar flashcards automaticamente.');
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const drafts = await generateFlashcardsFromSummary({
      apiKey: deepseekKey,
      summary,
      signal: controller.signal,
    });
    if (!drafts.length) throw new Error('O resumo não gerou cartões válidos.');
    setFlashcardDrafts(drafts);
    openHomeMode('flashcards');
  }, [deepseekKey, hasDeepseekAccess, isLocalTestFlow, openHomeMode, summary]);

  const handleGenerateQuiz = useCallback(async (files, options: any = {}) => {
    if (!hasDeepseekAccess) {
      setShowApiKeyModal(true);
      return;
    }
    if (!hasIndependentAuditor) {
      setError('Configure OPENROUTER_API_KEY, KIMI_API_KEY ou OPENAI_API_KEY no servidor para habilitar a auditoria independente do simulado.');
      setAppState('error');
      return;
    }

    const nextQuizOptions = {
      questionMode: options.questionMode || quizOptions.questionMode || 'generated_only',
      questionCount: options.questionCount || quizOptions.questionCount || 15,
      practiceMode: options.practiceMode || 'default',
    };
    const visualFiles = files.filter(needsQuizVisionPreparation);
    if (visualFiles.length > 0 && !hasZhipuAccess) {
      setShowApiKeyModal(true);
      return;
    }

    setQuizFiles(files);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions(nextQuizOptions);
    setError('');
    setQuizProcessingStage(visualFiles.length > 0 ? 'vision' : 'files');
    setQuizProcessingMessage(
      visualFiles.length > 0
        ? 'Preparando PDFs com foto/imagem para leitura visual...'
        : nextQuizOptions.practiceMode === 'focused'
        ? 'Montando novo teste com foco nos erros...'
        : nextQuizOptions.practiceMode === 'different'
        ? 'Montando novo teste com perguntas diferentes...'
        : nextQuizOptions.questionMode === 'mixed'
        ? 'Classificando arquivos, extraindo questões existentes e preparando material teórico...'
        : 'Classificando arquivos e usando bancos de questões como referência para gerar questões novas...'
    );
    setAppState('quiz-processing');
    abortControllerRef.current = new AbortController();

    try {
      let quizSourceFiles = files;

      if (visualFiles.length > 0) {
        const visualKeys = new Set(visualFiles.map((file) => `${file.name}-${file.size}`));
        const preparedFiles = [];

        for (const file of files) {
          const needsVisual = visualKeys.has(`${file.name}-${file.size}`);
          if (!needsVisual) {
            preparedFiles.push(file);
            continue;
          }

          const pagesToTranscribe = getQuizVisualPages(file);
          setQuizProcessingStage('vision');
          setQuizProcessingMessage(`Convertendo ${file.name} em imagens (${pagesToTranscribe.length} páginas)...`);

          const { images } = await renderPDFPagesToImages(file.file, {
            scale: 1.55,
            quality: 0.86,
            format: 'image/jpeg',
            maxPages: QUIZ_VISUAL_MAX_PAGES,
            pageNumbersToRender: pagesToTranscribe,
            onProgress: ({ current, total }) => {
              setQuizProcessingMessage(`Renderizando ${file.name}: ${current}/${total} páginas.`);
            },
          });

          setQuizProcessingMessage(`Lendo imagens de ${file.name} com GLM visual...`);
          const transcribedTextMap = await transcribePDFWithGLM({
            apiKey: zhipuKey,
            pageImages: images,
            pageNumbersToTranscribe: pagesToTranscribe,
            totalPages: file.numPages,
            signal: abortControllerRef.current.signal,
            onProgress: ({ current, total }) => {
              setQuizProcessingMessage(`Transcrevendo ${file.name}: ${current}/${total} páginas.`);
            },
          });

          const visualText = mergeQuizVisualText(file, transcribedTextMap, pagesToTranscribe);
          preparedFiles.push({
            ...file,
            text: visualText,
            textLength: getQuizTextLength(visualText),
            readMode: 'visual',
            requiresVision: false,
            visualStatus: pagesToTranscribe.length < file.numPages ? 'partial' : 'transcribed',
            visualTranscribedPages: pagesToTranscribe,
            transcribedTextMap,
          });
        }

        quizSourceFiles = preparedFiles;
        setQuizFiles(preparedFiles);
      }

      setQuizProcessingMessage(
        nextQuizOptions.practiceMode === 'focused'
          ? 'Gerando questões parecidas com os erros do aluno...'
          : nextQuizOptions.practiceMode === 'different'
          ? 'Gerando questões diferentes das anteriores...'
          : nextQuizOptions.questionMode === 'mixed'
          ? 'Classificando arquivos, extraindo questões existentes e preparando material teórico...'
          : 'Classificando arquivos e usando bancos de questões como referência para gerar questões novas...'
      );
      setQuizProcessingStage('classify');

      const analysis = await buildQuizFromCorpus({
        apiKey: deepseekKey,
        files: quizSourceFiles,
        questionMode: nextQuizOptions.questionMode,
        questionCount: nextQuizOptions.questionCount,
        previousQuestions: options.previousQuestions || [],
        focusQuestions: options.focusQuestions || [],
        practiceMode: nextQuizOptions.practiceMode,
        onProgress: ({ stage, message }) => {
          if (stage) setQuizProcessingStage(stage);
          if (message) setQuizProcessingMessage(message);
        },
        signal: abortControllerRef.current.signal,
      });
      setQuizAnalysis(analysis);
      setQuizQuestions(analysis.questions);
      setAppState('quiz-result');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Erro ao gerar o teste.');
      setAppState('error');
    }
  }, [deepseekKey, hasDeepseekAccess, hasIndependentAuditor, hasZhipuAccess, quizOptions.questionCount, quizOptions.questionMode, zhipuKey]);

  // --- Preferences selected → generate SPEC ---
  const handleGenerateQuizVariant = useCallback((variant, payload: any = {}) => {
    if (!quizFiles.length || !quizQuestions.length) return;

    handleGenerateQuiz(quizFiles, {
      questionMode: quizOptions.questionMode || quizAnalysis?.questionMode || 'generated_only',
      questionCount: quizOptions.questionCount || quizQuestions.length || 15,
      practiceMode: variant,
      previousQuestions: quizQuestions,
      focusQuestions: payload.focusQuestions || [],
    });
  }, [handleGenerateQuiz, quizAnalysis, quizFiles, quizOptions, quizQuestions]);

  const handleCancelQuizProcessing = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizProcessingMessage('');
    setQuizProcessingStage('files');
    setFlashcardDrafts([]);
    setError('');
    openHomeMode('quiz');
  }, [openHomeMode]);

  const runLocalSpecFlow = useCallback(async (prefs) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const mockFile = fileData || createMockFileData();

    setPreferences(prefs);
    setContextBase(mockFile.contextBase);
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setError('');
    setSpecGenerationStage('evidence');
    setAppState('generating-spec');

    await waitForLocalTest(650);
    if (controller.signal.aborted) return;
    setEvidenceMap(mockEvidenceMap);
    setSpecGenerationStage('structure');

    await waitForLocalTest(650);
    if (controller.signal.aborted) return;
    setSpec(mockSpec);
    setSpecGenerationStage('audit');

    await waitForLocalTest(750);
    if (controller.signal.aborted) return;
    setSpecAudit(mockSpecAudit);
    setAppState('edit-spec');
  }, [fileData]);

  const handlePreferencesComplete = useCallback(async (prefs) => {
    setPreferences(prefs);

    if (isLocalTestFlow) {
      runLocalSpecFlow(prefs);
      return;
    }

    if (!serverConfig.deepseekConfigured) {
      setError('Configure DEEPSEEK_API_KEY no servidor para gerar o resumo otimizado.');
      setAppState('error');
      return;
    }
    if (prefs.readHandwriting && !serverConfig.zhipuConfigured) {
      setError('Configure ZHIPU_API_KEY no servidor para a leitura visual.');
      setAppState('error');
      return;
    }

    const files = (fileData?.files || []).map((item) => item.file).filter(Boolean);
    if (!files.length) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSummary('');
    setSummaryLog('');
    setSpec('');
    setSpecAudit('');
    setRiskDecisions({});
    setVisualQuestions([]);
    setActiveSummaryJobId(null);
    setSummaryJob({ stage: 'uploading', progress: 0 });
    setError('');
    setAppState('processing');

    try {
      const job = await prepareSummaryJob({
        files,
        preferences: prefs,
        signal: controller.signal,
        onProgress: setSummaryJob,
      });
      setActiveSummaryJobId(job.id);
      setSpec(job.spec || '');
      setVisualQuestions(job.questions || []);
      setMissingPages([]);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
      }
      if (controller.signal.aborted) return;
      setAppState('edit-spec');
    } catch (jobError) {
      if (jobError?.name === 'AbortError') return;
      setError(jobError instanceof Error ? jobError.message : 'Erro ao gerar o resumo.');
      setAppState('error');
    }
  }, [fileData, isLocalTestFlow, runLocalSpecFlow, serverConfig.deepseekConfigured, serverConfig.zhipuConfigured, setAppState]);

  // --- Generate SPEC (Step 1) ---
  const generateSpec = useCallback(async (data, prefs) => {
    const fileInfo = data || fileData;
    const prefsToUse = prefs || preferences;

    if (!fileInfo || !hasDeepseekAccess || !hasIndependentAuditor || !hasZhipuAccess || !prefsToUse) return;

    let pageImages = fileInfo.pageImages || {};
    let transcribedTextMap = fileInfo.transcribedTextMap || {};

    // 1. Identify which pages need vision analysis.
    // When handwriting mode is enabled, send every page to GLM because ink can be
    // flattened into page graphics and not exposed as PDF annotations.
    const detectedVisionPages = fileInfo.pageMetadata
      ? fileInfo.pageMetadata.filter(p => p.needsVision).map(p => p.pageNum)
      : [];
    const allPageNumbers = fileInfo.pageMetadata
      ? fileInfo.pageMetadata.map(p => p.pageNum)
      : Array.from({ length: fileInfo.numPages }, (_, index) => index + 1);

    const needsVisionFlow = prefsToUse.readHandwriting;
    const manualVisionPages = prefsToUse.manualVisionPages || [];
    const handwritingMode = prefsToUse.handwritingMode || 'auto';
    const visionPages = !needsVisionFlow
      ? []
      : handwritingMode === 'all'
        ? allPageNumbers
        : handwritingMode === 'manual'
          ? manualVisionPages
          : detectedVisionPages;
    const hasVisionPages = visionPages.length > 0;

    // 2. Render only pages that need vision
    if (needsVisionFlow && hasVisionPages) {
      const pagesToRender = visionPages.filter(p => !pageImages[p]);

      if (pagesToRender.length > 0) {
        setAppState('rendering-pdf');
        setRenderingProgress(0);
        try {
          const highFidelity = handwritingMode === 'all';
          const { images } = await renderSummaryCorpusPages(fileInfo, pagesToRender, {
            scale: highFidelity ? 2.0 : 1.6,
            quality: highFidelity ? 0.92 : 0.86,
            format: highFidelity ? 'image/png' : 'image/jpeg',
            onProgress: ({ current, total }) => {
              setRenderingProgress(Math.round((current / total) * 100));
            },
          });
          
          // Merge newly rendered images with cached ones
          pageImages = { ...pageImages, ...images };
          fileInfo.pageImages = pageImages;
        } catch (err) {
          console.error('PDF rendering error:', err);
          setError('Erro ao processar as páginas do PDF para leitura visual.');
          setAppState('error');
          return;
        }
      }
    }

    // 3. Transcribe only pages that need vision with GLM.
    if (needsVisionFlow && hasVisionPages) {
      const pagesToTranscribe = visionPages.filter(p => !transcribedTextMap[p]);

      if (pagesToTranscribe.length > 0) {
        setAppState('transcribing-pdf');
        setTranscriptionProgress({ current: 0, total: pagesToTranscribe.length });
        setError('');
        abortControllerRef.current = new AbortController();
        try {
          const transcriptMap = await transcribePDFWithGLM({
            apiKey: zhipuKey,
            pageImages,
            pageNumbersToTranscribe: pagesToTranscribe,
            totalPages: fileInfo.numPages,
            onProgress: ({ current, total }) => {
              setTranscriptionProgress({ current, total });
            },
            signal: abortControllerRef.current.signal,
          });
          
          // Merge transcriptions
          transcribedTextMap = { ...transcribedTextMap, ...transcriptMap };
          fileInfo.transcribedTextMap = transcribedTextMap;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.error('GLM Transcription error:', err);
          setError(err.message || 'Erro ao transcrever material com o GLM-4V.');
          setAppState('error');
          return;
        }
      }
    }

    // 4. Build context-base: keep PDF text and append GLM visual transcription.
    const generatedContext = fileInfo.pageMetadata.map(page => {
      const pageNum = page.pageNum;
      const sourceLabel = page.sourceName
        ? `${page.sourceName} · página ${page.sourcePageNum}`
        : `PDF · página ${pageNum}`;
      const pdfText = page.text?.trim()
        ? page.text.trim()
        : '[Sem texto selecionável extraído pelo PDF.js]';
      const visualText = needsVisionFlow
        ? transcribedTextMap[pageNum] || `[⚠️ Transcrição visual não disponível na Página ${pageNum}]`
        : '';

      return [
        `--- Página global ${pageNum} · ${sourceLabel} ---`,
        `## Texto selecionável extraído do PDF`,
        pdfText,
        needsVisionFlow ? `## Transcrição visual GLM-4V da página renderizada` : '',
        needsVisionFlow ? visualText : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const orchestration = assessCorpusComplexity({
      text: generatedContext,
      numPages: fileInfo.numPages,
      fileCount: fileInfo.files?.length || 1,
      hasVision: needsVisionFlow && hasVisionPages,
    });

    if (orchestration.tier === 'invalid') {
      setError(orchestration.reasons[0]);
      setAppState('error');
      return;
    }

    setContextBase(generatedContext);
    fileInfo.contextBase = generatedContext;
    fileInfo.aiComplexity = orchestration;
    setFileData(fileInfo);

    // 5. Build an evidence map, then generate and audit the SPEC.
    setAppState('generating-spec');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setEvidenceMap('');
    setSpecGenerationStage('evidence');
    setError('');

    abortControllerRef.current = new AbortController();
    const evidencePrompt = buildEvidenceMapPrompt();
    const specPrompt = buildSpecPrompt(prefsToUse);
    const specAuditPrompt = buildSpecAuditPrompt();
    const specCorrectionPrompt = buildSpecCorrectionPrompt();
    const outputPreferenceInstructions = buildOutputPreferenceInstructions(prefsToUse);

    try {
      let generatedEvidenceMap = '';
      await generateSummary({
        apiKey: deepseekKey,
        role: 'evidence',
        pdfText: buildEvidenceMapUserMessage(generatedContext),
        systemPrompt: evidencePrompt,
        onChunk: (chunk) => {
          generatedEvidenceMap += chunk;
        },
        signal: abortControllerRef.current.signal,
      });

      setEvidenceMap(generatedEvidenceMap);
      fileInfo.evidenceMap = generatedEvidenceMap;
      setFileData(fileInfo);

      setSpecGenerationStage('structure');
      let generatedSpec = '';
      await generateSummary({
        apiKey: deepseekKey,
        role: 'spec',
        pdfText: `${outputPreferenceInstructions}\n\n---\n\n${buildSpecFromEvidenceUserMessage(generatedEvidenceMap)}`,
        systemPrompt: specPrompt,
        onChunk: (chunk) => {
          generatedSpec += chunk;
          setSpec(generatedSpec);
        },
        signal: abortControllerRef.current.signal,
      });

      let currentSpec = generatedSpec;
      let currentAudit = '';
      let correctionCount = 0;

      const routineSpecAuditRole = orchestration.tier === 'simple'
        ? 'spec-audit-simple'
        : 'spec-audit';
      const auditSpec = async (
        specToAudit,
        role: 'spec-audit-simple' | 'spec-audit' | 'spec-audit-critical' = routineSpecAuditRole
      ) => {
        let audit = '';
        await generateSummary({
          apiKey: deepseekKey,
          role,
          pdfText: buildSpecAuditUserMessage(generatedEvidenceMap, specToAudit),
          systemPrompt: specAuditPrompt,
          onChunk: (chunk) => {
            audit += chunk;
          },
          signal: abortControllerRef.current.signal,
        });
        return audit;
      };

      setSpecGenerationStage('audit');
      currentAudit = await auditSpec(currentSpec);

      while (correctionCount < 2 && getSpecAuditStatus(currentAudit) !== 'APROVADA') {
        correctionCount++;
        setSpecGenerationStage('correction');
        let correctedSpec = '';
        await generateSummary({
          apiKey: deepseekKey,
          role: 'spec-correction',
          pdfText: buildSpecCorrectionUserMessage(generatedEvidenceMap, currentSpec, currentAudit),
          systemPrompt: specCorrectionPrompt,
          onChunk: (chunk) => {
            correctedSpec += chunk;
          },
          signal: abortControllerRef.current.signal,
        });

        currentSpec = correctedSpec;
        setSpec(currentSpec);
        setSpecGenerationStage('audit');
        currentAudit = await auditSpec(currentSpec);
      }

      if (orchestration.tier === 'high' && getSpecAuditStatus(currentAudit) !== 'APROVADA') {
        currentAudit = await auditSpec(currentSpec, 'spec-audit-critical');
      }

      setSpec(currentSpec);
      setSpecAudit(currentAudit);
      setSpecCorrectionCount(correctionCount);
      fileInfo.specAudit = currentAudit;
      fileInfo.specCorrectionCount = correctionCount;
      setFileData(fileInfo);
      setAppState('edit-spec');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Spec generation error:', err);
      setError(err.message || 'Erro ao gerar o plano do resumo.');
      setAppState('error');
    }
  }, [fileData, deepseekKey, zhipuKey, hasDeepseekAccess, hasIndependentAuditor, hasZhipuAccess, preferences]);

  // --- Summary Generation Core (handles initial & reinforcement coverage runs) ---
  const runSummaryGeneration = useCallback(async (reinforcementString) => {
    if (!preferences) return;

    if (!hasDeepseekAccess) {
      setShowApiKeyModal(true);
      return;
    }
    if (!hasIndependentAuditor) {
      setError('Configure OPENROUTER_API_KEY, KIMI_API_KEY ou OPENAI_API_KEY no servidor para habilitar a auditoria independente do resumo.');
      setAppState('error');
      return;
    }

    if (!fileData || !spec.trim()) return;
    if (unresolvedRiskCount > 0) return;

    setAppState('processing');
    setSummaryJob({ stage: 'summarizing', progress: 80 });
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setError('');

    abortControllerRef.current = new AbortController();

    const summaryPrompt = buildSummaryPrompt();
    const rawContext = contextBase || fileData.contextBase || fileData.text;
    const orchestration = fileData.aiComplexity || assessCorpusComplexity({
      text: rawContext,
      numPages: fileData.numPages,
      fileCount: fileData.files?.length || 1,
      hasVision: Boolean(fileData.transcribedTextMap && Object.keys(fileData.transcribedTextMap).length),
    });
    const evidenceContext = evidenceMap || fileData.evidenceMap || '';
    const riskReviewNotes = buildRiskReviewNotes(highRiskItems, riskDecisions);
    const outputPreferenceInstructions = buildOutputPreferenceInstructions(preferences);
    // The generator reads the original corpus once. Routine audits and repairs use
    // the page-indexed evidence map to avoid paying to resend the whole PDF on every
    // iteration. A critical audit still receives the raw corpus.
    const generationContext = rawContext;
    const compactAuditContext = evidenceContext
      ? `## MAPA DE EVIDENCIAS POR PAGINA\n\n${evidenceContext}`
      : rawContext;
    
    // Inject reinforcement instructions at the beginning of user message if present
    let userMessage = `${outputPreferenceInstructions}\n\n---\n\n${buildSummaryUserMessage(generationContext, spec)}`;
    if (riskReviewNotes) {
      userMessage = `${riskReviewNotes}\n\n---\n\n${userMessage}`;
    }
    if (reinforcementString) {
      userMessage = `${reinforcementString}\n\n---\n\n${userMessage}`;
    }

    try {
      // 1. Generate Summary
      let finalSummary = '';
      const onSummaryChunk = (chunk) => {
        finalSummary += chunk;
        const split = splitOperationalSections(finalSummary);
        setSummary(split.summary);
        setSummaryLog(split.log);
      };

      await generateSummary({
        apiKey: deepseekKey,
        role: 'summary',
        pdfText: userMessage,
        systemPrompt: summaryPrompt,
        onChunk: onSummaryChunk,
        signal: abortControllerRef.current.signal,
      });

      const splitGenerated = splitOperationalSections(finalSummary);
      finalSummary = splitGenerated.summary;
      setSummary(finalSummary);
      setSummaryLog(splitGenerated.log);

      // 2. Perform an independent audit and repair rejected drafts before publication.
      setIsAuditing(true);
      const auditPrompt = buildAuditPrompt();
      const repairPrompt = buildSummaryRepairPrompt();
      const auditHistory = [];
      let operationalLog = splitGenerated.log;
      const routineSummaryAuditRole = orchestration.tier === 'simple'
        ? 'summary-audit-simple'
        : 'summary-audit';

      const auditSummary = async (
        summaryToAudit,
        attemptNumber,
        role: 'summary-audit-simple' | 'summary-audit' | 'summary-audit-critical' = routineSummaryAuditRole
      ) => {
        let report = '';
        const auditContext = role === 'summary-audit-critical'
          ? generationContext
          : compactAuditContext;
        await generateSummary({
          apiKey: deepseekKey,
          role,
          pdfText: buildAuditUserMessage(auditContext, spec, summaryToAudit),
          systemPrompt: auditPrompt,
          onChunk: (chunk) => {
            report += chunk;
            const completedAudits = auditHistory.map((item, index) => (
              `## Auditoria ${index + 1}\n\n${item}`
            ));
            const currentAudit = `## Auditoria ${attemptNumber}\n\n${report.trim()}`;
            setSummaryLog([operationalLog, ...completedAudits, currentAudit]
              .filter(Boolean)
              .join('\n\n---\n\n'));
          },
          signal: abortControllerRef.current.signal,
        });
        auditHistory.push(report);
        return report;
      };

      let missing = getMissingPages(finalSummary, fileData.numPages);
      let auditReport = await auditSummary(finalSummary, 1);
      let repairCount = 0;

      while (
        repairCount < 2
        && (getSummaryAuditStatus(auditReport) !== 'APROVADO' || missing.length > 0)
      ) {
        repairCount += 1;
        let repairedOutput = '';

        await generateSummary({
          apiKey: deepseekKey,
          role: 'summary-repair',
          pdfText: buildSummaryRepairUserMessage(
            compactAuditContext,
            spec,
            finalSummary,
            auditReport,
            missing
          ),
          systemPrompt: repairPrompt,
          onChunk: (chunk) => {
            repairedOutput += chunk;
            const repaired = splitOperationalSections(repairedOutput);
            setSummary(repaired.summary);
          },
          signal: abortControllerRef.current.signal,
        });

        const repaired = splitOperationalSections(repairedOutput);
        finalSummary = repaired.summary;
        operationalLog = [operationalLog, repaired.log].filter(Boolean).join('\n\n---\n\n');
        setSummary(finalSummary);
        missing = getMissingPages(finalSummary, fileData.numPages);
        auditReport = await auditSummary(finalSummary, repairCount + 1);
      }

      setMissingPages(missing);

      if (
        orchestration.tier === 'high'
        && getSummaryAuditStatus(auditReport) !== 'APROVADO'
        && missing.length === 0
      ) {
        auditReport = await auditSummary(
          finalSummary,
          auditHistory.length + 1,
          'summary-audit-critical'
        );
      }

      const finalAuditStatus = getSummaryAuditStatus(auditReport);
      const finalLog = [
        operationalLog,
        ...auditHistory.map((item, index) => `## Auditoria ${index + 1}\n\n${item}`),
      ].filter(Boolean).join('\n\n---\n\n');
      setSummaryLog(finalLog);

      if (finalAuditStatus !== 'APROVADO' || missing.length > 0) {
        throw new Error(
          `O resumo não atingiu o nível mínimo de qualidade após ${repairCount} correções automáticas. `
          + `Status: ${finalAuditStatus}${missing.length ? `. Páginas sem cobertura: ${missing.join(', ')}` : ''}.`
        );
      }

      setIsAuditing(false);
      setSummaryJob({ stage: 'completed', progress: 100 });
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
      }
      if (abortControllerRef.current.signal.aborted) return;
      setAppState('result');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Summary generation error:', err);
      setError(err.message || 'Erro ao gerar o resumo.');
      setAppState('error');
    }
  }, [deepseekKey, hasDeepseekAccess, hasIndependentAuditor, fileData, spec, preferences, contextBase, evidenceMap, highRiskItems, riskDecisions, unresolvedRiskCount]);

  // --- Initial Summary Generation ---
  const handleGenerateFromSpec = useCallback(() => {
    setCoverageReinforcementInstruction('');
    setMissingPages([]);

    if (isLocalTestFlow) {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setSummary('');
      setSummaryLog('');
      setIsAuditing(false);
      setSummaryJob({ stage: 'summarizing', progress: 80 });
      setAppState('processing');

      void (async () => {
        await waitForLocalTest(900);
        if (controller.signal.aborted) return;
        setIsAuditing(true);
        await waitForLocalTest(900);
        if (controller.signal.aborted) return;
        setSummary(mockSummary);
        setSummaryLog(mockSummaryLog);
        setIsAuditing(false);
        setSummaryJob({ stage: 'completed', progress: 100 });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          await waitForLocalTest(850);
        }
        if (controller.signal.aborted) return;
        setAppState('result');
      })();
      return;
    }

    if (activeSummaryJobId) {
      if (unresolvedRiskCount > 0 || !spec.trim()) return;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setSummary('');
      setSummaryLog('');
      setSummaryJob({ stage: 'queued_final', progress: 76 });
      setError('');
      setAppState('processing');

      const answers = highRiskItems.map((item) => ({
        id: item.id,
        action: riskDecisions[item.id]?.action,
        value: riskDecisions[item.id]?.value || '',
      }));

      void (async () => {
        try {
          const job = await finalizeSummaryJob({
            jobId: activeSummaryJobId,
            spec,
            answers,
            signal: controller.signal,
            onProgress: setSummaryJob,
          });
          setSummary(job.summary || '');
          setMissingPages([]);
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await new Promise((resolve) => window.setTimeout(resolve, 850));
          }
          if (controller.signal.aborted) return;
          setAppState('result');
        } catch (jobError) {
          if (jobError?.name === 'AbortError') return;
          setError(jobError instanceof Error ? jobError.message : 'Erro ao gerar o resumo.');
          setAppState('error');
        }
      })();
      return;
    }

    runSummaryGeneration('');
  }, [activeSummaryJobId, highRiskItems, isLocalTestFlow, riskDecisions, runSummaryGeneration, spec, unresolvedRiskCount]);

  // --- Reinforcement Regeneration ---
  const handleRegenerateWithCoverage = useCallback(() => {
    if (missingPages.length === 0) return;
    
    const reinforcement = `⚠️ ATENÇÃO CRÍTICA DO SISTEMA: Na tentativa anterior, as seguintes páginas foram COMPLETAMENTE IGNORADAS ou OMITIDAS do resumo: páginas ${missingPages.join(', ')}.
Você DEVE obrigatoriamente incluir e detalhar todas as informações, critérios, condutas e classificações destas páginas específicas (${missingPages.join(', ')}) no resumo final. Certifique-se de referenciá-las explicitamente com (p. X).`;
    
    setCoverageReinforcementInstruction(reinforcement);
    runSummaryGeneration(reinforcement);
  }, [missingPages, runSummaryGeneration]);

  // --- Regenerate SPEC ---
  const handleRegenerateSpec = useCallback(() => {
    if (isLocalTestFlow) {
      runLocalSpecFlow(preferences);
      return;
    }
    generateSpec(fileData, preferences);
  }, [fileData, preferences, generateSpec, isLocalTestFlow, runLocalSpecFlow]);

  const handleRiskDecisionChange = useCallback((itemId, decision) => {
    setRiskDecisions((prev) => ({
      ...prev,
      [itemId]: decision,
    }));
  }, []);

  // --- API key saved → continue pending flow ---
  const handleSaveApiKeyAndContinue = useCallback((keys) => {
    setDeepseekKey(keys.deepseek);
    setZhipuKey(keys.zhipu);
    sessionStorage.setItem('resumex_api_key', keys.deepseek);
    sessionStorage.setItem('resumex_zhipu_key', keys.zhipu);
    setShowApiKeyModal(false);

    if (fileData && preferences && (keys.deepseek || serverConfig.deepseekConfigured) && (keys.zhipu || serverConfig.zhipuConfigured)) {
      generateSpec(fileData, preferences);
    }
  }, [fileData, preferences, serverConfig.deepseekConfigured, serverConfig.zhipuConfigured, generateSpec]);

  // --- Reset ---
  const handleNewSummary = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    revokePdfCorpusUrls(fileData);
    setFileData(null);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions({ questionMode: 'generated_only', questionCount: 15 });
    setQuizProcessingMessage('');
    setQuizProcessingStage('files');
    setFlashcardDrafts([]);
    setHomeInitialMode('summary');
    setHasWorkspaceActivity(false);
    setWorkspaceResetKey((current) => current + 1);
    setError('');
    setIsLocalTestFlow(false);
    setAppState('upload');
  }, [fileData]);

  const handleHeaderHome = useCallback(() => {
    if (appState !== 'upload' || hasWorkspaceActivity) {
      setPendingNavigation(null);
      setShowHomeConfirmation(true);
      return;
    }
    handleNewSummary();
  }, [appState, handleNewSummary, hasWorkspaceActivity]);

  const handleHowItWorks = useCallback(() => {
    if (appState !== 'upload' || hasWorkspaceActivity) {
      setPendingNavigation('/como-funciona');
      setShowHomeConfirmation(true);
      return;
    }
    navigate('/como-funciona');
  }, [appState, hasWorkspaceActivity, navigate]);

  const closeHomeConfirmation = useCallback(() => {
    setShowHomeConfirmation(false);
    setPendingNavigation(null);
  }, []);

  const confirmReturnHome = useCallback(() => {
    const destination = pendingNavigation;
    setShowHomeConfirmation(false);
    setPendingNavigation(null);
    handleNewSummary();
    if (destination) navigate(destination);
  }, [handleNewSummary, navigate, pendingNavigation]);

  useEffect(() => {
    if (!showHomeConfirmation) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHomeConfirmation();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeHomeConfirmation, showHomeConfirmation]);

  // --- Back to upload ---
  const handleBackToUpload = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    revokePdfCorpusUrls(fileData);
    setFileData(null);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setSummaryLog('');
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions({ questionMode: 'generated_only', questionCount: 15 });
    setHomeInitialMode('summary');
    setQuizProcessingMessage('');
    setIsLocalTestFlow(false);
    setAppState('upload');
  }, [fileData]);

  // --- Back to preferences ---
  const handleBackToPreferences = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setSummaryLog('');
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setAppState('preferences');
  }, []);

  if (!isE2EMockMode && (!isLoaded || (isSignedIn && !serverConfig.loaded))) {
    return (
      <div className="app-loading-screen">
        <div className="app-loading-shell">
          <span className="app-loading-kicker">ACESSO / PREPARAÇÃO</span>
          <div className="app-loading-mark">
            <span className="header-logo-wordmark">Resumex</span>
          </div>
          <div className="app-loading-copy">
            <h1>Preparando ambiente</h1>
            <p>Validando sessão e conectando APIs.</p>
          </div>
          <div className="app-loading-bar" aria-hidden="true">
            <span />
          </div>
          <span className="app-loading-note">Isso leva apenas alguns instantes.</span>
        </div>
      </div>
    );
  }

  if (!isE2EMockMode && !isSignedIn) {
    return <AuthScreen />;
  }

  if (accessDenied) {
    return (
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-brand">
            <div>
              <h1>Resumex</h1>
              <p>Acesso não autorizado</p>
            </div>
          </div>
          <div className="upload-error">
            Esta conta Google não está na allowlist do servidor.
          </div>
          {session?.user && <AccountButton user={session.user} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container fichario-app ${appState === 'upload' ? 'home-fichario' : ''} ${appState === 'preferences' ? 'preferences-fichario' : ''} ${['rendering-pdf', 'transcribing-pdf', 'generating-spec', 'edit-spec', 'processing'].includes(appState) ? 'analysis-fichario' : ''} ${appState === 'result' ? 'result-fichario' : ''}`}>
      <div className="app-content">
        <Header
          onHome={handleHeaderHome}
          userActions={session?.user ? (
            <AccountButton
              user={session.user}
              onStudyCenter={handleHeaderHome}
              onHowItWorks={handleHowItWorks}
            />
          ) : null}
        />

        {appState === 'upload' && (
          <UploadZone
            key={workspaceResetKey}
            onUploadComplete={handleUploadComplete}
            onStartLocalTest={canUseLocalTestFlow ? handleStartLocalTest : undefined}
            initialMode={homeInitialMode}
            onModeChange={openHomeMode}
            onActivityChange={setHasWorkspaceActivity}
            flashcardConfig={{ initialDrafts: flashcardDrafts }}
            quizConfig={{
              deepseekKey,
              deepseekAvailable: hasDeepseekAccess,
              zhipuKey,
              zhipuAvailable: hasZhipuAccess,
              initialFiles: quizFiles,
              onOpenApiKeyModal: () => setShowApiKeyModal(true),
              onGenerate: handleGenerateQuiz,
            }}
          />
        )}

        {appState === 'preferences' && fileData && (
          <PreferencesPanel
            fileData={fileData}
            deepseekAvailable={serverConfig.deepseekConfigured}
            zhipuAvailable={serverConfig.zhipuConfigured}
            onContinue={handlePreferencesComplete}
            onBack={handleBackToUpload}
          />
        )}

        {appState === 'rendering-pdf' && fileData && (
          <div className="processing-section">
            <span className="processing-kicker">PREPARANDO MATERIAL / ETAPA 01</span>
            <div className="processing-animation">
              <div className="processing-ring" style={{ borderTopColor: 'var(--accent-cyan)' }} />
              <div className="processing-ring" style={{ borderRightColor: 'var(--accent-mint)', animationDirection: 'reverse' }} />
              <div className="processing-core"><Camera aria-hidden="true" /></div>
            </div>
            <div className="processing-text" role="status" aria-live="polite">
              <h3>Preparando imagens das páginas</h3>
              <p>Convertendo apenas as páginas selecionadas para que anotações, tabelas e esquemas possam ser lidos.</p>
            </div>
            <div className="upload-progress-bar" role="progressbar" aria-label="Preparação das páginas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={renderingProgress}>
              <div className="upload-progress-fill" style={{ width: `${renderingProgress}%` }} />
            </div>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {renderingProgress}% concluído
            </span>
            <p className="processing-note">Mantenha esta aba aberta. A próxima etapa começará automaticamente.</p>
          </div>
        )}

        {appState === 'transcribing-pdf' && fileData && (
          <div className="processing-section">
            <span className="processing-kicker">LEITURA VISUAL / ETAPA 02</span>
            <div className="processing-animation">
              <div className="processing-ring" style={{ borderTopColor: 'var(--accent-amber)' }} />
              <div className="processing-ring" style={{ borderRightColor: 'var(--accent-purple)', animationDirection: 'reverse' }} />
              <div className="processing-core"><FileText aria-hidden="true" /></div>
            </div>
            <div className="processing-text" role="status" aria-live="polite">
              <h3>Transcrevendo elementos visuais</h3>
              <p>O modelo está capturando caneta, setas, imagens e esquemas sem substituir o texto original do PDF.</p>
            </div>
            {transcriptionProgress.total > 0 && (
              <>
                <div className="upload-progress-bar" role="progressbar" aria-label="Leitura visual das páginas" aria-valuemin={0} aria-valuemax={transcriptionProgress.total} aria-valuenow={transcriptionProgress.current}>
                  <div 
                    className="upload-progress-fill" 
                    style={{ 
                      width: `${(transcriptionProgress.current / transcriptionProgress.total) * 100}%`,
                      background: 'var(--gradient-warm)' 
                    }} 
                  />
                </div>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  Página {transcriptionProgress.current} de {transcriptionProgress.total} concluída
                </span>
              </>
            )}
            <p className="processing-note">Cada página concluída é incorporada ao material antes da criação do plano.</p>
          </div>
        )}

        {(appState === 'generating-spec' || appState === 'edit-spec') && fileData && (
          <SpecEditor
            fileData={fileData}
            spec={spec}
            specAudit={specAudit}
            specCorrectionCount={specCorrectionCount}
            highRiskItems={highRiskItems}
            riskDecisions={riskDecisions}
            isGenerating={appState === 'generating-spec'}
            generationStage={specGenerationStage}
            onSpecChange={setSpec}
            onRiskDecisionChange={handleRiskDecisionChange}
            onGenerate={handleGenerateFromSpec}
            onRegenerateSpec={activeSummaryJobId ? undefined : handleRegenerateSpec}
            onBack={handleBackToPreferences}
            isVisualReview={Boolean(activeSummaryJobId)}
          />
        )}

        {appState === 'processing' && (
          <ProcessingView stage={summaryJob.stage} progress={summaryJob.progress} />
        )}

        {appState === 'quiz-processing' && (
          <QuizProcessingTimeline
            stage={quizProcessingStage}
            message={quizProcessingMessage}
            onCancel={handleCancelQuizProcessing}
          />
        )}

        {appState === 'result' && (
          <ResultView
            fileData={fileData}
            pdfUrl={fileData?.pdfUrl}
            summary={summary}
            summaryLog={summaryLog}
            missingPages={missingPages}
            onRegenerateWithCoverage={handleRegenerateWithCoverage}
            onNewSummary={handleNewSummary}
            onCreateFlashcards={handleCreateFlashcardsFromSummary}
          />
        )}

        {appState === 'quiz-result' && (
          <QuizView
            files={quizFiles}
            questions={quizQuestions}
            analysis={quizAnalysis}
            onNewQuiz={handleStartQuiz}
            onGenerateVariant={handleGenerateQuizVariant}
            onHome={handleNewSummary}
          />
        )}

        {appState === 'error' && (
          <div className="error-section">
            <div className="error-icon"><CircleX aria-hidden="true" /></div>
            <h2 className="error-title">Ops, algo deu errado</h2>
            <p className="error-message">{error}</p>
            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={handleNewSummary}>
                <ArrowLeft size={18} aria-hidden="true" />
                Recomeçar
              </button>
              {fileData && preferences && (
                <button className="btn btn-primary" onClick={handleGenerateFromSpec}>
                  <RefreshCw size={18} aria-hidden="true" />
                  Tentar Novamente
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showHomeConfirmation && (
        <div
          className="home-confirmation-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeHomeConfirmation();
          }}
        >
          <section
            className="home-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-confirmation-title"
          >
            <span className="home-confirmation-kicker">VOLTAR À HOME?</span>
            <h2 id="home-confirmation-title">Interromper o que você está fazendo?</h2>
            <p>Arquivos selecionados e alterações ainda não concluídas serão descartados.</p>
            <div className="home-confirmation-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeHomeConfirmation}
                autoFocus
              >
                Continuar aqui
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmReturnHome}>
                {pendingNavigation ? 'Ir para Como funciona' : 'Voltar para a home'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showApiKeyModal && (
        <ApiKeyModal
          deepseekKey={deepseekKey}
          zhipuKey={zhipuKey}
          onSave={handleSaveApiKey}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}
    </div>
  );
}
