import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/shared/ui/test-utils';
import GalleryRouteError from '@/app/(site)/(browse)/gallery/error';
import { GalleryError } from './GalleryError';

afterEach(cleanup);

describe('GalleryError (board A-Galeri-Hata)', () => {
  it('keeps the page head, says the gallery could not load and that videos and credits are not affected', () => {
    renderWithI18n(<GalleryError onRetry={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the gallery.');
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection and try again. Your videos and credits are not affected.');
  });
  it('the route boundary retries with the boundary reset', () => {
    const reset = vi.fn();
    renderWithI18n(<GalleryRouteError error={new Error('db')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
  it('is written in Turkish', () => {
    renderWithI18n(<GalleryError onRetry={() => {}} />, 'tr');
    expect(screen.getByRole('alert')).toHaveTextContent('Galeri yüklenemedi.');
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
  });
});
