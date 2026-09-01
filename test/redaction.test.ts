import { describe, expect, test } from "bun:test";
import {
  containsSecretLooking,
  isSecret,
  isSecretKey,
  isSecretValue,
  redactDeep,
} from "../src/core/redaction/redact.js";

describe("redaction", () => {
  test("detects secret-looking keys", () => {
    expect(isSecretKey("GITHUB_TOKEN")).toBe(true);
    expect(isSecretKey("MORPH_API_KEY")).toBe(true);
    expect(isSecretKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretKey("DATABASE_PASSWORD")).toBe(true);
    expect(isSecretKey("ENABLED_TOOLS")).toBe(false);
    expect(isSecretKey("PORT")).toBe(false);
    expect(isSecretKey("keychain_path")).toBe(false);
  });

  test("detects secret-looking values regardless of key", () => {
    expect(isSecretValue("sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1")).toBe(true);
    expect(isSecretValue("ghp_abcdefghijklmnopqrstuvwx1234")).toBe(true);
    expect(isSecretValue("hello world")).toBe(false);
    expect(isSecretValue("node")).toBe(false);
  });

  test("isSecret combines key and value heuristics", () => {
    expect(isSecret("SOME_VALUE", "sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1")).toBe(true);
    expect(isSecret("API_KEY", "anything-non-empty")).toBe(true);
    expect(isSecret("TIMEOUT", "15")).toBe(false);
  });

  test("redactDeep removes secrets from nested structures", () => {
    const input = {
      env: { MORPH_API_KEY: "sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1", MODE: "fast" },
      nested: [{ token: "abc123" }],
    };
    const out = redactDeep(input);
    expect(out.env.MORPH_API_KEY).toBe("redacted");
    expect(out.env.MODE).toBe("fast");
    expect(out.nested[0]!.token).toBe("redacted");
    // input untouched
    expect(input.env.MORPH_API_KEY).toStartWith("sk-");
  });

  test("export guard detects embedded secrets in serialized text", () => {
    expect(
      containsSecretLooking("value: sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1"),
    ).toBe(true);
    expect(containsSecretLooking("value: redacted")).toBe(false);
  });
});
