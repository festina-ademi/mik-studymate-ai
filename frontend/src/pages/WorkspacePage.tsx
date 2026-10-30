import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCode2,
  FileText,
  FolderTree,
  Layers3,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiQuotaBadge } from '../components/AiQuotaBadge';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CodeInputView } from '../components/CodeInputView';
import { SegmentedControl } from '../components/SegmentedControl';
import { Tooltip } from '../components/Tooltip';
import { DocumentUploader } from '../components/DocumentUploader';
import { ErrorState } from '../components/ErrorState';
import { LongCodeAlert } from '../components/LongCodeAlert';
import { UploadChoiceCards } from '../components/UploadChoiceCards';
import { UploadChoiceModal } from '../components/UploadChoiceModal';
import { PrettyMarkdown } from '../components/PrettyMarkdown';
import { PrintableSection } from '../components/PrintableSection';
import { ProgressBar } from '../components/ProgressBar';
import { QuizPanel } from '../components/quiz/QuizPanel';
import { Skeleton } from '../components/Skeleton';
import { Tabs } from '../components/Tabs';
import { TutorPanel } from '../components/tutor/TutorPanel';
import { UploadQuotaIndicator } from '../components/UploadQuotaIndicator';
import { EXPLANATION_DEPTH_OPTIONS, useExplanationDepth } from '../hooks/useExplanationDepth';
import { LEVEL_OPTIONS, useLevel } from '../hooks/useLevel';
import {
  deleteDocument,
  generateExplanation,
  getDocument,
  getDocumentChunks,
  generateSummary,
  readLanguagePreference,
  type ChunkRecord,
  type DocumentRecord,
  type ExplanationResponse,
  type SummaryResponse,
} from '../lib/api';
import { countCodeLines, LINE_BY_LINE_MAX_LINES, reconstructCode } from '../lib/codeLines';
import { describeErrorDetailed } from '../lib/errors';
import { forgetRecentDocument, saveUploadedDocument } from '../lib/documentStorage';
import { getReferenceTargetId } from '../lib/references';
import { readJsonStorage, readStorage, STORAGE_KEYS } from '../lib/storage';

// Avatar Mode pulls in the avatar animation, the voice engine and its own player state; it is
// only opened once a student clicks that tab, so it is split into its own chunk rather than
// shipped with every workspace visit (see docs/SECURITY.md's sibling performance notes in the
// Phase 10 report).
const ExplainerPanel = lazy(() =>
  import('../components/explainer/ExplainerPanel').then((m) => ({ default: m.ExplainerPanel })),
);

const tabOptions = ['summary', 'explanation', 'quiz', 'tutor', 'explainer'] as const;

// After this many messages sent in Chat, "Back to the Teacher" (shown after the Avatar tab's
// "Ask") goes away: the learner has settled into the chat.
const AVATAR_ASK_BANNER_MESSAGES = 3;
type WorkspaceTab = (typeof tabOptions)[number];

interface GeneratedView {
  text: string;
  raw: string;
  object?: SummaryResponse | ExplanationResponse;
}

export interface RecentDocument {
  id: string;
  filename: string;
  content_type: string;
  source_format: string;
  detected_language: string | null;
  updatedAt: string;
}

interface PreviewItem {
  id: string;
  label: string;
  title: string;
  text: string;
  /** The text's first line's real line number in the source file, for the line-number gutter
   * (code documents only); `null` for lecture pages/slides, which are not line-numbered. */
  lineStart: number | null;
}

function readRecentDocuments(): RecentDocument[] {
  const raw = readJsonStorage<RecentDocument[]>(STORAGE_KEYS.recentDocuments);
  return Array.isArray(raw) ? raw : [];
}

function readCurrentDocumentId(): string | null {
  return readStorage(STORAGE_KEYS.currentDocumentId);
}

function writeCurrentDocumentId(value: string | null): void {
  if (value) {
    window.localStorage.setItem(STORAGE_KEYS.currentDocumentId, value);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.currentDocumentId);
  }
}

