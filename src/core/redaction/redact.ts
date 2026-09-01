/**
 * Secret redaction. Secrets are treated as references, never as values.
 * Anything that looks like a secret is dropped before it can reach
 * snapshots, exports, stdout or audit logs.
 */

export const REDACTED = "redacted";

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|credential|apikey|api_key|auth|cookie|bearer|private)/i;

/** keys ending in KEY / _KEY etc. (avoid matching e.g. "keychain", "keymap") */
const KEY_SUFFIX_PATTERN = /(^|_|-)key$/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /^sk-[A-Za-z0-9_-]{10,}$/, // OpenAI / generic sk- keys
  /^sk-ant-[A-Za-z0-9_-]{10,}$/, // Anthropic
  /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/, // GitHub tokens
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack
  /^AKIA[0-9A-Z]{16}$/, // AWS access key id
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\./, // JWT
  /^AIza[0-9A-Za-z_-]{30,}$/, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || KEY_SUFFIX_PATTERN.test(key);
}

export function isSecretValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return SECRET_VALUE_PATTERNS.some((p) => p.test(value));
}

/** true when a key/value pair should be treated as a secret */
export function isSecret(key: string, value: unknown): boolean {
  if (isSecretValue(value)) return true;
  return isSecretKey(key) && typeof value === "string" && value.length > 0;
}

/**
 * Deep-redact an arbitrary object tree (used for preserved unknown fields).
 * Returns a copy; never mutates the input.
 */
export function redactDeep<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((v) => redactDeep(v)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v === "string" && isSecret(k, v)) {
        out[k] = REDACTED;
      } else if (isSecretValue(v)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as unknown as T;
  }
  if (typeof input === "string" && isSecretValue(input)) {
    return REDACTED as unknown as T;
  }
  return input;
}

/**
 * Scan a serialized document for secret-looking values; used as a final
 * guard before writing exports.
 */
export function containsSecretLooking(text: string): boolean {
  return SECRET_VALUE_PATTERNS.some((p) => {
    // strip anchors for a substring scan
    const src = p.source.replace(/^\^/, "").replace(/\$$/, "");
    return new RegExp(src).test(text);
  });
}
