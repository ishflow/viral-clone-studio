import type { Translate } from '@/core/i18n/types';
import { formatName } from '@/shared/lib/format';

const NAMED: Record<string, string> = {
  face: 'gallery.detail.tag.face',
  hands: 'gallery.detail.tag.hands',
  captions: 'gallery.detail.tag.captions',
  warning: 'gallery.detail.tag.warning',
  'product-check': 'gallery.detail.tag.productCheck',
  'before-after': 'gallery.detail.tag.beforeAfter',
};

/** A tag as a person reads it: the engine writes labels like `before-after`; an admin's plain-words tag stays as written. */
export function tagName(tag: string, t: Translate): string {
  if (tag === 'talking' || tag === 'no-talking') return formatName(tag, t);
  if (NAMED[tag]) return t(NAMED[tag]);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag)) return tag;
  const words = tag.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
