/**
 * Shared utilities for extracting and parsing JSON from AI model responses.
 * AI responses often wrap JSON in markdown code fences or include surrounding text,
 * so we need robust extraction before parsing.
 */

/**
 * Strip markdown code fences and surrounding whitespace from a text string.
 * Returns empty string if input is empty.
 */
function stripCodeFence(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

/**
 * Extract the first JSON object from a text string.
 * Handles markdown code fences (```json ... ```) and surrounding text.
 * Returns the raw JSON string or the original text if no braces found.
 */
export function extractJsonObject(text: string): string {
  const withoutFence = stripCodeFence(text);
  if (!withoutFence) return '';

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return withoutFence.slice(start, end + 1);
  }
  return withoutFence;
}

/**
 * Extract the first JSON array from a text string.
 * Handles markdown code fences and surrounding text.
 */
export function extractJsonArray(text: string): string {
  const withoutFence = stripCodeFence(text);
  if (!withoutFence) return '';

  const start = withoutFence.indexOf('[');
  const end = withoutFence.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return withoutFence.slice(start, end + 1);
  }
  return withoutFence;
}

/**
 * Safely parse a JSON object from text, returning a fallback value on failure.
 */
export function safeParseJsonObject<T = unknown>(text: string, fallback: T): T {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safely parse a JSON array from text, returning a fallback value on failure.
 */
export function safeParseJsonArray<T = unknown>(text: string, fallback: T[]): T[] {
  const jsonStr = extractJsonArray(text);
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T[];
  } catch {
    return fallback;
  }
}
