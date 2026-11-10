const TURKISH: Record<string, string> = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };

/** Lower-case ASCII `[a-z0-9-]`, one dash between words, none at the ends. */
function slug(text: string): string {
  return text
    .replace(/[ışğüöçİŞĞÜÖÇ]/g, (c) => TURKISH[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The file name of a downloaded video: `viral-clone-<template>-<first 8 of the job>.mp4`, nothing else leaks in. */
export function downloadName(title: string | undefined, jobId: string): string {
  const short = slug(title ?? '').slice(0, 24).replace(/-+$/, '');
  const id = slug(jobId.slice(0, 8));
  return `${['viral-clone', short, id].filter(Boolean).join('-')}.mp4`;
}
