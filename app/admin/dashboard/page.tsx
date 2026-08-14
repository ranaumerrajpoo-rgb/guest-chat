"use client"; 
 
import { useEffect, useState } from "react"; 
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"; 
 
type Conversation = { 
  id: string; 
  guest_id: string; 
  status: string; 
  created_at: string; 
}; 
 
type Message = { 
  id: string; 
  conversation_id: string; 
  sender_type: "guest" | "admin" | "system"; 
  message: string; 
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
 
      const { 
        data: { user }, 
      } = await supabase.auth.getUser(); 
 
      console.log("AUTH USER:", user); 
      console.log("AUTH USER ID:", user?.id); 
 
      const { data, error } = await supabase 
        .from("conversations") 
        .select("id, guest_id, status, created_at") 
        .order("created_at", { ascending: false }); 
 
      console.log("CONVERSATIONS:", data); 
      console.log("CONVERSATIONS ERROR:", error); 
 
      if (error) { 
        throw error; 
      } 
 
      setConversations(data || []); 
    } catch (error) { 
      console.error("Load conversations error:", error); 
      setError("Unable to load conversations."); 
    } finally { 
      setLoading(false); 
    } 
  } 
 
  async function openConversation(conversation: Conversation) { 
    setSelectedConversation(conversation); 
    setMessages([]); 
    setLoadingMessages(true); 
    setError(""); 
 
    try { 
      const supabase = createSupabaseBrowserClient(); 
 
      const { data, error } = await supabase 
        .from("messages") 
        .select( 
          "id, conversation_id, sender_type, message, created_at" 
        ) 
        .eq("conversation_id", conversation.id) 
        .order("created_at", { ascending: true }); 
 
      console.log("MESSAGES:", data); 
      console.log("MESSAGES ERROR:", error); 
 
      if (error) { 
        throw error; 
      } 
 
      setMessages(data || []); 
    } catch (error) { 
      console.error("Load messages error:", error); 
      setError("Unable to load messages."); 
    } finally { 
      setLoadingMessages(false); 
    } 
  } 
 
  useEffect(() => { 
    if (!selectedConversation) { 
      return; 
    } 
 
    const supabase = createSupabaseBrowserClient(); 
 
    const channel = supabase 
      .channel(`admin-messages-${selectedConversation.id}`) 
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
            if ( 
              current.some( 
                (message) => message.id === newMessage.id 
              ) 
            ) { 
              return current; 
            } 
 
            return [...current, newMessage]; 
          }); 
        } 
      ) 
      .subscribe((status) => { 
        console.log("Realtime status:", status); 
      }); 
 
    return () => { 
      supabase.removeChannel(channel); 
    }; 
  }, [selectedConversation]); 
 
 async function sendMessage() {
  console.log("🔥 ADMIN SEND CLICKED");

  const text = messageText.trim();

  console.log("🔥 ADMIN TEXT:", text);
  console.log(
    "🔥 SELECTED CONVERSATION:",
    selectedConversation
  );
  console.log("🔥 SENDING:", sending);

  if (!selectedConversation || !text || sending) {
    console.log("🔥 SEND BLOCKED");
    return;
  }

  try {
    setSending(true);

    const supabase = createSupabaseBrowserClient();

    console.log("🔥 SUPABASE CLIENT CREATED");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: selectedConversation.id,
        sender_type: "admin",
        message: text,
      })
      .select(
        "id, conversation_id, sender_type, message, created_at"
      )
      .single();

    console.log("🔥 ADMIN INSERT DATA:", data);
    console.log("🔥 ADMIN INSERT ERROR:", error);

    if (error) {
      console.error(
        "🔥 ADMIN MESSAGE INSERT ERROR:",
        error
      );

      alert(
        `Admin message failed:\n${error.message}\nCode: ${error.code}`
      );

      return;
    }

    if (!data) {
      alert(
        "Message insert hua lekin data return nahi hua."
      );

      return;
    }

    console.log(
      "✅ ADMIN MESSAGE SENT SUCCESSFULLY:",
      data
    );

    setMessages((current) => {
      if (
        current.some(
          (message) => message.id === data.id
        )
      ) {
        return current;
      }

      return [...current, data];
    });

    setMessageText("");
  } catch (error) {
    console.error(
      "🔥 SEND ADMIN MESSAGE ERROR:",
      error
    );

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
          <h1 className="text-xl font-semibold"> 
            Admin Dashboard 
          </h1> 
 
          <p className="text-xs text-gray-400"> 
            Guest Chat Management 
          </p> 
        </div> 
 
        <button 
          onClick={logout} 
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black" 
        > 
          Logout 
        </button> 
      </header> 
 
      <div className="mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl grid-cols-1 md:grid-cols-[340px_1fr]"> 
        <aside className="border-r bg-white"> 
          <div className="flex items-center justify-between border-b p-4"> 
            <div> 
              <h2 className="font-semibold"> 
                Conversations 
              </h2> 
 
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
              <div className="p-5 text-sm text-gray-500"> 
                Loading conversations... 
              </div> 
            ) : conversations.length === 0 ? ( 
              <div className="p-6 text-center"> 
                <div className="mb-2 text-3xl">💬</div> 
 
                <p className="text-sm text-gray-500"> 
                  No conversations yet. 
                </p> 
 
                <button 
                  onClick={loadConversations} 
                  className="mt-3 text-xs font-medium underline" 
                > 
                  Refresh 
                </button> 
              </div> 
            ) : ( 
              conversations.map((conversation) => ( 
                <button 
                  key={conversation.id} 
                  onClick={() => 
                    openConversation(conversation) 
                  } 
                  className={`w-full border-b p-4 text-left hover:bg-gray-50 ${ 
                    selectedConversation?.id === conversation.id 
                      ? "bg-gray-100" 
                      : "bg-white" 
                  }`} 
                > 
                  <div className="flex items-center justify-between"> 
                    <span className="text-sm font-semibold"> 
                      Guest 
                    </span> 
 
                    <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] text-green-700"> 
                      {conversation.status} 
                    </span> 
                  </div> 
 
                  <p className="mt-2 truncate text-xs text-gray-500"> 
                    {conversation.guest_id} 
                  </p> 
 
                  <p className="mt-2 text-[11px] text-gray-400"> 
                    {new Date( 
                      conversation.created_at 
                    ).toLocaleString()} 
                  </p> 
                </button> 
              )) 
            )} 
          </div> 
        </aside> 
 
        <section className="flex min-h-[calc(100vh-73px)] flex-col bg-gray-50"> 
          {!selectedConversation ? ( 
            <div className="flex flex-1 items-center justify-center text-center"> 
              <div> 
                <div className="mb-4 text-5xl">💬</div> 
 
                <h2 className="text-lg font-semibold text-gray-700"> 
                  Select a conversation 
                </h2> 
 
                <p className="mt-2 text-sm text-gray-400"> 
                  Choose a guest conversation from the left. 
                </p> 
              </div> 
            </div> 
          ) : ( 
            <> 
              <div className="border-b bg-white px-5 py-4"> 
                <h2 className="font-semibold"> 
                  Guest Chat 
                </h2> 
 
                <p className="mt-1 text-xs text-gray-400"> 
                  {selectedConversation.guest_id} 
                </p> 
              </div> 
 
              <div className="flex-1 space-y-3 overflow-y-auto p-5"> 
                {loadingMessages ? ( 
                  <div className="text-center text-sm text-gray-400"> 
                    Loading messages... 
                  </div> 
                ) : messages.length === 0 ? ( 
                  <div className="text-center text-sm text-gray-400"> 
                    No messages yet. 
                  </div> 
                ) : ( 
                  messages.map((item) => { 
                    if (item.sender_type === "system") { 
                      return ( 
                        <div 
                          key={item.id} 
                          className="text-center text-xs text-gray-400" 
                        > 
                          {item.message} 
                        </div> 
                      ); 
                    } 
 
                    const isAdmin = 
                      item.sender_type === "admin"; 
 
                    return ( 
                      <div 
                        key={item.id} 
                        className={`flex ${ 
                          isAdmin 
                            ? "justify-end" 
                            : "justify-start" 
                        }`} 
                      > 
                        <div 
                          className={`max-w-[75%] rounded-2xl px-4 py-3 ${ 
                            isAdmin 
                              ? "bg-black text-white" 
                              : "bg-white text-gray-900 shadow-sm" 
                          }`} 
                        > 
                          <p className="whitespace-pre-wrap break-words text-sm"> 
                            {item.message} 
                          </p> 
 
                          <p className="mt-1 text-[10px] text-gray-400"> 
                            {isAdmin ? "You" : "Guest"} •{" "} 
                            {new Date( 
                              item.created_at 
                            ).toLocaleTimeString()} 
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
                    onChange={(event) => 
                      setMessageText(event.target.value) 
                    } 
                    onKeyDown={(event) => { 
                      if ( 
                        event.key === "Enter" && 
                        !event.shiftKey 
                      ) { 
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
                    disabled={ 
                      sending || !messageText.trim() 
                    } 
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