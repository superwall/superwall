import type { ToolEffect } from "@/program/command";
import type { AscSession } from "./session";

export interface AscFlag {
  type: "string" | "number" | "boolean" | "list";
  describe: string;
  value?: string;
  required?: boolean;
  choices?: readonly string[];
}

export interface AscArg {
  name: string;
  describe: string;
  required?: boolean;
  choices?: readonly string[];
}

export interface AscInput {
  args: Record<string, string | undefined>;
  flags: Record<string, unknown>;
  yes: boolean;
}

export interface AscRow {
  label: string;
  meta: string;
}

export type AscOutput =
  | { rows: AscRow[]; data: unknown[]; noun: string }
  | { value: unknown; heading?: string };

export interface AscOperation {
  name: string;
  summary: string;
  details?: string;
  args?: readonly AscArg[];
  flags?: Readonly<Record<string, AscFlag>>;
  confirm?: boolean;
  effect: ToolEffect;
  run: (session: AscSession, input: AscInput) => Promise<AscOutput>;
}

export function textOf(input: AscInput, key: string): string | undefined {
  const value = input.flags[key];
  return typeof value === "string" ? value : undefined;
}

export function requireText(input: AscInput, key: string): string {
  const value = textOf(input, key);
  if (value === undefined) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
  return value;
}

export function numberOf(input: AscInput, key: string): number | undefined {
  const value = input.flags[key];
  return typeof value === "number" ? value : undefined;
}

export function requireNumber(input: AscInput, key: string): number {
  const value = numberOf(input, key);
  if (value === undefined) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
  return value;
}

export function listOf(input: AscInput, key: string): string[] {
  const value = input.flags[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function booleanOf(input: AscInput, key: string): boolean | undefined {
  const value = input.flags[key];
  return typeof value === "boolean" ? value : undefined;
}

export function argOf(input: AscInput, name: string): string {
  const value = input.args[name];
  if (value === undefined) throw new Error(`Missing <${name}>.`);
  return value;
}

export function plural(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ie` : noun}s`;
}
