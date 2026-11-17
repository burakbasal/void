import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand, tokenize } from "../src/lib/commands";

describe("terminal tokenization", () => {
  it("separates whitespace while preserving quoted values", () => {
    assert.deepEqual(tokenize('  /dm   quiet_user "hello there"  '), [
      "/dm", "quiet_user", "hello there",
    ]);
    assert.deepEqual(tokenize("/profile bio 'A place to think.'"), [
      "/profile", "bio", "A place to think.",
    ]);
  });

  it("preserves escaped whitespace and quote characters", () => {
    assert.deepEqual(tokenize('/dm user hello\\ world'), [
      "/dm", "user", "hello world",
    ]);
    assert.deepEqual(tokenize('/profile bio "say \\"hello\\""'), [
      "/profile", "bio", 'say "hello"',
    ]);
  });

  it("allows an explicitly empty argument", () => {
    assert.deepEqual(tokenize('/profile bio ""'), ["/profile", "bio", ""]);
  });

  it("rejects incomplete quotes instead of executing a partial command", () => {
    assert.throws(() => tokenize('/dm user "unfinished'));
    assert.throws(() => tokenize("/profile bio 'unfinished"));
    assert.throws(() => tokenize("/dm user trailing\\"));
  });
});

describe("terminal command parsing", () => {
  it("keeps ordinary messages and escaped slash messages out of command execution", () => {
    assert.equal(parseCommand("a message with /join in the middle"), null);
    assert.equal(parseCommand("hello"), null);
    assert.equal(parseCommand(""), null);
    assert.equal(parseCommand("//hello"), null);
  });

  it("returns an exact command and its arguments", () => {
    assert.deepEqual(parseCommand("/join quiet-room"), {
      name: "/join", args: ["quiet-room"],
    });
    assert.deepEqual(parseCommand('/dm user "hello there"'), {
      name: "/dm", args: ["user", "hello there"],
    });
    assert.deepEqual(parseCommand("/clear"), { name: "/clear", args: [] });
    assert.deepEqual(parseCommand("/HELP"), { name: "/help", args: [] });
  });
});
