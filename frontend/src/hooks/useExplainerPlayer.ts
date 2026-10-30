import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getExplainerSection,
  planExplainer,
  type ApiLanguage,
  type ExplainerScript,
  type ExplainerSectionSummary,
} from '../lib/api';
import { describeError } from '../lib/errors';
import {
  getTtsHealth,
  prefetchSpeech,
  speakText,
  type TtsController,
  type TtsEngineKind,
  type TtsErrorCode,
} from '../lib/tts';
import type { StudyLevel } from './useLevel';

export const EXPLAINER_SPEEDS = [1, 1.25, 1.5] as const;
export type ExplainerSpeed = (typeof EXPLAINER_SPEEDS)[number];

export type ExplainerPhase = 'loading' | 'ready' | 'error';
export type ExplainerStatus = 'idle' | 'playing' | 'paused';

const OVERVIEW_INDEX = -1;

function sectionCacheKey(
  index: number,
  level: StudyLevel,
  language: ApiLanguage,
  simplified: boolean,
): string {
  return `${String(index)}:${level}:${language}:${simplified ? '1' : '0'}`;
}

interface UseExplainerPlayerOptions {
  documentId: string;
  level: StudyLevel;
  language: ApiLanguage;
}

export interface UseExplainerPlayerResult {
  phase: ExplainerPhase;
  error: string | null;
  sections: ExplainerSectionSummary[];
  currentIndex: number;
  isOverview: boolean;
  isFirstSection: boolean;
  isLastSection: boolean;
  currentScript: ExplainerScript | null;
  isLoadingScript: boolean;
  status: ExplainerStatus;
  speed: ExplainerSpeed;
  captionIndex: number;
  amplitude: number;
  /** Narration was paused by "Ask" (the learner went to the Chat tab) and not yet resumed. */
  isAsking: boolean;
  showQuiz: boolean;
  voiceError: TtsErrorCode | null;
  /** Which engine actually spoke the most recent utterance, once known; `null` before the
   * first one resolves. Drives the "using browser voice" indicator when it reads `'browser'`
   * after a silent runtime fallback (the server voice is the default, so this starts `null`
   * rather than an optimistic `'server'` guess). */
  voiceEngine: TtsEngineKind | null;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  /** Jumps directly to any section (e.g. clicking a section pill), unlike `next`/`previous`
   * which only step by one. */
  goToSection: (index: number) => void;
  setSpeed: (speed: ExplainerSpeed) => void;
  explainSimpler: () => void;
  /** Pauses narration for "Ask", remembering whether it was playing. */
  ask: () => void;
  /** Ends the ask and resumes narration in place if `ask()` paused it mid-play. */
  resumeFromAsk: () => void;
  /** Ends the ask without touching playback. */
  dismissAsk: () => void;
  continueAfterQuiz: () => void;
  retry: () => void;
}

/**
 * The Avatar Mode player state machine: loads the plan, speaks the overview and each section
 * in turn (via `speakText()`, one utterance/caption at a time, server voice first with a
 * silent fallback to the browser's own voice), prefetches the next section's script while the
 * current one plays, and shows a mini-quiz once a section's narration ends.
 */