function isLecture(document: DocumentRecord): boolean {
  return document.content_type === 'lecture';
}

/** A code chunk's text with a muted, non-selectable line-number gutter (Phase 12), so a
 * student can reference an exact line when asking Chat about it. `select-none` on the gutter
 * keeps a copy-paste of the code clean, with no numbers mixed in. */
function CodeLines({ text, lineStart }: { text: string; lineStart: number | null }) {
  const lines = text.split('\n');
  const start = lineStart ?? 1;
  const width = String(start + lines.length - 1).length;
  return (
    <div className="font-mono text-sm leading-6 text-fg-muted">
      {lines.map((line, index) => (
        <div key={index} className="flex gap-3">
          <span
            aria-hidden="true"
            className="w-[2ch] shrink-0 select-none text-right text-fg-muted/50"
            style={{ minWidth: `${String(width)}ch` }}
          >
            {start + index}
          </span>
          <span className="whitespace-pre-wrap">{line}</span>
        </div>
      ))}
    </div>
  );
}

interface WorkspacePageProps {
  /** Called whenever the active tab changes; Study Mode uses this to log feature usage. */
  onTabChange?: (tab: WorkspaceTab) => void;
  /** Called once a quiz is completed; Study Mode uses this to log feature usage. */
  onQuizAttempt?: () => void;
}

