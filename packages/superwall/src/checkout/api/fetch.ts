const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  { retries = 2, backoffMs = 300 }: { retries?: number; backoffMs?: number } = {},
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const body = await response.text().catch(() => "");
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status} ${body}`);
      }
      lastError = new Error(`Server error: ${response.status} ${body}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Client error:")) throw error;
      lastError = error;
    }

    if (attempt < retries) await delay(backoffMs * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
