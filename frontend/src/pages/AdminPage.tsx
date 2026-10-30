import {
  CheckCircle2,
  Database,
  FileText,
  LogOut,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminResultsCharts } from '../components/admin/AdminResultsCharts';
import { AdminStatisticsPanel } from '../components/admin/AdminStatisticsPanel';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { Toast } from '../components/Toast';
import {
  activateAdminMaterial,
  activateAdminTest,
  adminLogin,
  adminLogout,
  adminMe,
  deleteAllStudyData,
  downloadAdminCsvExport,
  downloadAdminJsonExport,
  getAdminOverview,
  importAdminTest,
  listAdminMaterials,
  listAdminTests,
  uploadAdminMaterial,
  type AdminMaterial,
  type AdminOverview,
  type AdminTest,
  type AdminTestItemImport,
} from '../lib/api';
import { describeError } from '../lib/errors';

const SAMPLE_TEST_JSON = `{
  "name": "Sample knowledge test",
  "items": [
    {
      "kind": "multiple_choice",
      "topic": "Sorting",
      "question": { "en": "Which operation orders values?", "sq": "Cili operacion rendit?" },
      "options": {
        "en": ["Sort", "Copy", "Delete", "Move"],
        "sq": ["Rendit", "Kopjo", "Fshi", "Zhvendos"]
      },
      "correct_answer": { "en": "Sort", "sq": "Rendit" },
      "max_score": 1.0
    },
    {
      "kind": "short_answer",
      "topic": "Searching",
      "question": {
        "en": "Explain why binary search needs sorted data.",
        "sq": "Shpjego pse kerkimi binar ka nevoje per te dhena te renditura."
      },
      "correct_answer": {
        "en": "It halves the search range each step.",
        "sq": "Pergjysmon intervalin e kerkimit ne cdo hap."
      },
      "rubric_keywords": { "en": ["sorted", "half"], "sq": ["renditura", "pergjysmon"] },
      "max_score": 2.0
    }
  ]
}`;

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = (): void => {
    setIsSubmitting(true);
    setError(null);
    void adminLogin(password)
      .then(() => {
        onSuccess();
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <Card className="mx-auto max-w-sm space-y-5 p-8">
      <div className="flex items-center gap-2 text-fg">
        <ShieldCheck className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">{t('admin.loginTitle')}</h1>
      </div>
      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      <label className="block space-y-2">
        <span className="text-sm font-medium text-fg-muted">{t('admin.loginPassword')}</span>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-sm text-fg outline-none transition focus:border-primary"
        />
      </label>
      <Button variant="primary" onClick={submit} disabled={isSubmitting || !password}>
        {t('admin.loginSubmit')}
      </Button>
    </Card>
  );
}

function OverviewCards({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation();
  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-fg">{t('admin.overviewTitle')}</h2>
        <Badge>{t('admin.overviewTotal', { count: overview.total_participants })}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {overview.groups.map((group) => (
          <div key={group.group} className="rounded-2xl border border-border bg-surface-muted p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">
              {t(`admin.group_${group.group}`)}
            </p>
            <p className="mt-1 text-2xl font-semibold text-fg">{group.total}</p>
            <dl className="mt-3 space-y-1 text-xs text-fg-muted">
              <div className="flex justify-between">
                <dt>{t('admin.overviewImmediate')}</dt>
                <dd>{group.immediate_completed}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.overviewRetention')}</dt>
                <dd>{group.retention_completed}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.overviewWithdrawn')}</dt>
                <dd>{group.withdrawn}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        {t('admin.overviewActiveMaterial')}:{' '}
        <span className="font-medium text-fg">
          {overview.active_material ?? t('admin.overviewNone')}
        </span>
        {' · '}
        {t('admin.overviewActiveTest')}:{' '}
        <span className="font-medium text-fg">
          {overview.active_test ?? t('admin.overviewNone')}
        </span>
      </p>
    </Card>
  );
}

function MaterialsPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [materials, setMaterials] = useState<AdminMaterial[]>([]);
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = (): void => {
    void listAdminMaterials()
      .then(setMaterials)
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount only
  useEffect(refresh, []);

  const upload = (): void => {
    if (!name.trim() || files.length === 0) return;
    setIsBusy(true);
    setError(null);
    void uploadAdminMaterial(name.trim(), files)
      .then(() => {
        setName('');
        setFiles([]);
        refresh();
        onChanged();
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const activate = (id: string): void => {
    void activateAdminMaterial(id)
      .then(() => {
        refresh();
        onChanged();
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold text-fg">{t('admin.materialsTitle')}</h2>
      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      <div className="space-y-2 rounded-2xl border border-dashed border-border p-4">
        <input
          type="text"
          value={name}
          placeholder={t('admin.materialsNamePlaceholder')}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-fg outline-none focus:border-primary"
        />
        <input
          type="file"
          multiple
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
          }}
          className="w-full text-sm text-fg-muted"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={upload}
          disabled={isBusy || !name.trim() || files.length === 0}
        >
          <Upload className="size-4" />
          {t('admin.materialsImport')}
        </Button>
      </div>
      <ul className="space-y-2">
        {materials.map((material) => (
          <li
            key={material.id}
            className={`flex items-center justify-between rounded-xl border p-3 text-sm ${
              material.is_active
                ? 'border-primary bg-primary-soft'
                : 'border-border bg-surface-muted'
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{material.name}</p>
              <p className="truncate text-xs text-fg-muted">{material.filename}</p>
            </div>
            {material.is_active ? (
              <Badge>{t('admin.active')}</Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  activate(material.id);
                }}
              >
                {t('admin.activate')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TestsPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [tests, setTests] = useState<AdminTest[]>([]);
  const [json, setJson] = useState(SAMPLE_TEST_JSON);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = (): void => {
    void listAdminTests()
      .then(setTests)
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount only
  useEffect(refresh, []);

  const importTest = (): void => {
    setError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      setError(t('admin.testsInvalidJson'));
      return;
    }
    if (typeof payload !== 'object' || payload === null) {
      setError(t('admin.testsInvalidJson'));
      return;
    }
    setIsBusy(true);
    void importAdminTest(payload as { name: string; items: AdminTestItemImport[] })
      .then(() => {
        refresh();
        onChanged();
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const activate = (id: string): void => {
    void activateAdminTest(id)
      .then(() => {
        refresh();
        onChanged();
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold text-fg">{t('admin.testsTitle')}</h2>
      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      <textarea
        value={json}
        onChange={(event) => {
          setJson(event.target.value);
        }}
        rows={10}
        spellCheck={false}
        className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 font-mono text-xs text-fg outline-none focus:border-primary"
      />
      <Button variant="secondary" size="sm" onClick={importTest} disabled={isBusy}>
        <FileText className="size-4" />
        {t('admin.testsImport')}
      </Button>
      <ul className="space-y-2">
        {tests.map((test) => (
          <li
            key={test.id}
            className={`flex items-center justify-between rounded-xl border p-3 text-sm ${
              test.is_active ? 'border-primary bg-primary-soft' : 'border-border bg-surface-muted'
            }`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{test.name}</p>
              <p className="text-xs text-fg-muted">
                {t('admin.testsItemCount', { count: test.item_count })}
              </p>
            </div>
            {test.is_active ? (
              <Badge>{t('admin.active')}</Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  activate(test.id);
                }}
              >
                {t('admin.activate')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ExportPanel() {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const deleteAll = (): void => {
    if (confirmText !== 'DELETE') return;
    void deleteAllStudyData()
      .then((result) => {
        setNotice(t('admin.deleteAllSuccess', { count: result.deleted_participants }));
        setConfirmText('');
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold text-fg">{t('admin.exportTitle')}</h2>
      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      {notice ? (
        <Toast
          title={notice}
          icon={<CheckCircle2 className="size-4" />}
          onDismiss={() => {
            setNotice(null);
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void downloadAdminCsvExport();
          }}
        >
          <Database className="size-4" />
          {t('admin.exportCsv')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void downloadAdminJsonExport();
          }}
        >
          <Database className="size-4" />
          {t('admin.exportJson')}
        </Button>
      </div>
      <div className="space-y-2 rounded-2xl border border-error/40 bg-error/5 p-4">
        <p className="text-sm font-medium text-error">{t('admin.deleteAllTitle')}</p>
        <p className="text-xs text-fg-muted">{t('admin.deleteAllDescription')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={confirmText}
            placeholder="DELETE"
            onChange={(event) => {
              setConfirmText(event.target.value);
            }}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-error"
          />
          <Button
            variant="secondary"
            onClick={deleteAll}
            disabled={confirmText !== 'DELETE'}
            className="border-error text-error hover:bg-error/10"
          >
            <Trash2 className="size-4" />
            {t('admin.deleteAllAction')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Admin dashboard: login, overview, material/test management, results and delete-all-data. */
export function AdminPage() {
  const { t } = useTranslation();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    void adminMe()
      .then((status) => {
        setSignedIn(status.signed_in);
      })
      .catch(() => {
        setSignedIn(false);
      });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void getAdminOverview()
      .then(setOverview)
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  }, [signedIn, refreshToken, t]);

  const refresh = (): void => {
    setRefreshToken((value) => value + 1);
  };

  const logout = (): void => {
    void adminLogout().then(() => {
      setSignedIn(false);
    });
  };

  if (signedIn === null) {
    return (
      <Card className="mx-auto max-w-sm p-8">
        <Skeleton lines={4} />
      </Card>
    );
  }
  if (!signedIn) {
    return (
      <LoginForm
        onSuccess={() => {
          setSignedIn(true);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">{t('admin.dashboardTitle')}</h1>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="size-4" />
          {t('admin.logout')}
        </Button>
      </div>

      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      {overview ? <OverviewCards overview={overview} /> : <Skeleton lines={4} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <MaterialsPanel onChanged={refresh} />
        <TestsPanel onChanged={refresh} />
      </div>

      <AdminResultsCharts refreshToken={refreshToken} />
      <AdminStatisticsPanel refreshToken={refreshToken} />
      <ExportPanel />
    </div>
  );
}
