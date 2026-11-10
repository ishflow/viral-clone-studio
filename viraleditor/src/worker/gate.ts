// A gate in front of a heavy child process: at most `size` calls inside at once, the rest wait in the order they came.
export type Gate = <T>(call: () => Promise<T>) => Promise<T>;

export function openGate(size: number): Gate {
  if (!Number.isInteger(size) || size < 1) throw new Error(`a gate needs a whole number of at least 1, got ${size}`);
  let inside = 0;
  const waiting: Array<() => void> = [];
  const leave = (): void => { const next = waiting.shift(); if (next) next(); else inside -= 1; };   // a leaving call hands its place to the first in line
  return async <T>(call: () => Promise<T>): Promise<T> => {
    if (inside < size) inside += 1; else await new Promise<void>((go) => { waiting.push(go); });
    try { return await call(); } finally { leave(); }
  };
}

const defaultLog = (line: string): void => { console.error(line); };

/** The same gate, writing down the wait of a call that had to wait: `stage=gate.<name> wait_ms=<n>`. A call that went straight in writes nothing. */
export function waitLogged(gate: Gate, name: string, log: (line: string) => void = defaultLog, now: () => number = () => performance.now()): Gate {
  return <T>(call: () => Promise<T>): Promise<T> => {
    const asked = now();
    return gate(async () => {
      const waited = Math.round(now() - asked);
      if (waited > 0) log(`stage=gate.${name} wait_ms=${waited}`);
      return call();
    });
  };
}

/**
 * The same port with the named methods behind a gate; every other member, and every answer, passes untouched. A call that had to wait
 * writes one line, `stage=gate.<name>.<method> wait_ms=<n>` (`stage=gate.<method>` without a `name`): only the names and the time,
 * never an argument. A call that went straight in writes nothing.
 */
export function gated<T extends object>(port: T, gates: { [K in keyof T]?: Gate }, name?: string, log: (line: string) => void = defaultLog, now: () => number = () => performance.now()): T {
  return new Proxy(port, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      const gate = (gates as Record<string | symbol, Gate | undefined>)[key];
      if (typeof value !== 'function' || gate === undefined) return value;
      const logged = waitLogged(gate, `${name ? `${name}.` : ''}${String(key)}`, log, now);
      return (...args: unknown[]): Promise<unknown> => logged(async () => value.apply(target, args) as unknown);
    },
  });
}

/** The most calls one gate lets in, as the most inspections a worker runs at once. */
export const GATE_MAX = 16;

/** How many calls a gate lets in: `name` from the environment (a plain whole number from 1 to `GATE_MAX`), else a quarter of the cores (at least 1). */
export function gateSize(env: Record<string, string | undefined>, name: string, cpus: number): number {
  return gateSizeOr(env, name, Math.max(1, Math.floor(cpus / 4)), GATE_MAX);
}

/** The same for a gate with its own default and its own ceiling: `name` from the environment (a plain whole number from 1 to `max`), else `fallback`. */
export function gateSizeOr(env: Record<string, string | undefined>, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || n > max) throw new Error(`${name} must be a whole number from 1 to ${max}, got "${raw}"`);
  return n;
}
