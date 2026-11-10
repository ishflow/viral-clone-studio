'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { cx } from '@/shared/lib/cx';
import { Button, Card, Field, Icon, Input, PageHead, Select, Textarea } from '@/shared/ui';
import { ConfirmDangerDialog } from '@/shared/ui/ConfirmDangerDialog';
import { checkConnection, saveSettings, type SettingsState } from './actions';
import type { SiteLimits, SwapProviderState } from '@/data/ports';
import type { HealthView } from './health';
import { MAX_SEARCHES, RANGES, type FullSettings } from './schema';

const IDLE: SettingsState = { status: 'idle', errors: {} };
type NumberField = 'threshold' | 'dailyCandidates' | 'dailyTemplates' | 'secondsMin' | 'secondsMax' | 'shortsMinViews' | 'topAdsCards' | 'perScan';
/** Errors the form shows as one line next to Save changes, not on a field. */
const FORM_LEVEL_ERRORS = ['form', 'sourceTopads', 'sourceShorts'];
const NUMBER_FIELDS: NumberField[] = ['threshold', 'dailyCandidates', 'dailyTemplates', 'secondsMin', 'secondsMax', 'shortsMinViews', 'topAdsCards', 'perScan'];
type LimitNumber = 'jobsAtOnce' | 'ownVideosPerDay' | 'dailySpendingLimit' | 'warnAtPercent';
type LimitToggle = 'freeFirstVideo' | 'showTalkingTemplates' | 'generationPaused' | 'personSwap' | 'swapReview';
const ROW = 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0 first:pt-0';

/** The worker and the provider as `health()` last said; a warning when the worker is down, the provider is not set, or nothing could be read. */
function HealthRows({ health }: { health: HealthView | null }) {
  const t = useT();
  if (!health) {
    return <p role="alert" className="m-0 flex items-center gap-2 text-15 font-semibold text-warn"><Icon name="warning" size={18} />{t('adminSettings.provider.unknown')}</p>;
  }
  const good = (text: string) => <span className="flex items-center gap-2 text-15 font-semibold text-accent-text"><Icon name="done" size={18} strokeWidth={2.6} />{text}</span>;
  const bad = (text: string) => <span className="flex items-center gap-2 text-15 font-semibold text-warn"><Icon name="warning" size={18} />{text}</span>;
  const seen = health.lastSeenText ? t('adminSettings.provider.lastSeen', { time: health.lastSeenText }) : t('adminSettings.provider.neverSeen');
  return (
    <dl className="m-0 flex flex-col">
      <div className={ROW}>
        <dt className="text-15 text-text-2">{t('adminSettings.provider.worker')}</dt>
        <dd className="m-0">{health.worker === 'running' ? good(t('adminSettings.provider.running')) : bad(t('adminSettings.provider.down'))}</dd>
        {health.worker === 'down' && (
          <dd role="alert" className="m-0 basis-full text-13 leading-snug text-text-2">
            {seen} {t('adminSettings.provider.downNote')}
          </dd>
        )}
      </div>
      <div className={ROW}>
        <dt className="text-15 text-text-2">{t('adminSettings.provider.provider')}</dt>
        <dd className="m-0">
          {health.provider === 'ready'
            ? good(t('adminSettings.provider.connected'))
            : health.provider === 'fake'
              ? <span className="text-15 font-semibold text-text">{t('adminSettings.provider.fake')}</span>
              : bad(t('adminSettings.provider.notConfigured'))}
        </dd>
        {health.provider !== 'ready' && (
          <dd role={health.provider === 'not-configured' ? 'alert' : undefined} className="m-0 basis-full text-13 leading-snug text-text-2">
            {t(health.provider === 'fake' ? 'adminSettings.provider.fakeNote' : 'adminSettings.provider.notConfiguredNote')}
          </dd>
        )}
        {health.provider === 'ready' && health.outOfCredits && (
          <dd role="alert" className="m-0 flex basis-full items-start gap-2 text-13 leading-snug font-semibold text-warn">
            <Icon name="warning" size={16} className="mt-px flex-none" />{t('adminSettings.provider.outOfCredits')} {t('adminSettings.provider.afterTopUp')}
          </dd>
        )}
      </div>
    </dl>
  );
}