export function useExplainerPlayer({
  documentId,
  level,
  language,
}: UseExplainerPlayerOptions): UseExplainerPlayerResult {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<ExplainerPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<ExplainerSectionSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(OVERVIEW_INDEX);
  const [currentScript, setCurrentScript] = useState<ExplainerScript | null>(null);
  const [isLoadingScript, setIsLoadingScript] = useState(false);
  const [status, setStatus] = useState<ExplainerStatus>('idle');
  const [speed, setSpeedState] = useState<ExplainerSpeed>(1);
  const [captionIndex, setCaptionIndex] = useState(-1);
  const [amplitude, setAmplitude] = useState(0);
  const [isAsking, setIsAsking] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [voiceError, setVoiceError] = useState<TtsErrorCode | null>(null);
  const [voiceEngineKind, setVoiceEngineKind] = useState<TtsEngineKind | null>(null);

  const cache = useRef(new Map<string, ExplainerScript | Promise<ExplainerScript>>());
  const wasPlayingBeforeAsk = useRef(false);
  const simplifiedByIndex = useRef(new Map<number, boolean>());
  const controllerRef = useRef<TtsController | null>(null);
  const generationRef = useRef(0);
  // Checked once per session (health is cached in `lib/tts`); once a fallback actually happens,
  // flipped to skip straight to the browser voice for the rest of this playback session rather
  // than paying a doomed synthesize round-trip on every remaining utterance.
  const preferBrowserRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getTtsHealth().then((health) => {
      if (!cancelled) preferBrowserRef.current = !health.available;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopSpeaking = useCallback((): void => {
    generationRef.current += 1;
    controllerRef.current?.stop();
    controllerRef.current = null;
  }, []);

  const speakFrom = useCallback(
    (script: ExplainerScript, fromCaption: number, rate: ExplainerSpeed) => {
      const startAt = Math.max(0, fromCaption);
      const utterances = script.captions.slice(startAt).filter((text) => text.trim().length > 0);
      generationRef.current += 1;
      const generation = generationRef.current;
      setStatus('playing');
      setVoiceError(null);

      const finish = (): void => {
        setAmplitude(0);
        setStatus('idle');
        if (script.quiz && script.quiz.questions.length > 0) {
          setShowQuiz(true);
        }
      };

      if (utterances.length === 0) {
        finish();
        return;
      }

      let index = 0;
      const speakNext = (): void => {
        if (generation !== generationRef.current) return;
        const text = utterances[index];
        if (text === undefined) {
          finish();
          return;
        }
        setCaptionIndex(startAt + index);
        controllerRef.current = speakText(text, language, {
          rate,
          preferBrowser: preferBrowserRef.current,
          onAmplitude: (value) => {
            if (generation === generationRef.current) setAmplitude(value);
          },
          onEngineResolved: (engine) => {
            if (generation !== generationRef.current) return;
            setVoiceEngineKind(engine);
            if (engine === 'browser') {
              preferBrowserRef.current = true;
              return;
            }
            // This caption's server audio is ready and about to play: synthesize the next one
            // meanwhile, so it is ready when this one ends instead of after a multi-second gap.
            // Started only now (not alongside this caption's own request) because the server
            // runs one synthesis at a time and this caption must not queue behind its successor.
            const upcoming = utterances[index + 1];
            if (upcoming !== undefined) prefetchSpeech(upcoming, language);
          },
          onEnd: () => {
            if (generation !== generationRef.current) return;
            index += 1;
            speakNext();
          },
          onError: (code) => {
            if (generation !== generationRef.current) return;
            setAmplitude(0);
            setStatus('idle');
            setVoiceError(code);
          },
        });
      };
      speakNext();
    },
    [language],
  );

  const loadSection = useCallback(
    (index: number, options: { simplified?: boolean; autoplay?: boolean } = {}): void => {
      const simplified = options.simplified ?? false;
      const autoplay = options.autoplay ?? true;
      const key = sectionCacheKey(index, level, language, simplified);
      setIsLoadingScript(true);
      setShowQuiz(false);
      setCaptionIndex(-1);
      setVoiceError(null);
      stopSpeaking();

      let entry = cache.current.get(key);
      if (!entry) {
        entry = getExplainerSection({
          documentId,
          sectionIndex: index,
          level,
          language,
          simplified,
        });
        cache.current.set(key, entry);
      }
      void Promise.resolve(entry)
        .then((script) => {
          cache.current.set(key, script);
          simplifiedByIndex.current.set(index, simplified);
          setCurrentScript(script);
          setCurrentIndex(index);
          setIsLoadingScript(false);
          setPhase('ready');
          if (autoplay) {
            speakFrom(script, 0, speed);
          }
          // Prefetch the next section in the background so playback starts quickly once the
          // learner reaches it; ignored on failure (a normal fetch will retry at that point).
          if (index >= 0 && index + 1 < sections.length) {
            const nextKey = sectionCacheKey(index + 1, level, language, false);
            if (!cache.current.has(nextKey)) {
              const nextPromise = getExplainerSection({
                documentId,
                sectionIndex: index + 1,
                level,
                language,
                simplified: false,
              });
              cache.current.set(nextKey, nextPromise);
              void nextPromise
                .then((nextScript) => {
                  cache.current.set(nextKey, nextScript);
                })
                .catch(() => {
                  cache.current.delete(nextKey);
                });
            }
          }
        })
        .catch((caught: unknown) => {
          cache.current.delete(key);
          setIsLoadingScript(false);
          setError(describeError(t, caught));
          setPhase('error');
        });
    },
    [documentId, language, level, sections.length, speakFrom, speed, stopSpeaking, t],
  );

  // Plan the sections once per document/level/language, then load the overview.
  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      setPhase('loading');
      setError(null);
      setSections([]);
      setCurrentScript(null);
      setCurrentIndex(OVERVIEW_INDEX);
      setStatus('idle');
      cache.current.clear();
      stopSpeaking();

      try {
        const plan = await planExplainer({ documentId, level, language });
        if (cancelled) return;
        setSections(plan.sections);
        cache.current.set(sectionCacheKey(OVERVIEW_INDEX, level, language, false), plan.overview);
        setCurrentScript(plan.overview);
        setCurrentIndex(OVERVIEW_INDEX);
        setPhase('ready');
      } catch (caught: unknown) {
        if (cancelled) return;
        setError(describeError(t, caught));
        setPhase('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-plan only on document/level/language
  }, [documentId, level, language]);

  // Clean up any in-flight speech when the component using this hook unmounts.
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const play = useCallback((): void => {
    if (status === 'playing' || !currentScript) {
      return;
    }
    // Always restarts the current section from the beginning, including when paused (by the
    // Pause button or by asking a question) -- a deliberate choice so Play doubles as "replay
    // what the avatar just said"; the one way to resume from the exact pause point instead is
    // the Chat tab's "Back to the Teacher" after "Ask" (`resumeFromAsk`), which calls the
    // paused controller's `play()` directly rather than going through this restart path.
    speakFrom(currentScript, 0, speed);
  }, [currentScript, speakFrom, speed, status]);

  const pause = useCallback((): void => {
    if (status !== 'playing') return;
    controllerRef.current?.pause();
    setStatus('paused');
  }, [status]);

  const next = useCallback((): void => {
    if (currentIndex >= sections.length - 1) return;
    loadSection(currentIndex + 1);
  }, [currentIndex, loadSection, sections.length]);

  const previous = useCallback((): void => {
    if (currentIndex <= OVERVIEW_INDEX) return;
    loadSection(currentIndex - 1);
  }, [currentIndex, loadSection]);

  const goToSection = useCallback(
    (index: number): void => {
      if (index === currentIndex || index < 0 || index >= sections.length) return;
      loadSection(index);
    },
    [currentIndex, loadSection, sections.length],
  );

  const setSpeed = useCallback(
    (nextSpeed: ExplainerSpeed): void => {
      setSpeedState(nextSpeed);
      if (status === 'playing' && currentScript) {
        // The server (audio-element) engine applies this in place; only the browser engine
        // (no live rate control once an utterance has started) needs a restart.
        const appliedLive = controllerRef.current?.setPlaybackRate(nextSpeed) ?? false;
        if (!appliedLive) {
          speakFrom(currentScript, captionIndex >= 0 ? captionIndex : 0, nextSpeed);
        }
      }
    },
    [captionIndex, currentScript, speakFrom, status],
  );

  const explainSimpler = useCallback((): void => {
    if (currentIndex < 0) return;
    loadSection(currentIndex, { simplified: true });
  }, [currentIndex, loadSection]);

  const ask = useCallback((): void => {
    wasPlayingBeforeAsk.current = status === 'playing';
    if (status === 'playing') {
      controllerRef.current?.pause();
      setStatus('paused');
    }
    setIsAsking(true);
  }, [status]);

  const resumeFromAsk = useCallback((): void => {
    setIsAsking(false);
    if (wasPlayingBeforeAsk.current && status === 'paused') {
      controllerRef.current?.play();
      setStatus('playing');
    }
  }, [status]);

  /** Ends the ask without touching playback -- the learner came back to the Avatar tab some other
   * way than "Back to the Teacher" -- as opposed to `resumeFromAsk`, which resumes in place. */
  const dismissAsk = useCallback((): void => {
    setIsAsking(false);
  }, []);

  const continueAfterQuiz = useCallback((): void => {
    setShowQuiz(false);
    if (currentIndex < sections.length - 1) {
      loadSection(currentIndex + 1);
    }
  }, [currentIndex, loadSection, sections.length]);

  const retry = useCallback((): void => {
    if (currentIndex === OVERVIEW_INDEX && !currentScript) {
      // The very first load (planning) failed: re-run the effect by touching nothing here is
      // not possible directly, so re-load the overview through the same path as navigation.
      setPhase('loading');
      setError(null);
      void planExplainer({ documentId, level, language })
        .then((plan) => {
          setSections(plan.sections);
          cache.current.set(sectionCacheKey(OVERVIEW_INDEX, level, language, false), plan.overview);
          setCurrentScript(plan.overview);
          setCurrentIndex(OVERVIEW_INDEX);
          setPhase('ready');
        })
        .catch((caught: unknown) => {
          setError(describeError(t, caught));
          setPhase('error');
        });
      return;
    }
    loadSection(currentIndex, { simplified: simplifiedByIndex.current.get(currentIndex) ?? false });
  }, [currentIndex, currentScript, documentId, language, level, loadSection, t]);

  return useMemo(
    () => ({
      phase,
      error,
      sections,
      currentIndex,
      isOverview: currentIndex === OVERVIEW_INDEX,
      isFirstSection: currentIndex <= OVERVIEW_INDEX,
      isLastSection: currentIndex >= sections.length - 1,
      currentScript,
      isLoadingScript,
      status,
      speed,
      captionIndex,
      amplitude,
      isAsking,
      showQuiz,
      voiceError,
      voiceEngine: voiceEngineKind,
      play,
      pause,
      next,
      previous,
      goToSection,
      setSpeed,
      explainSimpler,
      ask,
      resumeFromAsk,
      dismissAsk,
      continueAfterQuiz,
      retry,
    }),
    [
      phase,
      error,
      sections,
      currentIndex,
      currentScript,
      isLoadingScript,
      status,
      speed,
      captionIndex,
      amplitude,
      isAsking,
      showQuiz,
      voiceError,
      voiceEngineKind,
      play,
      pause,
      next,
      previous,
      goToSection,
      setSpeed,
      explainSimpler,
      ask,
      resumeFromAsk,
      dismissAsk,
      continueAfterQuiz,
      retry,
    ],
  );
}
