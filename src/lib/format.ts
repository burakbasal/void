import type { RoomListing, RoomMember } from "./types";

export function formatRoomListing(room: RoomListing): string {
  const state = room.joined ? "●" : "·";
  const members = `${room.member_count} ${room.member_count === 1 ? "member" : "members"}`;
  const owner = room.is_owner ? " · owner" : "";
  const topic = room.topic ? `  ${room.topic}` : "";
  return `${state} #${room.name.padEnd(32)} ${room.visibility.padEnd(7)} ${members.padEnd(10)} @${room.owner_username}${owner}${topic}`;
}

export function formatRoomMember(member: RoomMember, ownerId: string, onlineIds: ReadonlySet<string>, meId: string): string {
  const username = member.profile?.username ?? member.user_id.slice(0, 8);
  const flags = [
    member.user_id === ownerId ? "owner" : null,
    member.user_id === meId ? "you" : null,
    onlineIds.has(member.user_id) ? "online" : null,
  ].filter(Boolean).join(" · ") || "member";
  return `${onlineIds.has(member.user_id) ? "●" : "·"} @${username.padEnd(24)} ${flags}`;
}