/** The provider of person swap as `health()` says it, beside the switch that opens person swap. Shown only when the worker names one. */
function SwapProvider({ state }: { state: SwapProviderState }) {
  const t = useT();
  const word = t(state === 'ready' ? 'adminSettings.provider.connected' : state === 'fake' ? 'adminSettings.provider.fake' : 'adminSettings.provider.notConfigured');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-13 leading-snug text-text-2">{t('adminSettings.swap.provider')}</span>
      <span className={cx('flex min-h-13 items-center gap-2 text-15 font-semibold', state === 'ready' ? 'text-accent-text' : state === 'fake' ? 'text-text' : 'text-warn')}>
        {state === 'ready' && <Icon name="done" size={18} strokeWidth={2.6} />}
        {state === 'not-configured' && <Icon name="warning" size={18} />}
        {word}
      </span>
      {state !== 'ready' && (
        <span role={state === 'not-configured' ? 'alert' : undefined} className="text-13 leading-snug text-text-2">
          {t(state === 'fake' ? 'adminSettings.swap.fakeNote' : 'adminSettings.swap.notConfiguredNote')}
        </span>
      )}
    </div>
  );
}

/** `/admin/settings`: the production system's health, and one form with every setting the scanner reads. */
export function SettingsView({ settings, limits, health: initialHealth, providerCaps }: { providerCaps?: { daily: number; job: number } | null; settings: FullSettings; limits: SiteLimits; health: HealthView | null }) {
  const t = useT();
  const numberFormat = new Intl.NumberFormat(useLocale());
  const [state, action, pending] = useActionState(saveSettings, IDLE);
  const [health, setHealth] = useState(initialHealth);
  const [checked, setChecked] = useState(false);
  const [checking, check] = useTransition();
  // As many inputs as there are times, plus one empty optional slot (at most 3). What is typed stays in the field after a failed save.
  const slots = Math.min(3, settings.scanTimes.length + 1);
  const [times, setTimes] = useState<string[]>([0, 1, 2].map((i) => settings.scanTimes[i] ?? ''));
  const [numbers, setNumbers] = useState<Record<NumberField, string>>(
    () => Object.fromEntries(NUMBER_FIELDS.map((key) => [key, String(settings[key])])) as Record<NumberField, string>,
  );
  const [sources, setSources] = useState(settings.sources);
  const [searches, setSearches] = useState(settings.searches.join('\n'));
  const [country, setCountry] = useState(settings.topAdsCountry ?? 'US');
  const [limitNumbers, setLimitNumbers] = useState<Record<LimitNumber, string>>({
    jobsAtOnce: String(limits.jobsAtOnce), ownVideosPerDay: String(limits.ownVideosPerDay),
    dailySpendingLimit: limits.dailySpendingLimit === null ? '' : String(limits.dailySpendingLimit), warnAtPercent: String(limits.warnAtPercent),
  });
  const [toggles, setToggles] = useState<Record<LimitToggle, boolean>>({
    freeFirstVideo: limits.freeFirstVideo, showTalkingTemplates: limits.showTalkingTemplates, generationPaused: limits.generationPaused,
    personSwap: limits.personSwap === true, swapReview: limits.swapReview !== false,
  });
  // Switching the look at the photos off is asked first; nothing else on this form is.
  const [askingLookOff, setAskingLookOff] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const hasFieldError = Object.keys(state.errors).some((field) => !FORM_LEVEL_ERRORS.includes(field));
  // After a refused save the first marked field is the one to fix: the error may sit far above the Save button.
  useEffect(() => {
    if (hasFieldError) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state, hasFieldError]);
  const range = (field: keyof typeof RANGES) => t('adminSettings.error.range', { min: numberFormat.format(RANGES[field].min), max: numberFormat.format(RANGES[field].max) });
  const error = (field: keyof SettingsState['errors'], message: string) => (state.errors[field] ? message : undefined);
  const number = (name: NumberField, label: string, fieldError?: string) => (
    <Field label={<span className="text-13">{label}</span>} error={fieldError} className="min-w-0 justify-end">
      <Input name={name} type="number" inputMode="numeric" step={1} value={numbers[name]} onChange={(e) => setNumbers({ ...numbers, [name]: e.target.value })} className="font-medium" />
    </Field>
  );
  const limitNumber = (name: LimitNumber, label: string, fieldError?: string, placeholder?: string) => (
    <Field label={<span className="text-13">{label}</span>} error={fieldError} className="min-w-0 justify-end">
      <Input name={name} type="number" inputMode="numeric" step={1} value={limitNumbers[name]} placeholder={placeholder} onChange={(e) => setLimitNumbers({ ...limitNumbers, [name]: e.target.value })} className="font-medium" />
    </Field>
  );
  const limitToggle = (name: LimitToggle, label: string, warn?: boolean, note?: string) => {
    const on = toggles[name];
    const flip = () => (name === 'swapReview' && on ? setAskingLookOff(true) : setToggles({ ...toggles, [name]: !on }));
    return (
      <div role="group" aria-label={label} className="flex min-w-0 flex-col justify-end gap-1.5">
        <span aria-hidden="true" className="text-13 leading-snug text-text-2">{label}</span>
        <button
          type="button" aria-pressed={on} aria-label={label} onClick={flip}
          className={cx('box-border flex min-h-13 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-12 border bg-bg px-4 text-left text-15 font-semibold text-text', on ? (warn ? 'border-warn' : 'border-accent-text') : 'border-edge-strong')}
        >
          {t(on ? 'adminSettings.scanning.on' : 'adminSettings.scanning.off')}
          <span aria-hidden="true" className={cx('size-2.5 rounded-full', on ? (warn ? 'bg-warn' : 'bg-accent-text') : 'border-[1.5px] border-text-3')} />
        </button>
        <input type="hidden" name={name} value={on ? '1' : '0'} />
        {note && <span className="text-13 leading-snug text-text-2">{note}</span>}
      </div>
    );
  };
  const runCheck = () =>
    check(async () => {
      const answer = await checkConnection();
      setHealth(answer);
      setChecked(answer !== null);
    });
  const searchError = state.errors.searches === 'required' ? t('adminSettings.error.searchesRequired') : error('searches', t('adminSettings.error.searches', { max: MAX_SEARCHES }));
  return (
    <div className="flex flex-col gap-8">
      <PageHead title={t('adminSettings.title')} lead={t('adminSettings.lead')} />
      <form ref={formRef} action={action} noValidate className="flex flex-col gap-8">
        <div className="grid grid-cols-1 items-start gap-4 nav:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4">
            <Card as="section" aria-labelledby="h-provider" className="flex flex-col gap-4 p-4 nav:p-6">
              <h2 id="h-provider" className="m-0 heading-6">{t('adminSettings.provider.title')}</h2>
              <HealthRows health={health} />
              {health?.provider === 'ready' && <p className="m-0 text-13 leading-snug text-text-2">{t('adminSettings.provider.note')}</p>}
              <div className="flex flex-col gap-2">
                <Button variant="secondary" pending={checking} className="w-fit max-nav:w-full" onClick={runCheck}>{t('adminSettings.provider.check')}</Button>
                {checked && !checking && <p role="status" className="m-0 text-13 leading-snug text-text-2">{t('adminSettings.provider.checked')}</p>}
              </div>
            </Card>
            <Card as="section" aria-labelledby="h-caps" className="flex flex-col gap-4 p-4 nav:p-6">
              <h2 id="h-caps" className="m-0 heading-6">{t('adminSettings.caps.title')}</h2>
              <div className="grid grid-cols-2 gap-4">
                {number('dailyCandidates', t('adminSettings.caps.candidates'), error('dailyCandidates', range('dailyCandidates')))}
                {number('dailyTemplates', t('adminSettings.caps.templates'), error('dailyTemplates', range('dailyTemplates')))}
              </div>
              <p className="m-0 text-13 leading-snug text-text-2">{t('adminSettings.caps.note')}</p>
            </Card>
          </div>
          <Card as="section" aria-labelledby="h-scanning" className="flex min-w-0 flex-col gap-4 p-4 nav:p-6">
            <h2 id="h-scanning" className="m-0 heading-6">{t('adminSettings.scanning.title')}</h2>
            <div role="group" aria-labelledby="l-times" className="flex flex-col gap-2">
              <span id="l-times" className="text-15 text-text-2">{t('adminSettings.scanning.times', { count: settings.scanTimes.length })}</span>
              <div className={cx('grid gap-2', slots === 3 ? 'grid-cols-3' : slots === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
                {times.slice(0, slots).map((value, i) => {
                  const field = (['time1', 'time2', 'time3'] as const)[i]!;
                  return (
                    <div key={field} className="relative min-w-0">
                      <input
                        type="time" name={field} value={value} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} aria-label={t('adminSettings.scanning.time', { n: i + 1 })}
                        aria-invalid={state.errors[field] ? true : undefined}
                        className="box-border min-h-13 w-full min-w-0 rounded-12 border border-edge-strong bg-bg px-3 pr-8 text-15 text-text nav:px-4 nav:pr-10 [&::-webkit-calendar-picker-indicator]:hidden aria-invalid:border-[1.5px] aria-invalid:border-warn"
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-text-2 nav:right-4"><Icon name="clock" size={18} /></span>
                    </div>
                  );
                })}
              </div>
              {(state.errors.time1 || state.errors.time2 || state.errors.time3) && (
                <span role="alert" className="flex items-center gap-1.5 text-13 leading-snug text-warn"><Icon name="warning" size={16} />{t(Object.values(state.errors).includes('duplicate') ? 'adminSettings.error.duplicate' : 'adminSettings.error.time')}</span>
              )}
              <span className="text-13 leading-snug text-text-3">{t('adminSettings.scanning.timezone')}</span>
            </div>
            <div role="group" aria-labelledby="l-sources" className="flex flex-col gap-2">
              <span id="l-sources" className="text-15 text-text-2">{t('adminSettings.scanning.sources')}</span>
              <div className="grid grid-cols-2 gap-2">
                {(['topads', 'shorts'] as const).map((source) => {
                  const on = sources[source];
                  return (
                    <button
                      key={source} type="button" aria-pressed={on} onClick={() => setSources({ ...sources, [source]: !on })}
                      className={cx('box-border flex min-h-13 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-12 border bg-bg px-4 text-left text-15 font-semibold text-text', on ? 'border-accent-text' : 'border-edge-strong')}
                    >
                      {t(`adminSettings.scanning.${source}`)}
                      <span className={cx('text-13 font-medium', on ? 'text-accent-text' : 'text-text-3')}>{t(on ? 'adminSettings.scanning.on' : 'adminSettings.scanning.off')}</span>
                    </button>
                  );
                })}
              </div>
              {state.errors.searches === 'required' && <span className="flex items-center gap-1.5 text-13 leading-snug text-warn"><Icon name="warning" size={16} />{t('adminSettings.error.shortsNeedsHashtag')}</span>}
              <input type="hidden" name="sourceTopads" value={sources.topads ? '1' : '0'} />
              <input type="hidden" name="sourceShorts" value={sources.shorts ? '1' : '0'} />
            </div>
            <Field label={t('adminSettings.scanning.topAdsIndustry')} hint={t('adminSettings.scanning.topAdsIndustryNote')} error={error('topAdsIndustry', t('adminSettings.error.topAdsFilter'))}>
              <Select name="topAdsIndustry" defaultValue={settings.topAdsIndustry ?? 'beauty-personal-care'}>
                {(['beauty-personal-care', 'skincare', 'makeup', 'haircare', 'all'] as const).map(value => <option key={value} value={value}>{t(`adminSettings.scanning.industry.${value}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('adminSettings.scanning.topAdsCountry')} error={error('topAdsCountry', t('adminSettings.error.country'))}>
              <Input name="topAdsCountry" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="US" />
            </Field>
            <Field label={t('adminSettings.scanning.topAdsPeriod')} error={error('topAdsPeriod', t('adminSettings.error.topAdsFilter'))}>
              <Select name="topAdsPeriod" defaultValue={String(settings.topAdsPeriod ?? 7)}>
                {[7, 30, 180].map(days => <option key={days} value={days}>{t('adminSettings.scanning.periodDays', { days })}</option>)}
              </Select>
            </Field>
            <Field label={t('adminSettings.scanning.searches')} hint={t('adminSettings.scanning.searchesNote')} error={searchError}>
              <Textarea name="searches" rows={5} value={searches} onChange={(e) => setSearches(e.target.value)} placeholder={t('adminSettings.scanning.searchesPlaceholder')} className="min-h-36" />
            </Field>
          </Card>
          <Card as="section" aria-labelledby="h-thresholds" className="flex min-w-0 flex-col gap-4 p-4 nav:p-6">
            <h2 id="h-thresholds" className="m-0 heading-6">{t('adminSettings.thresholds.title')}</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {number('threshold', t('adminSettings.thresholds.score'), error('threshold', t('adminSettings.error.threshold')))}
              {number('secondsMin', t('adminSettings.thresholds.minLength'), error('secondsMin', t('adminSettings.error.seconds')))}
              {number('secondsMax', t('adminSettings.thresholds.maxLength'), state.errors.secondsMax === 'order' ? t('adminSettings.error.order') : error('secondsMax', t('adminSettings.error.seconds')))}
              {number('shortsMinViews', t('adminSettings.thresholds.minViews'), error('shortsMinViews', range('shortsMinViews')))}
              {number('topAdsCards', t('adminSettings.thresholds.cards'), error('topAdsCards', range('topAdsCards')))}
              {number('perScan', t('adminSettings.thresholds.perScan'), error('perScan', range('perScan')))}
            </div>
            <p className="m-0 text-13 leading-snug text-text-2">{t('adminSettings.thresholds.note')}</p>
          </Card>
        </div>
        <Card as="section" aria-labelledby="h-limits" className="flex flex-col gap-4 p-4 nav:p-6">
          {providerCaps && <p className="m-0 text-13">Provider cap / Sağlayıcı sınırı (UTC): {providerCaps.daily} / day · gün; {providerCaps.job} / run · işlem. Conservative reservation units / Muhafazakâr rezervasyon birimleri. Refunds do not reset this cap / İadeler sınırı sıfırlamaz.</p>}
          <h2 id="h-limits" className="m-0 heading-6">{t('adminSettings.limits.title')}</h2>
          <div className="grid grid-cols-1 gap-4 min-[600px]:grid-cols-2 nav:grid-cols-4">
            {limitNumber('jobsAtOnce', t('adminSettings.limits.jobsAtOnce'), error('jobsAtOnce', range('jobsAtOnce')))}
            {limitNumber('ownVideosPerDay', t('adminSettings.limits.ownVideos'), error('ownVideosPerDay', range('ownVideosPerDay')))}
            {limitToggle('freeFirstVideo', t('adminSettings.limits.freeVideo'))}
            {limitToggle('showTalkingTemplates', t('adminSettings.limits.talking'))}
            {limitNumber('dailySpendingLimit', t('adminSettings.limits.spending'), error('dailySpendingLimit', range('dailySpendingLimit')), t('adminSettings.limits.notSet'))}
            {limitNumber('warnAtPercent', t('adminSettings.limits.warn'), error('warnAtPercent', t('adminSettings.error.percent')))}
            <Field label={<span className="text-13">{t('adminSettings.limits.onReached')}</span>} className="min-w-0 justify-end">
              <Select name="onLimitReached" defaultValue={limits.onLimitReached} className="font-medium">
                <option value="pause-new-jobs">{t('adminSettings.limits.pauseNew')}</option>
              </Select>
            </Field>
            {limitToggle('generationPaused', t('adminSettings.limits.pauseNow'), true)}
          </div>
          <p className="m-0 text-13 leading-snug text-text-2">{t('adminSettings.limits.note')}</p>
        </Card>
        <Card as="section" aria-labelledby="h-swap" className="flex flex-col gap-4 p-4 nav:p-6">
          <h2 id="h-swap" className="m-0 heading-6">{t('adminSettings.swap.title')}</h2>
          <div className="grid grid-cols-1 items-start gap-4 nav:grid-cols-3">
            {limitToggle('personSwap', t('adminSettings.swap.feature'), false, t('adminSettings.swap.featureNote'))}
            {health?.swap && <SwapProvider state={health.swap} />}
            {limitToggle('swapReview', t('adminSettings.swap.review'), false, t('adminSettings.swap.reviewNote'))}
          </div>
        </Card>
        {askingLookOff && (
          <ConfirmDangerDialog
            title={t('adminSettings.swap.reviewOff.title')}
            body={t('adminSettings.swap.reviewOff.body')}
            keepLabel={t('adminSettings.swap.reviewOff.keep')}
            confirmLabel={t('adminSettings.swap.reviewOff.confirm')}
            onKeep={() => setAskingLookOff(false)}
            onConfirm={() => {
              setToggles({ ...toggles, swapReview: false });
              setAskingLookOff(false);
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 max-nav:flex-col max-nav:items-stretch">
          <Button type="submit" pending={pending} className="max-nav:w-full">{t('adminSettings.save')}</Button>
          <p className="m-0 text-13 leading-snug text-text-3">{t('adminSettings.applyNote')}</p>
          <p role="status" className="m-0 text-15 text-accent-text empty:hidden">{state.status === 'saved' ? t('adminSettings.saved') : ''}</p>
          {(state.errors.form || state.errors.sourceTopads || state.errors.sourceShorts) && <p role="alert" className="m-0 text-15 text-warn">{t('adminSettings.error.failed')}</p>}
          {hasFieldError && <p role="alert" className="m-0 text-15 text-warn">{t('adminSettings.error.fix')}</p>}
        </div>
      </form>
    </div>
  );
}
