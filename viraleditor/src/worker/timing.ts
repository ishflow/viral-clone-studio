// How long each call into a port takes, one line per call in the worker's error log: `stage=<port>.<method> ms=<n>`. Only the names and the time: never an argument or an answer.
const defaultLog = (line: string): void => { console.error(line); };

export function timed<T extends object>(name: string, port: T, log: (line: string) => void = defaultLog, now: () => number = () => performance.now()): T {
  return new Proxy(port, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      return (...args: unknown[]): unknown => {
        const started = now();
        const done = (): void => { log(`stage=${name}.${key} ms=${Math.round(now() - started)}`); };
        let answer: unknown;
        try { answer = value.apply(target, args); } catch (error) { done(); throw error; }
        if (answer instanceof Promise) return answer.then((r: unknown) => { done(); return r; }, (error: unknown) => { done(); throw error; });
        done();
        return answer;
      };
    },
  });
}
