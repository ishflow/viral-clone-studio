'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { setLocale } from '@/core/i18n/actions';
import { useLocale, useT } from '@/core/i18n/I18nProvider';
import { LOCALES, type Locale } from '@/core/i18n/types';
import { cx } from '@/shared/lib/cx';
import { Icon } from './Icon';

const CHIP = 'min-h-11 cursor-pointer rounded-full border px-3.5 text-15 font-medium';
const ROW =
  'flex min-h-13 w-full cursor-pointer items-center gap-3 rounded-12 border border-edge-strong bg-transparent px-4 text-15 font-medium text-text box-border';
const ITEM = 'box-border flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 rounded-8 border-0 px-3 text-left text-15';

/** variant "chip": the "EN" button of the desktop header (list opens below). "row": the full-width row of the phone menu (list opens above). */
export function LanguageMenu({ variant = 'chip' }: { variant?: 'chip' | 'row' }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    items.current[LOCALES.indexOf(locale)]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, locale]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const choose = (next: Locale) => {
    setOpen(false);
    if (next !== locale) startTransition(() => void setLocale(next));
    else trigger.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = items.current.findIndex((el) => el === document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items.current[(at + step + LOCALES.length) % LOCALES.length]?.focus();
  };

  const name = t(`common.language.${locale}`);
  return (
    <div ref={root} className={cx('relative', variant === 'row' && 'w-full')} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        aria-label={t('common.language.label', { name })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={
          variant === 'chip'
            ? cx(CHIP, open ? 'border-edge-strong bg-raised text-text' : 'border-edge bg-transparent text-text-2 hover:text-text')
            : ROW
        }
      >
        {variant === 'chip' ? (
          t(`common.language.short.${locale}`)
        ) : (
          <>
            <Icon name="language" />
            <span className="flex-1 text-left">{name}</span>
            <Icon name="expand" />
          </>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('common.language.menu')}
          className={cx(
            'absolute z-30 box-border flex flex-col gap-1 rounded-16 border border-edge bg-surface p-2',
            variant === 'chip' ? 'top-13 right-0 w-66' : 'bottom-full left-0 mb-2 w-full',
          )}
        >
          {LOCALES.map((l, i) => {
            const on = l === locale;
            return (
              <button
                key={l}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => choose(l)}
                className={cx(ITEM, on ? 'bg-raised font-semibold text-text' : 'bg-transparent text-text-2 hover:bg-raised')}
              >
                {t(`common.language.${l}`)}
                {on && (
                  <span className="flex text-accent-text">
                    <Icon name="done" />
                  </span>
                )}
              </button>
            );
          })}
          <p className="m-0 border-t border-line px-3 pt-2 pb-1 text-13 leading-snug text-text-3">{t('common.language.note')}</p>
        </div>
      )}
    </div>
  );
}
