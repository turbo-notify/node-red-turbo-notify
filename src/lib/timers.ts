/** The one place the polling node schedules work, so tests can drive it by hand. */
export const timers = {
  after(fn: () => void, ms: number): () => void {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
