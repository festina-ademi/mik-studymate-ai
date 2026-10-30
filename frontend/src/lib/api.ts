/** Typed client for the StudyMate backend. Paths are relative to ``/api``. */

import type { ExplanationDepth } from '../hooks/useExplanationDepth';
import type { StudyLevel } from '../hooks/useLevel';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';
import { emitQuotaExceeded, emitQuotaUsageChanged } from './quotaEvents';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type ApiLanguage = 'en' | 'sq';
export type DocumentKind = 'lecture' | 'code';

/** The 14 real dropdown choices for pasted/typed code; "auto" is a separate request value. */
export type ProgrammingLanguageId =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'cpp'
  | 'csharp'
  | 'php'
  | 'sql'
  | 'html'
  | 'css'
  | 'go'
  | 'rust'
  | 'kotlin'
  | 'swift';

export const PROGRAMMING_LANGUAGE_IDS: ProgrammingLanguageId[] = [
  'python',
  'javascript',
  'typescript',
  'java',
  'cpp',
  'csharp',
  'php',
  'sql',
  'html',
  'css',
  'go',
  'rust',
  'kotlin',
  'swift',
];

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  content_hash: string;
  content_type: DocumentKind;
  source_format: string;
  detected_language: string | null;
  size_bytes: number;
  page_count: number | null;
}

export interface ChunkRecord {
  text: string;
  heading: string | null;
  page_start: number | null;
  page_end: number | null;
  line_start: number | null;
  line_end: number | null;
}

export interface UploadResult {
  document: DocumentRecord;
  chunks: ChunkRecord[];
}

export interface SummaryEntry {
  term: string;
  definition: string;
  references: string[];
}

export interface SummaryTakeaway {
  title: string;
  text: string;
  references: string[];
}

export interface GenerationMetadata {
  document_id: string;
  content_type: string;
  task: string;
  level: string;
  language: string;
  chunks_used: number;
  prompt_version: string;
  model: string;
  cached: boolean;
}

export interface SummaryResponse {
  overview: string;
  purpose?: string | null;
  inputs_outputs?: string[];
  main_components?: string[];
  key_concepts: SummaryEntry[];
  takeaways: SummaryTakeaway[];
  confidence_notes: string[];
  metadata: GenerationMetadata;
}

export interface ExplanationSection {
  title: string;
  content: string;
  references: string[];
}

export interface ExplanationResponse {
  sections: ExplanationSection[];
  recommendations: string[];
  architecture?: string | null;
  walkthrough: string[];
  confidence_notes: string[];
  metadata: GenerationMetadata;
}

export type QuestionKind = 'multiple_choice' | 'short_answer';
export type QuizDifficulty = 'easy' | 'medium' | 'hard';

/** A quiz question as shown before it is answered: no answer key included. */
export interface QuizQuestionRecord {
  id: number;
  kind: QuestionKind;
  topic: string;
  difficulty: QuizDifficulty;
  question: string;
  options: string[];
  /** Multiple_choice only: render checkboxes ("select all that apply") instead of radios. */
  allow_multiple: boolean;
  source_reference: string | null;
}

export interface QuizSetResponse {
  quiz_set_id: string;
  questions: QuizQuestionRecord[];
  weak_topics: string[];
  metadata: GenerationMetadata;
}

export interface QuizAnswerResult {
  question_id: number;
  kind: QuestionKind;
  topic: string;
  correct: boolean;
  score: number;
  provided: string;
  expected: string;
  /** Revealed now that the question has been answered; empty for short_answer. */
  correct_option_indices: number[];
  explanation: string | null;
  feedback: string | null;
  missing_key_points: string[];
  source_reference: string | null;
  peeked: boolean;
}

export interface QuizTopicBreakdownEntry {
  topic: string;
  correct: number;
  total: number;
  answered: number;
  average_score: number;
}

export interface QuizResultsResponse {
  quiz_set_id: string;
  total_questions: number;
  answered_questions: number;
  correct_count: number;
  score: number;
  topic_breakdown: QuizTopicBreakdownEntry[];
  weak_topics: string[];
  /** True if the learner opened "View source" (exam mode) at any point during this quiz. */
  peeked: boolean;
}

export interface WeakTopicEntry {
  topic: string;
  mastery: number;
  attempts: number;
}

export type MasteryLevel = 'weak' | 'developing' | 'strong';

export interface MasteryOverviewEntry {
  topic: string;
  mastery: number;
  level: MasteryLevel;
  attempts: number;
  correct: number;
}

export interface ReexplainResponse {
  topic: string;
  level: string;
  explanation: string;
  example: string;
  trace: string;
  references: string[];
  mastery: number;
  metadata: GenerationMetadata;
}

export interface TutorCitation {
  reference: string;
  snippet?: string | null;
}

export interface TutorHistoryEntry {
  id: number | null;
  role: 'user' | 'assistant';
  content: string;
  language: string;
  citations: TutorCitation[];
  follow_up_questions: string[];
}

export interface TutorResponse {
  answer: string;
  citations: TutorCitation[];
  follow_up_questions: string[];
  conversation_id: string;
  metadata: GenerationMetadata;
}

export interface ExplainerSectionSummary {
  index: number;
  title: string;
  source_reference: string;
  page_start: number | null;
  page_end: number | null;
  line_start: number | null;
  line_end: number | null;
}

export interface ExplainerScriptMetadata {
  document_id: string;
  level: string;
  language: string;
  simplified: boolean;
  prompt_version: string;
  model: string;
  cached: boolean;
}

/** One spoken script: the overview (`section_index: -1`) or a numbered section. */
export interface ExplainerScript {
  section_index: number;
  title: string;
  text: string;
  captions: string[];
  source_reference: string | null;
  page_start: number | null;
  page_end: number | null;
  line_start: number | null;
  line_end: number | null;
  quiz: QuizSetResponse | null;
  metadata: ExplainerScriptMetadata;
}

export interface ExplainerPlan {
  document_id: string;
  sections: ExplainerSectionSummary[];
  overview: ExplainerScript;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageKey: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    messageKey = `errors.${code}`,
    details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message_key: messageKey, details } = body.error;
    if (typeof code === 'string') {
      return new ApiError(
        status,
        code,
        typeof messageKey === 'string' ? messageKey : undefined,
        isRecord(details) ? details : {},
      );
    }
  }
  return new ApiError(status, 'http_error');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(
  path: string,
  parse: (body: unknown) => T | undefined,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      headers: { Accept: 'application/json' },
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'network');
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, body);
  }
  const parsed = parse(body);
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

function parseHealth(body: unknown): HealthResponse | undefined {
  if (isRecord(body) && body.status === 'ok' && typeof body.version === 'string') {
    return { status: 'ok', version: body.version };
  }
  return undefined;
}

