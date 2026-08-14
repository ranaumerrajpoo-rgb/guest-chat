import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body.session_id;
    const message = body.message;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return NextResponse.json(
        { error: "message cannot be empty" },
        { status: 400 }
      );
    }

    if (cleanMessage.length > 2000) {
      return NextResponse.json(
        { error: "message is too long" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();

    // Find guest by session
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (guestError) {
      console.error("Guest lookup error:", guestError);

      return NextResponse.json(
        { error: "Unable to verify guest" },
        { status: 500 }
      );
    }

    if (!guest) {
      return NextResponse.json(
        { error: "Guest session not found" },
        { status: 401 }
      );
    }

    // Find guest's open conversation
    const { data: conversation, error: conversationError } =
      await supabase
        .from("conversations")
        .select("id")
        .eq("guest_id", guest.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationError) {
      console.error(
        "Conversation lookup error:",
        conversationError
      );

      return NextResponse.json(
        { error: "Unable to find conversation" },
        { status: 500 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Insert message
    const { data: newMessage, error: messageError } =
      await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_type: "guest",
          message: cleanMessage,
        })
        .select("id, conversation_id, sender_type, message, created_at")
        .single();

    if (messageError) {
      console.error("Message insert error:", messageError);

      return NextResponse.json(
        { error: "Unable to send message" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    console.error("Guest message API error:", error);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}