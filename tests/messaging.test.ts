import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesConversation, roomDeletionForConversation, roomUpdateForConversation } from "../src/lib/conversation";
import { conversationTopic } from "../src/lib/types";
import type { Conversation, Message, Profile } from "../src/lib/types";

const me = "00000000-0000-4000-8000-000000000001";
const peer = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";
const roomId = "00000000-0000-4000-8000-0000000000aa";
const otherRoomId = "00000000-0000-4000-8000-0000000000bb";
const profile: Profile = { id: peer, username: "quiet_user", bio: "", created_at: "2026-01-01T00:00:00Z" };
const roomConversation: Conversation = { kind: "room", room: { id: roomId, name: "quiet-room", visibility: "public", topic: "", owner_id: me, created_at: "2026-01-01T00:00:00Z" } };
const dmConversation: Conversation = { kind: "dm", peer: profile };

function message(overrides: Partial<Message>): Message {
  return { id: crypto.randomUUID(), room_id: null, recipient_id: null, sender_id: me, body: "hello", created_at: "2026-01-01T00:00:00Z", ...overrides };
}

describe("conversation message routing", () => {
  it("routes room messages only to their own room", () => {
    const own = message({ room_id: roomId });
    assert.equal(matchesConversation(own, roomConversation, me), true);
    assert.equal(matchesConversation(own, { kind: "room", room: { ...roomConversation.room, id: otherRoomId } }, me), false);
    assert.equal(matchesConversation(own, dmConversation, me), false);
    assert.equal(matchesConversation(own, null, me), false);
  });

  it("routes direct messages in both directions without mixing third parties", () => {
    const sent = message({ recipient_id: peer });
    const received = message({ sender_id: peer, recipient_id: me });
    assert.equal(matchesConversation(sent, dmConversation, me), true);
    assert.equal(matchesConversation(received, dmConversation, me), true);
    assert.equal(matchesConversation(message({ recipient_id: stranger }), dmConversation, me), false);
    assert.equal(matchesConversation(message({ sender_id: stranger, recipient_id: me }), dmConversation, me), false);
  });

  it("never treats a room message as a direct message", () => {
    assert.equal(matchesConversation(message({ room_id: roomId, recipient_id: peer }), dmConversation, me), false);
  });

  it("uses a stable, participant-ordered DM topic", () => {
    assert.equal(conversationTopic(dmConversation, me), `dm:${[me, peer].sort().join(":")}`);
    assert.equal(conversationTopic(roomConversation, me), `room:${roomId}`);
  });

  it("applies a room update only to the matching open room", () => {
    const updated = { ...roomConversation.room, topic: "quiet hours" };
    assert.deepEqual(roomUpdateForConversation(roomConversation, updated), updated);
    assert.equal(roomUpdateForConversation(dmConversation, updated), null);
    assert.equal(roomUpdateForConversation(null, updated), null);
    assert.equal(roomUpdateForConversation(roomConversation, { ...updated, id: otherRoomId }), null);
  });

  it("closes only the deleted room conversation", () => {
    assert.equal(roomDeletionForConversation(roomConversation, roomId), true);
    assert.equal(roomDeletionForConversation(dmConversation, roomId), false);
    assert.equal(roomDeletionForConversation(roomConversation, otherRoomId), false);
    assert.equal(roomDeletionForConversation(roomConversation, null), false);
  });
});
