/** One `searchParams` value as text: the first one when the address repeats the parameter, empty when it is missing. */
export const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
