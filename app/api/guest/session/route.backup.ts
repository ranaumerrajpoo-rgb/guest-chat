import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.session_id;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();

    // 1. Find existing guest
    const { data: existingGuest, error: guestFindError } =
      await supabase
        .from("guests")
        .select("id, session_id")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (guestFindError) {
      console.error("Guest lookup error:", guestFindError);

      return NextResponse.json(
        { error: "Unable to find guest", details: guestFindError.message },
        { status: 500 }
      );
    }

    let guest = existingGuest;

    // 2. Create guest if needed
    if (!guest) {
      const { data: newGuest, error: guestCreateError } =
        await supabase
          .from("guests")
          .insert({
            session_id: sessionId,
          })
          .select("id, session_id")
          .single();

      if (guestCreateError) {
        console.error("Guest creation error:", guestCreateError);

        return NextResponse.json(
          {
            error: "Unable to create guest",
            details: guestCreateError.message,
          },
          { status: 500 }
        );
      }

      guest = newGuest;
    }

    // Safety check
    if (!guest) {
      return NextResponse.json(
        { error: "Guest was not created" },
        { status: 500 }
      );
    }

    // 3. Find existing open conversation
    const { data: existingConversation, error: conversationFindError } =
      await supabase
        .from("conversations")
        .select("id, guest_id, status, created_at")
        .eq("guest_id", guest.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationFindError) {
      console.error(
        "Conversation lookup error:",
        conversationFindError
      );

      return NextResponse.json(
        {
          error: "Unable to find conversation",
          details: conversationFindError.message,
        },
        { status: 500 }
      );
    }

    let conversation = existingConversation;

    // 4. Create conversation
    if (!conversation) {
      const { data: newConversation, error: conversationCreateError } =
        await supabase
          .from("conversations")
          .insert({
            guest_id: guest.id,
            status: "open",
          })
          .select("id, guest_id, status, created_at")
          .single();

      if (conversationCreateError) {
        console.error(
          "Conversation creation error:",
          conversationCreateError
        );

        return NextResponse.json(
          {
            error: "Unable to create conversation",
            details: conversationCreateError.message,
          },
          { status: 500 }
        );
      }

      conversation = newConversation;
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation was not created" },
        { status: 500 }
      );
    }

    console.log("Guest session ready:", {
      guest_id: guest.id,
      conversation_id: conversation.id,
    });

    return NextResponse.json({
      guest_id: guest.id,
      conversation_id: conversation.id,
    });
  } catch (error) {
    console.error("Guest session API error:", error);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}