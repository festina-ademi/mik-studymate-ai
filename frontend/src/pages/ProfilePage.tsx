import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FileText, ListChecks, Percent, Trash2 } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { DeleteProfileDialog } from '../components/profile/DeleteProfileDialog';
import { Skeleton } from '../components/Skeleton';
import {
  deleteDocument,
  getDocument,
  getDocumentChunks,
  getUserDocuments,
  getUserQuizHistory,
  type UserDocumentSummary,
  type UserQuizHistoryEntry,
} from '../lib/api';
import { forgetRecentDocument, saveUploadedDocument } from '../lib/documentStorage';
import { describeError } from '../lib/errors';
import { getInitials, readUserProfile } from '../lib/profile';
import { formatRelativeTime } from '../lib/relativeTime';

function scoreColorClass(score: number): string {
  if (score >= 0.75) return 'text-success';
  if (score >= 0.5) return 'text-warning';
  return 'text-error';
}

interface StatCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="inline-flex shrink-0 rounded-xl bg-primary-soft p-2.5 text-primary-soft-fg">
        <Icon className="size-5" />
      </span>
      <span>
        <span className="block text-xs uppercase tracking-[0.08em] text-fg-muted">{label}</span>
        <span className="block text-lg font-semibold text-fg">{value}</span>
      </span>
    </Card>
  );
}