function parseUpload(body: unknown): UploadResult | undefined {
  if (!isRecord(body) || !isRecord(body.document) || !Array.isArray(body.chunks)) {
    return undefined;
  }

  const document = body.document;
  const chunks = body.chunks.filter(isRecord);
  const parsedDocument: DocumentRecord = {
    id: typeof document.id === 'string' ? document.id : '',
    filename: typeof document.filename === 'string' ? document.filename : '',
    content_hash: typeof document.content_hash === 'string' ? document.content_hash : '',
    content_type: document.content_type === 'code' ? 'code' : 'lecture',
    source_format: typeof document.source_format === 'string' ? document.source_format : '',
    detected_language:
      typeof document.detected_language === 'string' ? document.detected_language : null,
    size_bytes: typeof document.size_bytes === 'number' ? document.size_bytes : 0,
    page_count: typeof document.page_count === 'number' ? document.page_count : null,
  };
  const parsedChunks: ChunkRecord[] = chunks.map((chunk) => ({
    text: typeof chunk.text === 'string' ? chunk.text : '',
    heading: typeof chunk.heading === 'string' ? chunk.heading : null,
    page_start: typeof chunk.page_start === 'number' ? chunk.page_start : null,
    page_end: typeof chunk.page_end === 'number' ? chunk.page_end : null,
    line_start: typeof chunk.line_start === 'number' ? chunk.line_start : null,
    line_end: typeof chunk.line_end === 'number' ? chunk.line_end : null,
  }));
  return { document: parsedDocument, chunks: parsedChunks };
}

function parseSummary(body: unknown): SummaryResponse | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const keyConcepts = Array.isArray(body.key_concepts) ? body.key_concepts.filter(isRecord) : [];
  return {
    overview: typeof body.overview === 'string' ? body.overview : '',
    purpose: typeof body.purpose === 'string' ? body.purpose : null,
    inputs_outputs: Array.isArray(body.inputs_outputs)
      ? body.inputs_outputs.filter((value): value is string => typeof value === 'string')
      : [],
    main_components: Array.isArray(body.main_components)
      ? body.main_components.filter((value): value is string => typeof value === 'string')
      : [],
    key_concepts: keyConcepts.map((entry) => ({
      term: typeof entry.term === 'string' ? entry.term : '',
      definition: typeof entry.definition === 'string' ? entry.definition : '',
      references: Array.isArray(entry.references)
        ? entry.references.filter((value): value is string => typeof value === 'string')
        : [],
    })),
    takeaways: Array.isArray(body.takeaways)
      ? body.takeaways.filter((value): value is SummaryTakeaway => isRecord(value))
      : [],
    confidence_notes: Array.isArray(body.confidence_notes)
      ? body.confidence_notes.filter((value): value is string => typeof value === 'string')
      : [],
    metadata: {
      document_id: typeof metadata.document_id === 'string' ? metadata.document_id : '',
      content_type: typeof metadata.content_type === 'string' ? metadata.content_type : '',
      task: typeof metadata.task === 'string' ? metadata.task : '',
      level: typeof metadata.level === 'string' ? metadata.level : '',
      language: typeof metadata.language === 'string' ? metadata.language : '',
      chunks_used: typeof metadata.chunks_used === 'number' ? metadata.chunks_used : 0,
      prompt_version: typeof metadata.prompt_version === 'string' ? metadata.prompt_version : '',
      model: typeof metadata.model === 'string' ? metadata.model : '',
      cached: Boolean(metadata.cached),
    },
  };
}

function parseExplanation(body: unknown): ExplanationResponse | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  return {
    sections: Array.isArray(body.sections)
      ? body.sections.filter((value): value is ExplanationSection => isRecord(value))
      : [],
    recommendations: Array.isArray(body.recommendations)
      ? body.recommendations.filter((value): value is string => typeof value === 'string')
      : [],
    architecture: typeof body.architecture === 'string' ? body.architecture : null,
    walkthrough: Array.isArray(body.walkthrough)
      ? body.walkthrough.filter((value): value is string => typeof value === 'string')
      : [],
    confidence_notes: Array.isArray(body.confidence_notes)
      ? body.confidence_notes.filter((value): value is string => typeof value === 'string')
      : [],
    metadata: {
      document_id: typeof metadata.document_id === 'string' ? metadata.document_id : '',
      content_type: typeof metadata.content_type === 'string' ? metadata.content_type : '',
      task: typeof metadata.task === 'string' ? metadata.task : '',
      level: typeof metadata.level === 'string' ? metadata.level : '',
      language: typeof metadata.language === 'string' ? metadata.language : '',
      chunks_used: typeof metadata.chunks_used === 'number' ? metadata.chunks_used : 0,
      prompt_version: typeof metadata.prompt_version === 'string' ? metadata.prompt_version : '',
      model: typeof metadata.model === 'string' ? metadata.model : '',
      cached: Boolean(metadata.cached),
    },
  };
}

function parseQuestionKind(value: unknown): QuestionKind {
  return value === 'multiple_choice' || value === 'short_answer' ? value : 'short_answer';
}

function parseDifficulty(value: unknown): QuizDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : 'medium';
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

function parseGenerationMetadata(value: unknown): GenerationMetadata {
  const metadata = isRecord(value) ? value : {};
  return {
    document_id: typeof metadata.document_id === 'string' ? metadata.document_id : '',
    content_type: typeof metadata.content_type === 'string' ? metadata.content_type : '',
    task: typeof metadata.task === 'string' ? metadata.task : '',
    level: typeof metadata.level === 'string' ? metadata.level : '',
    language: typeof metadata.language === 'string' ? metadata.language : '',
    chunks_used: typeof metadata.chunks_used === 'number' ? metadata.chunks_used : 0,
    prompt_version: typeof metadata.prompt_version === 'string' ? metadata.prompt_version : '',
    model: typeof metadata.model === 'string' ? metadata.model : '',
    cached: Boolean(metadata.cached),
  };
}

function parseQuizQuestion(question: Record<string, unknown>): QuizQuestionRecord {
  return {
    id: typeof question.id === 'number' ? question.id : Number(question.id ?? 0),
    kind: parseQuestionKind(question.kind),
    topic: typeof question.topic === 'string' ? question.topic : '',
    difficulty: parseDifficulty(question.difficulty),
    question: typeof question.question === 'string' ? question.question : '',
    options: parseStringArray(question.options),
    allow_multiple: Boolean(question.allow_multiple),
    source_reference:
      typeof question.source_reference === 'string' ? question.source_reference : null,
  };
}

function parseQuizSet(body: unknown): QuizSetResponse | undefined {
  if (!isRecord(body) || !Array.isArray(body.questions) || typeof body.quiz_set_id !== 'string') {
    return undefined;
  }
  return {
    quiz_set_id: body.quiz_set_id,
    questions: body.questions.filter(isRecord).map(parseQuizQuestion),
    weak_topics: parseStringArray(body.weak_topics),
    metadata: parseGenerationMetadata(body.metadata),
  };
}

function parseExplainerSectionSummary(entry: Record<string, unknown>): ExplainerSectionSummary {
  return {
    index: typeof entry.index === 'number' ? entry.index : 0,
    title: typeof entry.title === 'string' ? entry.title : '',
    source_reference: typeof entry.source_reference === 'string' ? entry.source_reference : '',
    page_start: typeof entry.page_start === 'number' ? entry.page_start : null,
    page_end: typeof entry.page_end === 'number' ? entry.page_end : null,
    line_start: typeof entry.line_start === 'number' ? entry.line_start : null,
    line_end: typeof entry.line_end === 'number' ? entry.line_end : null,
  };
}

