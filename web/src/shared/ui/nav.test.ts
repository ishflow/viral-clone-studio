import { describe, expect, it } from 'vitest';
import { currentFromPath, PANEL_NAV } from './nav';

describe('the admin menu', () => {
  it('has the photo review right after Jobs, at the page of the line of photographs', () => {
    const keys = PANEL_NAV.map((item) => item.key);
    expect(keys.indexOf('review')).toBe(keys.indexOf('jobs') + 1);
    expect(PANEL_NAV.find((item) => item.key === 'review')).toMatchObject({ href: '/admin/jobs/review', label: 'common.admin.photoReview' });
  });

  it.each([
    ['/admin', 'overview'],
    ['/admin/jobs', 'jobs'],
    ['/admin/jobs/job-1', 'jobs'],
    ['/admin/jobs/review', 'review'],
    ['/admin/jobs/review/job-1/1/body', 'review'],
    ['/admin/templates/new-swap', 'templates'],
    ['/admin/users/usr-demo', 'users'],
    ['/gallery', undefined],
  ])('puts %s under %s: the longest address that holds it wins, so the photo review is not Jobs', (path, key) => {
    expect(currentFromPath('admin', path)).toBe(key);
  });
});
