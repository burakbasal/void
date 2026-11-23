import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bioSchema, emailSchema, messageSchema, passwordSchema,
  readableError, roomNameSchema, roomTopicSchema, TerminalError, usernameSchema,
} from "../src/lib/validation";

describe("identity validation", () => {
  it("normalizes emails and rejects invalid addresses", () => {
    assert.equal(emailSchema.parse("  Person@Example.com  "), "person@example.com");
    assert.equal(emailSchema.safeParse("not-an-address").success, false);
    assert.equal(emailSchema.safeParse("person@").success, false);
  });

  it("normalizes usernames and enforces database-compatible boundaries", () => {
    assert.equal(usernameSchema.parse("  Quiet_User  "), "quiet_user");
    assert.equal(usernameSchema.safeParse("abc").success, true);
    assert.equal(usernameSchema.safeParse("a".repeat(24)).success, true);
    for (const value of ["ab", "a".repeat(25), "1user", "quiet-user", "two users", "user!"]) {
      assert.equal(usernameSchema.safeParse(value).success, false, value);
    }
  });

  it("keeps password bytes intact and enforces length and nonempty-content bounds", () => {
    const password = "  A-valid-password-42!  ";
    assert.equal(passwordSchema.parse(password), password);
    assert.equal(passwordSchema.safeParse("Short1!").success, false);
    assert.equal(passwordSchema.safeParse(" ".repeat(12)).success, false);
    assert.equal(passwordSchema.safeParse("Aa1!" + "x".repeat(125)).success, false);
    assert.equal(passwordSchema.safeParse("Aa1!" + "x".repeat(124)).success, true);
  });
});

describe("conversation input validation", () => {
  it("normalizes room names without allowing slashes or SQL punctuation", () => {
    assert.equal(roomNameSchema.parse("  Quiet-Room  "), "quiet-room");
    assert.equal(roomNameSchema.safeParse("abc").success, true);
    assert.equal(roomNameSchema.safeParse("a".repeat(32)).success, true);
    for (const value of ["ab", "a".repeat(33), "1room", "quiet_room", "room/name", "x';drop table rooms;"]) {
      assert.equal(roomNameSchema.safeParse(value).success, false, value);
    }
  });

  it("rejects blank or overlong messages and retains message content", () => {
    assert.equal(messageSchema.parse("  hello\nthere  "), "hello\nthere");
    assert.equal(messageSchema.safeParse(" \n\t ").success, false);
    assert.equal(messageSchema.safeParse("x".repeat(4000)).success, true);
    assert.equal(messageSchema.safeParse("x".repeat(4001)).success, false);
    assert.equal(messageSchema.parse("<script>alert('text')</script>"), "<script>alert('text')</script>");
  });

  it("allows clearing a room topic and caps its displayed length", () => {
    assert.equal(roomTopicSchema.parse("   "), "");
    assert.equal(roomTopicSchema.parse("  A quiet room  "), "A quiet room");
    assert.equal(roomTopicSchema.safeParse("x".repeat(120)).success, true);
    assert.equal(roomTopicSchema.safeParse("x".repeat(121)).success, false);
  });

  it("allows removing a bio and caps the public profile text", () => {
    assert.equal(bioSchema.parse("   "), "");
    assert.equal(bioSchema.parse("  a few words  "), "a few words");
    assert.equal(bioSchema.safeParse("x".repeat(160)).success, true);
    assert.equal(bioSchema.safeParse("x".repeat(161)).success, false);
  });
});

describe("safe error messages", () => {
  it("gives useful feedback for constraint, permission, and auth failures", () => {
    assert.match(readableError({ code: "23505" }), /already in use/i);
    assert.match(readableError({ code: "42501" }), /permission/i);
    assert.match(readableError({ code: "invalid_credentials" }), /email or password/i);
    assert.match(readableError({ code: "email_not_confirmed" }), /confirm your email/i);
    assert.match(readableError({ status: 429 }), /too many requests/i);
    assert.match(readableError(new TypeError("Failed to fetch")), /connection interrupted/i);
  });

  it("does not expose raw backend text, credentials, or SQL details", () => {
    const backendMessage = "SQL INSERT failed with secret=credential-should-not-render";
    const shown = readableError({ code: "UNKNOWN", message: backendMessage });
    assert.doesNotMatch(shown, /credential-should-not-render|INSERT/);
    assert.match(readableError(null), /could not be completed/i);
  });

  it("shows explicitly authored terminal messages while redacting arbitrary Errors", () => {
    const message = "Use /create room-name public|private.";
    assert.equal(readableError(new TerminalError(message)), message);
    assert.notEqual(readableError(new Error(message)), message);
  });

  it("shows the first actionable validation error", () => {
    const result = messageSchema.safeParse(" ");
    assert.equal(result.success, false);
    if (!result.success) assert.match(readableError(result.error), /cannot be empty/i);
  });
});
