"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Conversation = {
  id: string;
  guest_id: string;
  guest_name?: string;
  status: string;
  created_at: string;
  updated_at?: string;
  unread_count?: number;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_type: "guest" | "admin" | "system";
  message: string;
  is_read?: boolean;
  created_at: string;
};

export default function AdminDashboardPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      setLoading(true);
      setError("");

      const supabase = createSupabaseBrowserClient();

      // 1. Fetch conversations
      const { data: convData, error: convError } = await supabase
        .from("conversations")
        .select("id, guest_id, guest_name, status, created_at, updated_at")
        .order("updated_at", { ascending: false, nullsFirst: false });

      if (convError) throw convError;

      // 2. Fetch unread guest messages count
      const { data: unreadData, error: unreadError } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("sender_type", "guest")
        .eq("is_read", false);

      const unreadMap: Record<string, number> = {};
      if (unreadData) {
        unreadData.forEach((m) => {
          unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
        });
      }

      const formatted = (convData || []).map((c) => ({
        ...c,
        unread_count: unreadMap[c.id] || 0,
      }));

      setConversations(formatted);
    } catch (err) {
      console.error("Load conversations error:", err);
      setError("Unable to load conversations.");
    } finally {
      setLoading(false);
    }
  }

  /*
   * =========================================================
   * REALTIME: SORT TO TOP & INCREMENT UNREAD COUNT
   * =========================================================
   */
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel("admin-global-sync")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const newMsg = payload.new as Message;

          setConversations((prev) => {
            const targetIndex = prev.findIndex(
              (c) => c.id === newMsg.conversation_id
            );

            if (targetIndex === -1) {
              loadConversations();
              return prev;
            }

            const isCurrentChatOpen =
              selectedConversation?.id === newMsg.conversation_id;

            // Agar active chat khuli hai to read mark hoga, warna +1 badge
            const isGuestMsg = newMsg.sender_type === "guest";
            const currentUnread = prev[targetIndex].unread_count || 0;

            const updatedConv: Conversation = {
              ...prev[targetIndex],
              updated_at: newMsg.created_at,
              unread_count:
                isGuestMsg && !isCurrentChatOpen
                  ? currentUnread + 1
                  : currentUnread,
            };

            const filtered = prev.filter((c) => c.id !== newMsg.conversation_id);
            return [updatedConv, ...filtered];
          });

          // Agar wahi chat open hai to database mein foran read mark karein
          if (
            selectedConversation?.id === newMsg.conversation_id &&
            newMsg.sender_type === "guest"
          ) {
            await supabase
              .from("messages")
              .update({ is_read: true })
              .eq("id", newMsg.id);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const newConv = payload.new as Conversation;
          setConversations((prev) => {
            if (prev.some((c) => c.id === newConv.id)) return prev;
            return [{ ...newConv, unread_count: 0 }, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation]);

  /*
   * =========================================================
   * OPEN CONVERSATION (CLEAR NOTIFICATION BADGE)
   * =========================================================
   */
  async function openConversation(conversation: Conversation) {
    setSelectedConversation(conversation);
    setMessages([]);
    setLoadingMessages(true);
    setError("");

    // Local unread count 0 karein
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversation.id ? { ...c, unread_count: 0 } : c
      )
    );

    try {
      const supabase = createSupabaseBrowserClient();

      // Database mein messages mark as read karein
      await supabase
        .from("messages")
        .update({ is_read: true })
        .eq("conversation_id", conversation.id)
        .eq("sender_type", "guest")
        .eq("is_read", false);

      const { data, error: msgError } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_type, message, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (msgError) throw msgError;
      setMessages(data || []);
    } catch (err) {
      console.error("Load messages error:", err);
      setError("Unable to load messages.");
    } finally {
      setLoadingMessages(false);
    }
  }

  /*
   * =========================================================
   * ACTIVE CONVERSATION REALTIME
   * =========================================================
   */
  useEffect(() => {
    if (!selectedConversation) return;

    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`admin-active-chat-${selectedConversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConversation.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((current) => {
            if (current.some((m) => m.id === newMessage.id)) return current;
            return [...current, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation]);

  async function sendMessage() {
    const text = messageText.trim();
    if (!selectedConversation || !text || sending) return;

    try {
      setSending(true);
      const supabase = createSupabaseBrowserClient();

      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: selectedConversation.id,
          sender_type: "admin",
          message: text,
          is_read: true,
        })
        .select("id, conversation_id, sender_type, message, created_at")
        .single();

      if (insertError) {
        alert(`Admin message failed:\n${insertError.message}`);
        return;
      }

      if (data) {
        setMessages((current) => {
          if (current.some((m) => m.id === data.id)) return current;
          return [...current, data];
        });
      }

      setMessageText("");
    } catch (err) {
      console.error("Send admin message error:", err);
      alert("Message send nahi hua.");
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/admin";
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <header className="flex items-center justify-between bg-black px-6 py-4 text-white">
        <div>
          <h1 className="text-xl font-semibold">Admin Dashboard</h1>
          <p className="text-xs text-gray-400">Guest Chat Management</p>
        </div>

        <button
          onClick={logout}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-gray-200"
        >
          Logout
        </button>
      </header>

      <div className="mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl grid-cols-1 md:grid-cols-[340px_1fr]">
        <aside className="border-r bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <h2 className="font-semibold">Conversations</h2>
              <p className="text-xs text-gray-400">
                {conversations.length} conversation
                {conversations.length === 1 ? "" : "s"}
              </p>
            </div>

            <button
              onClick={loadConversations}
              className="rounded-lg border px-3 py-2 text-xs hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-[calc(100vh-140px)] overflow-y-auto">
            {loading ? (
              <div className="p-5 text-sm text-gray-500">Loading conversations...</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center">
                <div className="mb-2 text-3xl">💬</div>
                <p className="text-sm text-gray-500">No conversations yet.</p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const unread = conversation.unread_count || 0;
                const isSelected = selectedConversation?.id === conversation.id;

                return (
                  <button
                    key={conversation.id}
                    onClick={() => openConversation(conversation)}
                    className={`w-full border-b p-4 text-left transition hover:bg-gray-50 ${
                      isSelected
                        ? "bg-gray-100 border-l-4 border-l-black"
                        : "bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-900">
                        {conversation.guest_name || "Guest"}
                      </span>

                      <div className="flex items-center gap-2">
                        {/* UNREAD NOTIFICATION BADGE */}
                        {unread > 0 && (
                          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-green-500 px-1.5 text-[11px] font-bold text-white shadow">
                            {unread}
                          </span>
                        )}

                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                          {conversation.status}
                        </span>
                      </div>
                    </div>

                    <p className="mt-1 truncate text-xs text-gray-500">
                      ID: {conversation.guest_id.slice(0, 8)}...
                    </p>

                    <p className="mt-1 text-[11px] text-gray-400">
                      {new Date(
                        conversation.updated_at || conversation.created_at
                      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-73px)] flex-col bg-gray-50">
          {!selectedConversation ? (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <div className="mb-4 text-5xl">💬</div>
                <h2 className="text-lg font-semibold text-gray-700">Select a conversation</h2>
                <p className="mt-2 text-sm text-gray-400">Choose a guest conversation from the left.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b bg-white px-5 py-4">
                <h2 className="font-semibold text-gray-900">
                  {selectedConversation.guest_name ? `${selectedConversation.guest_name}'s Chat` : "Guest Chat"}
                </h2>
                <p className="mt-0.5 text-xs text-gray-400">
                  Session ID: {selectedConversation.guest_id}
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {loadingMessages ? (
                  <div className="text-center text-sm text-gray-400">Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-gray-400">No messages yet.</div>
                ) : (
                  messages.map((item) => {
                    if (item.sender_type === "system") {
                      return (
                        <div key={item.id} className="text-center text-xs text-gray-400">
                          {item.message}
                        </div>
                      );
                    }

                    const isAdmin = item.sender_type === "admin";

                    return (
                      <div
                        key={item.id}
                        className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                            isAdmin
                              ? "bg-black text-white"
                              : "bg-white text-gray-900 shadow-sm"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm">{item.message}</p>
                          <p className="mt-1 text-[10px] text-gray-400">
                            {isAdmin ? "You" : (selectedConversation.guest_name || "Guest")} •{" "}
                            {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t bg-white p-4">
                <div className="flex items-end gap-2">
                  <textarea
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Type your reply..."
                    rows={1}
                    maxLength={2000}
                    className="min-h-[46px] flex-1 resize-none rounded-xl border px-4 py-3 text-sm outline-none focus:border-black"
                  />

                  <button
                    onClick={sendMessage}
                    disabled={sending || !messageText.trim()}
                    className="rounded-xl bg-black px-5 py-3 text-sm text-white disabled:opacity-40"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  Enter to send • Shift + Enter for new line
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          {error}
        </div>
      )}
    </main>
  );
}