function parseExplainerScript(body: unknown): ExplainerScript | undefined {
  if (!isRecord(body) || typeof body.section_index !== 'number') {
    return undefined;
  }
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  return {
    section_index: body.section_index,
    title: typeof body.title === 'string' ? body.title : '',
    text: typeof body.text === 'string' ? body.text : '',
    captions: parseStringArray(body.captions),
    source_reference: typeof body.source_reference === 'string' ? body.source_reference : null,
    page_start: typeof body.page_start === 'number' ? body.page_start : null,
    page_end: typeof body.page_end === 'number' ? body.page_end : null,
    line_start: typeof body.line_start === 'number' ? body.line_start : null,
    line_end: typeof body.line_end === 'number' ? body.line_end : null,
    quiz: isRecord(body.quiz) ? (parseQuizSet(body.quiz) ?? null) : null,
    metadata: {
      document_id: typeof metadata.document_id === 'string' ? metadata.document_id : '',
      level: typeof metadata.level === 'string' ? metadata.level : '',
      language: typeof metadata.language === 'string' ? metadata.language : '',
      simplified: Boolean(metadata.simplified),
      prompt_version: typeof metadata.prompt_version === 'string' ? metadata.prompt_version : '',
      model: typeof metadata.model === 'string' ? metadata.model : '',
      cached: Boolean(metadata.cached),
    },
  };
}

function parseExplainerPlan(body: unknown): ExplainerPlan | undefined {
  if (!isRecord(body) || !Array.isArray(body.sections)) {
    return undefined;
  }
  const overview = parseExplainerScript(body.overview);
  if (!overview) {
    return undefined;
  }
  return {
    document_id: typeof body.document_id === 'string' ? body.document_id : '',
    sections: body.sections.filter(isRecord).map(parseExplainerSectionSummary),
    overview,
  };
}

function parseQuizAnswerResult(body: unknown): QuizAnswerResult | undefined {
  if (!isRecord(body) || typeof body.question_id !== 'number') {
    return undefined;
  }
  return {
    question_id: body.question_id,
    kind: parseQuestionKind(body.kind),
    topic: typeof body.topic === 'string' ? body.topic : '',
    correct: typeof body.correct === 'boolean' ? body.correct : false,
    score: typeof body.score === 'number' ? body.score : 0,
    provided: typeof body.provided === 'string' ? body.provided : '',
    expected: typeof body.expected === 'string' ? body.expected : '',
    correct_option_indices: parseNumberArray(body.correct_option_indices),
    explanation: typeof body.explanation === 'string' ? body.explanation : null,
    feedback: typeof body.feedback === 'string' ? body.feedback : null,
    missing_key_points: parseStringArray(body.missing_key_points),
    source_reference: typeof body.source_reference === 'string' ? body.source_reference : null,
    peeked: Boolean(body.peeked),
  };
}

function parseQuizResults(body: unknown): QuizResultsResponse | undefined {
  if (!isRecord(body) || !Array.isArray(body.topic_breakdown)) {
    return undefined;
  }
  return {
    quiz_set_id: typeof body.quiz_set_id === 'string' ? body.quiz_set_id : '',
    total_questions: typeof body.total_questions === 'number' ? body.total_questions : 0,
    answered_questions: typeof body.answered_questions === 'number' ? body.answered_questions : 0,
    correct_count: typeof body.correct_count === 'number' ? body.correct_count : 0,
    score: typeof body.score === 'number' ? body.score : 0,
    topic_breakdown: body.topic_breakdown.filter(isRecord).map((entry) => ({
      topic: typeof entry.topic === 'string' ? entry.topic : '',
      correct: typeof entry.correct === 'number' ? entry.correct : 0,
      total: typeof entry.total === 'number' ? entry.total : 0,
      answered: typeof entry.answered === 'number' ? entry.answered : 0,
      average_score: typeof entry.average_score === 'number' ? entry.average_score : 0,
    })),
    weak_topics: parseStringArray(body.weak_topics),
    peeked: Boolean(body.peeked),
  };
}

function parseWeakTopics(body: unknown): WeakTopicEntry[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  return body.filter(isRecord).map((entry) => ({
    topic: typeof entry.topic === 'string' ? entry.topic : '',
    mastery: typeof entry.mastery === 'number' ? entry.mastery : 0,
    attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
  }));
}

function parseMasteryLevel(value: unknown): MasteryLevel {
  return value === 'weak' || value === 'developing' || value === 'strong' ? value : 'developing';
}

function parseMasteryOverview(body: unknown): MasteryOverviewEntry[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  return body.filter(isRecord).map((entry) => ({
    topic: typeof entry.topic === 'string' ? entry.topic : '',
    mastery: typeof entry.mastery === 'number' ? entry.mastery : 0,
    level: parseMasteryLevel(entry.level),
    attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
    correct: typeof entry.correct === 'number' ? entry.correct : 0,
  }));
}

function parseReexplainResponse(body: unknown): ReexplainResponse | undefined {
  if (!isRecord(body) || typeof body.explanation !== 'string') {
    return undefined;
  }
  return {
    topic: typeof body.topic === 'string' ? body.topic : '',
    level: typeof body.level === 'string' ? body.level : '',
    explanation: body.explanation,
    example: typeof body.example === 'string' ? body.example : '',
    trace: typeof body.trace === 'string' ? body.trace : '',
    references: parseStringArray(body.references),
    mastery: typeof body.mastery === 'number' ? body.mastery : 0,
    metadata: parseGenerationMetadata(body.metadata),
  };
}

function parseTutorCitations(value: unknown): TutorCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((entry) => ({
      reference: typeof entry.reference === 'string' ? entry.reference : '',
      snippet: typeof entry.snippet === 'string' ? entry.snippet : null,
    }))
    .filter((entry) => entry.reference);
}

function parseTutorResponse(body: unknown): TutorResponse | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  return {
    answer: typeof body.answer === 'string' ? body.answer : '',
    citations: parseTutorCitations(body.citations),
    follow_up_questions: parseStringArray(body.follow_up_questions),
    conversation_id: typeof body.conversation_id === 'string' ? body.conversation_id : '',
    metadata: parseGenerationMetadata(body.metadata),
  };
}

function parseTutorRole(value: unknown): 'user' | 'assistant' {
  return value === 'user' ? 'user' : 'assistant';
}

function parseTutorHistory(body: unknown): TutorHistoryEntry[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  return body
    .filter(isRecord)
    .map((entry) => ({
      id: typeof entry.id === 'number' ? entry.id : null,
      role: parseTutorRole(entry.role),
      content: typeof entry.content === 'string' ? entry.content : '',
      language: typeof entry.language === 'string' ? entry.language : 'en',
      follow_up_questions: parseStringArray(entry.follow_up_questions),
      citations: Array.isArray(entry.citations)
        ? entry.citations.filter(isRecord).map((item) => ({
            reference: typeof item.reference === 'string' ? item.reference : '',
            snippet: typeof item.snippet === 'string' ? item.snippet : null,
          }))
        : [],
    }))
    .filter((entry) => entry.content || entry.citations.length > 0);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/api/health', parseHealth, { method: 'GET', signal });
}

export function readLanguagePreference(): ApiLanguage {
  const stored = readStorage(STORAGE_KEYS.language);
  return stored === 'sq' ? 'sq' : 'en';
}

/**
 * This browser's anonymous id, created on first use. It only keys the daily quotas (there are no
 * accounts) and carries no personal data.
 */
