import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { SignIn, useAuth, UserButton } from '@clerk/clerk-react';
import Header from './components/Header';
import ApiKeyModal from './components/ApiKeyModal';
import UploadZone from './components/UploadZone';
import PreferencesPanel from './components/PreferencesPanel';
import SpecEditor from './components/SpecEditor';
import ProcessingView from './components/ProcessingView';
import ResultView from './components/ResultView';
import QuizUpload from './components/QuizUpload';
import QuizView from './components/QuizView';
import { generateSummary } from './services/deepseekApi';
import { buildQuizFromCorpus } from './services/quizApi';
import { transcribePDFWithGLM } from './services/zhipuApi';
import { renderPDFPagesToImages } from './services/pdfExtractor';
import { setAuthTokenGetter } from './services/authClient';
import { 
  buildSpecPrompt, 
  buildSummaryPrompt, 
  buildSummaryUserMessage, 
  buildAuditPrompt, 
  buildAuditUserMessage 
} from './prompts/templates';
import {
  buildEvidenceMapPrompt,
  buildEvidenceMapUserMessage,
  buildSpecCorrectionPrompt,
  buildSpecCorrectionUserMessage,
  buildSpecAuditPrompt,
  buildSpecAuditUserMessage,
  buildSpecFromEvidenceUserMessage,
} from './prompts/evidence';
import { createMockFileData, mockSummary } from './mocks/e2eMock';

function isLocalBrowserHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

const isE2EMockMode = import.meta.env.DEV
  && import.meta.env.VITE_E2E_MOCK === 'true'
  && isLocalBrowserHost();

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

