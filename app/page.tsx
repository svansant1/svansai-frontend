"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import AIHelper, { type ChatMessage } from "../components/AIHelper";
import { supabase } from "../lib/supabase";
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  replaceConversationMessages,
  type ConversationRecord,
} from "@/lib/db/chat-history";
import {
  logPageView,
  getTotalViews,
  hasVisitorBeenCounted,
} from "@/lib/db/engagement";

type AiUser = { id: string; email: string };
type MascotPosition = { x: number; y: number };

const SIDEBAR_KEY = "svansai-sidebar-collapsed";
const MASCOT_KEY = "svansai-mascot-position";
const ACTIVE_CONVERSATION_KEY = "svansai-active-conversation-id";
const VISITOR_ID_KEY = "svansai-visitor-id";

const clampMascotPosition = (
  position: MascotPosition,
  size: number,
): MascotPosition => {
  if (typeof window === "undefined") return position;

  const safePadding = 12;
  const maxX = Math.max(safePadding, window.innerWidth - size - safePadding);
  const maxY = Math.max(safePadding, window.innerHeight - size - safePadding);

  return {
    x: Math.max(safePadding, Math.min(position.x, maxX)),
    y: Math.max(safePadding, Math.min(position.y, maxY)),
  };
};

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);

  const [showLogin, setShowLogin] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const [isThinking, setIsThinking] = useState(false);
  const [lastThought, setLastThought] = useState("Ready to help.");

  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [initialMessages, setInitialMessages] = useState<
    ChatMessage[] | undefined
  >(undefined);

  const [mascotPosition, setMascotPosition] = useState<MascotPosition>({
    x: 18,
    y: 18,
  });
  const [dragging, setDragging] = useState(false);
  const [totalViews, setTotalViews] = useState(0);

  // ─── Ref tracks conversationId synchronously to prevent stale closures ────
  const activeConversationIdRef = useRef<string | null>(null);
  const creatingConversationRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const aiUser: AiUser | null = useMemo(() => {
    if (user?.id && user?.email) return { id: user.id, email: user.email };
    return null;
  }, [user]);

  // ─── Mobile detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const previousBodyOverflowY = document.body.style.overflowY;
    const previousHtmlOverflowY = document.documentElement.style.overflowY;

    document.body.style.overflowY = "hidden";
    document.documentElement.style.overflowY = "hidden";

    const updateLayout = () => {
      const mobile = window.innerWidth <= 768;
      const size = mobile ? 96 : 230;

      setIsMobile(mobile);
      setMascotPosition((current) => clampMascotPosition(current, size));
    };

    updateLayout();

    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);

    return () => {
      document.body.style.overflowY = previousBodyOverflowY;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, []);

  // ─── Restore sidebar + mascot ─────────────────────────────────────────────
  useEffect(() => {
    const collapsed = localStorage.getItem(SIDEBAR_KEY);
    setIsSidebarCollapsed(collapsed === "true");

    const size = isMobile ? 96 : 230;
    const fallbackPosition = isMobile
      ? { x: 14, y: Math.max(280, window.innerHeight - 150) }
      : { x: 24, y: Math.max(320, window.innerHeight - 280) };

    const saved = localStorage.getItem(MASCOT_KEY);

    if (!saved) {
      setMascotPosition(clampMascotPosition(fallbackPosition, size));
      return;
    }

    try {
      const parsed = JSON.parse(saved) as MascotPosition;
      setMascotPosition(clampMascotPosition(parsed, size));
    } catch {
      setMascotPosition(clampMascotPosition(fallbackPosition, size));
    }
  }, [isMobile]);

  // ─── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null),
    );
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ─── Unique visitor tracking ──────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      let visitorId = localStorage.getItem(VISITOR_ID_KEY);
      if (!visitorId) {
        visitorId = crypto.randomUUID();
        localStorage.setItem(VISITOR_ID_KEY, visitorId);
      }
      const sessionKey = "svansai-view-session-id";
      let sessionId = sessionStorage.getItem(sessionKey);
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem(sessionKey, sessionId);
      }
      const alreadyCounted = await hasVisitorBeenCounted(visitorId);
      if (!alreadyCounted) {
        await logPageView({
          path: "/",
          visitorId,
          sessionId,
          userId: null,
          userAgent: navigator.userAgent,
        });
      }
      const count = await getTotalViews();
      setTotalViews(count);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Robot thinking events ────────────────────────────────────────────────
  useEffect(() => {
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<{ message: string }>).detail;
      setIsThinking(true);
      setLastThought(d?.message || "Thinking it through...");
    };
    const onEnd = (e: Event) => {
      const d = (e as CustomEvent<{ message: string }>).detail;
      setTimeout(() => {
        setIsThinking(false);
        setLastThought(d?.message || "Ready to help.");
      }, 1800);
    };
    window.addEventListener("sv-thinking-start", onStart);
    window.addEventListener("sv-thinking-end", onEnd);
    return () => {
      window.removeEventListener("sv-thinking-start", onStart);
      window.removeEventListener("sv-thinking-end", onEnd);
    };
  }, []);

  // ─── Load conversations on login ──────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) {
      setConversations([]);
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setInitialMessages(undefined);
      return;
    }

    void (async () => {
      const rows = await listConversations(user.id);
      setConversations(rows);

      const savedId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
      if (savedId) {
        const msgs = await getConversationMessages(savedId);
        if (msgs.length > 0) {
          setActiveConversationId(savedId);
          activeConversationIdRef.current = savedId;
          setInitialMessages(msgs);
          return;
        }
      }

      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setInitialMessages(undefined);
    })();
  }, [user?.id]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem(MASCOT_KEY, JSON.stringify(mascotPosition));
  }, [mascotPosition]);

  // ─── Auth handlers ────────────────────────────────────────────────────────
  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
        });
        setAuthMessage(
          error
            ? error.message
            : "Account created. Check your email if confirmation is required.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });
        if (error) {
          setAuthMessage(error.message);
        } else {
          setShowLogin(false);
          setAuthMessage("");
          setEmail("");
          setPassword("");
        }
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setAuthBusy(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setAuthBusy(false);
      setAuthMessage(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    activeConversationIdRef.current = null;
  };

  const handleSubmitFeedback = async () => {
    if (!user) {
      setShowFeedback(false);
      setShowLogin(true);
      return;
    }
    if (!feedbackText.trim()) return;
    setFeedbackBusy(true);
    setFeedbackMessage("");
    const { error } = await supabase
      .from("feedback")
      .insert([
        { user_id: user.id, email: user.email, message: feedbackText.trim() },
      ]);
    if (error) {
      setFeedbackMessage(error.message);
    } else {
      setFeedbackMessage("Feedback sent. Thank you.");
      setFeedbackText("");
      setTimeout(() => {
        setShowFeedback(false);
        setFeedbackMessage("");
      }, 1200);
    }
    setFeedbackBusy(false);
  };

  // ─── Conversation save — called ONCE per send from AIHelper ───────────────
  // useCallback so it doesn't get recreated on every render
  // (a recreated function reference causes AIHelper's ref to go stale)
  const handleMessagesChange = useCallback(
    async (messages: ChatMessage[]) => {
      if (!aiUser) return;

      const firstUserMessage = messages.find(
        (m) => m.role === "user" && m.content.trim(),
      )?.content;
      if (!firstUserMessage) return;

      // Read ref synchronously — state would be stale here
      let conversationId = activeConversationIdRef.current;

      if (!conversationId) {
        // Prevent concurrent creation
        if (creatingConversationRef.current) return;
        creatingConversationRef.current = true;

        try {
          const created = await createConversation(aiUser.id, firstUserMessage);
          if (!created) return;
          conversationId = created.id;
          activeConversationIdRef.current = created.id;
          setActiveConversationId(created.id);
          localStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
        } finally {
          creatingConversationRef.current = false;
        }
      }

      await replaceConversationMessages(conversationId, messages);

      // Refresh sidebar list
      const rows = await listConversations(aiUser.id);
      setConversations(rows);
    },
    [aiUser],
  ); // aiUser is stable — only changes on login/logout

  const handleLoadConversation = async (conversationId: string) => {
    const msgs = await getConversationMessages(conversationId);
    setActiveConversationId(conversationId);
    activeConversationIdRef.current = conversationId;
    setInitialMessages(msgs);
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
    if (isMobile) setMobileSidebarOpen(false);
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setInitialMessages([
      { role: "assistant", content: "What would you like help with today?" },
    ]);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    if (isMobile) setMobileSidebarOpen(false);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    await deleteConversation(conversationId);
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    if (activeConversationIdRef.current === conversationId) handleNewChat();
  };

  // ─── Mascot drag ──────────────────────────────────────────────────────────
  const beginDrag = (clientX: number, clientY: number) => {
    setDragging(true);
    const startX = clientX - mascotPosition.x;
    const startY = clientY - mascotPosition.y;
    const move = (moveX: number, moveY: number) => {
      const size = isMobile ? 96 : 230;
      setMascotPosition(
        clampMascotPosition(
          {
            x: moveX - startX,
            y: moveY - startY,
          },
          size,
        ),
      );
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    };
    const end = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", end);
  };

  const robotSize = isMobile ? 96 : 230;

  const RobotMascot = ({ size }: { size: number }) => (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        pointerEvents: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.96 }}
        animate={{
          opacity: 1,
          y: isThinking ? [0, -4, 0] : 0,
          scale: 1,
        }}
        transition={{
          duration: isThinking ? 1.8 : 0.28,
          repeat: isThinking ? Infinity : 0,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: isMobile ? 2 : 20,
          left: isMobile ? size * 0.58 : size * 0.68,
          minWidth: isMobile ? 118 : 164,
          maxWidth: isMobile ? 150 : 230,
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.76))",
          border: "1px solid rgba(125,211,252,0.28)",
          borderRadius: "20px",
          padding: isMobile ? "8px 10px" : "12px 16px",
          color: "white",
          fontSize: isMobile ? "0.7rem" : "0.92rem",
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.35,
          backdropFilter: "blur(22px)",
          boxShadow:
            "0 14px 34px rgba(0,0,0,0.34), 0 0 24px rgba(56,189,248,0.12)",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: isMobile ? "-7px" : "-9px",
            top: isMobile ? "22px" : "28px",
            width: isMobile ? 14 : 18,
            height: isMobile ? 14 : 18,
            background: "rgba(15,23,42,0.88)",
            borderLeft: "1px solid rgba(125,211,252,0.28)",
            borderBottom: "1px solid rgba(125,211,252,0.28)",
            transform: "rotate(45deg)",
            pointerEvents: "none",
          }}
        />
        <motion.span
          aria-hidden="true"
          animate={{ opacity: [0.18, 0.45, 0.18] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, transparent, rgba(56,189,248,0.18), transparent)",
            pointerEvents: "none",
          }}
        />
        <span style={{ position: "relative", zIndex: 1 }}>{lastThought}</span>
      </motion.div>

      <motion.div
        aria-hidden="true"
        animate={{
          scale: isThinking ? [1, 1.18, 1] : [1, 1.08, 1],
          opacity: isThinking ? [0.5, 0.86, 0.5] : [0.34, 0.52, 0.34],
        }}
        transition={{
          duration: isThinking ? 1.8 : 4.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          inset: "18% 18% 10% 18%",
          background:
            "radial-gradient(circle, rgba(56,189,248,0.32), rgba(168,85,247,0.12) 48%, transparent 72%)",
          filter: isMobile ? "blur(20px)" : "blur(34px)",
          borderRadius: "999px",
          pointerEvents: "none",
        }}
      />

      <motion.div
        animate={{
          y: isThinking ? [0, -8, 0] : [0, -4, 0],
          rotate: isThinking ? [-1.4, 1.4, -1.4] : [0, 0.7, 0],
        }}
        transition={{
          duration: isThinking ? 1.6 : 3.8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "relative",
          width: size,
          height: size,
        }}
      >
        <Image
          src="/mascot/sv-robot.png"
          alt="SV Robot"
          width={size}
          height={size}
          priority
          style={{
            position: "relative",
            filter: isMobile
              ? "drop-shadow(0 0 24px rgba(56, 189, 248, 0.36))"
              : "drop-shadow(0 0 42px rgba(56, 189, 248, 0.42))",
            pointerEvents: "none",
          }}
        />
      </motion.div>

      <AnimatePresence>
        {isThinking &&
          [0, 1, 2].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{
                opacity: [0, 0.9, 0],
                y: isMobile ? -(28 + i * 12) : -(40 + i * 18),
                x: 10 + i * 12,
                scale: [0.6, 1, 0.88],
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                delay: i * 0.18,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                bottom: size * 0.4,
                left: size * 0.55,
                width: `${(isMobile ? 8 : 12) + i * (isMobile ? 3 : 5)}px`,
                height: `${(isMobile ? 8 : 12) + i * (isMobile ? 3 : 5)}px`,
                borderRadius: "999px",
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.96), rgba(125,211,252,0.68))",
                boxShadow:
                  "0 0 16px rgba(125,211,252,0.35), 0 0 28px rgba(56,189,248,0.18)",
                pointerEvents: "none",
              }}
            />
          ))}
      </AnimatePresence>
    </div>
  );

  const SidebarContent = () => (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "14px",
        }}
      >
        <div>
          <strong style={{ fontSize: "0.95rem", letterSpacing: "0.02em" }}>
            Chats
          </strong>
          <div
            style={{
              marginTop: "3px",
              fontSize: "0.72rem",
              color: "rgba(186,230,253,0.58)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Memory Stream
          </div>
        </div>

        {isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            style={{
              width: 34,
              height: 34,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "999px",
              color: "white",
              fontSize: "1.2rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Close chat sidebar"
          >
            ×
          </button>
        )}
      </div>

      <button
        onClick={handleNewChat}
        style={{
          width: "100%",
          marginBottom: "12px",
          padding: "12px",
          borderRadius: "14px",
          border: "1px solid rgba(56,189,248,0.26)",
          background:
            "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(168,85,247,0.12))",
          color: "white",
          cursor: "pointer",
          fontWeight: 800,
          fontSize: "1rem",
          boxShadow: "0 12px 28px rgba(14,165,233,0.12)",
        }}
      >
        + New Chat
      </button>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          overflowY: "auto",
          overflowX: "hidden",
          maxHeight: "calc(100vh - 150px)",
          paddingRight: "2px",
        }}
      >
        {conversations.length === 0 && (
          <div
            style={{
              padding: "14px",
              borderRadius: "14px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.035)",
              color: "rgba(255,255,255,0.58)",
              fontSize: "0.84rem",
              lineHeight: 1.5,
            }}
          >
            Your saved conversations will appear here after you start chatting.
          </div>
        )}

        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "stretch",
              minWidth: 0,
            }}
          >
            <button
              onClick={() => handleLoadConversation(conversation.id)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: "13px",
                border:
                  activeConversationId === conversation.id
                    ? "1px solid rgba(56,189,248,0.55)"
                    : "1px solid rgba(255,255,255,0.10)",
                background:
                  activeConversationId === conversation.id
                    ? "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(168,85,247,0.10))"
                    : "rgba(255,255,255,0.04)",
                color: "white",
                cursor: "pointer",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: "0.9rem",
                boxShadow:
                  activeConversationId === conversation.id
                    ? "0 10px 26px rgba(56,189,248,0.12)"
                    : "none",
              }}
              title={conversation.title}
            >
              {conversation.title}
            </button>

            <button
              onClick={() => handleDeleteConversation(conversation.id)}
              style={{
                padding: "10px 12px",
                borderRadius: "13px",
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.72)",
                cursor: "pointer",
                fontSize: "0.85rem",
                flexShrink: 0,
              }}
              aria-label={`Delete conversation ${conversation.title}`}
              title="Delete conversation"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );

  const desktopSidebarWidth = isSidebarCollapsed ? 72 : 300;

  return (
    <main
      style={{
        background:
          "radial-gradient(circle at top, rgba(14,165,233,0.22), transparent 34%), radial-gradient(circle at bottom left, rgba(168,85,247,0.18), transparent 34%), linear-gradient(135deg, #020617 0%, #07111f 42%, #111827 100%)",
        height: "100dvh",
        minHeight: "100dvh",
        width: "100%",
        maxWidth: "100vw",
        display: "flex",
        alignItems: "stretch",
        padding: 0,
        position: "relative",
        overflowX: "hidden",
        overflowY: "hidden",
        color: "white",
        boxSizing: "border-box",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 18%), radial-gradient(circle at 80% 30%, rgba(245,158,11,0.10), transparent 18%), radial-gradient(circle at 30% 80%, rgba(168,85,247,0.12), transparent 20%)",
          pointerEvents: "none",
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.026) 1px, transparent 1px)",
          backgroundSize: isMobile ? "34px 34px" : "46px 46px",
          maskImage:
            "radial-gradient(circle at center, black 0%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(circle at center, black 0%, transparent 78%)",
          opacity: 0.32,
          pointerEvents: "none",
        }}
      />

      <motion.div
        aria-hidden="true"
        animate={{
          x: [0, 34, -18, 0],
          y: [0, -22, 24, 0],
          scale: [1, 1.08, 0.96, 1],
        }}
        transition={{
          duration: 14,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          width: isMobile ? 180 : 360,
          height: isMobile ? 180 : 360,
          top: isMobile ? "7%" : "4%",
          right: isMobile ? "-70px" : "8%",
          borderRadius: "999px",
          background:
            "radial-gradient(circle, rgba(56,189,248,0.30), rgba(56,189,248,0.06) 45%, transparent 70%)",
          filter: "blur(18px)",
          opacity: 0.78,
          pointerEvents: "none",
        }}
      />

      <motion.div
        aria-hidden="true"
        animate={{
          x: [0, -26, 22, 0],
          y: [0, 26, -16, 0],
          scale: [1, 0.94, 1.1, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          width: isMobile ? 220 : 420,
          height: isMobile ? 220 : 420,
          bottom: isMobile ? "-112px" : "-150px",
          left: isMobile ? "-106px" : "9%",
          borderRadius: "999px",
          background:
            "radial-gradient(circle, rgba(168,85,247,0.26), rgba(168,85,247,0.06) 45%, transparent 70%)",
          filter: "blur(22px)",
          opacity: 0.78,
          pointerEvents: "none",
        }}
      />

      <motion.div
        aria-hidden="true"
        animate={{
          opacity: [0.1, 0.22, 0.1],
          rotate: [0, 3, 0],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          width: isMobile ? 240 : 520,
          height: isMobile ? 240 : 520,
          top: isMobile ? "36%" : "22%",
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: "999px",
          border: "1px solid rgba(125,211,252,0.18)",
          boxShadow:
            "inset 0 0 70px rgba(56,189,248,0.08), 0 0 90px rgba(56,189,248,0.06)",
          pointerEvents: "none",
        }}
      />

      {isMobile && user && (
        <button
          onClick={() => setMobileSidebarOpen(true)}
          style={{
            position: "fixed",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            background:
              "linear-gradient(135deg, rgba(56,189,248,0.28), rgba(168,85,247,0.16))",
            border: "1px solid rgba(56,189,248,0.42)",
            borderLeft: "none",
            borderRadius: "0 12px 12px 0",
            color: "white",
            padding: "12px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1rem",
            backdropFilter: "blur(14px)",
            boxShadow: "2px 0 18px rgba(14,165,233,0.22)",
          }}
          aria-label="Open chat sidebar"
        >
          ›
        </button>
      )}

      <AnimatePresence>
        {isMobile && mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.64)",
                zIndex: 55,
                backdropFilter: "blur(6px)",
              }}
            />

            <motion.div
              initial={{ x: -292 }}
              animate={{ x: 0 }}
              exit={{ x: -292 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                bottom: 0,
                width: 292,
                maxWidth: "calc(100vw - 28px)",
                background:
                  "linear-gradient(180deg, rgba(2,6,23,0.98), rgba(15,23,42,0.96))",
                borderRight: "1px solid rgba(125,211,252,0.14)",
                backdropFilter: "blur(30px)",
                padding: "20px 16px",
                boxSizing: "border-box",
                zIndex: 60,
                overflowY: "hidden",
                overflowX: "hidden",
                boxShadow: "18px 0 70px rgba(0,0,0,0.42)",
              }}
            >
              <SidebarContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {!isMobile && user && (
        <aside
          style={{
            width: desktopSidebarWidth,
            minWidth: desktopSidebarWidth,
            transition: "width 0.22s ease",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
            borderRight: "1px solid rgba(125,211,252,0.12)",
            backdropFilter: "blur(30px)",
            padding: "14px",
            boxSizing: "border-box",
            zIndex: 30,
            overflow: "hidden",
            position: "relative",
            boxShadow: "18px 0 70px rgba(0,0,0,0.18)",
            flexShrink: 0,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at top left, rgba(56,189,248,0.10), transparent 36%), radial-gradient(circle at bottom, rgba(168,85,247,0.08), transparent 34%)",
              pointerEvents: "none",
            }}
          />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isSidebarCollapsed ? "center" : "space-between",
                gap: "8px",
                marginBottom: "14px",
              }}
            >
              {!isSidebarCollapsed && (
                <div>
                  <strong style={{ fontSize: "0.95rem" }}>Chats</strong>
                  <div
                    style={{
                      marginTop: "3px",
                      fontSize: "0.68rem",
                      color: "rgba(186,230,253,0.54)",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Saved Sessions
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsSidebarCollapsed((v) => !v)}
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.035))",
                  border: "1px solid rgba(255,255,255,0.13)",
                  color: "white",
                  borderRadius: "12px",
                  padding: "8px 10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
                }}
                title={isSidebarCollapsed ? "Open" : "Collapse"}
                aria-label={
                  isSidebarCollapsed ? "Open sidebar" : "Collapse sidebar"
                }
              >
                {isSidebarCollapsed ? "›" : "‹"}
              </button>
            </div>

            <button
              onClick={handleNewChat}
              style={{
                width: "100%",
                marginBottom: "12px",
                padding: "12px",
                borderRadius: "14px",
                border: "1px solid rgba(56,189,248,0.28)",
                background:
                  "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(168,85,247,0.12))",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: isSidebarCollapsed ? "0.9rem" : "1rem",
                boxShadow: "0 12px 28px rgba(14,165,233,0.12)",
              }}
              title="New Chat"
            >
              {isSidebarCollapsed ? "+" : "New Chat"}
            </button>

            {!isSidebarCollapsed && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  overflowY: "auto",
                  overflowX: "hidden",
                  maxHeight: "calc(100vh - 128px)",
                  paddingRight: "2px",
                }}
              >
                {conversations.length === 0 && (
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "14px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.035)",
                      color: "rgba(255,255,255,0.58)",
                      fontSize: "0.84rem",
                      lineHeight: 1.5,
                    }}
                  >
                    Start a chat and your saved sessions will appear here.
                  </div>
                )}

                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    style={{
                      display: "flex",
                      gap: "6px",
                      alignItems: "stretch",
                      minWidth: 0,
                    }}
                  >
                    <button
                      onClick={() => handleLoadConversation(conversation.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: "13px",
                        border:
                          activeConversationId === conversation.id
                            ? "1px solid rgba(56,189,248,0.55)"
                            : "1px solid rgba(255,255,255,0.10)",
                        background:
                          activeConversationId === conversation.id
                            ? "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(168,85,247,0.10))"
                            : "rgba(255,255,255,0.04)",
                        color: "white",
                        cursor: "pointer",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        boxShadow:
                          activeConversationId === conversation.id
                            ? "0 10px 26px rgba(56,189,248,0.12)"
                            : "none",
                      }}
                      title={conversation.title}
                    >
                      {conversation.title}
                    </button>

                    <button
                      onClick={() => handleDeleteConversation(conversation.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "13px",
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.72)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      aria-label={`Delete conversation ${conversation.title}`}
                      title="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isSidebarCollapsed && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  overflowY: "auto",
                  overflowX: "hidden",
                  maxHeight: "calc(100vh - 128px)",
                }}
              >
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => handleLoadConversation(conversation.id)}
                    style={{
                      width: "100%",
                      padding: "10px",
                      borderRadius: "13px",
                      border:
                        activeConversationId === conversation.id
                          ? "1px solid rgba(56,189,248,0.55)"
                          : "1px solid rgba(255,255,255,0.10)",
                      background:
                        activeConversationId === conversation.id
                          ? "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(168,85,247,0.10))"
                          : "rgba(255,255,255,0.04)",
                      color: "white",
                      cursor: "pointer",
                      textAlign: "center",
                      fontSize: "1rem",
                      boxShadow:
                        activeConversationId === conversation.id
                          ? "0 10px 26px rgba(56,189,248,0.12)"
                          : "none",
                    }}
                    title={conversation.title}
                    aria-label={`Open conversation ${conversation.title}`}
                  >
                    💬
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          padding: isMobile
            ? "18px 14px 128px"
            : "28px clamp(20px, 4vw, 56px) 24px",
          boxSizing: "border-box",
          position: "relative",
          zIndex: 10,
          overflowY: "hidden",
          overflowX: "hidden",
        }}
      >
        <AnimatePresence>
          {showLogin && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(14px)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
                overflowX: "hidden",
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                style={{
                  background:
                    "linear-gradient(145deg, rgba(2,6,23,0.98), rgba(15,23,42,0.96))",
                  padding: isMobile ? "24px" : "34px",
                  borderRadius: "26px",
                  width: "100%",
                  maxWidth: "460px",
                  color: "white",
                  position: "relative",
                  boxShadow:
                    "0 24px 90px rgba(0,0,0,0.48), 0 0 44px rgba(56,189,248,0.10)",
                  border: "1px solid rgba(125,211,252,0.16)",
                  overflow: "hidden",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 34%)",
                    pointerEvents: "none",
                  }}
                />

                <button
                  onClick={() => {
                    setShowLogin(false);
                    setAuthMessage("");
                  }}
                  style={{
                    position: "absolute",
                    top: "14px",
                    right: "14px",
                    width: "34px",
                    height: "34px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.055)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 700,
                    zIndex: 2,
                  }}
                  aria-label="Close login modal"
                >
                  ×
                </button>

                <div style={{ position: "relative", zIndex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: "2rem", fontWeight: 900 }}>
                    {authMode === "signin" ? "Log In" : "Create Account"}
                  </h2>

                  <p
                    style={{
                      marginTop: "12px",
                      color: "rgba(255,255,255,0.82)",
                      lineHeight: 1.6,
                    }}
                  >
                    {authMode === "signin"
                      ? "Log in to keep your progress and use feedback."
                      : "Create an account to save your progress and use feedback."}
                  </p>

                  <div
                    style={{ display: "flex", gap: "10px", marginTop: "18px" }}
                  >
                    {(["signin", "signup"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setAuthMode(mode)}
                        style={{
                          flex: 1,
                          padding: "12px",
                          borderRadius: "13px",
                          border: "1px solid rgba(255,255,255,0.12)",
                          background:
                            authMode === mode
                              ? "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(168,85,247,0.12))"
                              : "rgba(255,255,255,0.04)",
                          color: "white",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {mode === "signin" ? "Sign In" : "Sign Up"}
                      </button>
                    ))}
                  </div>

                  <input
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle({ marginTop: "18px" })}
                    autoComplete="email"
                  />

                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEmailAuth();
                    }}
                    style={inputStyle({ marginTop: "12px" })}
                    autoComplete={
                      authMode === "signin"
                        ? "current-password"
                        : "new-password"
                    }
                  />

                  <button
                    onClick={handleEmailAuth}
                    disabled={authBusy}
                    style={{
                      marginTop: "16px",
                      width: "100%",
                      padding: "14px",
                      background: "linear-gradient(135deg, #38bdf8, #818cf8)",
                      color: "#020617",
                      border: "none",
                      borderRadius: "13px",
                      fontWeight: 900,
                      cursor: authBusy ? "not-allowed" : "pointer",
                      fontSize: "1rem",
                      boxShadow: "0 16px 34px rgba(56,189,248,0.22)",
                      opacity: authBusy ? 0.72 : 1,
                    }}
                  >
                    {authBusy
                      ? "Please wait..."
                      : authMode === "signin"
                        ? "Log In"
                        : "Create Account"}
                  </button>

                  <hr
                    style={{
                      margin: "22px 0",
                      borderColor: "rgba(255,255,255,0.12)",
                    }}
                  />

                  <button
                    onClick={() => handleOAuth("google")}
                    style={oauthButtonStyle()}
                  >
                    Continue with Google
                  </button>

                  <button
                    onClick={() => handleOAuth("apple")}
                    style={oauthButtonStyle({ marginTop: "10px" })}
                  >
                    Continue with Apple
                  </button>

                  {authMessage && (
                    <p
                      style={{
                        marginTop: "14px",
                        color: "#bae6fd",
                        lineHeight: 1.5,
                      }}
                    >
                      {authMessage}
                    </p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showFeedback && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.82)",
                backdropFilter: "blur(14px)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
                overflowX: "hidden",
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                style={{
                  background:
                    "linear-gradient(145deg, rgba(2,6,23,0.98), rgba(15,23,42,0.96))",
                  padding: isMobile ? "24px" : "34px",
                  borderRadius: "26px",
                  width: "100%",
                  maxWidth: "520px",
                  color: "white",
                  position: "relative",
                  boxShadow:
                    "0 24px 90px rgba(0,0,0,0.48), 0 0 44px rgba(168,85,247,0.10)",
                  border: "1px solid rgba(125,211,252,0.16)",
                  overflow: "hidden",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "radial-gradient(circle at top right, rgba(168,85,247,0.12), transparent 34%)",
                    pointerEvents: "none",
                  }}
                />

                <button
                  onClick={() => setShowFeedback(false)}
                  style={{
                    position: "absolute",
                    top: "14px",
                    right: "14px",
                    width: "34px",
                    height: "34px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.055)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 700,
                    zIndex: 2,
                  }}
                  aria-label="Close feedback modal"
                >
                  ×
                </button>

                <div style={{ position: "relative", zIndex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: "2rem", fontWeight: 900 }}>
                    Send Feedback
                  </h2>

                  <p
                    style={{
                      marginTop: "12px",
                      color: "rgba(255,255,255,0.82)",
                      lineHeight: 1.6,
                    }}
                  >
                    Have an idea to make SVANS-AI better? Send it here.
                  </p>

                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Type your suggestion here..."
                    style={{
                      width: "100%",
                      minHeight: "160px",
                      marginTop: "18px",
                      padding: "16px",
                      borderRadius: "15px",
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.055)",
                      color: "white",
                      boxSizing: "border-box",
                      outline: "none",
                      resize: "none",
                      lineHeight: 1.55,
                    }}
                  />

                  <button
                    onClick={handleSubmitFeedback}
                    disabled={feedbackBusy}
                    style={{
                      marginTop: "16px",
                      width: "100%",
                      padding: "14px",
                      background: "linear-gradient(135deg, #38bdf8, #818cf8)",
                      color: "#020617",
                      border: "none",
                      borderRadius: "13px",
                      fontWeight: 900,
                      cursor: feedbackBusy ? "not-allowed" : "pointer",
                      boxShadow: "0 16px 34px rgba(56,189,248,0.22)",
                      opacity: feedbackBusy ? 0.72 : 1,
                    }}
                  >
                    {feedbackBusy ? "Sending..." : "Submit Feedback"}
                  </button>

                  {feedbackMessage && (
                    <p
                      style={{
                        marginTop: "14px",
                        color: "#bae6fd",
                        lineHeight: 1.5,
                      }}
                    >
                      {feedbackMessage}
                    </p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
          style={{
            width: "100%",
            maxWidth: "min(1180px, calc(100vw - 32px))",
            margin: isMobile ? "0 auto 10px" : "0 auto 14px",
            minHeight: isMobile ? 138 : 218,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            position: "relative",
            zIndex: 12,
            pointerEvents: "none",
          }}
        >
          <RobotMascot size={isMobile ? 118 : 190} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          style={{
            background:
              "linear-gradient(135deg, rgba(14,165,233,0.16), rgba(255,255,255,0.055) 45%, rgba(168,85,247,0.11))",
            padding: isMobile ? "20px 16px 18px" : "34px 38px 30px",
            borderRadius: isMobile ? "24px" : "30px",
            backdropFilter: "blur(32px)",
            border: "1px solid rgba(125,211,252,0.24)",
            width: "100%",
            maxWidth: "min(1180px, calc(100vw - 32px))",
            margin: isMobile ? "0 auto 14px" : "0 auto 16px",
            textAlign: "center",
            position: "relative",
            zIndex: 10,
            boxShadow:
              "0 20px 70px rgba(14,165,233,0.12), 0 22px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.12)",
            overflow: "visible",
            isolation: "isolate",
            boxSizing: "border-box",
          }}
        >
          <motion.div
            aria-hidden="true"
            animate={{
              opacity: [0.22, 0.48, 0.22],
              scale: [1, 1.07, 1],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{
              position: "absolute",
              inset: "-28%",
              background:
                "radial-gradient(circle at 28% 18%, rgba(125,211,252,0.28), transparent 34%), radial-gradient(circle at 78% 24%, rgba(168,85,247,0.20), transparent 32%)",
              zIndex: -1,
              pointerEvents: "none",
            }}
          />

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, rgba(125,211,252,0.78), transparent)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: isMobile ? "static" : "absolute",
              top: isMobile ? undefined : "16px",
              right: isMobile ? undefined : "18px",
              display: "flex",
              gap: "8px",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-end",
              marginBottom: isMobile ? "16px" : 0,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "7px 12px",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.055)",
                color: "rgba(255,255,255,0.72)",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
              }}
              title="Total unique views"
            >
              <span>👁</span>
              <span>{totalViews.toLocaleString()}</span>
            </div>

            <button
              onClick={() => {
                if (!user) {
                  setShowLogin(true);
                } else {
                  setShowFeedback(true);
                }
              }}
              style={pillButtonStyle()}
            >
              Feedback
            </button>

            {user ? (
              <button onClick={handleLogout} style={pillButtonStyle()}>
                Log Out
              </button>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                style={pillButtonStyle()}
              >
                Login
              </button>
            )}
          </div>

          <motion.p
            animate={{ opacity: [0.68, 1, 0.68] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            style={{
              letterSpacing: isMobile ? "0.18em" : "0.28em",
              color: "#7dd3fc",
              fontWeight: "bold",
              fontSize: "9px",
              margin: isMobile ? "2px 0 10px" : "6px 0 10px",
              textShadow: "0 0 18px rgba(56,189,248,0.32)",
            }}
          >
            ONLINE AND READY
          </motion.p>

          <h1
            style={{
              fontSize: isMobile ? "2.2rem" : "clamp(3.1rem, 5.2vw, 4.8rem)",
              fontWeight: 950,
              margin: 0,
              lineHeight: 0.9,
              letterSpacing: 0,
              background:
                "linear-gradient(90deg, #f8fafc 0%, #bae6fd 34%, #38bdf8 68%, #d8b4fe 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
              display: "inline-block",
              textShadow: "0 0 34px rgba(56,189,248,0.24)",
            }}
          >
            SVANS-AI
          </h1>

          <p
            style={{
              margin: "14px auto 0",
              color: "rgba(255,255,255,0.86)",
              fontSize: isMobile ? "0.9rem" : "1rem",
              lineHeight: 1.55,
              fontWeight: 650,
              maxWidth: 520,
            }}
          >
            Clear answers, sharper thinking, and useful next steps.
          </p>

          <div
            style={{
              margin: "16px auto 0",
              display: "flex",
              justifyContent: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {["Reason", "Build", "Learn", "Debug"].map((item) => (
              <span
                key={item}
                style={{
                  padding: "7px 11px",
                  borderRadius: "999px",
                  border: "1px solid rgba(125,211,252,0.28)",
                  background: "rgba(15,23,42,0.28)",
                  color: "#bae6fd",
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  boxShadow: "0 10px 24px rgba(14,165,233,0.08)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, delay: 0.08, ease: "easeOut" }}
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025))",
            padding: isMobile ? "16px" : "34px",
            borderRadius: isMobile ? "24px" : "34px",
            backdropFilter: "blur(42px)",
            border: "1px solid rgba(125,211,252,0.12)",
            width: "100%",
            maxWidth: "min(1180px, calc(100vw - 32px))",
            margin: isMobile ? "12px auto 0" : "12px auto 0",
            minHeight: isMobile ? 0 : "clamp(560px, 72vh, 820px)",
            height: isMobile
              ? "calc(100dvh - 318px)"
              : "calc(100dvh - 376px)",
            position: "relative",
            zIndex: 10,
            boxShadow:
              "0 24px 90px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.07)",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(120deg, rgba(56,189,248,0.08), transparent 32%, rgba(168,85,247,0.075))",
              pointerEvents: "none",
            }}
          />

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, rgba(125,211,252,0.6), transparent)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              zIndex: 2,
              minWidth: 0,
              height: "100%",
            }}
          >
            <AIHelper
              user={aiUser}
              onRequestLogin={() => setShowLogin(true)}
              initialMessages={initialMessages}
              onMessagesChange={handleMessagesChange}
              conversationId={activeConversationId}
            />
          </div>
        </motion.div>

        <div
          style={{
            marginTop: "16px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.38)",
            letterSpacing: "0.08em",
            textAlign: "center",
            zIndex: 10,
            position: "relative",
          }}
        >
          SVANS-AI • Built by Shawn Vansant
        </div>
      </div>
    </main>
  );
}

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%",
    padding: "14px",
    borderRadius: "13px",
    border: "1px solid rgba(255,255,255,0.13)",
    background: "rgba(255,255,255,0.055)",
    color: "white",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "1rem",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
    ...extra,
  };
}

function oauthButtonStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px",
    borderRadius: "13px",
    border: "1px solid rgba(255,255,255,0.13)",
    background: "rgba(255,255,255,0.055)",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
    ...extra,
  };
}

function pillButtonStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.13)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))",
    color: "white",
    cursor: "pointer",
    fontSize: "12px",
    letterSpacing: "0.08em",
    fontWeight: 700,
    boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
    ...extra,
  };
}
