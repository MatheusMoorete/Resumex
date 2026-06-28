import { useState, useCallback, useEffect, useRef } from 'react';
import { SignIn, useAuth, UserButton } from '@clerk/clerk-react';
import Header from './components/Header';
import ApiKeyModal from './components/ApiKeyModal';
import UploadZone from './components/UploadZone';
import PreferencesPanel from './components/PreferencesPanel';
import SpecEditor from './components/SpecEditor';
import ProcessingView from './components/ProcessingView';
import ResultView from './components/ResultView';
import { generateSummary } from './services/deepseekApi';
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

function uniqueSortedPages(pages) {
  return [...new Set(pages)].sort((a, b) => a - b);
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
  const [spec, setSpec] = useState('');
  const [summary, setSummary] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [missingPages, setMissingPages] = useState([]);
  const [coverageReinforcementInstruction, setCoverageReinforcementInstruction] = useState('');
  const [error, setError] = useState('');

  // Abort controller
  const abortControllerRef = useRef(null);
  const hasDeepseekAccess = Boolean(deepseekKey || serverConfig.deepseekConfigured);
  const hasZhipuAccess = Boolean(zhipuKey || serverConfig.zhipuConfigured);

  useEffect(() => {
    let isMounted = true;

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
    setFileData(data);
    setAppState('preferences');
  }, []);

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
          ? uniqueSortedPages([...detectedVisionPages, ...manualVisionPages])
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

    // 5. Call generator for SPEC
    setAppState('generating-spec');
    setSpec('');
    setError('');

    abortControllerRef.current = new AbortController();
    const specPrompt = buildSpecPrompt(prefsToUse);

    try {
      await generateSummary({
        apiKey: deepseekKey,
        pdfText: generatedContext,
        systemPrompt: specPrompt,
        onChunk: (chunk) => {
          setSpec((prev) => prev + chunk);
        },
        signal: abortControllerRef.current.signal,
      });

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

    setAppState('processing');
    setSummary('');
    setIsAuditing(false);
    setError('');

    abortControllerRef.current = new AbortController();

    const summaryPrompt = buildSummaryPrompt();
    const textContext = contextBase || fileData.contextBase || fileData.text;
    
    // Inject reinforcement instructions at the beginning of user message if present
    let userMessage = buildSummaryUserMessage(textContext, spec);
    if (reinforcementString) {
      userMessage = `${reinforcementString}\n\n---\n\n${userMessage}`;
    }

    try {
      // 1. Generate Summary
      let finalSummary = '';
      const onSummaryChunk = (chunk) => {
        finalSummary += chunk;
        setSummary(finalSummary);
      };

      await generateSummary({
        apiKey: deepseekKey,
        pdfText: userMessage,
        systemPrompt: summaryPrompt,
        onChunk: onSummaryChunk,
        signal: abortControllerRef.current.signal,
      });

      // 2. Perform Automatic Audit
      setIsAuditing(true);
      
      const auditPrompt = buildAuditPrompt();
      const auditUserMessage = buildAuditUserMessage(textContext, spec, finalSummary);
      let auditReport = '\n\n';

      const onAuditChunk = (chunk) => {
        auditReport += chunk;
        setSummary(finalSummary + auditReport);
      };

      await generateSummary({
        apiKey: deepseekKey,
        pdfText: auditUserMessage,
        systemPrompt: auditPrompt,
        onChunk: onAuditChunk,
        signal: abortControllerRef.current.signal,
      });

      // 3. Scan for page coverage programmatically
      const totalOutput = finalSummary + auditReport;
      const missing = getMissingPages(totalOutput, fileData.numPages);
      setMissingPages(missing);

      setIsAuditing(false);
      setAppState('result');
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Summary generation error:', err);
      setError(err.message || 'Erro ao gerar o resumo.');
      setAppState('error');
    }
  }, [deepseekKey, hasDeepseekAccess, fileData, spec, preferences, contextBase]);

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
    setSpec('');
    setSummary('');
    setIsAuditing(false);
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
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
    setSpec('');
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setAppState('upload');
  }, [fileData]);

  // --- Back to preferences ---
  const handleBackToPreferences = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setSpec('');
    setMissingPages([]);
    setCoverageReinforcementInstruction('');
    setAppState('preferences');
  }, []);

  if (!isLoaded || (isSignedIn && !serverConfig.loaded)) {
    return (
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-brand">
            <div className="header-logo-icon">Rx</div>
            <div>
              <h1>ResumeX</h1>
              <p>Carregando...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
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
            <div className="header-logo-icon">Rx</div>
            <div>
              <h1>ResumeX</h1>
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
          <UploadZone onUploadComplete={handleUploadComplete} />
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
            isGenerating={appState === 'generating-spec'}
            onSpecChange={setSpec}
            onGenerate={handleGenerateFromSpec}
            onRegenerateSpec={handleRegenerateSpec}
            onBack={handleBackToPreferences}
          />
        )}

        {appState === 'processing' && (
          <ProcessingView isAuditing={isAuditing} />
        )}

        {appState === 'result' && (
          <ResultView
            pdfUrl={fileData?.pdfUrl}
            summary={summary}
            missingPages={missingPages}
            onRegenerateWithCoverage={handleRegenerateWithCoverage}
            onNewSummary={handleNewSummary}
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