export function getClientId(): string {
  const stored = readStorage(STORAGE_KEYS.clientId);
  if (stored) {
    return stored;
  }
  const created =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
  writeStorage(STORAGE_KEYS.clientId, created);
  return created;
}

/**
 * The id the quotas are counted under. During a Study Mode session it is the participant's
 * anonymous code, so participants sharing one lab computer each get their own quota.
 */
function quotaClientId(): string {
  const participantCode = readStorage(STORAGE_KEYS.studyParticipantCode);
  return participantCode ? `study-${participantCode}` : getClientId();
}

/** Requests that may use some of today's AI-request or upload quota. */
const QUOTA_USING_PATH =
  /^\/api\/(documents(\/code)?$|documents\/[^/]+\/(summary|explanation|quiz|tutor|topics\/|explainer\/)|quiz\/[^/]+\/answer)/;

async function reportQuotaExceeded(response: Response): Promise<void> {
  const body = await readJson(response);
  if (!isRecord(body) || !isRecord(body.error) || body.error.code !== 'quota_exceeded') {
    return;
  }
  const details = isRecord(body.error.details) ? body.error.details : {};
  const hours = body.hours_remaining ?? details.hours_remaining;
  emitQuotaExceeded({
    hoursRemaining: typeof hours === 'number' ? Math.max(1, hours) : 1,
    quota: typeof details.quota === 'string' ? details.quota : null,
  });
}

/**
 * The single way this module calls the backend: adds the quota headers (client id and time zone,
 * so the backend can count per browser and per local day) and acts as the global interceptor
 * for quota responses -- a `429 quota_exceeded` opens the app-wide quota modal, and any request
 * that may use quota refreshes the usage badge. Callers still get the response and handle errors
 * as before.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const callerHeaders =
    init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers).entries())
      : init.headers;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...callerHeaders,
      'X-Client-Id': quotaClientId(),
      'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  if (response.status === 429) {
    await reportQuotaExceeded(response.clone());
  } else if (QUOTA_USING_PATH.test(path)) {
    emitQuotaUsageChanged();
  }
  return response;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  /** ISO timestamp of the user's next local midnight, when `used` returns to 0. */
  reset_at: string;
}

export interface QuotaOverview {
  ai_requests: QuotaStatus;
  uploads: QuotaStatus;
}

function parseQuotaStatus(body: unknown): QuotaStatus | undefined {
  if (
    !isRecord(body) ||
    typeof body.used !== 'number' ||
    typeof body.limit !== 'number' ||
    typeof body.reset_at !== 'string'
  ) {
    return undefined;
  }
  return { used: body.used, limit: body.limit, reset_at: body.reset_at };
}

function parseQuotaOverview(body: unknown): QuotaOverview | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const aiRequests = parseQuotaStatus(body.ai_requests);
  const uploads = parseQuotaStatus(body.uploads);
  return aiRequests && uploads ? { ai_requests: aiRequests, uploads } : undefined;
}

/** Today's AI-request and upload usage for this browser. */
export function getQuota(): Promise<QuotaOverview> {
  return request('/api/quota', parseQuotaOverview, { method: 'GET' });
}

export async function uploadDocuments(files: FileList | File[]): Promise<UploadResult[]> {
  const formData = new FormData();
  const items = Array.from(files);
  items.forEach((file) => {
    formData.append('files', file, file.name);
  });

  const payload = await request<UploadResult[]>(
    '/api/documents',
    (body) => {
      if (Array.isArray(body)) {
        return body.filter((value): value is UploadResult => isRecord(value));
      }
      if (isRecord(body) && isRecord(body.document)) {
        const parsed = parseUpload(body);
        return parsed ? [parsed] : undefined;
      }
      return undefined;
    },
    {
      method: 'POST',
      body: formData,
    },
  );

  return payload;
}

export interface CodeUploadResult extends UploadResult {
  /** `null` when auto-detect could not identify a language (the frontend then shows a
   * "select manually" notice; the document itself is still created and usable). */
  detected_programming_language: ProgrammingLanguageId | null;
  language_detected_automatically: boolean;
}

function parseCodeUploadResult(body: unknown): CodeUploadResult | undefined {
  const base = parseUpload(body);
  if (!base || !isRecord(body)) {
    return undefined;
  }
  const detected = body.detected_programming_language;
  return {
    ...base,
    detected_programming_language:
      typeof detected === 'string' ? (detected as ProgrammingLanguageId) : null,
    language_detected_automatically: body.language_detected_automatically === true,
  };
}

/** Ingest pasted/typed source code (Phase 11), same response shape as a file upload. */
export function uploadCode(options: {
  code: string;
  language: ProgrammingLanguageId | 'auto';
  filename?: string;
}): Promise<CodeUploadResult> {
  return request('/api/documents/code', parseCodeUploadResult, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: options.code,
      language: options.language,
      filename: options.filename ?? null,
    }),
  });
}

/**
 * Delete a document on the server. A 404 counts as success: the document is already gone (e.g.
 * deleted from another page), and the caller still needs to drop it from its local lists.
 */
export function deleteDocument(documentId: string): Promise<void> {
  return request<null>(`/api/documents/${documentId}`, () => null, { method: 'DELETE' }).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    },
  );
}

function parseDocumentRecord(body: unknown): DocumentRecord | undefined {
  if (!isRecord(body) || typeof body.id !== 'string') {
    return undefined;
  }
  return {
    id: body.id,
    filename: typeof body.filename === 'string' ? body.filename : '',
    content_hash: typeof body.content_hash === 'string' ? body.content_hash : '',
    content_type: body.content_type === 'code' ? 'code' : 'lecture',
    source_format: typeof body.source_format === 'string' ? body.source_format : '',
    detected_language: typeof body.detected_language === 'string' ? body.detected_language : null,
    size_bytes: typeof body.size_bytes === 'number' ? body.size_bytes : 0,
    page_count: typeof body.page_count === 'number' ? body.page_count : null,
  };
}

/** Fetch a document by id (e.g. the material assigned to a study participant). */
export function getDocument(documentId: string): Promise<DocumentRecord> {
  return request(`/api/documents/${documentId}`, parseDocumentRecord, { method: 'GET' });
}

function parseChunkRecord(chunk: Record<string, unknown>): ChunkRecord {
  return {
    text: typeof chunk.text === 'string' ? chunk.text : '',
    heading: typeof chunk.heading === 'string' ? chunk.heading : null,
    page_start: typeof chunk.page_start === 'number' ? chunk.page_start : null,
    page_end: typeof chunk.page_end === 'number' ? chunk.page_end : null,
    line_start: typeof chunk.line_start === 'number' ? chunk.line_start : null,
    line_end: typeof chunk.line_end === 'number' ? chunk.line_end : null,
  };
}

/** Fetch a document's chunks (e.g. to render the study control group's material viewer). */
export function getDocumentChunks(documentId: string): Promise<ChunkRecord[]> {
  return request(
    `/api/documents/${documentId}/chunks`,
    (body) => (Array.isArray(body) ? body.filter(isRecord).map(parseChunkRecord) : undefined),
    { method: 'GET' },
  );
}

