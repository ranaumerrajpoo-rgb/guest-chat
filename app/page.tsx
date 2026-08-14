"use client";

import { useEffect, useState } from "react";
import { getGuestSessionId } from "@/lib/guest-session";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Message = {
  id: string;
  conversation_id: string;
  sender_type: "guest" | "admin" | "system";
  message: string;
  created_at: string;
};

// 🔊 Audio Ringtone Synthesizer
function playMessageTone() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(830.61, ctx.currentTime + 0.12);

    osc2.frequency.setValueAtTime(659.25, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(830.61, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.error("Audio playback error:", e);
  }
}

// 📲 Mobile Notification Bar Trigger
function triggerMobileNotification(messageText: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  if (Notification.permission === "granted") {
    // Agar Service Worker register hai to uske zariye notification dikhayein
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification("Aqsa Service Provider", {
          body: messageText,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          vibrate: [200, 100, 200],
          tag: "chat-reply",
        } as NotificationOptions);
      });
    } else {
      // Fallback normal Notification
      new Notification("Aqsa Service Provider", {
        body: messageText,
        icon: "/favicon.ico",
      });
    }
  }
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [guestId, setGuestId] = useState("");
  const [conversationId, setConversationId] = useState("");

  const [guestName, setGuestName] = useState("");
  const [nameSubmitted, setNameSubmitted] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");

  const [status, setStatus] = useState("Enter your name");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  // 🔔 Register Service Worker & Ask for Mobile Notification Permission
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.log("Service Worker registration failed:", err);
      });
    }
  }, []);

  /*
   * =========================================================
   * START GUEST SESSION & ASK PERMISSION
   * =========================================================
   */
  async function startGuestSession() {
    const name = guestName.trim();
    if (!name) return;

    // Ask for Notification permission on button click
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }

    try {
      setStatus("Connecting...");
      const id = getGuestSessionId();
      setSessionId(id);

      const response = await fetch("/api/guest/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: id,
          guest_name: name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to connect");
      }

      setGuestId(data.guest_id || "");
      setConversationId(data.conversation_id || "");
      setGuestName(data.guest_name || name);
      setNameSubmitted(true);
      setStatus("Online");
    } catch (error) {
      console.error("Guest connection error:", error);
      setStatus("Offline");
      alert("Connection failed. Please try again.");
    }
  }

  function openChat() {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
    setChatOpen(true);
  }

  /*
   * =========================================================
   * CONNECT EXISTING GUEST SESSION
   * =========================================================
   */
  useEffect(() => {
    async function connectGuest() {
      try {
        const id = getGuestSessionId();
        setSessionId(id);

        const response = await fetch("/api/guest/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: id }),
        });

        const data = await response.json();

        if (response.ok && data.conversation_id) {
          setGuestId(data.guest_id || "");
          setConversationId(data.conversation_id || "");

          if (data.guest_name) {
            setGuestName(data.guest_name);
            setNameSubmitted(true);
            setStatus("Online");
          }
        }
      } catch (error) {
        console.error("Existing guest connection error:", error);
      }
    }

    connectGuest();
  }, []);

  /*
   * =========================================================
   * LOAD EXISTING MESSAGES
   * =========================================================
   */
  useEffect(() => {
    if (!conversationId) return;

    async function loadMessages() {
      try {
        setChatLoading(true);
        const supabase = createSupabaseBrowserClient();

        const { data, error } = await supabase
          .from("messages")
          .select("id, conversation_id, sender_type, message, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        setMessages((data || []) as Message[]);
      } catch (error) {
        console.error("Load guest messages error:", error);
      } finally {
        setChatLoading(false);
      }
    }

    loadMessages();
  }, [conversationId]);

  /*
   * =========================================================
   * REALTIME: ADMIN MESSAGE -> SOUND + MOBILE NOTIFICATION BAR
   * =========================================================
   */
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`guest-chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;

          // 📲 Admin reply par Sound + Mobile Notification Bar popup
          if (newMessage.sender_type === "admin") {
            playMessageTone();
            triggerMobileNotification(newMessage.message);
          }

          setMessages((current) => {
            const alreadyExists = current.some(
              (message) => message.id === newMessage.id
            );
            if (alreadyExists) return current;
            return [...current, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  /*
   * =========================================================
   * SEND GUEST MESSAGE
   * =========================================================
   */
  async function sendMessage() {
    const text = messageText.trim();
    if (!text || !sessionId || sending || !conversationId) return;

    setSending(true);

    try {
      const response = await fetch("/api/guest/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to send message");
      }

      if (data.message) {
        setMessages((current) => {
          if (current.some((m) => m.id === data.message.id)) return current;
          return [...current, data.message];
        });
      }

      setMessageText("");
    } catch (error) {
      console.error("Send guest message error:", error);
      alert("Message send nahi hua. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  useEffect(() => {
    const element = document.getElementById("aqsa-chat-messages");
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  return (
    <main className="min-h-screen bg-[#fff8fb] text-[#24152d]">
      {/* NAME POPUP */}
      {!nameSubmitted && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#f8e2eb] text-3xl">
                A
              </div>
              <h2 className="mt-5 font-serif text-3xl text-[#32113f]">
                Welcome to Aqsa
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Before we get started, please tell us your name.
              </p>
            </div>

            <div className="mt-6">
              <label
                htmlFor="guest-name"
                className="mb-2 block text-sm font-medium text-[#32113f]"
              >
                Your name
              </label>

              <input
                id="guest-name"
                type="text"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    startGuestSession();
                  }
                }}
                placeholder="Enter your name"
                maxLength={100}
                autoFocus
                className="w-full rounded-2xl border border-[#e5d8df] bg-[#fffafd] px-4 py-3.5 text-sm text-gray-900 outline-none transition focus:border-[#a45b7d] focus:ring-2 focus:ring-[#a45b7d]/10"
              />

              <button
                onClick={startGuestSession}
                disabled={!guestName.trim() || status === "Connecting..."}
                className="mt-4 w-full rounded-2xl bg-[#32113f] px-5 py-3.5 font-semibold text-white transition hover:bg-[#4a1758] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "Connecting..." ? "Connecting..." : "Continue"}
              </button>

              <p className="mt-3 text-center text-[11px] text-gray-400">
                No account or login required.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* NAVBAR */}
      <nav className="fixed left-0 right-0 top-0 z-40 border-b border-white/20 bg-[#32113f]/95 text-white backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <a href="#home" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e8bd72] bg-[#5b1d68] text-xl font-serif text-[#f5d18d]">
              A
            </div>
            <div>
              <div className="font-serif text-xl font-semibold tracking-wide">
                Aqsa
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-[#e8bd72]">
                Service Provider
              </div>
            </div>
          </a>

          <div className="hidden items-center gap-7 text-sm md:flex">
            <a href="#home" className="transition hover:text-[#f0c780]">Home</a>
            <a href="#services" className="transition hover:text-[#f0c780]">Services</a>
            <a href="#about" className="transition hover:text-[#f0c780]">About</a>
            <a href="#reviews" className="transition hover:text-[#f0c780]">Reviews</a>
            <button
              onClick={openChat}
              className="rounded-full bg-[#e8bd72] px-5 py-2.5 font-semibold text-[#32113f] transition hover:bg-[#f5d18d]"
            >
              Chat With Us
            </button>
          </div>

          <button
            onClick={openChat}
            className="rounded-full bg-[#e8bd72] px-4 py-2 text-sm font-semibold text-[#32113f] md:hidden"
          >
            Chat
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section
        id="home"
        className="relative overflow-hidden bg-gradient-to-br from-[#32113f] via-[#5b1d68] to-[#8f3d75] pt-32 text-white"
      >
        <div className="absolute -left-24 top-32 h-72 w-72 rounded-full bg-[#e8bd72]/10 blur-3xl" />
        <div className="absolute -right-20 top-20 h-80 w-80 rounded-full bg-[#f4a6c8]/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 md:grid-cols-2 md:pb-28">
          <div>
            <div className="mb-5 inline-flex rounded-full border border-[#e8bd72]/40 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#f5d18d]">
              Premium Spa & Wellness
            </div>
            <h1 className="max-w-2xl font-serif text-5xl leading-[1.05] md:text-7xl">
              Your Peace,<br />
              <span className="text-[#f4a6c8]">Our Priority.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/75 md:text-lg">
              Welcome to Aqsa Service Provider — a peaceful space designed to help you relax, refresh and reconnect with yourself.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={openChat}
                className="rounded-full bg-[#e8bd72] px-7 py-3.5 font-semibold text-[#32113f] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#f5d18d]"
              >
                💬 Chat With Us
              </button>
              <a
                href="#services"
                className="rounded-full border border-white/30 bg-white/5 px-7 py-3.5 text-center font-medium backdrop-blur transition hover:bg-white/10"
              >
                Explore Services
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="relative mx-auto max-w-md overflow-hidden rounded-[2rem] border border-white/20 bg-white/10 p-3 shadow-2xl backdrop-blur">
              <div className="flex min-h-[470px] flex-col items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-[#f6c9d9] via-[#d88aac] to-[#6d285f] px-8 text-center">
                <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full border-2 border-[#f5d18d] bg-[#32113f]/80 font-serif text-6xl text-[#f5d18d] shadow-xl">
                  A
                </div>
                <p className="font-serif text-3xl text-white">Aqsa</p>
                <p className="mt-2 text-sm uppercase tracking-[0.35em] text-white/75">Service Provider</p>
                <div className="my-8 h-px w-24 bg-[#f5d18d]" />
                <p className="max-w-xs text-sm leading-6 text-white/80">Relax • Refresh • Reconnect</p>
                <button
                  onClick={openChat}
                  className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#32113f] shadow-lg"
                >
                  Talk to us
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="bg-[#fff8fb] px-5 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#a45b7d]">Our Services</p>
            <h2 className="mt-3 font-serif text-4xl text-[#32113f] md:text-5xl">Care designed around you</h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { icon: "🌸", title: "Relaxation Massage", text: "Unwind and let everyday stress fade away.", price: "Starting from $49" },
              { icon: "✨", title: "Premium Facial", text: "Refresh your skin with a gentle and luxurious facial.", price: "Starting from $39" },
              { icon: "🧖", title: "Body Wellness", text: "Give yourself dedicated time to relax and recharge.", price: "Starting from $59" },
            ].map((service) => (
              <div key={service.title} className="group rounded-3xl border border-[#ead8e2] bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f8e2eb] text-2xl">{service.icon}</div>
                <h3 className="mt-6 font-serif text-2xl text-[#32113f]">{service.title}</h3>
                <p className="mt-3 text-sm leading-6 text-gray-600">{service.text}</p>
                <div className="mt-5 flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#a45b7d]">{service.price}</span>
                  <button onClick={openChat} className="text-sm font-semibold text-[#32113f] underline underline-offset-4">Ask us</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FLOATING CHAT BUTTON */}
      {!chatOpen && (
        <button
          onClick={openChat}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full bg-[#32113f] px-5 py-3.5 text-white shadow-2xl transition hover:-translate-y-1 hover:bg-[#4a1758]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8bd72] text-lg text-[#32113f]">💬</span>
          <span className="hidden text-sm font-semibold sm:block">Chat with us</span>
          <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </button>
      )}

      {/* CHAT WINDOW */}
      {chatOpen && (
        <div className="fixed bottom-4 right-4 z-[60] flex h-[min(650px,calc(100vh-32px))] w-[calc(100vw-32px)] max-w-[390px] flex-col overflow-hidden rounded-3xl border border-[#e6d5df] bg-white shadow-2xl">
          <div className="bg-gradient-to-r from-[#32113f] to-[#7b326d] px-5 py-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e8bd72] bg-[#5b1d68] font-serif text-xl text-[#e8bd72]">
                  {guestName ? guestName.charAt(0).toUpperCase() : "A"}
                </div>
                <div>
                  <p className="font-semibold">
                    {guestName ? guestName : "Aqsa Service Provider"}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
                    <span className="h-2 w-2 rounded-full bg-green-400" />
                    <span>{status === "Online" ? "Online • Active" : status}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setChatOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg transition hover:bg-white/20"
              >
                ×
              </button>
            </div>
          </div>

          <div id="aqsa-chat-messages" className="flex-1 space-y-3 overflow-y-auto bg-[#fffafd] p-4">
            {chatLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading conversation...</div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f8e2eb] text-2xl">👋</div>
                  <h3 className="mt-4 font-serif text-xl text-[#32113f]">Welcome {guestName || "to Aqsa"}</h3>
                  <p className="mt-2 max-w-[240px] text-xs leading-5 text-gray-500">Hi {guestName}! How can we help you today?</p>
                </div>
              </div>
            ) : (
              messages.map((item) => {
                if (item.sender_type === "system") {
                  return (
                    <div key={item.id} className="text-center text-[10px] text-gray-400">
                      {item.message}
                    </div>
                  );
                }

                const isGuest = item.sender_type === "guest";

                return (
                  <div key={item.id} className={`flex ${isGuest ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${isGuest ? "rounded-br-md bg-[#32113f] text-white" : "rounded-bl-md bg-[#f1e8ee] text-gray-900"}`}>
                      <p className="whitespace-pre-wrap break-words">{item.message}</p>
                      <p className={`mt-1 text-[9px] ${isGuest ? "text-white/50" : "text-gray-400"}`}>
                        {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows={1}
                maxLength={2000}
                disabled={status !== "Online"}
                className="min-h-[45px] flex-1 resize-none rounded-2xl border border-[#e5d8df] bg-[#fffafd] px-4 py-3 text-sm outline-none transition focus:border-[#a45b7d] disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={sending || !messageText.trim() || status !== "Online"}
                className="flex h-[45px] w-[45px] items-center justify-center rounded-2xl bg-[#32113f] text-lg text-white transition hover:bg-[#4a1758] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? "..." : "➤"}
              </button>
            </div>
            <p className="mt-2 text-center text-[9px] text-gray-400">Enter to send • Shift + Enter for new line</p>
          </div>
        </div>
      )}
    </main>
  );
}