export function WorkspacePage({ onTabChange, onQuizAttempt }: WorkspacePageProps = {}) {
  const { t, i18n } = useTranslation();
  const { level, setLevel } = useLevel();
  const { depth, setDepth } = useExplanationDepth();
  const queryClient = useQueryClient();
  const levelTooltipId = useId();
  const [tab, setTab] = useState<WorkspaceTab>('summary');
  const [documents, setDocuments] = useState<RecentDocument[]>(() => readRecentDocuments());
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(() => {
    const initialDocuments = readRecentDocuments();
    const saved = readCurrentDocumentId();
    if (saved && initialDocuments.some((item) => item.id === saved)) {
      return saved;
    }
    return initialDocuments[0]?.id ?? null;
  });
  const [summary, setSummary] = useState<GeneratedView | null>(null);
  const [explanation, setExplanation] = useState<GeneratedView | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [showUploader, setShowUploader] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  // The current document's code, when "Shorten the code" opened the editor pre-filled with it.
  const [codeToShorten, setCodeToShorten] = useState<string | null>(null);
  // Set when the student picks line-by-line themselves, so the long-code alert opens right away
  // even from another tab (otherwise it waits until the Explanation tab is opened).
  const [depthAlertRequested, setDepthAlertRequested] = useState(false);
  const [showUploadChoice, setShowUploadChoice] = useState(false);
  // The empty state (no document yet) starts on the document-vs-code choice directly, since
  // there is nothing behind it a modal would need to preserve.
  const [emptyStateMode, setEmptyStateMode] = useState<'choice' | 'document' | 'code'>('choice');
  // Bumped by the error card's Retry button to re-run the summary/explanation generation.
  const [generationAttempt, setGenerationAttempt] = useState(0);
  // Shown briefly when an interface-language switch kicks off a Summary/Explanation
  // regeneration for a document that already has content loaded (not on the initial load,
  // which has its own skeleton/progress bar already).
  const [isSwitchingLanguage, setIsSwitchingLanguage] = useState(false);
  const previousLanguageRef = useRef(i18n.language);
  // Exam mode: while a quiz is actively being taken, the source panel collapses to a thin
  // rail so it cannot be used to look up answers. `examPeeked` tracks whether the student has
  // used the "View source" affordance (the banner's button, or the rail's own expand chevron)
  // during the current quiz; QuizPanel reads it to flag the rest of that quiz's answers.
  const [examModeActive, setExamModeActive] = useState(false);
  const [examPeeked, setExamPeeked] = useState(false);

  const currentDocument = useMemo<DocumentRecord | null>(() => {
    if (!currentDocumentId) return null;
    const stored = readJsonStorage<{ document?: DocumentRecord }>(STORAGE_KEYS.documentState);
    if (stored?.document?.id === currentDocumentId) {
      return stored.document;
    }
    return null;
  }, [currentDocumentId]);

  const explainerChunks = useMemo<ChunkRecord[]>(() => {
    if (!currentDocument || isLecture(currentDocument)) return [];
    return readJsonStorage<ChunkRecord[]>(STORAGE_KEYS.chunksState) ?? [];
  }, [currentDocument]);

  const isCodeDocument = currentDocument !== null && !isLecture(currentDocument);
  const codeLineCount = useMemo(() => countCodeLines(explainerChunks), [explainerChunks]);
  // Depth only exists for code; lectures send none, so the toggle never re-fetches them.
  const requestDepth = isCodeDocument ? depth : undefined;
  // Line-by-line is a soft-limited mode: past the limit the student is asked to switch to blocks
  // or shorten the code first, and no line-by-line explanation is requested in the meantime.
  const lineByLineBlocked =
    requestDepth === 'line-by-line' && codeLineCount > LINE_BY_LINE_MAX_LINES;
  const previousDepthRef = useRef(requestDepth);

  const viewerItems = useMemo<PreviewItem[]>(() => {
    const doc = currentDocument;
    if (!doc) return [];
    if (isLecture(doc)) {
      // Real extracted text, grouped by the page/slide each chunk came from.
      const stored = readJsonStorage<ChunkRecord[]>(STORAGE_KEYS.chunksState) ?? [];
      const prefix = doc.source_format === 'pptx' ? 'slide' : 'page';
      const groups = new Map<number, string[]>();
      stored.forEach((chunk, index) => {
        const number = chunk.page_start ?? index + 1;
        groups.set(number, [...(groups.get(number) ?? []), chunk.text]);
      });
      return Array.from(groups, ([number, texts]) => ({
        id: `${prefix}-${doc.id}-${String(number)}`,
        label: `${prefix === 'slide' ? 'Slide' : 'Page'} ${String(number)}`,
        title: `${prefix === 'slide' ? 'Slide' : 'Page'} ${String(number)}`,
        text: texts.join('\n\n'),
        lineStart: null,
      }));
    }
    const chunks = readJsonStorage<ChunkRecord[]>(STORAGE_KEYS.chunksState) ?? [];
    if (chunks.length === 0) {
      return [
        {
          id: `${doc.id}-file`,
          label: 'main',
          title: doc.filename,
          text: 'No code chunks available',
          lineStart: null,
        },
      ];
    }
    return chunks.map((chunk, index) => {
      const chunkIndex = index + 1;
      const fileLabel = chunk.heading ?? 'file-' + String(chunkIndex);
      return {
        id: doc.id + '-line-' + String(chunkIndex),
        label: fileLabel,
        title: fileLabel,
        text: chunk.text,
        lineStart: chunk.line_start,
      };
    });
  }, [currentDocument]);

  useEffect(() => {
    if (currentDocument == null) {
      return;
    }

    // A run triggered purely by switching the interface language -- as opposed to the initial
    // load or a level change -- gets the brief "switching content to..." indicator instead of
    // the existing (bigger) loading skeleton, since there's already content on screen.
    const language = readLanguagePreference();
    const isLanguageSwitch = previousLanguageRef.current !== i18n.language && summary !== null;
    previousLanguageRef.current = i18n.language;
    // A depth switch only changes the explanation, so the (unchanged) summary is not re-fetched.
    const isDepthSwitch = previousDepthRef.current !== requestDepth && summary !== null;
    previousDepthRef.current = requestDepth;

    // Guards against a stale response clobbering fresh state: if the document, level or
    // language changes again while a summary/explanation call is still in flight (e.g. the
    // student flips the language toggle twice quickly), the effect re-runs and cancellation
    // flips true, so the abandoned run's callbacks become no-ops instead of racing the new run.
    // The check is read through a function (rather than a plain variable or ref) on purpose:
    // TypeScript's control flow analysis otherwise "proves" the flag can't have changed between
    // two checks in the same async function and flags the second one as dead code — which is
    // wrong here, since it *can* change, from the effect's cleanup firing while this function is
    // suspended at an `await`.
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;

    const run = async () => {
      setError(null);
      setIsGeneratingSummary(!isDepthSwitch);
      setIsGeneratingExplanation(!lineByLineBlocked);
      if (isLanguageSwitch) setIsSwitchingLanguage(true);
      try {
        if (!isDepthSwitch) {
          const summaryResponse = await generateSummary({
            documentId: currentDocument.id,
            level,
            language,
            stream: true,
            onPartial: (payload) => {
              if (isCancelled()) return;
              setSummary((current) => ({
                text: payload,
                raw: payload,
                object: current?.object,
              }));
            },
          });
          if (isCancelled()) return;
          setSummary({
            text: summaryResponse.overview || 'No summary available yet.',
            raw: JSON.stringify(summaryResponse),
            object: summaryResponse,
          });
        }
        if (lineByLineBlocked) return;

        const explanationResponse = await generateExplanation({
          documentId: currentDocument.id,
          level,
          language,
          depth: requestDepth,
          stream: true,
          onPartial: (payload) => {
            if (isCancelled()) return;
            setExplanation((current) => ({
              text: payload,
              raw: payload,
              object: current?.object,
            }));
          },
        });
        if (isCancelled()) return;
        setExplanation({
          text: explanationResponse.sections
            .map((section) => `## ${section.title}\n${section.content}`)
            .join('\n\n'),
          raw: JSON.stringify(explanationResponse),
          object: explanationResponse,
        });
      } catch (caught: unknown) {
        if (!isCancelled()) setError(describeErrorDetailed(t, caught));
      } finally {
        if (!isCancelled()) {
          setIsGeneratingSummary(false);
          setIsGeneratingExplanation(false);
          setIsSwitchingLanguage(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // `summary` is only read once, at the top, to detect a language switch; it must not itself
    // re-trigger this effect, hence the lint suppression below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentDocument,
    level,
    t,
    generationAttempt,
    i18n.language,
    requestDepth,
    lineByLineBlocked,
  ]);

  const changeDepth = (value: typeof depth): void => {
    setDepth(value);
    setDepthAlertRequested(value === 'line-by-line');
  };

  const closeLongCodeAlert = (): void => {
    setDepthAlertRequested(false);
    setDepth('blocks');
  };

  const shortenCode = (): void => {
    setDepthAlertRequested(false);
    setCodeToShorten(reconstructCode(explainerChunks));
    setShowCodeInput(true);
  };

  const closeCodeInput = (): void => {
    setShowCodeInput(false);
    setCodeToShorten(null);
  };

  const handleExamModeChange = (active: boolean): void => {
    setExamModeActive(active);
    if (!active) {
      setExamPeeked(false);
    }
  };

  const revealSourceDuringExam = (): void => {
    setExamPeeked(true);
  };

  const sourceCollapsed = tab === 'quiz' && examModeActive && !examPeeked;

  // The Avatar tab's "Ask" opens the Chat tab directly. While the learner is there having come
  // from the Avatar, Chat shows "Back to the Teacher"; it goes away once they send
  // AVATAR_ASK_BANNER_MESSAGES messages (they have settled into the chat) or leave Chat any
  // other way. `wasPlaying` decides whether going back resumes the paused narration.
  const [avatarAskContext, setAvatarAskContext] = useState<{
    fromAvatar: boolean;
    wasPlaying: boolean;
  } | null>(null);
  const [messagesSinceAvatarAsk, setMessagesSinceAvatarAsk] = useState(0);
  const [resumeNarrationOnReturn, setResumeNarrationOnReturn] = useState(false);

  // The Avatar panel stays mounted (hidden) once opened for the current document, so leaving it
  // for Chat and coming back keeps the narration's exact pause point. Adjusted during render
  // (React's recommended alternative to an effect for state derived from other state).
  const [explainerOpenedFor, setExplainerOpenedFor] = useState<string | null>(null);
  if (tab === 'explainer' && currentDocument && explainerOpenedFor !== currentDocument.id) {
    setExplainerOpenedFor(currentDocument.id);
  }
  const keepExplainerMounted =
    currentDocument !== null && explainerOpenedFor === currentDocument.id;

  const changeTab = (nextTab: WorkspaceTab): void => {
    setTab(nextTab);
    onTabChange?.(nextTab);
    if (nextTab !== 'tutor') {
      setAvatarAskContext(null);
    }
  };

  const askFromAvatar = (wasPlaying: boolean): void => {
    changeTab('tutor');
    setAvatarAskContext({ fromAvatar: true, wasPlaying });
    setMessagesSinceAvatarAsk(0);
  };

  const backToTeacher = (): void => {
    setResumeNarrationOnReturn(avatarAskContext?.wasPlaying ?? false);
    changeTab('explainer');
  };

  const countMessageSinceAvatarAsk = (): void => {
    if (!avatarAskContext) return;
    const sent = messagesSinceAvatarAsk + 1;
    setMessagesSinceAvatarAsk(sent);
    if (sent >= AVATAR_ASK_BANNER_MESSAGES) {
      setAvatarAskContext(null);
    }
  };
  // A citation clicked while the source panel is collapsed (exam mode): the panel it would
  // scroll to doesn't exist yet, so the click reveals it (a citation click implies wanting to
  // see the source, same as the exam banner's own "View source" button) and the scroll itself
  // waits for that reveal to actually render, below. A ref (not state) holds the pending
  // target, since reading and clearing it belongs in the effect that reacts to the reveal, not
  // in a render.
  const pendingReferenceRef = useRef<string | null>(null);

  useEffect(() => {
    if (sourceCollapsed || !currentDocument) {
      return;
    }
    const pending = pendingReferenceRef.current;
    if (!pending) {
      return;
    }
    pendingReferenceRef.current = null;
    const targetId = getReferenceTargetId(pending, currentDocument.id);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [sourceCollapsed, currentDocument]);

  const scrollToReference = (reference: string): void => {
    if (!currentDocument) {
      return;
    }
    if (sourceCollapsed) {
      revealSourceDuringExam();
      pendingReferenceRef.current = reference;
      return;
    }
    const targetId = getReferenceTargetId(reference, currentDocument.id);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteDocument(id);
      const nextDocuments = forgetRecentDocument(id);
      setDocuments(nextDocuments);
      void queryClient.invalidateQueries({ queryKey: ['userDocuments'] });
      if (currentDocumentId === id) {
        const fallback = nextDocuments[0]?.id ?? null;
        if (fallback) {
          selectRecentDocument(fallback);
        } else {
          setCurrentDocumentId(null);
          writeCurrentDocumentId(null);
        }
      }
    } catch (caught: unknown) {
      setError(describeErrorDetailed(t, caught));
    }
  };

  const handleDeleteClick = (id: string): void => {
    void handleDelete(id);
  };

  const handleUploaded = (document: DocumentRecord): void => {
    setDocuments(readRecentDocuments());
    setCurrentDocumentId(document.id);
    setSummary(null);
    setExplanation(null);
    setError(null);
    setPageIndex(0);
    setTab('summary');
    setAvatarAskContext(null);
    setShowUploader(false);
    setShowCodeInput(false);
    setCodeToShorten(null);
    setEmptyStateMode('choice');
  };

  const selectRecentDocument = (id: string): void => {
    // Only the most recently opened document's text is kept in localStorage, so switching back
    // to an older one re-fetches it from the backend first.
    const run = async () => {
      try {
        const [document, chunks] = await Promise.all([getDocument(id), getDocumentChunks(id)]);
        saveUploadedDocument(document, chunks);
        handleUploaded(document);
      } catch (caught: unknown) {
        setError(describeErrorDetailed(t, caught));
      }
    };
    void run();
  };

  if (!currentDocument) {
    return (
      <div className="space-y-6 py-4">
        <div className="flex justify-end">
          <AiQuotaBadge />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-fg">{t('workspace.emptyTitle')}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t('workspace.emptyDescription')}</p>
          <UploadQuotaIndicator className="mt-3" />
        </div>
        {emptyStateMode === 'choice' ? (
          <div className="mx-auto w-full max-w-2xl">
            <UploadChoiceCards
              onChooseDocument={() => {
                setEmptyStateMode('document');
              }}
              onChooseCode={() => {
                setEmptyStateMode('code');
              }}
            />
          </div>
        ) : emptyStateMode === 'code' ? (
          <CodeInputView
            onUploaded={handleUploaded}
            onCancel={() => {
              setEmptyStateMode('choice');
            }}
          />
        ) : (
          <DocumentUploader
            onUploaded={handleUploaded}
            onCancel={() => {
              setEmptyStateMode('choice');
            }}
          />
        )}
      </div>
    );
  }

  const currentSummary = tab === 'summary' ? summary : null;
  const currentExplanation = tab === 'explanation' ? explanation : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <AiQuotaBadge />
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-fg-muted">
            {t('workspace.title')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-fg">{currentDocument.filename}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip
            id={levelTooltipId}
            title={t('workspace.levelTooltipTitle')}
            content={
              <div className="space-y-2">
                {LEVEL_OPTIONS.map((option) => (
                  <p
                    key={option}
                    className={level === option ? 'font-semibold text-primary' : 'text-fg-muted'}
                  >
                    {t(`workspace.levelTooltipDescription_${option}`)}
                  </p>
                ))}
              </div>
            }
            wide
            placement="bottom"
            align="end"
          >
            <SegmentedControl
              label={t('header.levelLabel')}
              describedBy={levelTooltipId}
              value={level}
              options={LEVEL_OPTIONS.map((option) => ({
                value: option,
                label: t(`level.${option}`),
                ariaLabel: t(`level.${option}`),
              }))}
              onChange={setLevel}
            />
          </Tooltip>
          {isCodeDocument ? (
            <SegmentedControl
              label={t('workspace.depthLabel')}
              value={depth}
              options={EXPLANATION_DEPTH_OPTIONS.map((option) => ({
                value: option,
                label: t(`workspace.depth_${option}`),
                ariaLabel: t(`workspace.depth_${option}`),
              }))}
              onChange={changeDepth}
            />
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              setShowUploadChoice(true);
            }}
          >
            {t('workspace.uploadNew')}
          </Button>
          <Badge>{currentDocument.content_type}</Badge>
        </div>
      </div>

      <UploadChoiceModal
        open={showUploadChoice}
        onClose={() => {
          setShowUploadChoice(false);
        }}
        onChooseDocument={() => {
          setShowUploadChoice(false);
          setShowUploader(true);
        }}
        onChooseCode={() => {
          setShowUploadChoice(false);
          setShowCodeInput(true);
        }}
      />

      {showUploader ? (
        <DocumentUploader
          onUploaded={handleUploaded}
          onCancel={() => {
            setShowUploader(false);
          }}
        />
      ) : showCodeInput ? (
        <CodeInputView
          key={codeToShorten === null ? 'new' : 'shorten'}
          onUploaded={handleUploaded}
          onCancel={closeCodeInput}
          initialCode={codeToShorten ?? ''}
          initialFilename={codeToShorten === null ? '' : currentDocument.filename}
        />
      ) : null}

      <LongCodeAlert
        open={
          lineByLineBlocked &&
          (tab === 'explanation' || depthAlertRequested) &&
          !showCodeInput &&
          !showUploader
        }
        lineCount={codeLineCount}
        onSwitchToBlocks={closeLongCodeAlert}
        onShortenCode={shortenCode}
        onDismiss={closeLongCodeAlert}
      />

      <div
        className={`grid gap-6 ${sourceCollapsed ? 'xl:grid-cols-[3rem_1fr]' : 'xl:grid-cols-[1fr_1.3fr]'} ${showUploader || showCodeInput ? 'hidden' : ''}`}
      >
        {sourceCollapsed ? (
          <button
            type="button"
            onClick={revealSourceDuringExam}
            aria-label={t('workspace.examModeViewSource')}
            className="hidden items-center justify-center rounded-2xl border border-border bg-surface-muted text-fg-muted transition hover:text-fg xl:flex"
          >
            <Eye className="size-4" />
          </button>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                {isLecture(currentDocument) ? (
                  <FileText className="size-4" />
                ) : (
                  <FileCode2 className="size-4" />
                )}
                {isLecture(currentDocument)
                  ? t('workspace.originalMaterial')
                  : t('workspace.filePreview')}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPageIndex((value) => Math.max(0, value - 1));
                  }}
                  ariaLabel={t('workspace.previousPage')}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPageIndex((value) => Math.min(viewerItems.length - 1, value + 1));
                  }}
                  ariaLabel={t('workspace.nextPage')}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              {viewerItems.map((item, index) => {
                const isSelected = index === pageIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPageIndex(index);
                    }}
                    id={item.id}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-primary bg-primary-soft'
                        : 'border-border bg-surface-muted'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-fg">{item.title}</span>
                      <span className="text-xs uppercase tracking-[0.08em] text-fg-muted">
                        {item.label}
                      </span>
                    </div>
                    {isLecture(currentDocument) ? (
                      <p className="whitespace-pre-wrap text-sm leading-6 text-fg-muted">
                        {item.text}
                      </p>
                    ) : (
                      <CodeLines text={item.text} lineStart={item.lineStart} />
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <Card className="flex min-h-160 flex-col overflow-hidden">
          <Tabs
            value={tab}
            onChange={changeTab}
            options={tabOptions.map((option) => ({
              value: option,
              label: t(`workspace.${option}Tab`),
            }))}
          />

          <div className="flex-1 overflow-auto p-4">
            {error && (tab === 'summary' || tab === 'explanation') ? (
              // Only the tabs that depend on the generated summary/explanation show its failure;
              // the quiz, chat and avatar tabs make their own requests and stay usable.
              <ErrorState
                title={t('workspace.errorTitle')}
                description={error}
                onRetry={() => {
                  setError(null);
                  setGenerationAttempt((attempt) => attempt + 1);
                }}
              />
            ) : tab === 'summary' ? (
              <div className="space-y-4">
                {isSwitchingLanguage ? (
                  <p className="text-xs font-medium text-primary">
                    {t('workspace.switchingLanguage')}
                  </p>
                ) : (
                  isGeneratingSummary && (
                    <ProgressBar value={70} label={t('workspace.summaryLoading')} />
                  )
                )}
                {currentSummary ? (
                  <PrintableSection
                    title={t('workspace.printSummaryTitle')}
                    documentName={currentDocument.filename}
                    language={readLanguagePreference()}
                  >
                    {isLecture(currentDocument) && currentDocument.page_count ? (
                      <p className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                        {t(
                          currentDocument.source_format === 'pptx'
                            ? 'workspace.summaryMetaSlides'
                            : 'workspace.summaryMetaPages',
                          { count: currentDocument.page_count },
                        )}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 print-hide">
                      {(() => {
                        const concepts =
                          currentSummary.object !== undefined &&
                          'key_concepts' in currentSummary.object
                            ? currentSummary.object.key_concepts
                            : [];
                        return concepts.slice(0, 5).map((item) => (
                          <button
                            key={`${item.term}-${item.definition}`}
                            type="button"
                            onClick={() => {
                              scrollToReference(item.references[0] ?? 'Page 1');
                            }}
                            className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs text-fg-muted"
                          >
                            {item.term}
                          </button>
                        ));
                      })()}
                    </div>
                    <PrettyMarkdown value={currentSummary.text} />
                  </PrintableSection>
                ) : (
                  <div className="space-y-3">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="h-4 animate-pulse rounded bg-surface-muted" />
                    ))}
                  </div>
                )}
              </div>
            ) : tab === 'explanation' ? (
              <div className="space-y-4">
                {isSwitchingLanguage ? (
                  <p className="text-xs font-medium text-primary">
                    {t('workspace.switchingLanguage')}
                  </p>
                ) : (
                  isGeneratingExplanation && (
                    <ProgressBar value={75} label={t('workspace.explanationLoading')} />
                  )
                )}
                {currentExplanation ? (
                  <PrintableSection
                    title={t('workspace.printExplanationTitle')}
                    documentName={currentDocument.filename}
                    language={readLanguagePreference()}
                  >
                    <div className="flex flex-wrap gap-2 print-hide">
                      {(() => {
                        const references =
                          currentExplanation.object !== undefined &&
                          'sections' in currentExplanation.object
                            ? currentExplanation.object.sections.flatMap(
                                (section) => section.references,
                              )
                            : [];
                        return references.slice(0, 6).map((reference) => (
                          <button
                            key={reference}
                            type="button"
                            onClick={() => {
                              scrollToReference(reference);
                            }}
                            className="rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-xs text-primary-soft-fg"
                          >
                            {reference}
                          </button>
                        ));
                      })()}
                    </div>
                    <PrettyMarkdown value={currentExplanation.text} />
                  </PrintableSection>
                ) : (
                  <div className="space-y-3">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="h-4 animate-pulse rounded bg-surface-muted" />
                    ))}
                  </div>
                )}
              </div>
            ) : tab === 'quiz' ? (
              <QuizPanel
                key={currentDocument.id}
                documentId={currentDocument.id}
                documentName={currentDocument.filename}
                level={level}
                language={readLanguagePreference()}
                onJumpToReference={scrollToReference}
                onQuizAttempt={onQuizAttempt}
                onExamModeChange={handleExamModeChange}
                examPeeked={examPeeked}
                onPeekSource={revealSourceDuringExam}
              />
            ) : tab === 'tutor' ? (
              <TutorPanel
                key={currentDocument.id}
                documentId={currentDocument.id}
                contentType={currentDocument.content_type}
                level={level}
                language={readLanguagePreference()}
                onJumpToReference={scrollToReference}
                autoFocusInput={avatarAskContext !== null}
                onBackToTeacher={avatarAskContext ? backToTeacher : null}
                onMessageSent={countMessageSinceAvatarAsk}
              />
            ) : null}
            {keepExplainerMounted ? (
              <div className={tab === 'explainer' ? undefined : 'hidden'}>
                <Suspense fallback={<Skeleton lines={6} />}>
                  <ExplainerPanel
                    key={currentDocument.id}
                    documentId={currentDocument.id}
                    document={currentDocument}
                    chunks={explainerChunks}
                    level={level}
                    language={readLanguagePreference()}
                    onJumpToReference={scrollToReference}
                    active={tab === 'explainer'}
                    onAsk={askFromAvatar}
                    resumeOnReturn={resumeNarrationOnReturn}
                    onResumeHandled={() => {
                      setResumeNarrationOnReturn(false);
                    }}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-fg-muted">
            <Layers3 className="size-4" />
            {t('workspace.recentDocuments')}
          </div>
          <UploadQuotaIndicator />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {documents.map((document) => (
            <div
              key={document.id}
              className={`flex items-center justify-between rounded-xl border p-3 ${document.id === currentDocumentId ? 'border-primary bg-primary-soft' : 'border-border bg-surface-muted'}`}
            >
              <button
                type="button"
                onClick={() => {
                  selectRecentDocument(document.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <FolderTree className="size-4 text-primary" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{document.filename}</div>
                  <div className="text-xs text-fg-muted">{document.content_type}</div>
                </div>
              </button>
              <button
                type="button"
                aria-label={t('workspace.deleteDocument', { filename: document.filename })}
                onClick={() => {
                  handleDeleteClick(document.id);
                }}
                className="rounded-lg p-2 text-fg-muted hover:bg-surface"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
