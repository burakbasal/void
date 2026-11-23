import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMANDS, HELP_ENTRIES, formatHelp, parseCommand, tokenize } from "../src/lib/commands";

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

  it("parses group creation, invitation, and deletion arguments", () => {
    assert.deepEqual(parseCommand("/create quiet-room public"), {
      name: "/create", args: ["quiet-room", "public"],
    });
    assert.deepEqual(parseCommand('/create secret-room private "only for a few"'), {
      name: "/create", args: ["secret-room", "private", "only for a few"],
    });
    assert.deepEqual(parseCommand('/invite quiet_user'), {
      name: "/invite", args: ["quiet_user"],
    });
    assert.deepEqual(parseCommand('/kick quiet_user'), {
      name: "/kick", args: ["quiet_user"],
    });
    assert.deepEqual(parseCommand('/topic ""'), {
      name: "/topic", args: [""],
    });
    assert.deepEqual(parseCommand("/delete quiet-room"), {
      name: "/delete", args: ["quiet-room"],
    });
    for (const command of ["/create", "/join", "/members", "/topic", "/invite", "/kick", "/delete", "/dm", "/history"]) {
      assert.ok(COMMANDS.includes(command), `${command} is registered`);
    }
  });
});

describe("terminal help", () => {
  it("documents every registered command, including account commands", () => {
    const documented = new Set(HELP_ENTRIES.map(([command]) => command.split(" ")[0]));
    for (const command of COMMANDS) {
      assert.ok(documented.has(command), `${command} is documented`);
    }
  });

  it("formats command syntax and descriptions for the terminal", () => {
    const lines = formatHelp();
    assert.equal(lines.length, HELP_ENTRIES.length);
    assert.ok(lines.some(line => line.startsWith("/kick <username>\n  ")));
    assert.ok(lines.some(line => line.startsWith('/topic [text]\n  ')));
  });
});