export async function generateSummary(options: {
  documentId: string;
  level: StudyLevel;
  language: ApiLanguage;
  stream?: boolean;
  onPartial?: (text: string) => void;
}): Promise<SummaryResponse> {
  const stream = options.stream ?? false;
  const body = JSON.stringify({ level: options.level, language: options.language, stream });
  const response = await apiFetch(`/api/documents/${options.documentId}/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const payload: unknown =
    stream && response.body
      ? await consumeJsonStream(response.body, options.onPartial)
      : await response.json();
  const parsed = parseSummary(payload);
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function generateExplanation(options: {
  documentId: string;
  level: StudyLevel;
  language: ApiLanguage;
  /** Line-by-line or blocks; only meaningful for code documents (the backend ignores it for
   * lectures), so callers omit it there. */
  depth?: ExplanationDepth;
  stream?: boolean;
  onPartial?: (text: string) => void;
}): Promise<ExplanationResponse> {
  const stream = options.stream ?? false;
  const body = JSON.stringify({
    level: options.level,
    language: options.language,
    stream,
    ...(options.depth ? { depth: options.depth } : {}),
  });
  const response = await apiFetch(`/api/documents/${options.documentId}/explanation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const payload: unknown =
    stream && response.body
      ? await consumeJsonStream(response.body, options.onPartial)
      : await response.json();
  const parsed = parseExplanation(payload);
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function generateQuiz(options: {
  documentId: string;
  level: StudyLevel;
  language: ApiLanguage;
  numQuestions?: number;
  types?: QuestionKind[];
  regenerate?: boolean;
  /** Scopes the quiz to one topic's chunks only, for a "retest this topic" quiz. */
  topic?: string;
  /** Bumped on each "New quiz" so it is generated (and cached) separately from earlier ones. */
  variationSeed?: number;
}): Promise<QuizSetResponse> {
  const response = await apiFetch(`/api/documents/${options.documentId}/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      level: options.level,
      language: options.language,
      stream: false,
      num_questions: options.numQuestions,
      question_types: options.types,
      regenerate: options.regenerate ?? false,
      topic: options.topic,
      variation_seed: options.variationSeed ?? 0,
    }),
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseQuizSet(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function answerQuizQuestion(options: {
  questionId: number;
  answer?: string;
  /** 0-based option indices for a multiple_choice answer (one or more); omit for short_answer. */
  selectedOptionIndices?: number[];
  /** Whether the learner had the exam-mode "View source" panel open for this question. */
  peeked?: boolean;
}): Promise<QuizAnswerResult> {
  const response = await apiFetch(`/api/quiz/${String(options.questionId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      answer: options.answer ?? '',
      selected_option_indices: options.selectedOptionIndices ?? [],
      peeked: options.peeked ?? false,
    }),
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseQuizAnswerResult(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function getQuizResults(quizSetId: string): Promise<QuizResultsResponse> {
  const response = await apiFetch(`/api/quiz/${quizSetId}/results`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseQuizResults(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function getWeakTopics(documentId: string): Promise<WeakTopicEntry[]> {
  const response = await apiFetch(`/api/documents/${documentId}/weak-topics`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseWeakTopics(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function getDocumentMastery(documentId: string): Promise<MasteryOverviewEntry[]> {
  const response = await apiFetch(`/api/documents/${documentId}/mastery`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseMasteryOverview(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function reexplainTopic(options: {
  documentId: string;
  topic: string;
  level: StudyLevel;
  language: ApiLanguage;
}): Promise<ReexplainResponse> {
  const response = await apiFetch(
    `/api/documents/${options.documentId}/topics/${encodeURIComponent(options.topic)}/reexplain`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ level: options.level, language: options.language, stream: false }),
    },
  );
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseReexplainResponse(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

/** One parsed ``event: <name>\ndata: <json>`` block from an SSE stream. */
interface SseEvent {
  event: string;
  data: unknown;
}

function parseSseEvent(raw: string): SseEvent | undefined {
  let event = 'message';
  let dataText = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataText += line.slice('data:'.length).trim();
    }
  }
  if (!dataText) {
    return undefined;
  }
  try {
    return { event, data: JSON.parse(dataText) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * Read an SSE response body whose `token` events chunk a single JSON object's text (summary and
 * explanation's `stream_response()`, unlike the chat's, has no separate structured `result`
 * event — the tokens *are* the JSON, split into pieces so it can render progressively before the
 * whole thing has arrived), assembling and parsing it once the stream ends.
 */
async function consumeJsonStream(
  body: ReadableStream<Uint8Array>,
  onPartial: ((text: string) => void) | undefined,
): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assembled = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const parsed = parseSseEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (parsed?.event === 'token') {
        const text =
          isRecord(parsed.data) && typeof parsed.data.text === 'string' ? parsed.data.text : '';
        if (text) {
          assembled += text;
          onPartial?.(assembled);
        }
      } else if (parsed?.event === 'error') {
        throw parseErrorEnvelope(502, parsed.data);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  try {
    return JSON.parse(assembled) as unknown;
  } catch {
    throw new ApiError(0, 'invalid_response');
  }
}

/** Read an SSE response body, calling `onToken` for each `token` event's text. */
async function consumeTutorStream(
  body: ReadableStream<Uint8Array>,
  onToken: ((text: string) => void) | undefined,
): Promise<TutorResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: TutorResponse | undefined;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const parsed = parseSseEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (parsed?.event === 'token') {
        const text =
          isRecord(parsed.data) && typeof parsed.data.text === 'string' ? parsed.data.text : '';
        if (text) {
          onToken?.(text);
        }
      } else if (parsed?.event === 'result') {
        result = parseTutorResponse(parsed.data);
      } else if (parsed?.event === 'error') {
        throw parseErrorEnvelope(502, parsed.data);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (result === undefined) {
    throw new ApiError(0, 'invalid_response');
  }
  return result;
}

export async function askTutorQuestion(options: {
  documentId: string;
  message: string;
  level: StudyLevel;
  language: ApiLanguage;
  stream?: boolean;
  onToken?: (text: string) => void;
  /** Scopes this turn to a specific thread (e.g. the Avatar tab's chat bubble keeps its own,
   * separate from the main Chat tab's); omit to continue the document's main conversation. */
  conversationId?: string;
}): Promise<TutorResponse> {
  const stream = options.stream ?? false;
  const response = await apiFetch(`/api/documents/${options.documentId}/tutor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({
      message: options.message,
      level: options.level,
      conversation_id: options.conversationId,
      language: options.language,
      stream,
    }),
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  if (stream && response.body) {
    return consumeTutorStream(response.body, options.onToken);
  }
  const parsed = parseTutorResponse(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function listTutorHistory(documentId: string): Promise<TutorHistoryEntry[]> {
  const response = await apiFetch(`/api/documents/${documentId}/tutor/history`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseTutorHistory(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

export async function clearTutorHistory(documentId: string): Promise<void> {
  const response = await apiFetch(`/api/documents/${documentId}/tutor/history`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
}

/** Plan Avatar Mode sections for a document and eagerly generate its overview script. */
export async function planExplainer(options: {
  documentId: string;
  level: StudyLevel;
  language: ApiLanguage;
}): Promise<ExplainerPlan> {
  const response = await apiFetch(`/api/documents/${options.documentId}/explainer/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ level: options.level, language: options.language }),
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseExplainerPlan(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

/**
 * Fetch (generating and caching if needed) one Avatar Mode section's script and mini-quiz.
 * `sectionIndex: -1` fetches the overview.
 */
export async function getExplainerSection(options: {
  documentId: string;
  sectionIndex: number;
  level: StudyLevel;
  language: ApiLanguage;
  simplified?: boolean;
  signal?: AbortSignal;
}): Promise<ExplainerScript> {
  const params = new URLSearchParams({
    level: options.level,
    language: options.language,
    simplified: String(options.simplified ?? false),
  });
  const response = await apiFetch(
    `/api/documents/${options.documentId}/explainer/sections/${String(options.sectionIndex)}?${params.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' }, signal: options.signal },
  );
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  const parsed = parseExplainerScript(await response.json());
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

/**
 * Synthesize speech for `text` with the server's Meta MMS-TTS voice (`FEATURE_SERVER_TTS`,
 * on by default). Rejects with `ApiError('tts_disabled' | 'tts_not_installed' | 'tts_failed')`
 * if synthesis isn't possible, or after `timeoutMs` with an `AbortError` — either way, the
 * caller (`src/lib/tts.ts`) falls back to the browser's own voice.
 */
export async function synthesizeSpeech(options: {
  text: string;
  language: ApiLanguage;
  timeoutMs?: number;
}): Promise<Blob> {
  const response = await apiFetch(`/api/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify({ text: options.text, language: options.language }),
    signal: options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!response.ok) {
    const text = await readJson(response);
    throw parseErrorEnvelope(response.status, text);
  }
  return response.blob();
}

export interface TtsHealth {
  available: boolean;
  modelsLoaded: { sq: boolean; en: boolean };
}

/** Whether server TTS is worth attempting, and which language models are already warm. */
export async function getTtsHealth(timeoutMs = 5000): Promise<TtsHealth> {
  const response = await apiFetch(`/api/tts/health`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
  const body = (await response.json()) as {
    available?: unknown;
    models_loaded?: { sq?: unknown; en?: unknown };
  };
  return {
    available: body.available === true,
    modelsLoaded: {
      sq: body.models_loaded?.sq === true,
      en: body.models_loaded?.en === true,
    },
  };
}

// --- User profile: cross-document history and full data wipe -------------------------------

export interface UserDocumentSummary {
  id: string;
  filename: string;
  content_type: DocumentKind;
  source_format: string;
  size_bytes: number;
  page_count: number | null;
  created_at: string;
}

export interface UserQuizHistoryEntry {
  quiz_set_id: string;
  document_id: string;
  document_name: string;
  level: string;
  language: ApiLanguage;
  created_at: string;
  total_questions: number;
  answered_questions: number;
  correct_count: number;
  score: number;
}

function parseUserDocuments(body: unknown): UserDocumentSummary[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  return body.filter(isRecord).map((entry) => ({
    id: typeof entry.id === 'string' ? entry.id : '',
    filename: typeof entry.filename === 'string' ? entry.filename : '',
    content_type: entry.content_type === 'code' ? 'code' : 'lecture',
    source_format: typeof entry.source_format === 'string' ? entry.source_format : '',
    size_bytes: typeof entry.size_bytes === 'number' ? entry.size_bytes : 0,
    page_count: typeof entry.page_count === 'number' ? entry.page_count : null,
    created_at: typeof entry.created_at === 'string' ? entry.created_at : '',
  }));
}

function parseUserQuizHistory(body: unknown): UserQuizHistoryEntry[] | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  return body.filter(isRecord).map((entry) => ({
    quiz_set_id: typeof entry.quiz_set_id === 'string' ? entry.quiz_set_id : '',
    document_id: typeof entry.document_id === 'string' ? entry.document_id : '',
    document_name: typeof entry.document_name === 'string' ? entry.document_name : '',
    level: typeof entry.level === 'string' ? entry.level : '',
    language: entry.language === 'sq' ? 'sq' : 'en',
    created_at: typeof entry.created_at === 'string' ? entry.created_at : '',
    total_questions: typeof entry.total_questions === 'number' ? entry.total_questions : 0,
    answered_questions: typeof entry.answered_questions === 'number' ? entry.answered_questions : 0,
    correct_count: typeof entry.correct_count === 'number' ? entry.correct_count : 0,
    score: typeof entry.score === 'number' ? entry.score : 0,
  }));
}

/** Every uploaded document, for the profile page's history. */
export function getUserDocuments(): Promise<UserDocumentSummary[]> {
  return request('/api/user/documents', parseUserDocuments, { method: 'GET' });
}

/** Every attempted quiz, for the profile page's history. */
export function getUserQuizHistory(): Promise<UserQuizHistoryEntry[]> {
  return request('/api/user/quiz-history', parseUserQuizHistory, { method: 'GET' });
}

/** Permanently delete every document, quiz, and other generated data for this local user. */
export function deleteAllUserData(): Promise<void> {
  return request<null>('/api/user/all-data', () => null, { method: 'DELETE' }).then(
    () => undefined,
  );
}

// --- Study Mode: participant flow -----------------------------------------------------------

export type StudyGroupName = 'experimental' | 'control';

export interface StudyParticipant {
  code: string;
  group: StudyGroupName;
  language: ApiLanguage;
  document_id: string | null;
  material_name: string | null;
  withdrawn: boolean;
  immediate_submitted: boolean;
  questionnaire_submitted: boolean;
  retention_submitted: boolean;
  retention_unlock_at: string | null;
}

export interface StudyTimerStatus {
  started: boolean;
  duration_seconds: number | null;
  remaining_seconds: number | null;
  expired: boolean;
}

export type StudyItemKind = 'multiple_choice' | 'short_answer';

export interface StudyTestItem {
  id: number;
  kind: StudyItemKind;
  topic: string;
  question: string;
  options: string[];
  max_score: number;
}

export interface StudyTestPublic {
  test_id: string;
  items: StudyTestItem[];
}

export interface StudySubmitResult {
  phase: 'immediate' | 'retention';
  total_score: number;
  max_possible_score: number;
}

export interface StudyRetentionStatus {
  unlocked: boolean;
  unlock_at: string;
  already_submitted: boolean;
  test: StudyTestPublic | null;
}

function parseStudyParticipant(body: unknown): StudyParticipant | undefined {
  if (!isRecord(body) || typeof body.code !== 'string') {
    return undefined;
  }
  return {
    code: body.code,
    group: body.group === 'control' ? 'control' : 'experimental',
    language: body.language === 'sq' ? 'sq' : 'en',
    document_id: typeof body.document_id === 'string' ? body.document_id : null,
    material_name: typeof body.material_name === 'string' ? body.material_name : null,
    withdrawn: Boolean(body.withdrawn),
    immediate_submitted: Boolean(body.immediate_submitted),
    questionnaire_submitted: Boolean(body.questionnaire_submitted),
    retention_submitted: Boolean(body.retention_submitted),
    retention_unlock_at:
      typeof body.retention_unlock_at === 'string' ? body.retention_unlock_at : null,
  };
}

function parseStudyTimerStatus(body: unknown): StudyTimerStatus | undefined {
  if (!isRecord(body) || typeof body.started !== 'boolean') {
    return undefined;
  }
  return {
    started: body.started,
    duration_seconds: typeof body.duration_seconds === 'number' ? body.duration_seconds : null,
    remaining_seconds: typeof body.remaining_seconds === 'number' ? body.remaining_seconds : null,
    expired: Boolean(body.expired),
  };
}

function parseStudyItemKind(value: unknown): StudyItemKind {
  return value === 'short_answer' ? 'short_answer' : 'multiple_choice';
}

function parseStudyTestPublic(body: unknown): StudyTestPublic | undefined {
  if (!isRecord(body) || typeof body.test_id !== 'string' || !Array.isArray(body.items)) {
    return undefined;
  }
  return {
    test_id: body.test_id,
    items: body.items.filter(isRecord).map((item) => ({
      id: typeof item.id === 'number' ? item.id : 0,
      kind: parseStudyItemKind(item.kind),
      topic: typeof item.topic === 'string' ? item.topic : '',
      question: typeof item.question === 'string' ? item.question : '',
      options: parseStringArray(item.options),
      max_score: typeof item.max_score === 'number' ? item.max_score : 1,
    })),
  };
}

function parseStudySubmitResult(body: unknown): StudySubmitResult | undefined {
  if (!isRecord(body) || typeof body.total_score !== 'number') {
    return undefined;
  }
  return {
    phase: body.phase === 'retention' ? 'retention' : 'immediate',
    total_score: body.total_score,
    max_possible_score: typeof body.max_possible_score === 'number' ? body.max_possible_score : 0,
  };
}

function parseStudyRetentionStatus(body: unknown): StudyRetentionStatus | undefined {
  if (!isRecord(body) || typeof body.unlocked !== 'boolean') {
    return undefined;
  }
  return {
    unlocked: body.unlocked,
    unlock_at: typeof body.unlock_at === 'string' ? body.unlock_at : '',
    already_submitted: Boolean(body.already_submitted),
    test: isRecord(body.test) ? (parseStudyTestPublic(body.test) ?? null) : null,
  };
}

/** Record consent and create a new participant: language + consent -> code and group. */
export async function createStudyParticipant(options: {
  language: ApiLanguage;
  consent: boolean;
}): Promise<StudyParticipant> {
  return request(
    '/api/study/participants',
    parseStudyParticipant,
    withJsonBody('POST', { language: options.language, consent: options.consent }),
  );
}

/** The participant's current state, to resume the flow after a page refresh. */
export async function getStudyParticipant(code: string): Promise<StudyParticipant> {
  return request(`/api/study/participants/${encodeURIComponent(code)}`, parseStudyParticipant, {
    method: 'GET',
  });
}

/** Start the study session timer (idempotent). */
export async function startStudyTimer(code: string): Promise<StudyTimerStatus> {
  return request(
    `/api/study/participants/${encodeURIComponent(code)}/timer/start`,
    parseStudyTimerStatus,
    { method: 'POST' },
  );
}

/** The study session timer's current status. */
export async function getStudyTimer(code: string): Promise<StudyTimerStatus> {
  return request(
    `/api/study/participants/${encodeURIComponent(code)}/timer`,
    parseStudyTimerStatus,
    { method: 'GET' },
  );
}

/** The immediate test's items (no answer key), in the participant's study language. */
export async function getStudyImmediateTest(code: string): Promise<StudyTestPublic> {
  return request(`/api/study/participants/${encodeURIComponent(code)}/test`, parseStudyTestPublic, {
    method: 'GET',
  });
}

/** Submit the immediate test (once per participant). */
export async function submitStudyImmediateTest(
  code: string,
  answers: { item_id: number; answer: string }[],
): Promise<StudySubmitResult> {
  return request(
    `/api/study/participants/${encodeURIComponent(code)}/test/immediate`,
    parseStudySubmitResult,
    withJsonBody('POST', { answers }),
  );
}

/** Submit the experimental group's post-session questionnaire (once per participant). */
export async function submitStudyQuestionnaire(
  code: string,
  payload: { perceived_usefulness: number; ease_of_understanding: number; open_comment?: string },
): Promise<void> {
  const response = await apiFetch(
    `/api/study/participants/${encodeURIComponent(code)}/questionnaire`,
    { ...withJsonBody('POST', payload) },
  );
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
}

/** Whether the retention test has unlocked yet, and its items once it has. */
export async function getStudyRetentionStatus(code: string): Promise<StudyRetentionStatus> {
  return request(
    `/api/study/participants/${encodeURIComponent(code)}/retention`,
    parseStudyRetentionStatus,
    { method: 'GET' },
  );
}

/** Submit the retention test (once per participant, once unlocked). */
export async function submitStudyRetentionTest(
  code: string,
  answers: { item_id: number; answer: string }[],
): Promise<StudySubmitResult> {
  return request(
    `/api/study/participants/${encodeURIComponent(code)}/test/retention`,
    parseStudySubmitResult,
    withJsonBody('POST', { answers }),
  );
}

/** Log one feature-usage event (tab view, quiz attempt); silently ignored on failure. */
export async function logStudyUsageEvent(
  code: string,
  eventType: 'tab_view' | 'quiz_attempt',
  detail?: string,
): Promise<void> {
  try {
    await apiFetch(
      `/api/study/participants/${encodeURIComponent(code)}/usage-events`,
      withJsonBody('POST', { event_type: eventType, detail }),
    );
  } catch {
    // Usage logging must never interrupt the participant's session.
  }
}

/** Withdraw and delete all of the participant's substantive data. */
export async function withdrawStudyParticipant(code: string): Promise<void> {
  const response = await apiFetch(`/api/study/participants/${encodeURIComponent(code)}/withdraw`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
}

// --- Admin ------------------------------------------------------------------------------------

function withJsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  };
}

export interface AdminSessionStatus {
  signed_in: boolean;
}

function parseAdminSessionStatus(body: unknown): AdminSessionStatus | undefined {
  if (!isRecord(body) || typeof body.signed_in !== 'boolean') {
    return undefined;
  }
  return { signed_in: body.signed_in };
}

export async function adminLogin(password: string): Promise<AdminSessionStatus> {
  return request('/api/admin/login', parseAdminSessionStatus, withJsonBody('POST', { password }));
}

export async function adminLogout(): Promise<void> {
  await apiFetch(`/api/admin/logout`, { method: 'POST', credentials: 'include' });
}

export async function adminMe(): Promise<AdminSessionStatus> {
  return request('/api/admin/me', parseAdminSessionStatus, {
    method: 'GET',
    credentials: 'include',
  });
}

export interface AdminGroupOverview {
  group: string;
  total: number;
  withdrawn: number;
  immediate_completed: number;
  questionnaire_completed: number;
  retention_completed: number;
}

export interface AdminOverview {
  total_participants: number;
  groups: AdminGroupOverview[];
  active_material: string | null;
  active_test: string | null;
}

function parseAdminOverview(body: unknown): AdminOverview | undefined {
  if (!isRecord(body) || !Array.isArray(body.groups)) {
    return undefined;
  }
  return {
    total_participants: typeof body.total_participants === 'number' ? body.total_participants : 0,
    groups: body.groups.filter(isRecord).map((group) => ({
      group: typeof group.group === 'string' ? group.group : '',
      total: typeof group.total === 'number' ? group.total : 0,
      withdrawn: typeof group.withdrawn === 'number' ? group.withdrawn : 0,
      immediate_completed:
        typeof group.immediate_completed === 'number' ? group.immediate_completed : 0,
      questionnaire_completed:
        typeof group.questionnaire_completed === 'number' ? group.questionnaire_completed : 0,
      retention_completed:
        typeof group.retention_completed === 'number' ? group.retention_completed : 0,
    })),
    active_material: typeof body.active_material === 'string' ? body.active_material : null,
    active_test: typeof body.active_test === 'string' ? body.active_test : null,
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  return request('/api/admin/overview', parseAdminOverview, {
    method: 'GET',
    credentials: 'include',
  });
}

export interface AdminMaterial {
  id: string;
  name: string;
  document_id: string;
  filename: string;
  is_active: boolean;
}

function parseAdminMaterial(body: unknown): AdminMaterial | undefined {
  if (!isRecord(body) || typeof body.id !== 'string') {
    return undefined;
  }
  return {
    id: body.id,
    name: typeof body.name === 'string' ? body.name : '',
    document_id: typeof body.document_id === 'string' ? body.document_id : '',
    filename: typeof body.filename === 'string' ? body.filename : '',
    is_active: Boolean(body.is_active),
  };
}

export async function listAdminMaterials(): Promise<AdminMaterial[]> {
  return request(
    '/api/admin/materials',
    (body) =>
      Array.isArray(body)
        ? body
            .filter(isRecord)
            .map((item) => parseAdminMaterial(item))
            .filter((item): item is AdminMaterial => item !== undefined)
        : undefined,
    { method: 'GET', credentials: 'include' },
  );
}

export async function uploadAdminMaterial(name: string, files: File[]): Promise<AdminMaterial> {
  const formData = new FormData();
  formData.append('name', name);
  files.forEach((file) => {
    formData.append('files', file, file.name);
  });
  return request('/api/admin/materials', parseAdminMaterial, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
}

export async function activateAdminMaterial(id: string): Promise<AdminMaterial> {
  return request(`/api/admin/materials/${encodeURIComponent(id)}/activate`, parseAdminMaterial, {
    method: 'POST',
    credentials: 'include',
  });
}

export interface AdminTestItemImport {
  kind: StudyItemKind;
  topic?: string;
  question: Record<string, string>;
  options?: Record<string, string[]>;
  correct_answer: Record<string, string>;
  rubric_keywords?: Record<string, string[]>;
  max_score?: number;
}

export interface AdminTest {
  id: string;
  name: string;
  item_count: number;
  is_active: boolean;
}

function parseAdminTest(body: unknown): AdminTest | undefined {
  if (!isRecord(body) || typeof body.id !== 'string') {
    return undefined;
  }
  return {
    id: body.id,
    name: typeof body.name === 'string' ? body.name : '',
    item_count: typeof body.item_count === 'number' ? body.item_count : 0,
    is_active: Boolean(body.is_active),
  };
}

export async function listAdminTests(): Promise<AdminTest[]> {
  return request(
    '/api/admin/tests',
    (body) =>
      Array.isArray(body)
        ? body
            .filter(isRecord)
            .map((item) => parseAdminTest(item))
            .filter((item): item is AdminTest => item !== undefined)
        : undefined,
    { method: 'GET', credentials: 'include' },
  );
}

export async function importAdminTest(payload: {
  name: string;
  items: AdminTestItemImport[];
}): Promise<AdminTest> {
  return request('/api/admin/tests', parseAdminTest, withJsonBody('POST', payload));
}

export async function activateAdminTest(id: string): Promise<AdminTest> {
  return request(`/api/admin/tests/${encodeURIComponent(id)}/activate`, parseAdminTest, {
    method: 'POST',
    credentials: 'include',
  });
}

export interface AdminParticipantResult {
  code: string;
  group: string;
  language: string;
  immediate_score: number | null;
  immediate_max_score: number | null;
  retention_score: number | null;
  retention_max_score: number | null;
}

function parseAdminParticipantResult(body: unknown): AdminParticipantResult | undefined {
  if (!isRecord(body) || typeof body.code !== 'string') {
    return undefined;
  }
  return {
    code: body.code,
    group: typeof body.group === 'string' ? body.group : '',
    language: typeof body.language === 'string' ? body.language : '',
    immediate_score: typeof body.immediate_score === 'number' ? body.immediate_score : null,
    immediate_max_score:
      typeof body.immediate_max_score === 'number' ? body.immediate_max_score : null,
    retention_score: typeof body.retention_score === 'number' ? body.retention_score : null,
    retention_max_score:
      typeof body.retention_max_score === 'number' ? body.retention_max_score : null,
  };
}

export async function getAdminResults(): Promise<AdminParticipantResult[]> {
  return request(
    '/api/admin/results',
    (body) =>
      Array.isArray(body)
        ? body
            .filter(isRecord)
            .map((item) => parseAdminParticipantResult(item))
            .filter((item): item is AdminParticipantResult => item !== undefined)
        : undefined,
    { method: 'GET', credentials: 'include' },
  );
}

export interface DescriptiveStats {
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
}

export interface NormalityResult {
  n: number;
  statistic: number | null;
  p_value: number | null;
  is_normal: boolean | null;
}

export interface LeveneResult {
  statistic: number | null;
  p_value: number | null;
  equal_variances: boolean | null;
}

export interface TTestResult {
  variant: 'student' | 'welch';
  statistic: number | null;
  p_value: number | null;
  degrees_of_freedom: number | null;
}

export interface MannWhitneyResult {
  statistic: number | null;
  p_value: number | null;
}

export interface CohensD {
  value: number;
  ci_low: number;
  ci_high: number;
}

export type RecommendedTest = 'student_t' | 'welch_t' | 'mann_whitney' | 'insufficient_data';

export interface GroupComparison {
  outcome: string;
  descriptive_experimental: DescriptiveStats;
  descriptive_control: DescriptiveStats;
  normality_experimental: NormalityResult;
  normality_control: NormalityResult;
  levene: LeveneResult;
  student_t: TTestResult | null;
  welch_t: TTestResult | null;
  mann_whitney: MannWhitneyResult | null;
  cohens_d: CohensD | null;
  recommended_test: RecommendedTest;
}

export interface StudyStatisticsReport {
  participant_count: number;
  group_counts: Record<string, number>;
  language_counts: Record<string, number>;
  immediate_score: GroupComparison;
  retention_score: GroupComparison;
  retention_change: GroupComparison;
  by_language: Record<string, Record<string, GroupComparison>>;
}

export async function getAdminStatistics(): Promise<StudyStatisticsReport> {
  const response = await apiFetch(`/api/admin/statistics`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
  return (await response.json()) as StudyStatisticsReport;
}

async function downloadAdminExport(path: string, filename: string): Promise<void> {
  const response = await apiFetch(path, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadAdminCsvExport(): Promise<void> {
  return downloadAdminExport('/api/admin/export.csv', 'study_export.csv');
}

export function downloadAdminJsonExport(): Promise<void> {
  return downloadAdminExport('/api/admin/export.json', 'study_export.json');
}

export async function deleteAllStudyData(): Promise<{ deleted_participants: number }> {
  const response = await apiFetch(`/api/admin/delete-all-data`, {
    ...withJsonBody('POST', { confirm: 'DELETE' }),
  });
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, await readJson(response));
  }
  return (await response.json()) as { deleted_participants: number };
}
