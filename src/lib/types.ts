export type Profile = {
  id: string;
  username: string;
  bio: string;
  created_at: string;
};

export type Room = {
  id: string;
  name: string;
  visibility: "public" | "private";
  owner_id: string;
  created_at: string;
};

export type Message = {
  id: string;
  room_id: string | null;
  recipient_id: string | null;
  sender_id: string;
  body: string;
  created_at: string;
  sender?: Profile;
};

export type Conversation =
  | { kind: "room"; room: Room }
  | { kind: "dm"; peer: Profile };

export type MessageCursor = Pick<Message, "created_at" | "id">;

export function conversationTopic(conversation: Conversation, userId: string): string {
  return conversation.kind === "room"
    ? `room:${conversation.room.id}`
    : `dm:${[userId, conversation.peer.id].sort().join(":")}`;
}