export default function App() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Core state - DeepSeek generates text; GLM transcribes visual/handwritten pages.
  // Local keys are optional overrides. Server-side env keys are preferred.
  const [appState, setAppState] = useState('upload');
  const [deepseekKey, setDeepseekKey] = useState(() => 
    localStorage.getItem('resumex_api_key') || ''
  );
  const [zhipuKey, setZhipuKey] = useState(() => 
    localStorage.getItem('resumex_zhipu_key') || ''
  );
  const [serverConfig, setServerConfig] = useState({
    deepseekConfigured: false,
    zhipuConfigured: false,
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
  const [riskDecisions, setRiskDecisions] = useState({});
  const [summary, setSummary] = useState('');
  const [summaryLog, setSummaryLog] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [missingPages, setMissingPages] = useState([]);
  const [coverageReinforcementInstruction, setCoverageReinforcementInstruction] = useState('');
  const [quizFiles, setQuizFiles] = useState([]);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizAnalysis, setQuizAnalysis] = useState(null);
  const [quizProcessingMessage, setQuizProcessingMessage] = useState('');
  const [error, setError] = useState('');

  // Abort controller
  const abortControllerRef = useRef(null);
  const hasDeepseekAccess = Boolean(deepseekKey || serverConfig.deepseekConfigured);
  const hasZhipuAccess = Boolean(zhipuKey || serverConfig.zhipuConfigured);
  const highRiskItems = useMemo(
    () => extractHighRiskEvidenceItems(evidenceMap || fileData?.evidenceMap || ''),
    [evidenceMap, fileData]
  );
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;

  useEffect(() => {
    let isMounted = true;

    if (isE2EMockMode) {
      setAuthTokenGetter(null);
      setServerConfig({
        deepseekConfigured: true,
        zhipuConfigured: true,
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
      loaded: true,
    });
  }, [getToken]);

  // --- API Key saving ---
  const handleSaveApiKey = useCallback((keys) => {
    setDeepseekKey(keys.deepseek);
    setZhipuKey(keys.zhipu);
    localStorage.setItem('resumex_api_key', keys.deepseek);
    localStorage.setItem('resumex_zhipu_key', keys.zhipu);
    setShowApiKeyModal(false);
  }, []);

  // --- Upload complete → go to preferences ---
  const handleUploadComplete = useCallback((data) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (fileData?.pdfUrl) URL.revokeObjectURL(fileData.pdfUrl);
    setFileData(data);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setError('');
    setAppState('preferences');
  }, [fileData]);

  const handleStartQuiz = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizProcessingMessage('');
    setError('');
    setAppState('quiz-upload');
  }, []);

  const handleGenerateQuiz = useCallback(async (files, options = {}) => {
    if (!hasDeepseekAccess) {
      setShowApiKeyModal(true);
      return;
    }

    const visualFiles = files.filter((file) => file.requiresVision || file.readMode === 'visual');
    if (visualFiles.length > 0 && !hasZhipuAccess) {
      setShowApiKeyModal(true);
      return;
    }

    setQuizFiles(files);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setError('');
    setQuizProcessingMessage(
      visualFiles.length > 0
        ? 'Preparando PDFs com foto/imagem para leitura visual...'
        : options.questionMode === 'mixed'
        ? 'Classificando arquivos, extraindo questoes existentes e preparando material teorico...'
        : 'Classificando arquivos e usando bancos de questoes como referencia para gerar questoes novas...'
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
          setQuizProcessingMessage(`Convertendo ${file.name} em imagens (${pagesToTranscribe.length} paginas)...`);

          const { images } = await renderPDFPagesToImages(file.file, {
            scale: 1.55,
            quality: 0.86,
            format: 'image/jpeg',
            maxPages: QUIZ_VISUAL_MAX_PAGES,
            pageNumbersToRender: pagesToTranscribe,
            onProgress: ({ current, total }) => {
              setQuizProcessingMessage(`Renderizando ${file.name}: ${current}/${total} paginas.`);
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
              setQuizProcessingMessage(`Transcrevendo ${file.name}: ${current}/${total} paginas.`);
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
        options.questionMode === 'mixed'
          ? 'Classificando arquivos, extraindo questoes existentes e preparando material teorico...'
          : 'Classificando arquivos e usando bancos de questoes como referencia para gerar questoes novas...'
      );

      const analysis = await buildQuizFromCorpus({
        apiKey: deepseekKey,
        files: quizSourceFiles,
        questionMode: options.questionMode || 'generated_only',
        questionCount: options.questionCount || 15,
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
  }, [deepseekKey, hasDeepseekAccess, hasZhipuAccess, zhipuKey]);

  // --- Preferences selected → generate SPEC ---
  const handlePreferencesComplete = useCallback((prefs) => {
    setPreferences(prefs);

    if (!hasDeepseekAccess || !hasZhipuAccess) {
      setShowApiKeyModal(true);
      return;
    }

    generateSpec(fileData, prefs);
  }, [hasDeepseekAccess, hasZhipuAccess, fileData]);

  // --- Generate SPEC (Step 1) ---
  const generateSpec = useCallback(async (data, prefs) => {
    const fileInfo = data || fileData;
    const prefsToUse = prefs || preferences;

    if (!fileInfo || !hasDeepseekAccess || !hasZhipuAccess || !prefsToUse) return;

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
          const { images } = await renderPDFPagesToImages(fileInfo.file, {
            scale: highFidelity ? 2.0 : 1.6,
            quality: highFidelity ? 0.92 : 0.86,
            format: highFidelity ? 'image/png' : 'image/jpeg',
            pageNumbersToRender: pagesToRender,
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
      const pdfText = page.text?.trim()
        ? page.text.trim()
        : '[Sem texto selecionável extraído pelo PDF.js]';
      const visualText = needsVisionFlow
        ? transcribedTextMap[pageNum] || `[⚠️ Transcrição visual não disponível na Página ${pageNum}]`
        : '';

      return [
        `--- Página ${pageNum} ---`,
        `## Texto selecionável extraído do PDF`,
        pdfText,
        needsVisionFlow ? `## Transcrição visual GLM-4V da página renderizada` : '',
        needsVisionFlow ? visualText : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    setContextBase(generatedContext);
    fileInfo.contextBase = generatedContext;
    setFileData(fileInfo);

    // 5. Build an evidence map, then generate and audit the SPEC.
    setAppState('generating-spec');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setEvidenceMap('');
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

      let generatedSpec = '';
      await generateSummary({
        apiKey: deepseekKey,
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

      const auditSpec = async (specToAudit) => {
        let audit = '';
        await generateSummary({
          apiKey: deepseekKey,
          pdfText: buildSpecAuditUserMessage(generatedEvidenceMap, specToAudit),
          systemPrompt: specAuditPrompt,
          onChunk: (chunk) => {
            audit += chunk;
          },
          signal: abortControllerRef.current.signal,
        });
        return audit;
      };

      currentAudit = await auditSpec(currentSpec);

      while (correctionCount < 2 && getSpecAuditStatus(currentAudit) !== 'APROVADA') {
        correctionCount++;
        let correctedSpec = '';
        await generateSummary({
          apiKey: deepseekKey,
          pdfText: buildSpecCorrectionUserMessage(generatedEvidenceMap, currentSpec, currentAudit),
          systemPrompt: specCorrectionPrompt,
          onChunk: (chunk) => {
            correctedSpec += chunk;
          },
          signal: abortControllerRef.current.signal,
        });

        currentSpec = correctedSpec;
        setSpec(currentSpec);
        currentAudit = await auditSpec(currentSpec);
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
  }, [fileData, deepseekKey, zhipuKey, hasDeepseekAccess, hasZhipuAccess, preferences]);

  // --- Summary Generation Core (handles initial & reinforcement coverage runs) ---
  const runSummaryGeneration = useCallback(async (reinforcementString) => {
    if (!preferences) return;

    if (!hasDeepseekAccess) {
      setShowApiKeyModal(true);
      return;
    }

    if (!fileData || !spec.trim()) return;
    if (unresolvedRiskCount > 0) return;

    setAppState('processing');
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setError('');

    abortControllerRef.current = new AbortController();

    const summaryPrompt = buildSummaryPrompt();
    const rawContext = contextBase || fileData.contextBase || fileData.text;
    const evidenceContext = evidenceMap || fileData.evidenceMap || '';
    const riskReviewNotes = buildRiskReviewNotes(highRiskItems, riskDecisions);
    const outputPreferenceInstructions = buildOutputPreferenceInstructions(preferences);
    const textContext = evidenceContext
      ? `## MAPA DE EVIDENCIAS VALIDADO\n\n${evidenceContext}\n\n---\n\n## CONTEXTO BRUTO DO PDF\n\n${rawContext}`
      : rawContext;
    
    // Inject reinforcement instructions at the beginning of user message if present
    let userMessage = `${outputPreferenceInstructions}\n\n---\n\n${buildSummaryUserMessage(textContext, spec)}`;
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
        pdfText: userMessage,
        systemPrompt: summaryPrompt,
        onChunk: onSummaryChunk,
        signal: abortControllerRef.current.signal,
      });

      const splitGenerated = splitOperationalSections(finalSummary);
      finalSummary = splitGenerated.summary;
      setSummary(finalSummary);
      setSummaryLog(splitGenerated.log);

      // 2. Perform Automatic Audit
      setIsAuditing(true);
      
      const auditPrompt = buildAuditPrompt();
      const auditUserMessage = buildAuditUserMessage(textContext, spec, finalSummary);
      let auditReport = '';

      const onAuditChunk = (chunk) => {
        auditReport += chunk;
        const combinedLog = [splitGenerated.log, auditReport.trim()].filter(Boolean).join('\n\n---\n\n');
        setSummaryLog(combinedLog);
      };

      await generateSummary({
        apiKey: deepseekKey,
        pdfText: auditUserMessage,
        systemPrompt: auditPrompt,
        onChunk: onAuditChunk,
        signal: abortControllerRef.current.signal,
      });

      // 3. Scan for page coverage programmatically
      const missing = getMissingPages(finalSummary, fileData.numPages);
      setMissingPages(missing);

      setIsAuditing(false);
      setAppState('result');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Summary generation error:', err);
      setError(err.message || 'Erro ao gerar o resumo.');
      setAppState('error');
    }
  }, [deepseekKey, hasDeepseekAccess, fileData, spec, preferences, contextBase, evidenceMap, highRiskItems, riskDecisions, unresolvedRiskCount]);

  // --- Initial Summary Generation ---
  const handleGenerateFromSpec = useCallback(() => {
    setCoverageReinforcementInstruction('');
    setMissingPages([]);
    runSummaryGeneration('');
  }, [runSummaryGeneration]);

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
    generateSpec(fileData, preferences);
  }, [fileData, preferences, generateSpec]);

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
    localStorage.setItem('resumex_api_key', keys.deepseek);
    localStorage.setItem('resumex_zhipu_key', keys.zhipu);
    setShowApiKeyModal(false);

    if (fileData && preferences && (keys.deepseek || serverConfig.deepseekConfigured) && (keys.zhipu || serverConfig.zhipuConfigured)) {
      generateSpec(fileData, preferences);
    }
  }, [fileData, preferences, serverConfig.deepseekConfigured, serverConfig.zhipuConfigured, generateSpec]);

  // --- Reset ---
  const handleNewSummary = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (fileData?.pdfUrl) URL.revokeObjectURL(fileData.pdfUrl);
    setFileData(null);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setSummary('');
    setSummaryLog('');
    setIsAuditing(false);
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizProcessingMessage('');
    setError('');
    setAppState('upload');
  }, [fileData]);

  // --- Back to upload ---
  const handleBackToUpload = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (fileData?.pdfUrl) URL.revokeObjectURL(fileData.pdfUrl);
    setFileData(null);
    setPreferences(null);
    setContextBase('');
    setEvidenceMap('');
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
    setSummary('');
    setSummaryLog('');
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setQuizFiles([]);
    setQuizQuestions([]);
    setQuizAnalysis(null);
    setQuizProcessingMessage('');
    setAppState('upload');
  }, [fileData]);

  // --- Back to preferences ---
  const handleBackToPreferences = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setSpec('');
    setSpecAudit('');
    setSpecCorrectionCount(0);
    setRiskDecisions({});
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
        </div>
      </div>
    );
  }

  if (!isE2EMockMode && !isSignedIn) {
    return (
      <div className="auth-screen">
        <div className="auth-panel clerk-auth-panel">
          <SignIn
            signUpUrl="/"
            appearance={{
              variables: {
                colorPrimary: '#8fb8a8',
                colorBackground: '#171c18',
                colorInputBackground: '#202720',
                colorInputText: '#f3efe7',
                colorText: '#f3efe7',
                colorTextSecondary: '#b8b4aa',
                colorNeutral: '#8f8a80',
                borderRadius: '8px',
                fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
              },
              elements: {
                rootBox: 'clerk-root-box',
                card: 'clerk-card',
                headerTitle: 'clerk-header-title',
                headerSubtitle: 'clerk-header-subtitle',
                socialButtonsBlockButton: 'clerk-social-button',
                footerAction: 'clerk-footer-action',
                footer: 'clerk-footer',
                formButtonPrimary: 'clerk-primary-button',
              },
            }}
          />
        </div>
      </div>
    );
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
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-content">
        <Header
          deepseekKey={deepseekKey}
          zhipuKey={zhipuKey}
          deepseekAvailable={hasDeepseekAccess}
          zhipuAvailable={hasZhipuAccess}
          onOpenApiKeyModal={() => setShowApiKeyModal(true)}
          userActions={<UserButton afterSignOutUrl="/" />}
        />

        {appState === 'upload' && (
          <UploadZone
            onUploadComplete={handleUploadComplete}
            onStartQuiz={handleStartQuiz}
          />
        )}

        {appState === 'quiz-upload' && (
          <QuizUpload
            deepseekKey={deepseekKey}
            deepseekAvailable={hasDeepseekAccess}
            zhipuKey={zhipuKey}
            zhipuAvailable={hasZhipuAccess}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
            onGenerate={handleGenerateQuiz}
            onBack={handleNewSummary}
          />
        )}

        {appState === 'preferences' && fileData && (
          <PreferencesPanel
            fileData={fileData}
            deepseekKey={deepseekKey}
            zhipuKey={zhipuKey}
            deepseekAvailable={hasDeepseekAccess}
            zhipuAvailable={hasZhipuAccess}
            onOpenApiKeyModal={() => setShowApiKeyModal(true)}
            onContinue={handlePreferencesComplete}
            onBack={handleBackToUpload}
          />
        )}

        {appState === 'rendering-pdf' && fileData && (
          <div className="processing-section">
            <div className="processing-animation">
              <div className="processing-ring" style={{ borderTopColor: 'var(--accent-cyan)' }} />
              <div className="processing-ring" style={{ borderRightColor: 'var(--accent-mint)', animationDirection: 'reverse' }} />
              <div className="processing-core">📸</div>
            </div>
            <div className="processing-text">
              <h3>Preparando imagens das páginas</h3>
              <p>Renderizando as páginas selecionadas para leitura visual...</p>
            </div>
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{ width: `${renderingProgress}%` }} />
            </div>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {renderingProgress}% concluído
            </span>
          </div>
        )}

        {appState === 'transcribing-pdf' && fileData && (
          <div className="processing-section">
            <div className="processing-animation">
              <div className="processing-ring" style={{ borderTopColor: 'var(--accent-amber)' }} />
              <div className="processing-ring" style={{ borderRightColor: 'var(--accent-purple)', animationDirection: 'reverse' }} />
              <div className="processing-core">📝</div>
            </div>
            <div className="processing-text">
              <h3>Transcrevendo com GLM-4V</h3>
              <p>O modelo de visão está lendo as páginas selecionadas para capturar caneta, setas e esquemas...</p>
            </div>
            {transcriptionProgress.total > 0 && (
              <>
                <div className="upload-progress-bar">
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
            onSpecChange={setSpec}
            onRiskDecisionChange={handleRiskDecisionChange}
            onGenerate={handleGenerateFromSpec}
            onRegenerateSpec={handleRegenerateSpec}
            onBack={handleBackToPreferences}
          />
        )}

        {appState === 'processing' && (
          <ProcessingView isAuditing={isAuditing} />
        )}

        {appState === 'quiz-processing' && (
          <div className="processing-section">
            <div className="processing-animation">
              <div className="processing-ring" style={{ borderTopColor: 'var(--accent-mint)' }} />
              <div className="processing-ring" style={{ borderRightColor: 'var(--accent-cyan)', animationDirection: 'reverse' }} />
              <div className="processing-core">Q</div>
            </div>
            <div className="processing-text">
              <h3>Montando simulado</h3>
              <p>{quizProcessingMessage || 'A IA esta extraindo questoes e usando a teoria para completar o teste.'}</p>
            </div>
          </div>
        )}

        {appState === 'result' && (
          <ResultView
            pdfUrl={fileData?.pdfUrl}
            summary={summary}
            summaryLog={summaryLog}
            missingPages={missingPages}
            onRegenerateWithCoverage={handleRegenerateWithCoverage}
            onNewSummary={handleNewSummary}
          />
        )}

        {appState === 'quiz-result' && (
          <QuizView
            files={quizFiles}
            questions={quizQuestions}
            analysis={quizAnalysis}
            onNewQuiz={handleStartQuiz}
          />
        )}

        {appState === 'error' && (
          <div className="error-section">
            <div className="error-icon">😵</div>
            <h2 className="error-title">Ops, algo deu errado</h2>
            <p className="error-message">{error}</p>
            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={handleNewSummary}>
                ← Recomeçar
              </button>
              {fileData && preferences && (
                <button className="btn btn-primary" onClick={handleGenerateFromSpec}>
                  🔄 Tentar Novamente
                </button>
              )}
            </div>
          </div>
        )}
      </div>

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
