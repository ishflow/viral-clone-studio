/**
 * `ref` for a `<form action={…}>` whose fields are all controlled.
 * React resets a form after its action. That reset leaves a controlled `<select>` on the option it was first rendered with while
 * the state still holds the chosen one, so the next submit would send the old value. The reset is cancelled here: the state stays
 * the one source of the values. (A native listener: React's own `onReset` does not run for the reset React itself triggers.)
 */
export function keepControlledValues(form: HTMLFormElement | null): (() => void) | undefined {
  if (!form) return undefined;
  const cancel = (event: Event) => event.preventDefault();
  form.addEventListener('reset', cancel);
  return () => form.removeEventListener('reset', cancel);
}
