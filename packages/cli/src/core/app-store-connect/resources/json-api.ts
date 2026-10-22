import { isRecord } from "@/core/json";

export interface AscResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, unknown>;
}

export interface AscDocument {
  data: AscResource[];
  one: AscResource | null;
  included: AscResource[];
  next?: string;
}

const APPLE_ORIGIN = /^https:\/\/api\.appstoreconnect\.apple\.com/;

function parseResource(value: unknown): AscResource | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    type: typeof value.type === "string" ? value.type : "",
    attributes: isRecord(value.attributes) ? value.attributes : {},
    relationships: isRecord(value.relationships) ? value.relationships : {},
  };
}

function parseResources(value: unknown): AscResource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const resource = parseResource(item);
    return resource ? [resource] : [];
  });
}

export function parseDocument(raw: unknown): AscDocument {
  const body = isRecord(raw) ? raw : {};
  const links = isRecord(body.links) ? body.links : {};
  const next = typeof links.next === "string" ? links.next.replace(APPLE_ORIGIN, "") : undefined;
  return {
    data: Array.isArray(body.data) ? parseResources(body.data) : [],
    one: Array.isArray(body.data) ? null : (parseResource(body.data) ?? null),
    included: parseResources(body.included),
    ...(next ? { next } : {}),
  };
}

export function attribute(resource: AscResource, key: string): string | undefined {
  const value = resource.attributes[key];
  return typeof value === "string" ? value : undefined;
}

export function numberAttribute(resource: AscResource, key: string): number | undefined {
  const value = resource.attributes[key];
  return typeof value === "number" ? value : undefined;
}

function linkageOf(resource: AscResource, name: string): unknown {
  const relationship = resource.relationships[name];
  return isRecord(relationship) ? relationship.data : undefined;
}

export function relatedId(resource: AscResource, name: string): string | undefined {
  const data = linkageOf(resource, name);
  return isRecord(data) && typeof data.id === "string" ? data.id : undefined;
}


export function selectIncluded(document: AscDocument, type: string, id: string | undefined): AscResource | undefined {
  return document.included.find((resource) => resource.type === type && resource.id === id);
}

export function linkTo(type: string, id: string): { data: { type: string; id: string } } {
  return { data: { type, id } };
}

export function linkToMany(type: string, ids: readonly string[]): { data: { type: string; id: string }[] } {
  return { data: ids.map((id) => ({ type, id })) };
}

export function compact(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
}
