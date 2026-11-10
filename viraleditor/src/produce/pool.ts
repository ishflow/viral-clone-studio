// At most `limit` tasks at a time, in the order they came. Every paid request of a run goes through one pool of 3.
export interface Pool { run<T>(task: () => Promise<T>): Promise<T> }

export function createPool(limit: number): Pool {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    if (running >= limit) return;
    const start = waiting.shift();
    if (start !== undefined) { running += 1; start(); }
  };
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          // `then` on a resolved promise: a task that throws at once is a rejection like any other
          Promise.resolve().then(task).then(resolve, reject).finally(() => { running -= 1; next(); });
        });
        next();
      });
    },
  };
}
