import type { Conversation, Message } from "./types";

/** Whether a persisted message belongs to the currently open room or DM. */
export function matchesConversation(message: Message, conversation: Conversation | null, userId: string): boolean {
  if (!conversation) return false;
  if (conversation.kind === "room") return message.room_id === conversation.room.id;
  return !message.room_id && message.recipient_id !== null && (
    (message.sender_id === userId && message.recipient_id === conversation.peer.id) ||
    (message.sender_id === conversation.peer.id && message.recipient_id === userId)
  );
}
