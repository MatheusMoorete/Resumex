import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, CircleX, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthSession } from '../features/auth/domain/auth';
import Header from '../shared/components/Header';
import GenericErrorView from '../shared/components/GenericErrorView';
import ApiKeyModal from '../features/auth/components/ApiKeyModal';
import AccountButton from '../features/auth/components/AccountButton';
import AuthScreen from '../features/auth/components/AuthScreen';
import { authService } from '../features/auth/services/authService';
import UploadZone from '../features/pdf/components/UploadZone';
import { DevTelemetryWidget } from '../shared/components/DevTelemetryWidget';
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
import { cancelQuizJob, prepareQuizJob } from '../features/quiz/services/quizJobApi';
import { revokePdfCorpusUrls } from '../features/pdf/services/pdfCorpus';
import { prepareFlashcardJob } from '../features/flashcards/services/flashcardJobApi';
import { setAuthTokenGetter } from '../features/auth/services/authClient';
import { createSummary } from '../features/summary/services/summaryApi';
import { createQuiz } from '../features/quiz/services/quizPersistenceApi';
import { FicharioView } from '../features/fichario/components/FicharioView';
import {
  createMockFileData,
  mockFlashcardDrafts,
  mockSpec,
  mockSummary,
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
  fichario: '/app/fichario',
  preferences: '/app/resumo/configurar',
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
  if (path === '/app/fichario') return 'fichario';
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
 * - 'generating-spec'  → AI is reading context-base and generating a SPEC
 * - 'edit-spec'        → User is editing the SPEC
 * - 'processing'       → AI is generating the final summary from SPEC + Audit
 * - 'result'           → Summary ready
 * - 'error'            → Error occurred
 */

function isRiskDecisionResolved(decision) {
  if (!decision) return false;
  if (decision.action === 'correct') return Boolean(decision.value?.trim());
  return true;
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
  const [spec, setSpec] = useState('');
  const [riskDecisions, setRiskDecisions] = useState({});
  const [activeSummaryJobId, setActiveSummaryJobId] = useState<string | null>(null);
  const [visualQuestions, setVisualQuestions] = useState<VisualQuestion[]>([]);
  const [summary, setSummary] = useState('');
  const [summaryJob, setSummaryJob] = useState({ stage: 'queued', progress: 0 });
  const [quizFiles, setQuizFiles] = useState([]);
  const [quizSummarySource, setQuizSummarySource] = useState<{ name: string; text: string } | null>(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizAnalysis, setQuizAnalysis] = useState(null);
  const [activeQuizJobId, setActiveQuizJobId] = useState<string | null>(null);
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

    const needsSummaryData = ['preferences', 'generating-spec', 'edit-spec', 'processing'].includes(routeState);
    const needsResultData = routeState === 'result';
    const needsQuizData = routeState === 'quiz-processing' || routeState === 'quiz-result';

    if ((!isE2EMockMode && needsSummaryData && !fileData) || (needsResultData && !fileData && !summary) || (needsQuizData && !quizFiles.length && !quizSummarySource)) {
      setAppStateValue('upload');
      setHomeInitialMode(needsQuizData ? 'quiz' : 'summary');
      navigate(needsQuizData ? HOME_MODE_ROUTES.quiz : '/app', { replace: true });
      return;
    }

    setAppStateValue(routeState);
    if (routeState === 'upload') setHomeInitialMode(getRouteMode(location.pathname));
  }, [fileData, summary, location.pathname, navigate, quizFiles.length, quizSummarySource]);

  // Abort controller
  const abortControllerRef = useRef(null);
  const hasZhipuAccess = Boolean(zhipuKey || serverConfig.zhipuConfigured);
  const hasIndependentAuditor = Boolean(serverConfig.auditorConfigured);
  const highRiskItems = visualQuestions;
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;
  const abortActiveWork = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (activeQuizJobId) {
      cancelQuizJob(activeQuizJobId).catch(() => {});
      setActiveQuizJobId(null);
    }
  }, [activeQuizJobId]);

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
    abortActiveWork();
    revokePdfCorpusUrls(fileData);
    setFileData(data);
    setPreferences(null);
    setSpec('');
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setError('');
    setAppState('preferences');
  }, [abortActiveWork, fileData]);

  const handleStartLocalTest = useCallback(() => {
    setIsLocalTestFlow(true);
    handleUploadComplete(createMockFileData());
  }, [handleUploadComplete]);

  const handleStartQuiz = useCallback(() => {
    abortActiveWork();
    setQuizFiles([]);
    setQuizSummarySource(null);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions({ questionMode: 'generated_only', questionCount: 15 });
    setQuizProcessingMessage('');
    setQuizProcessingStage('files');
    setError('');
    setIsLocalTestFlow(false);
    openHomeMode('quiz');
  }, [abortActiveWork, openHomeMode]);

  const handleCreateFlashcardsFromSummary = useCallback(async () => {
    if (isLocalTestFlow) {
      setFlashcardDrafts(mockFlashcardDrafts);
      openHomeMode('flashcards');
      return;
    }

    if (!serverConfig.deepseekConfigured) {
      throw new Error('Configure DEEPSEEK_API_KEY no servidor para gerar flashcards.');
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { drafts } = await prepareFlashcardJob({
      textSource: { name: 'Resumo atual.md', text: summary },
      sourceType: 'summary',
      count: 20,
      signal: controller.signal,
    });
    if (!drafts.length) throw new Error('O resumo não gerou cartões válidos.');
    setFlashcardDrafts(drafts);
    openHomeMode('flashcards');
  }, [isLocalTestFlow, openHomeMode, serverConfig.deepseekConfigured, summary]);

  const handleGenerateQuiz = useCallback(async (files, options: any = {}) => {
    if (!serverConfig.deepseekConfigured) {
      setError('Configure DEEPSEEK_API_KEY no servidor para gerar simulados.');
      setAppState('error');
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
    const sourceFiles = files
      .map((file) => file?.file instanceof File ? file.file : file)
      .filter((file) => file instanceof File);
    const summarySource = options.summarySource?.text?.trim()
      ? { name: options.summarySource.name || 'Resumo atual.md', text: options.summarySource.text.trim() }
      : null;
    if (!sourceFiles.length && !summarySource) {
      setError('Selecione ao menos um PDF ou resumo para gerar o simulado.');
      setAppState('error');
      return;
    }

    setQuizFiles(files);
    setQuizSummarySource(summarySource);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions(nextQuizOptions);
    setError('');
    setQuizProcessingStage('files');
    setQuizProcessingMessage(
      nextQuizOptions.practiceMode === 'focused'
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
      const job = await prepareQuizJob({
        files: sourceFiles,
        summarySource,
        options: {
          ...nextQuizOptions,
          previousQuestions: options.previousQuestions || [],
          focusQuestions: options.focusQuestions || [],
        },
        signal: abortControllerRef.current.signal,
        onProgress: (progressJob) => {
          setActiveQuizJobId(progressJob.id);
          if (progressJob.stage) setQuizProcessingStage(progressJob.stage);
          if (progressJob.message) setQuizProcessingMessage(progressJob.message);
        },
      });
      setActiveQuizJobId(null);
      setQuizAnalysis(job.analysis);
      setQuizQuestions(job.questions);
      createQuiz(
        `Simulado - ${sourceFiles[0]?.name || summarySource?.name || 'Resumo atual'}`,
        job.questions
      ).catch((e) => console.error('Erro ao salvar simulado:', e));
      setAppState('quiz-result');
    } catch (err: any) {
      setActiveQuizJobId(null);
      if (err.name === 'AbortError') return;
      setError(err.message || 'Erro ao gerar o teste.');
      setAppState('error');
    }
  }, [hasIndependentAuditor, quizOptions.questionCount, quizOptions.questionMode, serverConfig.deepseekConfigured]);

  // --- Preferences selected → generate SPEC ---
  const handleGenerateQuizVariant = useCallback((variant, payload: any = {}) => {
    handleGenerateQuiz(quizFiles, {
      questionMode: quizOptions.questionMode || quizAnalysis?.questionMode || 'generated_only',
      questionCount: quizOptions.questionCount || quizQuestions.length || 15,
      practiceMode: variant,
      previousQuestions: quizQuestions,
      focusQuestions: payload.focusQuestions || [],
      summarySource: quizSummarySource,
    });
  }, [handleGenerateQuiz, quizAnalysis, quizFiles, quizOptions, quizQuestions, quizSummarySource]);

  const handleCreateQuizFromSummary = useCallback(async () => {
    if (!summary.trim()) throw new Error('O resumo está vazio.');
    const sourceName = fileData?.files?.[0]?.name?.replace(/\.pdf$/i, '') || 'Resumo atual';
    await handleGenerateQuiz([], {
      questionMode: 'generated_only',
      questionCount: 15,
      summarySource: { name: `${sourceName}.md`, text: summary },
    });
  }, [fileData, handleGenerateQuiz, summary]);

  const handleCancelQuizProcessing = useCallback(() => {
    abortActiveWork();
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizProcessingMessage('');
    setQuizProcessingStage('files');
    setFlashcardDrafts([]);
    setError('');
    openHomeMode('quiz');
  }, [abortActiveWork, openHomeMode]);

  const runLocalSpecFlow = useCallback(async (prefs) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setPreferences(prefs);
    setSpec('');
    setRiskDecisions({});
    setError('');
    setAppState('generating-spec');

    await waitForLocalTest(650);
    if (controller.signal.aborted) return;
    setSpec(mockSpec);
    setAppState('edit-spec');
  }, []);

  const autoSaveToFichario = useCallback(async (summaryContent: string, fileName?: string, contentHash?: string) => {
    if (!summaryContent) return;
    try {
      const sourceName = fileName || fileData?.files?.[0]?.name || 'Resumo Médico';
      const title = sourceName.replace(/\.[^/.]+$/, '');
      await createSummary({
        title,
        content: summaryContent,
        source_file_name: sourceName,
        content_hash: contentHash,
      });
    } catch (err) {
      console.error('Erro ao salvar resumo automaticamente no Fichário:', err);
    }
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
    setSpec('');
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
      if (job.status === 'completed') {
        const finalSummary = job.summary || '';
        setSummary(finalSummary);
        void autoSaveToFichario(finalSummary, files[0]?.name);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          await new Promise((resolve) => window.setTimeout(resolve, 850));
        }
        if (controller.signal.aborted) return;
        setAppState('result');
        return;
      }
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



  // --- Initial Summary Generation ---
  const handleGenerateFromSpec = useCallback(() => {
    if (isLocalTestFlow) {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setSummary('');
      setSummaryJob({ stage: 'summarizing', progress: 80 });
      setAppState('processing');

      void (async () => {
        await waitForLocalTest(900);
        if (controller.signal.aborted) return;
        setSummary(mockSummary);
        void autoSaveToFichario(mockSummary, 'mock-e2e.pdf');
        setSummaryJob({ stage: 'completed', progress: 100 });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          await waitForLocalTest(850);
        }
        if (controller.signal.aborted) return;
        setAppState('result');
      })();
      return;
    }

    if (!activeSummaryJobId) {
      setError('O job de resumo não está mais disponível. Reenvie o material.');
      setAppState('error');
      return;
    }

    if (unresolvedRiskCount > 0 || !spec.trim()) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSummary('');
    setSummaryJob({ stage: 'queued_final', progress: 76 });
    setError('');
    setAppState('processing');

    const answers = highRiskItems.map((item) => ({
      id: item.id,
      action: riskDecisions[item.id]?.action,
      value: riskDecisions[item.id]?.value || '',
    }));

    void finalizeSummaryJob({
      jobId: activeSummaryJobId,
      spec,
      answers,
      signal: controller.signal,
      onProgress: setSummaryJob,
    }).then(async (job) => {
      const finalSummary = job.summary || '';
      setSummary(finalSummary);
      void autoSaveToFichario(finalSummary);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await new Promise((resolve) => window.setTimeout(resolve, 850));
      }
      if (!controller.signal.aborted) setAppState('result');
    }).catch((jobError) => {
      if (jobError?.name === 'AbortError') return;
      setError(jobError instanceof Error ? jobError.message : 'Erro ao gerar o resumo.');
      setAppState('error');
    });
  }, [activeSummaryJobId, autoSaveToFichario, highRiskItems, isLocalTestFlow, riskDecisions, spec, unresolvedRiskCount]);

  const handleRiskDecisionChange = useCallback((itemId, decision) => {
    setRiskDecisions((prev) => ({
      ...prev,
      [itemId]: decision,
    }));
  }, []);

  // --- Reset ---
  const handleNewSummary = useCallback(() => {
    abortActiveWork();
    revokePdfCorpusUrls(fileData);
    setFileData(null);
    setPreferences(null);
    setSpec('');
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setQuizFiles([]);
    setQuizSummarySource(null);
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
  }, [abortActiveWork, fileData]);

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
    abortActiveWork();
    revokePdfCorpusUrls(fileData);
    setFileData(null);
    setPreferences(null);
    setSpec('');
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setQuizFiles([]);
    setQuizSummarySource(null);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizOptions({ questionMode: 'generated_only', questionCount: 15 });
    setHomeInitialMode('summary');
    setQuizProcessingMessage('');
    setIsLocalTestFlow(false);
    setAppState('upload');
  }, [abortActiveWork, fileData]);

  // --- Back to preferences ---
  const handleBackToPreferences = useCallback(() => {
    abortActiveWork();
    setSpec('');
    setRiskDecisions({});
    setActiveSummaryJobId(null);
    setVisualQuestions([]);
    setSummary('');
    setAppState('preferences');
  }, [abortActiveWork]);

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
    <div className={`app-container fichario-app ${appState === 'upload' ? 'home-fichario' : ''} ${appState === 'preferences' ? 'preferences-fichario' : ''} ${['generating-spec', 'edit-spec', 'processing'].includes(appState) ? 'analysis-fichario' : ''} ${appState === 'result' ? 'result-fichario' : ''} ${appState === 'fichario' ? 'fichario-page home-fichario' : ''}`}>
      <div className="app-content">
        <Header
          onHome={handleHeaderHome}
          userActions={session?.user ? (
            <AccountButton
              user={session.user}
              onStudyCenter={handleHeaderHome}
              onFichario={() => navigate('/app/fichario')}
              onHowItWorks={handleHowItWorks}
            />
          ) : null}
        />

        {appState === 'fichario' && (
          <div className="fichario-page-section">
            <FicharioView
              onOpenSummary={(savedSum) => {
                setSummary(savedSum.content);
                setAppState('result');
              }}
              onOpenQuiz={(savedQuiz) => {
                setQuizQuestions(savedQuiz.questions || []);
                setAppState('quiz-result');
              }}
            />
          </div>
        )}

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
              deepseekAvailable: serverConfig.deepseekConfigured,
              initialFiles: quizFiles,
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

        {(appState === 'generating-spec' || appState === 'edit-spec') && fileData && (
          <SpecEditor
            fileData={fileData}
            spec={spec}
            highRiskItems={highRiskItems}
            riskDecisions={riskDecisions}
            isGenerating={appState === 'generating-spec'}
            onSpecChange={setSpec}
            onRiskDecisionChange={handleRiskDecisionChange}
            onGenerate={handleGenerateFromSpec}
            onBack={handleBackToPreferences}
            isVisualReview
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
            onNewSummary={handleNewSummary}
            onGoToFichario={() => navigate('/app/fichario')}
            onCreateFlashcards={handleCreateFlashcardsFromSummary}
            onCreateQuiz={handleCreateQuizFromSummary}
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
          <GenericErrorView
            error={error}
            onReset={handleNewSummary}
            onRetry={fileData && preferences ? () => (
              activeSummaryJobId
                ? handleGenerateFromSpec()
                : handlePreferencesComplete(preferences)
            ) : undefined}
          />
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

      <DevTelemetryWidget />
    </div>
  );
}
