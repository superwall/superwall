export function parseParams(pairs: string[] | undefined): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf("=");
    if (eq < 0) throw new Error(`Invalid -d "${pair}" - expected key=value (or key:=jsonValue).`);

    const typed = pair[eq - 1] === ":";
    const key = pair.slice(0, typed ? eq - 1 : eq);
    const raw = pair.slice(eq + 1);
    const value = typed ? parseTyped(raw, pair) : raw;
    assignPath(root, splitKey(key), value);
  }
  return root;
}

function parseTyped(raw: string, pair: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid -d "${pair}" - value after := must be JSON (number, true/false, null, "quoted", [...], {...}).`,
    );
  }
}

function splitKey(key: string): string[] {
  return key
    .replace(/\]/g, "")
    .split("[")
    .filter((p) => p !== "");
}

function assignPath(root: Record<string, unknown>, parts: string[], value: unknown): void {
  let cur: Record<string, unknown> | unknown[] = root;
  for (const [i, key] of parts.entries()) {
    const nextKey = parts[i + 1];
    if (nextKey === undefined) {
      assign(cur, key, value);
      return;
    }
    let next = childOf(cur, key);
    if (next === undefined) {
      next = /^\d+$/.test(nextKey) ? [] : {};
      assign(cur, key, next);
    }
    cur = next as Record<string, unknown> | unknown[];
  }
}

function childOf(container: Record<string, unknown> | unknown[], key: string): unknown {
  return Array.isArray(container) ? container[Number(key)] : container[key];
}

function assign(container: Record<string, unknown> | unknown[], key: string, value: unknown): void {
  if (Array.isArray(container)) container[Number(key)] = value;
  else container[key] = value;
}
