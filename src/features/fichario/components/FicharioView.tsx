import React, { useEffect, useState, useMemo, useRef } from 'react';
import { 
  listSummaries, 
  deleteSummary, 
  updateSummary, 
  getStoredUserTags, 
  saveStoredUserTag, 
  deleteStoredUserTag,
  type SavedSummary 
} from '../../summary/services/summaryApi';
import { listDecks, listCards, type FlashcardDeck } from '../../flashcards/services/flashcardApi';
import { listQuizzes, listQuizAttempts, deleteQuiz, type SavedQuiz, type SavedQuizAttempt } from '../../quiz/services/quizPersistenceApi';
import { 
  BookOpen, 
  Layers, 
  HelpCircle, 
  Trash2, 
  Search, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw, 
  Clock, 
  Award, 
  FolderArchive, 
  Pencil, 
  Tag,
  ArrowLeft,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Quote
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FicharioViewProps {
  onOpenSummary?: (summary: SavedSummary) => void;
  onOpenQuiz?: (quiz: SavedQuiz) => void;
  onOpenDeck?: (deck: FlashcardDeck) => void;
}

type ActiveTab = 'summaries' | 'flashcards' | 'quizzes';

// Helper for converting markdown to clean visual HTML for editing
function markdownToVisualHtml(markdown: string): string {
  if (!markdown) return '<p></p>';
  return markdown
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith('# ')) {
        return `<h2>${trimmed.slice(2)}</h2>`;
      }
      if (trimmed.startsWith('## ')) {
        return `<h2>${trimmed.slice(3)}</h2>`;
      }
      if (trimmed.startsWith('### ')) {
        return `<h3>${trimmed.slice(4)}</h3>`;
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const items = trimmed
          .split(/\n/)
          .map((line) => `<li>${line.replace(/^[-*]\s+/, '')}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      const formatted = trimmed
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
      return `<p>${formatted}</p>`;
    })
    .join('');
}

// Helper for converting visual HTML back to clean Markdown for storage
function visualHtmlToMarkdown(html: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  let markdown = '';
  temp.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2') {
        markdown += `## ${el.textContent?.trim()}\n\n`;
      } else if (tag === 'h3' || tag === 'h4') {
        markdown += `### ${el.textContent?.trim()}\n\n`;
      } else if (tag === 'ul') {
        el.querySelectorAll('li').forEach((li) => {
          markdown += `- ${li.textContent?.trim()}\n`;
        });
        markdown += '\n';
      } else if (tag === 'ol') {
        let i = 1;
        el.querySelectorAll('li').forEach((li) => {
          markdown += `${i++}. ${li.textContent?.trim()}\n`;
        });
        markdown += '\n';
      } else {
        const text = el.textContent?.trim();
        if (text) {
          markdown += `${text}\n\n`;
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        markdown += `${text}\n\n`;
      }
    }
  });

  return markdown.trim();
}