/** Full profile history: identity, stats, documents and quizzes, and the danger zone. */
export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = readUserProfile();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (profile === null) {
      void navigate('/welcome', { replace: true });
    }
  }, [profile, navigate]);

  const documentsQuery = useQuery({
    queryKey: ['userDocuments'],
    queryFn: getUserDocuments,
    enabled: profile !== null,
  });
  const quizHistoryQuery = useQuery({
    queryKey: ['userQuizHistory'],
    queryFn: getUserQuizHistory,
    enabled: profile !== null,
  });

  if (profile === null) {
    return null;
  }

  const documents = documentsQuery.data ?? [];
  const quizHistory = quizHistoryQuery.data ?? [];

  const averageScore =
    quizHistory.length === 0
      ? null
      : quizHistory.reduce((sum, entry) => sum + entry.score, 0) / quizHistory.length;
  const lastActivity = [
    ...documents.map((d) => d.created_at),
    ...quizHistory.map((q) => q.created_at),
  ]
    .sort()
    .at(-1);

  const openDocumentInWorkspace = (documentId: string): void => {
    setOpeningDocumentId(documentId);
    setOpenError(null);
    void Promise.all([getDocument(documentId), getDocumentChunks(documentId)])
      .then(([document, chunks]) => {
        saveUploadedDocument(document, chunks);
        void navigate('/workspace');
      })
      .catch((caught: unknown) => {
        setOpenError(describeError(t, caught));
        setOpeningDocumentId(null);
      });
  };

  const removeDocument = (documentId: string): void => {
    void deleteDocument(documentId)
      .then(() => {
        forgetRecentDocument(documentId);
        void queryClient.invalidateQueries({ queryKey: ['userDocuments'] });
        void queryClient.invalidateQueries({ queryKey: ['userQuizHistory'] });
      })
      .catch((caught: unknown) => {
        setOpenError(describeError(t, caught));
      });
  };

  const secondaryLine =
    profile.role === 'student'
      ? [profile.university, profile.degree ? t(`welcome.degree_${profile.degree}`) : null]
          .filter(Boolean)
          .join(' · ')
      : (profile.fieldOfWork ?? '');

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      <h1 className="sr-only">{t('profile.title')}</h1>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="inline-flex size-20 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-contrast shadow-soft">
              {getInitials(profile.firstName, profile.lastName)}
            </span>
            <div>
              <p className="text-xl font-semibold text-fg">
                {profile.firstName} {profile.lastName}
              </p>
              <p className="text-sm text-fg-muted">{profile.birthYear}</p>
              {secondaryLine ? <p className="mt-1 text-sm text-fg-muted">{secondaryLine}</p> : null}
              {profile.role === 'student' && profile.yearOfStudy ? (
                <p className="text-sm text-fg-muted">{t(`welcome.year_${profile.yearOfStudy}`)}</p>
              ) : null}
              <p className="mt-1 text-sm text-fg-muted">
                {t(`language.${profile.language}.label`)} · {t(`level.${profile.level}`)}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigate('/');
            }}
          >
            {t('profileMenu.endSession')}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={FileText}
          label={t('profile.statsDocuments')}
          value={String(documents.length)}
        />
        <StatCard
          icon={ListChecks}
          label={t('profile.statsQuizzes')}
          value={String(quizHistory.length)}
        />
        <StatCard
          icon={Percent}
          label={t('profile.statsAverageScore')}
          value={averageScore === null ? '—' : `${String(Math.round(averageScore * 100))}%`}
        />
        <StatCard
          icon={Clock}
          label={t('profile.statsLastActivity')}
          value={
            lastActivity
              ? formatRelativeTime(lastActivity, profile.language)
              : t('profile.noActivityYet')
          }
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-fg">{t('profile.documentsTitle')}</h2>
        {openError ? <p className="text-sm text-error">{openError}</p> : null}
        {documentsQuery.isLoading ? (
          <Card className="p-4">
            <Skeleton lines={3} />
          </Card>
        ) : documentsQuery.isError ? (
          <ErrorState
            title={t('profile.errorTitle')}
            description={t('profile.errorDocuments')}
            onRetry={() => {
              void documentsQuery.refetch();
            }}
          />
        ) : documents.length === 0 ? (
          <EmptyState
            title={t('profile.documentsEmptyTitle')}
            description={t('profile.documentsEmptyDescription')}
            actionLabel={t('profile.documentsEmptyCta')}
            onAction={() => {
              void navigate('/workspace');
            }}
          />
        ) : (
          <Card className="divide-y divide-border p-0">
            {documents.map((document: UserDocumentSummary) => (
              <div key={document.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{document.filename}</p>
                  <p className="text-sm text-fg-muted">
                    {t(`profile.contentType_${document.content_type}`)} ·{' '}
                    {new Date(document.created_at).toLocaleDateString(profile.language)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={openingDocumentId === document.id}
                    onClick={() => {
                      openDocumentInWorkspace(document.id);
                    }}
                  >
                    {t('profile.openDocument')}
                  </Button>
                  <button
                    type="button"
                    aria-label={t('profile.deleteDocument')}
                    onClick={() => {
                      removeDocument(document.id);
                    }}
                    className="rounded-xl p-2 text-fg-muted transition hover:bg-error/10 hover:text-error"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-fg">{t('profile.quizzesTitle')}</h2>
        {quizHistoryQuery.isLoading ? (
          <Card className="p-4">
            <Skeleton lines={3} />
          </Card>
        ) : quizHistoryQuery.isError ? (
          <ErrorState
            title={t('profile.errorTitle')}
            description={t('profile.errorQuizzes')}
            onRetry={() => {
              void quizHistoryQuery.refetch();
            }}
          />
        ) : quizHistory.length === 0 ? (
          <Card className="p-4 text-sm text-fg-muted">{t('profile.quizzesEmpty')}</Card>
        ) : (
          <Card className="divide-y divide-border p-0">
            {quizHistory.map((entry: UserQuizHistoryEntry) => (
              <div key={entry.quiz_set_id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{entry.document_name}</p>
                  <p className="text-sm text-fg-muted">
                    {new Date(entry.created_at).toLocaleDateString(profile.language)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`font-semibold ${scoreColorClass(entry.score)}`}>
                    {Math.round(entry.score * 100)}%
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      openDocumentInWorkspace(entry.document_id);
                    }}
                  >
                    {t('profile.viewDetails')}
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Card className="border-error/30 bg-error/5 p-6">
        <h2 className="text-lg font-semibold text-error">{t('profile.dangerZoneTitle')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t('profile.dangerZoneDescription')}</p>
        <Button
          className="mt-4 bg-error text-primary-contrast hover:bg-error/90"
          onClick={() => {
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="size-4" />
          {t('profileMenu.deleteProfile')}
        </Button>
      </Card>

      <DeleteProfileDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}
