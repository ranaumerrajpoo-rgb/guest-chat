const SESSION_KEY = "guest_chat_session_id";

export function getGuestSessionId(): string {
  if (typeof window === "undefined") {
    throw new Error("getGuestSessionId must run in the browser");
  }

  let sessionId = localStorage.getItem(SESSION_KEY);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  return sessionId;
}