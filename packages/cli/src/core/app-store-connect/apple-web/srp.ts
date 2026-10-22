import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";

const MODULUS_HEX =
  "ac6bdb41324a9a9bf166de5e1389582faf72b6651987ee07fc319294" +
  "3db56050a37329cbb4a099ed8193e0757767a13dd52312ab4b03310d" +
  "cd7f48a9da04fd50e8083969edb767b0cf6095179a163ab3661a05fb" +
  "d5faaae82918a9962f0b93b855f97993ec975eeaa80d740adbf4ff74" +
  "7359d041d5c33ea71d281e446b14773bca97b43a23fb801676bd207a" +
  "436c6481f1d2b9078717461a5b9d32e688f87748544523b524b0d57d" +
  "5ea77a2775d2ecfa032cfbdbf52fb3786160279004e57ae6af874e73" +
  "03ce53299ccc041c7bc308d82a5698f3a8d0c38271ae35f8e9dbfbb6" +
  "94b5c803d89f7ae435de236d525f54759b65e372fcd68ef20fa7111f" +
  "9e4aff73";
const MODULUS = BigInt(`0x${MODULUS_HEX}`);
const GENERATOR = 2n;
const WIDTH = MODULUS_HEX.length;
const SECRET_BYTES = 256;
const DERIVED_BYTES = 32;

export type PasswordProtocol = "s2k" | "s2k_fo";

interface Ephemeral {
  secret: bigint;
  publicKey: string;
}

interface ProofInput {
  accountName: string;
  password: string;
  protocol: PasswordProtocol;
  salt: string;
  iterations: number;
  serverPublicKey: string;
  secret: bigint;
}

interface Proof {
  m1: string;
  m2: string;
}

const digest = (bytes: Buffer): Buffer => createHash("sha256").update(bytes).digest();
const hashHex = (hex: string): string => digest(Buffer.from(hex, "hex")).toString("hex");
const evenHex = (value: bigint): string => {
  const hex = value.toString(16);
  return hex.length % 2 === 1 ? `0${hex}` : hex;
};
const paddedHash = (...values: string[]): bigint => {
  return BigInt(`0x${hashHex(values.map((value) => value.padStart(WIDTH, "0")).join(""))}`);
};

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

export function createEphemeral(random: (size: number) => Buffer = randomBytes): Ephemeral {
  const secret = BigInt(`0x${random(SECRET_BYTES).toString("hex")}`);
  const publicKey = Buffer.from(evenHex(modPow(GENERATOR, secret, MODULUS)), "hex");
  return { secret, publicKey: publicKey.toString("base64") };
}

function derivePassword(input: ProofInput, salt: Buffer): Buffer {
  const hashed = digest(Buffer.from(input.password, "utf8"));
  const prepared = input.protocol === "s2k_fo" ? Buffer.from(hashed.toString("hex"), "utf8") : hashed;
  return pbkdf2Sync(prepared, salt, input.iterations, DERIVED_BYTES, "sha256");
}

export function createProof(input: ProofInput): Proof {
  const salt = Buffer.from(input.salt, "base64");
  const serverBytes = Buffer.from(input.serverPublicKey, "base64");
  const serverHex = serverBytes.toString("hex");
  if (serverHex.length > WIDTH) throw new Error("Apple sent an invalid sign-in challenge.");
  const serverPublic = BigInt(`0x${serverHex || "0"}`);
  if (serverPublic % MODULUS === 0n) throw new Error("Apple sent an invalid sign-in challenge.");

  const clientPublic = modPow(GENERATOR, input.secret, MODULUS);
  const clientHex = evenHex(clientPublic);
  const saltHex = salt.toString("hex");
  const derivedHex = derivePassword(input, salt).toString("hex");

  const x = BigInt(`0x${hashHex(saltHex + hashHex(`3a${derivedHex}`))}`);
  const k = paddedHash(MODULUS_HEX, evenHex(GENERATOR));
  const u = paddedHash(clientHex, serverHex);
  if (u === 0n) throw new Error("Apple sent an invalid sign-in challenge.");

  const masked = (k * modPow(GENERATOR, x, MODULUS)) % MODULUS;
  const base = (((serverPublic - masked) % MODULUS) + MODULUS) % MODULUS;
  const sessionKey = hashHex(evenHex(modPow(base, input.secret + u * x, MODULUS)));

  const modulusHash = digest(Buffer.from(MODULUS_HEX, "hex"));
  const generatorHash = digest(Buffer.from(evenHex(GENERATOR).padStart(WIDTH, "0"), "hex"));
  const mixed = Buffer.from(modulusHash.map((byte, index) => byte ^ generatorHash.readUInt8(index)));
  const accountHash = digest(Buffer.from(input.accountName, "utf8")).toString("hex");

  const m1 = hashHex(mixed.toString("hex") + accountHash + saltHex + clientHex + serverHex + sessionKey);
  const m2 = hashHex(clientHex + m1 + sessionKey);
  return {
    m1: Buffer.from(m1, "hex").toString("base64"),
    m2: Buffer.from(m2, "hex").toString("base64"),
  };
}
