import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ChipGroup, type ChipOption } from '../components/ChipGroup';
import { FIELD_OF_WORK_IDS } from '../data/fieldsOfWork';
import { CITY_IDS, universitiesForCity, type CityId } from '../data/universities';
import { LEVEL_OPTIONS, useLevel, type StudyLevel } from '../hooks/useLevel';
import { SUPPORTED_LANGUAGES, isLanguage, type Language } from '../i18n';
import {
  writeUserProfile,
  YEARS_BY_DEGREE,
  type Degree,
  type UserProfile,
  type UserRole,
  type YearOfStudy,
} from '../lib/profile';

const STUDENT_STEPS = [
  'welcome',
  'name',
  'role',
  'city',
  'university',
  'degree',
  'year',
  'language',
  'level',
  'summary',
] as const;
const OTHER_STEPS = [
  'welcome',
  'name',
  'role',
  'fieldOfWork',
  'language',
  'level',
  'summary',
] as const;
type Step = (typeof STUDENT_STEPS)[number] | (typeof OTHER_STEPS)[number];

function stepsForRole(role: UserRole | null): readonly Step[] {
  return role === 'student' ? STUDENT_STEPS : OTHER_STEPS;
}

const ROLES: UserRole[] = ['student', 'professional', 'other'];
const OTHER_CHIP_ID = 'other';
const MIN_BIRTH_YEAR = 1950;
const MAX_BIRTH_YEAR = 2015;
// Newest first: most users onboarding are students, so their likely birth year is near the top.
const BIRTH_YEARS = Array.from(
  { length: MAX_BIRTH_YEAR - MIN_BIRTH_YEAR + 1 },
  (_, index) => MAX_BIRTH_YEAR - index,
);

const INPUT_CLASS =
  'w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-fg outline-none focus:border-primary';

interface OptionProps {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
}

function RadioOption({ name, value, checked, label, description, onSelect }: OptionProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
        checked
          ? 'border-primary bg-primary-soft'
          : 'border-border bg-surface hover:border-primary/40'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-1 accent-[var(--primary)]"
      />
      <span>
        <span className="block font-medium text-fg">{label}</span>
        {description ? <span className="block text-sm text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-left">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </label>
  );
}

function StepHeading({ title, helper }: { title: string; helper: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-semibold text-fg">{title}</h2>
      <p className="text-sm text-fg-muted">{helper}</p>
    </div>
  );
}

