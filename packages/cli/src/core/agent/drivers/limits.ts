const USAGE_LIMIT_PATTERNS = [
  /\b(?:session|usage) limit\b/i,
  /\b(?:daily|weekly|monthly) limit (?:hit|reached|exceeded)\b/i,
  /\b(?:credit|credits|quota) (?:is |are )?exhausted\b/i,
  /\b(?:out of|no) (?:credits?|usage) remaining\b/i,
];

export function isUsageLimitText(text: string | undefined): boolean {
  return !!text && USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}
