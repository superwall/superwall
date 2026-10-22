import { createHash } from "node:crypto";

function leadingZeroBits(sum: Buffer, bits: number): boolean {
  const whole = Math.floor(bits / 8);
  for (let index = 0; index < whole; index++) {
    if (sum[index] !== 0) return false;
  }
  const remaining = bits % 8;
  return remaining === 0 || (sum.readUInt8(whole) & (0xff << (8 - remaining))) === 0;
}

const two = (value: number): string => String(value).padStart(2, "0");

export function mintHashcash(bits: number, challenge: string, now: Date): string {
  const date =
    String(now.getUTCFullYear()) +
    two(now.getUTCMonth() + 1) +
    two(now.getUTCDate()) +
    two(now.getUTCHours()) +
    two(now.getUTCMinutes()) +
    two(now.getUTCSeconds());
  for (let counter = 0; ; counter++) {
    const candidate = `1:${bits}:${date}:${challenge}::${counter}`;
    if (leadingZeroBits(createHash("sha1").update(candidate).digest(), bits)) return candidate;
  }
}
