import { z } from "zod";
import { getSupabase } from "./supabase";
import { bioSchema, messageSchema, roomNameSchema, usernameSchema } from "./validation";
import type { Conversation, Message, MessageCursor, Profile, Room } from "./types";

const uuidSchema = z.string().uuid();
const cursorSchema = z.object({ id: uuidSchema, created_at: z.string().datetime({ offset: true }) });
export const MESSAGE_PAGE_SIZE = 50;

function one<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("User or room not found.");
  return row as T;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw error;
  return one<T>(data);
}

async function voidRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase().rpc(name, args);
  if (error) throw error;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  if (!data.session) throw { code: "session_not_found" };
  return data.session.user.id;
}

async function attachSenders(messages: Message[]): Promise<Message[]> {
  const ids = [...new Set(messages.map((message) => message.sender_id))];
  if (!ids.length) return messages;
  const { data, error } = await getSupabase().from("profiles").select("id,username,bio,created_at").in("id", ids);
  if (error) throw error;
  const senders = new Map((data as Profile[]).map((profile) => [profile.id, profile]));
  return messages.map((message) => ({ ...message, sender: senders.get(message.sender_id) }));
}

export const api = {
  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await getSupabase().from("profiles").select("id,username,bio,created_at").eq("id", uuidSchema.parse(userId)).maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  },

  async listRooms(): Promise<Room[]> {
    const { data, error } = await getSupabase().from("rooms").select("id,name,visibility,owner_id,created_at").order("name").limit(100);
    if (error) throw error;
    return data as Room[];
  },

  async listJoinedRooms(userId: string): Promise<Room[]> {
    const { data: memberships, error: memberError } = await getSupabase().from("room_members").select("room_id").eq("user_id", uuidSchema.parse(userId)).limit(1000);
    if (memberError) throw memberError;
    if (!memberships.length) return [];
    const { data, error } = await getSupabase().from("rooms").select("id,name,visibility,owner_id,created_at").in("id", memberships.map((member) => member.room_id)).order("name");
    if (error) throw error;
    return data as Room[];
  },

  async searchUsers(query = ""): Promise<Profile[]> {
    const prefix = z.string().trim().toLowerCase().max(24).regex(/^[a-z0-9_]*$/, "Search using letters, numbers, or underscores.").parse(query.replace(/^@/, ""));
    let request = getSupabase().from("profiles").select("id,username,bio,created_at").order("username").limit(50);
    // Escape LIKE metacharacters; underscore is a literal username character.
    if (prefix) request = request.ilike("username", `${prefix.replace(/_/g, "\\_")}%`);
    const { data, error } = await request;
    if (error) throw error;
    return data as Profile[];
  },

  createRoom(name: string, visibility: "public" | "private" = "public"): Promise<Room> {
    return rpc<Room>("create_room", { p_name: roomNameSchema.parse(name), p_visibility: z.enum(["public", "private"]).parse(visibility) });
  },

  joinRoom(name: string): Promise<Room> {
    return rpc<Room>("join_room", { p_name: roomNameSchema.parse(name) });
  },

  inviteToRoom(roomId: string, username: string): Promise<void> {
    return voidRpc("invite_to_room", { p_room_id: uuidSchema.parse(roomId), p_username: usernameSchema.parse(username) });
  },

  leaveRoom(roomId: string): Promise<void> {
    return voidRpc("leave_room", { p_room_id: uuidSchema.parse(roomId) });
  },

  deleteRoom(roomId: string): Promise<void> {
    return voidRpc("delete_room", { p_room_id: uuidSchema.parse(roomId) });
  },

  openDm(username: string): Promise<Profile> {
    return rpc<Profile>("open_dm", { p_username: usernameSchema.parse(username) });
  },

  updateProfile(username: string, bio: string): Promise<Profile> {
    return rpc<Profile>("update_profile", { p_username: usernameSchema.parse(username), p_bio: bioSchema.parse(bio) });
  },

  async getMessages(conversation: Conversation, before?: MessageCursor): Promise<Message[]> {
    let request = getSupabase().from("messages").select("id,room_id,recipient_id,sender_id,body,created_at");
    let participantsFilter: string | undefined;
    if (conversation.kind === "room") {
      request = request.eq("room_id", uuidSchema.parse(conversation.room.id));
    } else {
      const userId = uuidSchema.parse(await currentUserId());
      const peerId = uuidSchema.parse(conversation.peer.id);
      participantsFilter = `and(sender_id.eq.${userId},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${userId})`;
    }
    if (before) {
      const cursor = cursorSchema.parse(before);
      // Both ordered columns participate so messages sharing a timestamp are never skipped.
      const cursorFilter = `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
      request = request.or(participantsFilter ? `and(or(${participantsFilter}),or(${cursorFilter}))` : cursorFilter);
    } else if (participantsFilter) {
      request = request.or(participantsFilter);
    }
    const { data, error } = await request.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MESSAGE_PAGE_SIZE);
    if (error) throw error;
    return attachSenders((data as Message[]).reverse());
  },

  async sendMessage(conversation: Conversation, userId: string, body: string): Promise<Message> {
    const row = {
      sender_id: uuidSchema.parse(userId),
      body: messageSchema.parse(body),
      room_id: conversation.kind === "room" ? uuidSchema.parse(conversation.room.id) : null,
      recipient_id: conversation.kind === "dm" ? uuidSchema.parse(conversation.peer.id) : null,
    };
    // No optimistic success, automatic retries, timestamps, or client-generated IDs.
    const { data, error } = await getSupabase().from("messages").insert(row).select("id,room_id,recipient_id,sender_id,body,created_at").single();
    if (error) throw error;
    return one<Message>(data);
  },
};
