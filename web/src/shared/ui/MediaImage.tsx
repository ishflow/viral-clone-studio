import Image from 'next/image';
import type { ComponentProps } from 'react';

/**
 * `next/image` for pictures that may live under `/media` (posters, samples, job pictures). The image optimizer fetches the file
 * on the server without the viewer's session, and `/media` answers a stranger 404 for everything not public (a sample before it is
 * published, a job's poster): the picture then broke. Those files are served as they are.
 */
export function MediaImage(props: ComponentProps<typeof Image>) {
  const media = typeof props.src === 'string' && props.src.startsWith('/media/');
  return <Image {...props} unoptimized={props.unoptimized ?? media} />;
}
