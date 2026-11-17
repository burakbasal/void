import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const usernameSchema = z.string().trim().toLowerCase().regex(
  /^[a-z][a-z0-9_]{2,23}$/,
  "Use 3–24 characters: start with a letter, then letters, numbers, or underscores.",
);

export const passwordSchema = z.string()
  .min(12, "Use a password with at least 12 characters.")
  .max(128, "Passwords may contain at most 128 characters.")
  .refine((password) => /\S/.test(password), "Use a password containing more than spaces.");

export const roomNameSchema = z.string().trim().toLowerCase().regex(
  /^[a-z][a-z0-9-]{2,31}$/,
  "Use 3–32 characters: start with a letter, then letters, numbers, or hyphens.",
);

export const messageSchema = z.string().trim()
  .min(1, "A message cannot be empty.")
  .max(4000, "Keep messages to 4,000 characters or fewer.");

export const bioSchema = z.string().trim().max(160, "Keep your bio to 160 characters or fewer.");

/** A message written by application code and safe to show verbatim in the terminal. */
export class TerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalError";
  }
}

const errorMessages: Record<string, string> = {
  "23505": "That name is already in use. Choose another.",
  "23503": "That user or room no longer exists.",
  "23514": "The input does not meet the allowed format or length.",
  "42501": "You do not have permission to do that.",
  "PGRST116": "That user or room could not be found.",
  "PGRST205": "The database schema is not installed. Apply the included Supabase migrations.",
  "PGRST202": "The database functions are not installed. Apply the included Supabase migrations.",
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed: "Confirm your email first, then log in.",
  email_address_not_authorized: "This development project's email service only sends to its account owner. A custom SMTP provider is required for other addresses.",
  user_already_exists: "An account with that email already exists. Try logging in.",
  email_exists: "An account with that email already exists. Try logging in.",
  weak_password: "That password is too weak. Use a longer, unique password.",
  over_email_send_rate_limit: "Too many email requests. Wait a few minutes before trying again.",
  over_request_rate_limit: "Too many requests. Wait a moment before trying again.",
  session_not_found: "Your session has ended. Log in again.",
  refresh_token_not_found: "Your session has ended. Log in again.",
  reauthentication_needed: "Password changes need a recent login. Use /cancel, then /reset and open the recovery link, or log out and log in again.",
  reauthentication_not_valid: "Password verification has expired. Use /cancel, then /reset and open a new recovery link.",
  reauth_nonce_missing: "Password changes need verification. Use /cancel, then /reset and open the recovery link.",
};

/** Never echo arbitrary backend responses: these can contain SQL, URLs, or credentials. */
export function readableError(error: unknown): string {
  if (error instanceof TerminalError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check your input and try again.";
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
    if (typeof value.code === "string" && errorMessages[value.code]) return errorMessages[value.code];
    const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
    if (value.status === 429 || /rate.?limit|too many|slow down/.test(message)) {
      return "Too many requests. Wait a moment before trying again.";
    }
    if (/room creation limit/.test(message)) return "Room creation limit reached. Delete unused rooms or try again later.";
    if (/invalid login credentials/.test(message)) return errorMessages.invalid_credentials;
    if (/email not confirmed/.test(message)) return errorMessages.email_not_confirmed;
    if (/failed to fetch|network|fetch failed|timeout|timed out|load failed/.test(message)) {
      return "Connection interrupted. Check your network and try again.";
    }
    if (/room not found|room does not exist|room unavailable/.test(message)) return "Room not found, or you do not have access.";
    if (/user not found|profile not found|user does not exist/.test(message)) return "User not found.";
    if (/already.*member/.test(message)) return "You are already a member of that room.";
    if (/owner.*leav|cannot leave.*owner/.test(message)) {
      return "Room owners cannot leave. Delete the room with /delete instead.";
    }
    if (/private room|invitation required/.test(message)) return "This room is private. Ask its owner for an invitation.";
    if (/permission|not authorized|not a member|access denied|only.*owner/.test(message)) return errorMessages["42501"];
    if (/cannot.*yourself|cannot.*self|choose another user to message/.test(message)) return "Choose another user to start a conversation.";
    if (/database error saving new user/.test(message)) {
      return "Registration could not be completed. The username may be taken; choose another and retry.";
    }
    if (/supabase.*configur|backend.*configur/.test(message)) return "Supabase is not configured. Add the project URL and public anon key to .env.local, then restart the server.";
    if (value.status === 401 || value.status === 403) return "Your session is unavailable or access was denied. Log in again.";
  }
  return "The request could not be completed. Please try again.";
}
