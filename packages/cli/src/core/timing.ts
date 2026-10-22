export const timing = {
  sleep: (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms)),
};
