export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(body: string): unknown {
  if (body.trim() === "") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function textField(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" && found.trim() !== "" ? found.trim() : undefined;
}

export function listField(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}