// Fullscreen Editor Component (UX-Focused Clean Document Editor with Site Header Visual)
const FicharioFullscreenEditor: React.FC<{
  summary: SavedSummary;
  availableTags: string[];
  onSave: (id: string, newTitle: string, newContent: string, newTags: string[]) => Promise<void>;
  onClose: () => void;
  onCreateTag: (tagName: string) => void;
  onDeleteTag: (tagName: string) => void;
}> = ({ summary, availableTags, onSave, onClose, onCreateTag, onDeleteTag }) => {
  const [title, setTitle] = useState(summary.title);
  const [tags, setTags] = useState<string[]>(summary.tags || []);
  const [saving, setSaving] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = markdownToVisualHtml(summary.content);
    }
  }, [summary.content]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const html = editorRef.current?.innerHTML || '';
      const markdownContent = visualHtmlToMarkdown(html);
      await onSave(summary.id, title, markdownContent, tags);
      onClose();
    } catch (err) {
      alert('Erro ao salvar resumo.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter((t) => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const handleCreateAndAssignTag = () => {
    const clean = newTagText.trim().replace(/^#/, '');
    if (clean) {
      onCreateTag(clean);
      if (!tags.includes(clean)) {
        setTags([...tags, clean]);
      }
      setNewTagText('');
    }
  };

  return (
    <div className="fichario-fullscreen-editor-overlay">
      {/* Site Header Matching Layout */}
      <div className="fullscreen-editor-site-header">
        <button className="fichario-btn-secondary" onClick={onClose}>
          <ArrowLeft size={15} style={{ marginRight: 6 }} /> Voltar ao Fichário
        </button>

        <div className="fullscreen-header-center">
          <span className="fullscreen-header-kicker">
            <FileText size={13} /> EDIÇÃO DE RESUMO
          </span>
          <h2 className="fullscreen-header-title">Edição de Ficha de Estudos</h2>
        </div>

        <div className="fullscreen-header-actions">
          <button className="fichario-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="fichario-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </div>

      {/* Main Document Workspace (Focused on Great UX) */}
      <div className="fullscreen-editor-workspace">
        <div className="fullscreen-editor-container">
          {/* Metadata Card: Title & Tags */}
          <div className="editor-meta-card">
            <input
              type="text"
              className="editor-title-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Digite o título da ficha de resumo..."
            />

            <div className="editor-tags-row">
              <span className="tags-row-label">
                <Tag size={13} /> TAGS DA FICHA:
              </span>
              <div className="tags-row-chips">
                {tags.map((t) => (
                  <span key={t} className="editor-tag-chip active">
                    #{t}
                    <button type="button" onClick={() => handleToggleTag(t)}>×</button>
                  </span>
                ))}
                <button
                  type="button"
                  className="editor-add-tag-btn"
                  onClick={() => setShowTagPicker(true)}
                >
                  + Adicionar Tag
                </button>
              </div>
            </div>
          </div>

          {/* Modal de Escolha e Criação de Tags com Estilo Fichário */}
          {showTagPicker && (
            <div
              className="home-confirmation-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowTagPicker(false);
              }}
            >
              <section className="home-confirmation-dialog tag-picker-fichario-dialog">
                <span className="home-confirmation-kicker">GERENCIAR TAGS DA FICHA</span>
                <h2>Tags da sua conta</h2>
                <p>Selecione as tags para vincular a esta ficha de resumo ou crie novas tags abaixo.</p>

                <div className="tag-modal-options-list">
                  {availableTags.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: '#65726b' }}>Nenhuma tag cadastrada ainda.</p>
                  ) : (
                    availableTags.map((t) => (
                      <div
                        key={t}
                        className={`tag-modal-option-chip ${tags.includes(t) ? 'selected' : ''}`}
                        onClick={() => handleToggleTag(t)}
                      >
                        <span>#{t}</span>
                        {tags.includes(t) && <span className="check-mark">✓</span>}
                        <button
                          type="button"
                          className="tag-modal-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTag(t);
                          }}
                          title="Excluir tag da conta"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="tag-modal-create-row">
                  <input
                    type="text"
                    className="fichario-input-text"
                    placeholder="Criar nova tag (ex: Pediatria, Neuro...)"
                    value={newTagText}
                    onChange={(e) => setNewTagText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateAndAssignTag();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCreateAndAssignTag}
                  >
                    + Criar
                  </button>
                </div>

                <div className="home-confirmation-actions" style={{ marginTop: '20px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowTagPicker(false)}
                  >
                    Concluído
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* Standard Clean Rich Text Editor (High Usability & Distraction-Free UX) */}
          <div className="editor-document-wrapper">
            <div className="editor-clean-toolbar">
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Negrito (Ctrl+B)"
                onClick={() => document.execCommand('bold')}
              >
                <Bold size={15} />
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Itálico (Ctrl+I)"
                onClick={() => document.execCommand('italic')}
              >
                <Italic size={15} />
              </button>
              <span className="editor-toolbar-divider" />
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Título Principal (H1)"
                onClick={() => document.execCommand('formatBlock', false, 'h2')}
              >
                <Heading1 size={15} />
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Subtítulo (H2)"
                onClick={() => document.execCommand('formatBlock', false, 'h3')}
              >
                <Heading2 size={15} />
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Parágrafo Normal"
                onClick={() => document.execCommand('formatBlock', false, 'p')}
              >
                Texto
              </button>
              <span className="editor-toolbar-divider" />
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Lista com Marcadores"
                onClick={() => document.execCommand('insertUnorderedList')}
              >
                <List size={15} />
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Lista Numerada"
                onClick={() => document.execCommand('insertOrderedList')}
              >
                <ListOrdered size={15} />
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                title="Citação"
                onClick={() => document.execCommand('formatBlock', false, 'blockquote')}
              >
                <Quote size={15} />
              </button>
            </div>

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="editor-clean-canvas"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export const FicharioView: React.FC<FicharioViewProps> = ({
  onOpenSummary,
  onOpenQuiz,
  onOpenDeck,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('summaries');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // States for data
  const [summaries, setSummaries] = useState<SavedSummary[]>([]);
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [deckCardCounts, setDeckCardCounts] = useState<Record<string, number>>({});
  const [quizzes, setQuizzes] = useState<SavedQuiz[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<SavedQuizAttempt[]>([]);
  const [userTags, setUserTags] = useState<string[]>([]);

  // Selected summary modal preview
  const [previewSummary, setPreviewSummary] = useState<SavedSummary | null>(null);

  // Deletion confirmation modal targets
  const [deleteTargetSummary, setDeleteTargetSummary] = useState<SavedSummary | null>(null);
  const [deleteTargetQuiz, setDeleteTargetQuiz] = useState<SavedQuiz | null>(null);
  const [deleteTargetTag, setDeleteTargetTag] = useState<string | null>(null);

  // Fullscreen Editor summary target
  const [editingSummary, setEditingSummary] = useState<SavedSummary | null>(null);

  // New Tag Creation Modal State
  const [showCreateTagModal, setShowCreateTagModal] = useState(false);
  const [newTagNameInput, setNewTagNameInput] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [sumList, deckList, quizList, attemptList] = await Promise.all([
        listSummaries().catch(() => []),
        listDecks().catch(() => []),
        listQuizzes().catch(() => []),
        listQuizAttempts().catch(() => []),
      ]);

      setSummaries(sumList);
      setDecks(deckList);
      setQuizzes(quizList);
      setQuizAttempts(attemptList);

      // Load card counts for decks
      const counts: Record<string, number> = {};
      await Promise.all(
        deckList.map(async (deck) => {
          const cards = await listCards(deck.id).catch(() => []);
          counts[deck.id] = cards.length;
        })
      );
      setDeckCardCounts(counts);
    } catch (err) {
      console.error('Erro ao carregar dados do Fichário:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    setUserTags(getStoredUserTags());
  }, []);

  const handleCreateNewUserTag = (tagName: string) => {
    const updated = saveStoredUserTag(tagName);
    setUserTags(updated);
  };

  const handleConfirmDeleteTag = async (tagName: string) => {
    const updatedTags = deleteStoredUserTag(tagName);
    setUserTags(updatedTags);

    if (selectedTagFilter === tagName) {
      setSelectedTagFilter(null);
    }

    // Remove tag from summaries in local state & update DB
    const updatedSummaries = await Promise.all(
      summaries.map(async (s) => {
        if (s.tags?.includes(tagName)) {
          const newTags = s.tags.filter((t) => t !== tagName);
          const updated = await updateSummary(s.id, { tags: newTags });
          return updated;
        }
        return s;
      })
    );

    setSummaries(updatedSummaries);
    setDeleteTargetTag(null);
  };

  const handleSaveSummaryEdit = async (id: string, newTitle: string, newContent: string, newTags: string[]) => {
    try {
      const updated = await updateSummary(id, {
        title: newTitle,
        content: newContent,
        tags: newTags,
      });
      setSummaries((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      if (previewSummary?.id === updated.id) {
        setPreviewSummary(updated);
      }
    } catch (err) {
      alert('Erro ao salvar alterações no resumo.');
      throw err;
    }
  };

  const handleConfirmDeleteSummary = async () => {
    if (!deleteTargetSummary) return;
    try {
      await deleteSummary(deleteTargetSummary.id);
      setSummaries((prev) => prev.filter((s) => s.id !== deleteTargetSummary.id));
      if (previewSummary?.id === deleteTargetSummary.id) setPreviewSummary(null);
      setDeleteTargetSummary(null);
    } catch (err) {
      alert('Erro ao apagar resumo.');
    }
  };

  const handleConfirmDeleteQuiz = async () => {
    if (!deleteTargetQuiz) return;
    try {
      await deleteQuiz(deleteTargetQuiz.id);
      setQuizzes((prev) => prev.filter((q) => q.id !== deleteTargetQuiz.id));
      setDeleteTargetQuiz(null);
    } catch (err) {
      alert('Erro ao apagar simulado.');
    }
  };

  // Filtered Items
  const filteredSummaries = useMemo(() => {
    return summaries.filter((s) => {
      const matchesSearch = !searchQuery.trim() ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesTag = !selectedTagFilter || s.tags?.includes(selectedTagFilter);
      return matchesSearch && matchesTag;
    });
  }, [summaries, searchQuery, selectedTagFilter]);

  const filteredDecks = useMemo(() => {
    if (!searchQuery.trim()) return decks;
    const q = searchQuery.toLowerCase();
    return decks.filter((d) => d.name.toLowerCase().includes(q));
  }, [decks, searchQuery]);

  const filteredQuizzes = useMemo(() => {
    if (!searchQuery.trim()) return quizzes;
    const q = searchQuery.toLowerCase();
    return quizzes.filter((qz) => qz.title.toLowerCase().includes(q));
  }, [quizzes, searchQuery]);

  // Helper for quiz best score
  const getQuizStats = (quizId: string) => {
    const attempts = quizAttempts.filter((a) => a.quiz_id === quizId);
    if (!attempts.length) return null;
    const bestScore = Math.max(...attempts.map((a) => a.score));
    const lastAttempt = attempts[0];
    return {
      count: attempts.length,
      bestScore: Math.round(bestScore),
      lastScore: Math.round(lastAttempt.score),
      lastDate: new Date(lastAttempt.completed_at).toLocaleDateString('pt-BR'),
    };
  };

  return (
    <div className="fichario-view-page">
      {/* Header Fichário Médico */}
      <header className="fichario-view-header">
        <div className="fichario-view-header-main">
          <span className="fichario-view-kicker">
            <FolderArchive size={14} /> MESA DE ESTUDOS MÉDICOS / ACERVO PESSOAL
          </span>
          <h1 className="fichario-view-title">Meu Fichário de Estudos</h1>
          <p className="fichario-view-subtitle">
            Seus resumos médicos formatados, cartões de recordação ativa (FSRS) e simulados organizados em um só lugar.
          </p>
        </div>

        <div className="fichario-view-header-aside">
          <button className="fichario-btn-refresh" onClick={loadData} disabled={loading} title="Atualizar fichário">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Toolbar com Abas de Divisória do Fichário + Barra de Busca */}
      <div className="fichario-view-toolbar">
        <div className="fichario-divider-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'summaries'}
            className={`fichario-tab-item tab-summaries ${activeTab === 'summaries' ? 'active' : ''}`}
            onClick={() => setActiveTab('summaries')}
          >
            <BookOpen size={16} />
            <span>Resumos</span>
            <strong className="tab-pill">{summaries.length}</strong>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'flashcards'}
            className={`fichario-tab-item tab-flashcards ${activeTab === 'flashcards' ? 'active' : ''}`}
            onClick={() => setActiveTab('flashcards')}
          >
            <Layers size={16} />
            <span>Flashcards</span>
            <strong className="tab-pill">{decks.length}</strong>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'quizzes'}
            className={`fichario-tab-item tab-quizzes ${activeTab === 'quizzes' ? 'active' : ''}`}
            onClick={() => setActiveTab('quizzes')}
          >
            <HelpCircle size={16} />
            <span>Simulados</span>
            <strong className="tab-pill">{quizzes.length}</strong>
          </button>
        </div>

        <div className="fichario-search-wrapper">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="fichario-search-input"
            placeholder="Filtrar fichas por título, conteúdo ou tema..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Folha Pautada do Fichário */}
      <main className="fichario-notebook-sheet">
        <div className="fichario-sheet-margin-line" />

        {loading ? (
          <div className="fichario-state-loading">
            <RefreshCw size={28} className="spin text-green" />
            <span>Buscando suas fichas de estudo...</span>
          </div>
        ) : (
          <>
            {/* ABAS 1: RESUMOS */}
            {activeTab === 'summaries' && (
              <div className="fichario-tab-panel">
                {/* Tag Filter Bar */}
                <div className="fichario-tag-filter-bar">
                  <span className="tag-filter-label">
                    <Tag size={13} /> TAGS DA CONTA:
                  </span>
                  <button
                    className={`tag-filter-chip ${selectedTagFilter === null ? 'active' : ''}`}
                    onClick={() => setSelectedTagFilter(null)}
                  >
                    Todas ({summaries.length})
                  </button>
                  {userTags.map((tag) => {
                    const count = summaries.filter((s) => s.tags?.includes(tag)).length;
                    return (
                      <span
                        key={tag}
                        className={`tag-filter-chip ${selectedTagFilter === tag ? 'active' : ''}`}
                      >
                        <span
                          className="chip-text"
                          onClick={() => setSelectedTagFilter(selectedTagFilter === tag ? null : tag)}
                        >
                          #{tag} ({count})
                        </span>
                        <button
                          type="button"
                          className="chip-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetTag(tag);
                          }}
                          title="Excluir tag permanentemente"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  <button
                    className="tag-filter-chip create-chip"
                    onClick={() => setShowCreateTagModal(true)}
                  >
                    + Criar Tag
                  </button>
                </div>

                {filteredSummaries.length === 0 ? (
                  <div className="fichario-empty-box">
                    <FileText size={44} className="empty-icon" />
                    <h3>Nenhum resumo encontrado</h3>
                    <p>
                      {searchQuery || selectedTagFilter
                        ? 'Nenhuma ficha bate com os filtros selecionados.'
                        : 'Envie um PDF na Home para gerar e arquivar seu primeiro resumo médico.'}
                    </p>
                  </div>
                ) : (
                  <div className="fichario-grid-cards">
                    {filteredSummaries.map((summary) => (
                      <article
                        key={summary.id}
                        className="fichario-index-card summary-type"
                        onClick={() => setPreviewSummary(summary)}
                      >
                        <div className="index-card-header">
                          <span className="index-badge template-badge">
                            {summary.tags && summary.tags.length > 0
                              ? summary.tags[0].toUpperCase()
                              : summary.template_type === 'active_recall'
                              ? 'ACTIVE RECALL'
                              : summary.template_type === 'cornell'
                              ? 'CORNELL'
                              : 'RESUMO MÉDICO'}
                          </span>
                          <div className="index-card-actions">
                            <button
                              className="index-card-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSummary(summary);
                              }}
                              title="Editar ficha em tela cheia"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="index-card-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTargetSummary(summary);
                              }}
                              title="Apagar ficha"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <h3 className="index-card-title">{summary.title}</h3>

                        {summary.source_file_name && (
                          <div className="index-card-source">
                            <FileText size={12} /> {summary.source_file_name}
                          </div>
                        )}

                        {summary.tags && summary.tags.length > 0 && (
                          <div className="index-card-tags">
                            {summary.tags.map((tag) => (
                              <span key={tag} className="index-tag-chip">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}

                        <p className="index-card-snippet">
                          {summary.content.replace(/[#*`>_-]/g, '').slice(0, 150)}...
                        </p>

                        <div className="index-card-footer">
                          <span className="index-card-date">
                            <Calendar size={12} />{' '}
                            {new Date(summary.created_at).toLocaleDateString('pt-BR')}
                          </span>
                          <span className="index-card-action">
                            Ler Ficha <ExternalLink size={12} />
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ABAS 2: FLASHCARDS */}
            {activeTab === 'flashcards' && (
              <div className="fichario-tab-panel">
                {filteredDecks.length === 0 ? (
                  <div className="fichario-empty-box">
                    <Layers size={44} className="empty-icon" />
                    <h3>Nenhum deck de flashcards</h3>
                    <p>
                      {searchQuery
                        ? 'Nenhum deck encontrado para essa busca.'
                        : 'Os conjuntos de cartões criados aparecerão organizados como um fichário aqui.'}
                    </p>
                  </div>
                ) : (
                  <div className="fichario-grid-cards">
                    {filteredDecks.map((deck) => {
                      const count = deckCardCounts[deck.id] ?? 0;
                      return (
                        <article
                          key={deck.id}
                          className="fichario-index-card deck-type"
                          onClick={() => onOpenDeck?.(deck)}
                        >
                          <div className="index-card-header">
                            <span className="index-badge deck-badge">Filtro FSRS</span>
                          </div>

                          <h3 className="index-card-title">{deck.name}</h3>

                          <div className="deck-info-box">
                            <div className="info-cell">
                              <strong className="info-num">{count}</strong>
                              <span className="info-lbl">Cartões</span>
                            </div>
                            <div className="info-cell">
                              <strong className="info-num">{(deck.desired_retention * 100).toFixed(0)}%</strong>
                              <span className="info-lbl">Alvo de Retenção</span>
                            </div>
                          </div>

                          <div className="index-card-footer">
                            <span className="index-card-date">
                              <Clock size={12} /> {new Date(deck.updated_at).toLocaleDateString('pt-BR')}
                            </span>
                            <span className="index-card-action">
                              Estudar Deck <ExternalLink size={12} />
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ABAS 3: SIMULADOS */}
            {activeTab === 'quizzes' && (
              <div className="fichario-tab-panel">
                {filteredQuizzes.length === 0 ? (
                  <div className="fichario-empty-box">
                    <HelpCircle size={44} className="empty-icon" />
                    <h3>Nenhum simulado salvo</h3>
                    <p>
                      {searchQuery
                        ? 'Nenhum simulado atende ao filtro fornecido.'
                        : 'Gere simulados automáticos para testar seus conhecimentos e acompanhar suas notas.'}
                    </p>
                  </div>
                ) : (
                  <div className="fichario-grid-cards">
                    {filteredQuizzes.map((quiz) => {
                      const stats = getQuizStats(quiz.id);
                      return (
                        <article
                          key={quiz.id}
                          className="fichario-index-card quiz-type"
                          onClick={() => onOpenQuiz?.(quiz)}
                        >
                          <div className="index-card-header">
                            <span className="index-badge quiz-badge">
                              {quiz.questions?.length || 0} Questões
                            </span>
                            <button
                              className="index-card-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTargetQuiz(quiz);
                              }}
                              title="Excluir simulado"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <h3 className="index-card-title">{quiz.title}</h3>

                          {stats ? (
                            <div className="quiz-score-banner">
                              <div className="score-row">
                                <Award size={14} className="icon-amber" />
                                <span>Melhor resultado: <strong>{stats.bestScore}%</strong></span>
                              </div>
                              <div className="score-row">
                                <CheckCircle2 size={14} className="icon-green" />
                                <span>{stats.count} {stats.count === 1 ? 'tentativa' : 'tentativas'}</span>
                              </div>
                            </div>
                          ) : (
                            <p className="index-card-snippet">Simulado arquivado. Nenhuma tentativa realizada ainda.</p>
                          )}

                          <div className="index-card-footer">
                            <span className="index-card-date">
                              <Calendar size={12} /> {new Date(quiz.created_at).toLocaleDateString('pt-BR')}
                            </span>
                            <span className="index-card-action">
                              Fazer Simulado <ExternalLink size={12} />
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal de Leitura / Prévia do Resumo */}
      {previewSummary && (
        <div className="fichario-read-overlay" onClick={() => setPreviewSummary(null)}>
          <div className="fichario-read-paper" onClick={(e) => e.stopPropagation()}>
            <div className="read-paper-header">
              <div>
                <span className="read-paper-badge">
                  {previewSummary.tags?.[0] || previewSummary.template_type}
                </span>
                <h2>{previewSummary.title}</h2>
              </div>
              <button className="read-paper-close" onClick={() => setPreviewSummary(null)}>
                ✕
              </button>
            </div>

            <div className="read-paper-content markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {previewSummary.content}
              </ReactMarkdown>
            </div>

            <div className="read-paper-footer">
              <button
                className="fichario-btn-secondary"
                onClick={() => {
                  setEditingSummary(previewSummary);
                }}
              >
                <Pencil size={14} style={{ marginRight: 6 }} /> Editar Ficha
              </button>
              <button
                className="fichario-btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(previewSummary.content);
                  alert('Resumo em Markdown copiado!');
                }}
              >
                Copiar para o Notion
              </button>
              {onOpenSummary && (
                <button
                  className="fichario-btn-primary"
                  onClick={() => {
                    onOpenSummary(previewSummary);
                    setPreviewSummary(null);
                  }}
                >
                  <ExternalLink size={14} style={{ marginRight: 6 }} /> Abrir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editor Fullscreen sem caractéres .md */}
      {editingSummary && (
        <FicharioFullscreenEditor
          summary={editingSummary}
          availableTags={userTags}
          onSave={handleSaveSummaryEdit}
          onClose={() => setEditingSummary(null)}
          onCreateTag={handleCreateNewUserTag}
          onDeleteTag={(tagName) => setDeleteTargetTag(tagName)}
        />
      )}

      {/* Modal de Confirmação de Exclusão de Resumo */}
      {deleteTargetSummary && (
        <div
          className="home-confirmation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTargetSummary(null);
          }}
        >
          <section
            className="home-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-summary-dialog-title"
          >
            <span className="home-confirmation-kicker">EXCLUIR RESUMO?</span>
            <h2 id="delete-summary-dialog-title">Excluir este resumo do fichário?</h2>
            <p>
              Esta ação não poderá ser desfeita. A ficha <strong>"{deleteTargetSummary.title}"</strong> será permanentemente removida do seu fichário.
            </p>
            <div className="home-confirmation-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTargetSummary(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmDeleteSummary}
              >
                Excluir resumo
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Simulado */}
      {deleteTargetQuiz && (
        <div
          className="home-confirmation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTargetQuiz(null);
          }}
        >
          <section
            className="home-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-quiz-dialog-title"
          >
            <span className="home-confirmation-kicker">EXCLUIR SIMULADO?</span>
            <h2 id="delete-quiz-dialog-title">Excluir este simulado do fichário?</h2>
            <p>
              Esta ação não poderá ser desfeita. O simulado <strong>"{deleteTargetQuiz.title}"</strong> e seu histórico de tentativas serão removidos.
            </p>
            <div className="home-confirmation-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTargetQuiz(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmDeleteQuiz}
              >
                Excluir simulado
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Tag */}
      {deleteTargetTag && (
        <div
          className="home-confirmation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTargetTag(null);
          }}
        >
          <section
            className="home-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-tag-dialog-title"
          >
            <span className="home-confirmation-kicker">EXCLUIR TAG DA CONTA?</span>
            <h2 id="delete-tag-dialog-title">Excluir tag #{deleteTargetTag}?</h2>
            <p>
              Esta ação não poderá ser desfeita. A tag <strong>#{deleteTargetTag}</strong> será permanentemente removida da sua conta e de todos os resumos vinculados.
            </p>
            <div className="home-confirmation-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTargetTag(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleConfirmDeleteTag(deleteTargetTag)}
              >
                Excluir tag
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de Criação de Nova Tag */}
      {showCreateTagModal && (
        <div
          className="home-confirmation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateTagModal(false);
          }}
        >
          <section className="home-confirmation-dialog">
            <span className="home-confirmation-kicker">CRIAR NOVA TAG</span>
            <h2>Adicionar tag ao fichário</h2>
            <p>Crie uma nova tag para organizar seus resumos e matérias de estudo.</p>
            <input
              type="text"
              className="fichario-input-text"
              placeholder="Ex: Cirurgia Vascular, Cardiologia, Pediatria..."
              value={newTagNameInput}
              onChange={(e) => setNewTagNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newTagNameInput.trim()) {
                    handleCreateNewUserTag(newTagNameInput);
                    setSelectedTagFilter(newTagNameInput.trim().replace(/^#/, ''));
                    setNewTagNameInput('');
                    setShowCreateTagModal(false);
                  }
                }
              }}
              autoFocus
              style={{ marginBlock: '12px' }}
            />
            <div className="home-confirmation-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateTagModal(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (newTagNameInput.trim()) {
                    handleCreateNewUserTag(newTagNameInput);
                    setSelectedTagFilter(newTagNameInput.trim().replace(/^#/, ''));
                    setNewTagNameInput('');
                    setShowCreateTagModal(false);
                  }
                }}
              >
                Criar Tag
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
