import { afterEach, describe, expect, test } from "bun:test";
import {
  materialize,
  materializeDeep,
  portabilize,
  portabilizeDeep,
} from "../src/core/storage/paths.js";

const HOME = "/Users/testuser";
const prev = process.env.AEM_HOME;

function withHome(fn: () => void) {
  process.env.AEM_HOME = HOME;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.AEM_HOME;
    else process.env.AEM_HOME = prev;
  }
}

afterEach(() => {
  if (prev === undefined) delete process.env.AEM_HOME;
  else process.env.AEM_HOME = prev;
});

describe("path portability", () => {
  test("portabilize replaces whole-path values", () => {
    withHome(() => {
      expect(portabilize(`${HOME}/.codex/config.toml`)).toBe("~/.codex/config.toml");
      expect(portabilize(HOME)).toBe("~");
    });
  });

  test("portabilize replaces paths embedded in JSON strings", () => {
    withHome(() => {
      const value = `{"browser":"${HOME}/.codex/plugins/browser.mjs","sky":"@oai/sky"}`;
      expect(portabilize(value)).toBe(
        `{"browser":"~/.codex/plugins/browser.mjs","sky":"@oai/sky"}`,
      );
    });
  });

  test("portabilize does not mangle sibling users or unrelated strings", () => {
    withHome(() => {
      expect(portabilize(`${HOME}x/file`)).toBe(`${HOME}x/file`); // /Users/testuserx
      expect(portabilize("no paths here")).toBe("no paths here");
    });
  });

  test("materialize is the inverse for whole and embedded paths", () => {
    withHome(() => {
      expect(materialize("~/.codex/config.toml")).toBe(`${HOME}/.codex/config.toml`);
      expect(materialize("~")).toBe(HOME);
      expect(materialize(`{"browser":"~/.codex/plugins/b.mjs"}`)).toBe(
        `{"browser":"${HOME}/.codex/plugins/b.mjs"}`,
      );
      // ~ not followed by / is left alone
      expect(materialize("approx ~5 minutes")).toBe("approx ~5 minutes");
    });
  });

  test("round-trip: portabilize -> materialize is identity for path-bearing values", () => {
    withHome(() => {
      const samples = [
        `${HOME}/.codex/plugins/x.mjs`,
        `{"a":"${HOME}/.a","b":["${HOME}/.b"]}`,
        `--path=${HOME}/dir`,
      ];
      for (const s of samples) {
        expect(materialize(portabilize(s))).toBe(s);
      }
    });
  });

  test("deep variants walk nested structures", () => {
    withHome(() => {
      const input = {
        cmd: `${HOME}/bin/tool`,
        nested: { list: [`${HOME}/a`, "plain"] },
      };
      const portable = portabilizeDeep(input);
      expect(portable.cmd).toBe("~/bin/tool");
      expect(portable.nested.list).toEqual(["~/a", "plain"]);
      expect(materializeDeep(portable)).toEqual(input);
    });
  });
});