/** First-run onboarding: role, background, interface language and proficiency level. */
export function WelcomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { level, setLevel } = useLevel();

  const [stepIndex, setStepIndex] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleDetail, setRoleDetail] = useState('');

  const [cityId, setCityId] = useState<string | null>(null);
  const [cityOther, setCityOther] = useState('');
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [universityOther, setUniversityOther] = useState('');
  const [degree, setDegree] = useState<Degree | null>(null);
  const [yearOfStudy, setYearOfStudy] = useState<YearOfStudy | null>(null);

  const [fieldOfWorkId, setFieldOfWorkId] = useState<string | null>(null);
  const [fieldOfWorkOther, setFieldOfWorkOther] = useState('');

  const language: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  const steps = stepsForRole(role);
  const step: Step = steps[stepIndex] ?? 'welcome';
  const isStudent = role === 'student';

  const selectCity = (id: string): void => {
    setCityId(id);
    setCityOther('');
    setUniversityId(null);
    setUniversityOther('');
  };

  const selectDegree = (value: Degree): void => {
    setDegree(value);
    setYearOfStudy(null);
  };

  const resolvedCity = cityId === OTHER_CHIP_ID ? cityOther.trim() : (cityId ?? '');
  const resolvedUniversity =
    universityId === OTHER_CHIP_ID ? universityOther.trim() : (universityId ?? '');
  const resolvedFieldOfWork =
    fieldOfWorkId === OTHER_CHIP_ID ? fieldOfWorkOther.trim() : (fieldOfWorkId ?? '');

  let canContinue = true;
  if (step === 'name') {
    canContinue = firstName.trim() !== '' && lastName.trim() !== '' && birthYear !== null;
  } else if (step === 'role') {
    canContinue = role !== null && (role !== 'other' || roleDetail.trim() !== '');
  } else if (step === 'city') {
    canContinue = cityId !== null && (cityId !== OTHER_CHIP_ID || cityOther.trim() !== '');
  } else if (step === 'university') {
    canContinue =
      universityId !== null && (universityId !== OTHER_CHIP_ID || universityOther.trim() !== '');
  } else if (step === 'degree') {
    canContinue = degree !== null;
  } else if (step === 'year') {
    canContinue = yearOfStudy !== null;
  } else if (step === 'fieldOfWork') {
    canContinue =
      fieldOfWorkId !== null && (fieldOfWorkId !== OTHER_CHIP_ID || fieldOfWorkOther.trim() !== '');
  }

  const buildProfile = (): UserProfile | null => {
    if (role === null || birthYear === null) return null;
    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthYear,
      role,
      ...(role === 'other' ? { roleDetail: roleDetail.trim() } : {}),
      ...(isStudent
        ? {
            city: resolvedCity,
            university: resolvedUniversity,
            ...(degree !== null ? { degree } : {}),
            ...(yearOfStudy !== null ? { yearOfStudy } : {}),
          }
        : { fieldOfWork: resolvedFieldOfWork }),
      language,
      level,
      completedAt: new Date().toISOString(),
    };
  };

  const finish = (): void => {
    const profile = buildProfile();
    if (profile === null) return;
    writeUserProfile(profile);
    // Language and level were already applied as they were chosen; setting them again keeps the
    // header toggles and the profile consistent even if those steps were never touched.
    setLevel(profile.level);
    void i18n.changeLanguage(profile.language);
    void navigate('/workspace');
  };

  const roleLabel = (value: UserRole): string => t(`welcome.role_${value}`);
  const cityLabel = (id: string): string =>
    id === OTHER_CHIP_ID ? t('welcome.otherOption') : t(`welcome.city_${id}`);
  const fieldOfWorkLabel = (id: string): string =>
    id === OTHER_CHIP_ID ? t('welcome.otherOption') : t(`welcome.field_${id}`);

  const cityOptions: ChipOption[] = CITY_IDS.map((id) => ({ id, label: cityLabel(id) }));
  const universityOptions: ChipOption[] = [
    ...universitiesForCity(cityId as CityId | null).map((name) => ({ id: name, label: name })),
    { id: OTHER_CHIP_ID, label: t('welcome.otherOption') },
  ];
  const degreeOptions: ChipOption[] = (['bachelor', 'master', 'phd'] satisfies Degree[]).map(
    (value) => ({ id: value, label: t(`welcome.degree_${value}`) }),
  );
  const yearOptions: ChipOption[] = YEARS_BY_DEGREE[degree ?? 'bachelor'].map((value) => ({
    id: value,
    label: t(`welcome.year_${value}`),
  }));
  const fieldOfWorkOptions: ChipOption[] = FIELD_OF_WORK_IDS.map((id) => ({
    id,
    label: fieldOfWorkLabel(id),
  }));

  const renderBody = (): ReactNode => {
    switch (step) {
      case 'welcome':
        return (
          <div className="space-y-4 text-center">
            <h1 className="text-3xl font-semibold text-fg">{t('welcome.title')}</h1>
            <p className="text-base leading-7 text-fg-muted">{t('welcome.intro')}</p>
          </div>
        );
      case 'name':
        return (
          <div className="space-y-4">
            <StepHeading title={t('welcome.nameTitle')} helper={t('welcome.nameHelper')} />
            <Field label={t('welcome.firstName')}>
              <input
                className={INPUT_CLASS}
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                }}
              />
            </Field>
            <Field label={t('welcome.lastName')}>
              <input
                className={INPUT_CLASS}
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                }}
              />
            </Field>
            <Field label={t('welcome.birthYear')}>
              <select
                className={INPUT_CLASS}
                value={birthYear ?? ''}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setBirthYear(Number.isNaN(value) || value === 0 ? null : value);
                }}
              >
                <option value="">{t('welcome.birthYearPlaceholder')}</option>
                {BIRTH_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );
      case 'role':
        return (
          <fieldset className="space-y-3">
            <legend className="mb-3 text-2xl font-semibold text-fg">
              {t('welcome.roleTitle')}
            </legend>
            {ROLES.map((value) => (
              <RadioOption
                key={value}
                name="role"
                value={value}
                checked={role === value}
                label={roleLabel(value)}
                onSelect={() => {
                  setRole(value);
                }}
              />
            ))}
            {role === 'other' ? (
              <Field label={t('welcome.roleOtherLabel')}>
                <input
                  className={INPUT_CLASS}
                  value={roleDetail}
                  onChange={(event) => {
                    setRoleDetail(event.target.value);
                  }}
                />
              </Field>
            ) : null}
          </fieldset>
        );
      case 'city':
        return (
          <div className="space-y-4">
            <StepHeading title={t('welcome.cityTitle')} helper={t('welcome.cityHelper')} />
            <ChipGroup
              ariaLabel={t('welcome.cityTitle')}
              options={cityOptions}
              selectedId={cityId}
              onSelect={selectCity}
              otherId={OTHER_CHIP_ID}
              otherValue={cityOther}
              onOtherValueChange={setCityOther}
              otherInputLabel={t('welcome.city')}
            />
          </div>
        );
      case 'university':
        return (
          <div className="space-y-4">
            <StepHeading
              title={t('welcome.universityTitle')}
              helper={t('welcome.universityHelper')}
            />
            <ChipGroup
              ariaLabel={t('welcome.universityTitle')}
              options={universityOptions}
              selectedId={universityId}
              onSelect={(id) => {
                setUniversityId(id);
                setUniversityOther('');
              }}
              otherId={OTHER_CHIP_ID}
              otherValue={universityOther}
              onOtherValueChange={setUniversityOther}
              otherInputLabel={t('welcome.university')}
            />
          </div>
        );
      case 'degree':
        return (
          <div className="space-y-4">
            <StepHeading title={t('welcome.degreeTitle')} helper={t('welcome.degreeHelper')} />
            <ChipGroup
              ariaLabel={t('welcome.degreeTitle')}
              options={degreeOptions}
              selectedId={degree}
              onSelect={(id) => {
                selectDegree(id as Degree);
              }}
            />
          </div>
        );
      case 'year':
        return (
          <div className="space-y-4">
            <StepHeading title={t('welcome.yearTitle')} helper={t('welcome.yearHelper')} />
            <ChipGroup
              ariaLabel={t('welcome.yearTitle')}
              options={yearOptions}
              selectedId={yearOfStudy}
              onSelect={(id) => {
                setYearOfStudy(id as YearOfStudy);
              }}
            />
          </div>
        );
      case 'fieldOfWork':
        return (
          <div className="space-y-4">
            <StepHeading
              title={t('welcome.fieldOfWorkTitle')}
              helper={t('welcome.fieldOfWorkHelper')}
            />
            <ChipGroup
              ariaLabel={t('welcome.fieldOfWorkTitle')}
              options={fieldOfWorkOptions}
              selectedId={fieldOfWorkId}
              onSelect={(id) => {
                setFieldOfWorkId(id);
                setFieldOfWorkOther('');
              }}
              otherId={OTHER_CHIP_ID}
              otherValue={fieldOfWorkOther}
              onOtherValueChange={setFieldOfWorkOther}
              otherInputLabel={t('welcome.fieldOfWork')}
            />
          </div>
        );
      case 'language':
        return (
          <fieldset className="space-y-3">
            <legend className="mb-3 text-2xl font-semibold text-fg">
              {t('welcome.languageTitle')}
            </legend>
            {SUPPORTED_LANGUAGES.map((code) => (
              <RadioOption
                key={code}
                name="language"
                value={code}
                checked={language === code}
                label={t(`language.${code}.label`)}
                onSelect={() => {
                  void i18n.changeLanguage(code);
                }}
              />
            ))}
          </fieldset>
        );
      case 'level':
        return (
          <fieldset className="space-y-3">
            <legend className="mb-3 text-2xl font-semibold text-fg">
              {t('welcome.levelTitle')}
            </legend>
            {LEVEL_OPTIONS.map((option: StudyLevel) => (
              <RadioOption
                key={option}
                name="level"
                value={option}
                checked={level === option}
                label={t(`level.${option}`)}
                description={t(`welcome.levelDescription_${option}`)}
                onSelect={() => {
                  setLevel(option);
                }}
              />
            ))}
          </fieldset>
        );
      case 'summary': {
        const who = role === 'other' ? roleDetail : role === null ? '' : roleLabel(role);
        const rows: [string, string][] = [
          [t('welcome.summaryName'), `${firstName} ${lastName}`.trim()],
          [t('welcome.summaryBirthYear'), birthYear === null ? '' : String(birthYear)],
          [t('welcome.summaryRole'), who],
        ];
        if (isStudent) {
          rows.push(
            [
              t('welcome.city'),
              cityId === null
                ? ''
                : cityLabel(cityId) + (cityId === OTHER_CHIP_ID ? ` — ${resolvedCity}` : ''),
            ],
            [t('welcome.university'), resolvedUniversity],
            [t('welcome.degree'), degree === null ? '' : t(`welcome.degree_${degree}`)],
            [
              t('welcome.yearOfStudy'),
              yearOfStudy === null ? '' : t(`welcome.year_${yearOfStudy}`),
            ],
          );
        } else {
          rows.push([
            t('welcome.fieldOfWork'),
            fieldOfWorkId === null
              ? ''
              : fieldOfWorkLabel(fieldOfWorkId) +
                (fieldOfWorkId === OTHER_CHIP_ID ? ` — ${resolvedFieldOfWork}` : ''),
          ]);
        }
        rows.push(
          [t('welcome.summaryLanguage'), t(`language.${language}.label`)],
          [t('welcome.summaryLevel'), t(`level.${level}`)],
        );
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-fg">{t('welcome.doneTitle')}</h2>
            <Card className="p-4">
              <dl className="space-y-2 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="text-right font-medium text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        );
      }
    }
  };

  return (
    <div className="mx-auto max-w-xl py-8">
      <p className="mb-4 text-center text-xs uppercase tracking-[0.12em] text-fg-muted">
        {t('welcome.stepCounter', { current: stepIndex + 1, total: steps.length })}
      </p>
      <Card className="overflow-hidden p-6 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {renderBody()}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex justify-between gap-3">
          {stepIndex > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setStepIndex((index) => Math.max(0, index - 1));
              }}
            >
              {t('welcome.back')}
            </Button>
          ) : (
            <span />
          )}
          {step === 'summary' ? (
            <Button onClick={finish}>{t('welcome.continueToUpload')}</Button>
          ) : (
            <Button
              onClick={() => {
                setStepIndex((index) => Math.min(steps.length - 1, index + 1));
              }}
              disabled={!canContinue}
            >
              {step === 'welcome' ? t('welcome.getStarted') : t('welcome.next')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
