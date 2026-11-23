import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRoomListing, formatRoomMember } from "../src/lib/format";
import type { RoomListing, RoomMember } from "../src/lib/types";

const room: RoomListing = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "quiet-room",
  visibility: "public",
  topic: "A place to think.",
  owner_username: "owner",
  member_count: 3,
  joined: true,
  is_owner: true,
};

describe("group directory formatting", () => {
  it("shows joining, ownership, size, and topic without exposing IDs", () => {
    const line = formatRoomListing(room);
    assert.match(line, /^● #quiet-room/);
    assert.match(line, /public/);
    assert.match(line, /3 members/);
    assert.match(line, /@owner · owner/);
    assert.match(line, /A place to think\./);
    assert.equal(line.includes(room.id), false);
  });

  it("uses singular grammar and a neutral marker for available rooms", () => {
    const line = formatRoomListing({ ...room, joined: false, is_owner: false, member_count: 1, topic: "" });
    assert.match(line, /^· #quiet-room/);
    assert.match(line, /1 member /);
    assert.equal(line.includes("owner ·"), false);
    assert.equal(line.includes("A place to think"), false);
  });
});

describe("room member formatting", () => {
  const member: RoomMember = {
    room_id: room.id,
    user_id: "00000000-0000-4000-8000-000000000002",
    joined_at: "2026-01-01T00:00:00Z",
    profile: { id: "00000000-0000-4000-8000-000000000002", username: "member", bio: "", created_at: "2025-01-01T00:00:00Z" },
  };

  it("marks the signed-in owner and online presence", () => {
    const line = formatRoomMember(member, member.user_id, new Set([member.user_id]), member.user_id);
    assert.match(line, /^● @member/);
    assert.match(line, /owner · you · online/);
  });

  it("falls back safely when a profile is unavailable", () => {
    const line = formatRoomMember({ ...member, profile: undefined }, room.id, new Set(), "another-user");
    assert.match(line, /00000000/);
    assert.match(line, /member$/);
  });
});
