"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import AIHelper, { type ChatMessage } from "../components/AIHelper";
import { supabase } from "../lib/supabase";
import svRobot from "../mascot/sv-robot.png";
import {
  buildConversationTitle,
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  replaceConversationMessages,
  type ConversationRecord,
} from "@/lib/db/chat-history";

type AiUser = {
  id: string;
  email: string;
};

type MascotPosition = {
  x: number;
  y: number;
};

const SIDEBAR_KEY = "svansai-sidebar-collapsed";
const MASCOT_KEY = "svansai-mascot-position";

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

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [initialMessages, setInitialMessages] = useState<
    ChatMessage[] | undefined
  >(undefined);
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([]);

  const [mascotPosition, setMascotPosition] = useState<MascotPosition>({
    x: 18,
    y: 18,
  });
  const [dragging, setDragging] = useState(false);

  const aiUser: AiUser | null = useMemo(() => {
    if (user?.id && user?.email) {
      return { id: user.id, email: user.email };
    }
    return null;
  }, [user]);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const collapsed = localStorage.getItem(SIDEBAR_KEY);
    setIsSidebarCollapsed(collapsed === "true");

    const saved = localStorage.getItem(MASCOT_KEY);
    if (saved) {
      try {
        setMascotPosition(JSON.parse(saved));
      } catch {
        // ignore
      }
    } else {
      setMascotPosition(isMobile ? { x: 10, y: 12 } : { x: 18, y: 18 });
    }
  }, [isMobile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      setIsThinking(true);
      setLastThought(detail?.message || "Thinking it through...");
    };

    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      setTimeout(() => {
        setIsThinking(false);
        setLastThought(detail?.message || "Ready to help.");
      }, 1800);
    };

    window.addEventListener("sv-thinking-start", onStart);
    window.addEventListener("sv-thinking-end", onEnd);

    return () => {
      window.removeEventListener("sv-thinking-start", onStart);
      window.removeEventListener("sv-thinking-end", onEnd);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setConversations([]);
      setActiveConversationId(null);
      setInitialMessages(undefined);
      return;
    }

    void loadConversationList(user.id);
    setActiveConversationId(null);
    setInitialMessages(undefined);
  }, [user?.id]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem(MASCOT_KEY, JSON.stringify(mascotPosition));
  }, [mascotPosition]);

  const loadConversationList = async (userId: string) => {
    const rows = await listConversations(userId);
    setConversations(rows);
  };

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
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthBusy(false);
      setAuthMessage(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
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

    const { error } = await supabase.from("feedback").insert([
      {
        user_id: user.id,
        email: user.email,
        message: feedbackText.trim(),
      },
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

  const handleMessagesChange = async (messages: ChatMessage[]) => {
    setCurrentMessages(messages);

    if (!aiUser) return;

    let conversationId = activeConversationId;

    if (!conversationId) {
      const created = await createConversation(
        aiUser.id,
        messages.find((m) => m.role === "user")?.content,
      );
      if (!created) return;

      conversationId = created.id;
      setActiveConversationId(created.id);
      setConversations((prev) => [created, ...prev]);
    }

    await replaceConversationMessages(conversationId, messages);

    const firstUserMessage = messages.find((m) => m.role === "user")?.content;
    if (firstUserMessage) {
      const title = buildConversationTitle(firstUserMessage);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, title } : c)),
      );
    }

    if (aiUser?.id) {
      void loadConversationList(aiUser.id);
    }
  };

  const handleLoadConversation = async (conversationId: string) => {
    const msgs = await getConversationMessages(conversationId);
    setActiveConversationId(conversationId);
    setInitialMessages(msgs);
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setInitialMessages([
      {
        role: "assistant",
        content: "What would you like help with today?",
      },
    ]);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    await deleteConversation(conversationId);
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));

    if (activeConversationId === conversationId) {
      handleNewChat();
    }
  };

  const beginDrag = (clientX: number, clientY: number) => {
    setDragging(true);

    const startX = clientX - mascotPosition.x;
    const startY = clientY - mascotPosition.y;

    const move = (moveX: number, moveY: number) => {
      const maxX = window.innerWidth - (isMobile ? 96 : 230);
      const maxY = window.innerHeight - (isMobile ? 96 : 230);

      setMascotPosition({
        x: Math.max(0, Math.min(maxX, moveX - startX)),
        y: Math.max(0, Math.min(maxY, moveY - startY)),
      });
    };

    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) move(touch.clientX, touch.clientY);
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
  const bubbleBottom = isMobile ? robotSize + 14 : robotSize + 18;
  const bubbleMaxWidth = isMobile ? 118 : 180;

  const RobotMascot = ({ size }: { size: number }) => (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        cursor: dragging ? "grabbing" : "grab",
        pointerEvents: "auto",
        touchAction: "none",
      }}
      onMouseDown={(e) => beginDrag(e.clientX, e.clientY)}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        if (touch) beginDrag(touch.clientX, touch.clientY);
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          position: "absolute",
          bottom: bubbleBottom,
          left: 0,
          maxWidth: bubbleMaxWidth,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: "20px",
          padding: isMobile ? "7px 10px" : "10px 16px",
          color: "white",
          fontSize: isMobile ? "0.72rem" : "0.95rem",
          fontWeight: 600,
          textAlign: "center",
          lineHeight: 1.35,
          backdropFilter: "blur(18px)",
          boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
          whiteSpace: "normal",
          pointerEvents: "none",
        }}
      >
        {lastThought}
      </motion.div>

      <div
        style={{
          position: "absolute",
          inset: "20% 20% 12% 20%",
          background: "rgba(56, 189, 248, 0.14)",
          filter: isMobile ? "blur(20px)" : "blur(30px)",
          borderRadius: "999px",
        }}
      />

      <Image
        src={svRobot}
        alt="SV Robot"
        width={size}
        height={size}
        style={{
          position: "relative",
          filter: isMobile
            ? "drop-shadow(0 0 20px rgba(56, 189, 248, 0.28))"
            : "drop-shadow(0 0 30px rgba(56, 189, 248, 0.3))",
          pointerEvents: "none",
        }}
      />

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
                width: `${(isMobile ? 9 : 12) + i * (isMobile ? 4 : 5)}px`,
                height: `${(isMobile ? 9 : 12) + i * (isMobile ? 4 : 5)}px`,
                borderRadius: "999px",
                background: "rgba(255,255,255,0.75)",
                boxShadow: "0 0 14px rgba(255,255,255,0.18)",
                pointerEvents: "none",
              }}
            />
          ))}
      </AnimatePresence>
    </div>
  );

  const sidebarWidth = isSidebarCollapsed ? 72 : isMobile ? 260 : 300;

  return (
    <main
      style={{
        background:
          "radial-gradient(circle at top, rgba(14,165,233,0.18), transparent 35%), linear-gradient(135deg, #020617 0%, #0f172a 45%, #111827 100%)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "stretch",
        padding: "0",
        position: "relative",
        overflow: "hidden",
        color: "white",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 18%), radial-gradient(circle at 80% 30%, rgba(245,158,11,0.10), transparent 18%), radial-gradient(circle at 30% 80%, rgba(168,85,247,0.10), transparent 20%)",
          pointerEvents: "none",
        }}
      />

      {user && (
        <aside
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            transition: "width 0.2s ease",
            background: "rgba(255,255,255,0.03)",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(28px)",
            padding: "14px",
            boxSizing: "border-box",
            zIndex: 20,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginBottom: "14px",
            }}
          >
            {!isSidebarCollapsed && (
              <strong style={{ fontSize: "0.95rem" }}>Chats</strong>
            )}

            <button
              onClick={() => setIsSidebarCollapsed((v) => !v)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "white",
                borderRadius: "10px",
                padding: "8px 10px",
                cursor: "pointer",
              }}
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
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(56,189,248,0.16)",
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {isSidebarCollapsed ? "+" : "New Chat"}
          </button>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              overflowY: "auto",
              maxHeight: "calc(100vh - 120px)",
            }}
          >
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                style={{
                  display: "flex",
                  gap: "6px",
                  alignItems: "stretch",
                }}
              >
                <button
                  onClick={() => handleLoadConversation(conversation.id)}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border:
                      activeConversationId === conversation.id
                        ? "1px solid rgba(56,189,248,0.45)"
                        : "1px solid rgba(255,255,255,0.10)",
                    background:
                      activeConversationId === conversation.id
                        ? "rgba(56,189,248,0.14)"
                        : "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                  title={conversation.title}
                >
                  {isSidebarCollapsed ? "💬" : conversation.title}
                </button>

                {!isSidebarCollapsed && (
                  <button
                    onClick={() => handleDeleteConversation(conversation.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "12px",
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.04)",
                      color: "white",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: isMobile ? "14px 14px 140px" : "20px",
          boxSizing: "border-box",
          position: "relative",
          zIndex: 10,
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
                backdropFilter: "blur(12px)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                style={{
                  background: "#020617",
                  padding: isMobile ? "24px" : "34px",
                  borderRadius: "24px",
                  width: "100%",
                  maxWidth: "460px",
                  color: "white",
                  position: "relative",
                  boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
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
                    background: "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>

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
                  style={{
                    display: "flex",
                    gap: "10px",
                    marginTop: "18px",
                  }}
                >
                  {(["signin", "signup"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAuthMode(mode)}
                      style={{
                        flex: 1,
                        padding: "12px",
                        borderRadius: "12px",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background:
                          authMode === mode
                            ? "rgba(56,189,248,0.18)"
                            : "rgba(255,255,255,0.04)",
                        color: "white",
                        cursor: "pointer",
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
                />

                <button
                  onClick={handleEmailAuth}
                  disabled={authBusy}
                  style={{
                    marginTop: "16px",
                    width: "100%",
                    padding: "14px",
                    background: "#38bdf8",
                    color: "#020617",
                    border: "none",
                    borderRadius: "12px",
                    fontWeight: 800,
                    cursor: authBusy ? "not-allowed" : "pointer",
                    fontSize: "1rem",
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
                backdropFilter: "blur(12px)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                style={{
                  background: "#020617",
                  padding: isMobile ? "24px" : "34px",
                  borderRadius: "24px",
                  width: "100%",
                  maxWidth: "520px",
                  color: "white",
                  position: "relative",
                  boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
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
                    background: "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>

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
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    boxSizing: "border-box",
                    outline: "none",
                    resize: "none",
                  }}
                />

                <button
                  onClick={handleSubmitFeedback}
                  disabled={feedbackBusy}
                  style={{
                    marginTop: "16px",
                    width: "100%",
                    padding: "14px",
                    background: "#38bdf8",
                    color: "#020617",
                    border: "none",
                    borderRadius: "12px",
                    fontWeight: 800,
                    cursor: feedbackBusy ? "not-allowed" : "pointer",
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
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          style={{
            position: "fixed",
            left: mascotPosition.x,
            bottom: mascotPosition.y,
            zIndex: 40,
          }}
        >
          <RobotMascot size={robotSize} />
        </div>

        <div
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.03)",
            padding: isMobile ? "20px 20px 16px" : "40px",
            borderRadius: isMobile ? "24px" : "40px",
            backdropFilter: "blur(30px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            width: "100%",
            maxWidth: "900px",
            margin: "0 auto 16px",
            textAlign: "center",
            position: "relative",
            zIndex: 10,
            boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              position: isMobile ? "static" : "absolute",
              top: isMobile ? undefined : "20px",
              right: isMobile ? undefined : "25px",
              display: "flex",
              gap: "10px",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-end",
              marginBottom: isMobile ? "14px" : 0,
              flexWrap: "wrap",
            }}
          >
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

          <p
            style={{
              letterSpacing: "0.45em",
              color: "#38bdf8",
              fontWeight: "bold",
              fontSize: "10px",
              marginBottom: "12px",
            }}
          >
            NEURAL LINK ESTABLISHED
          </p>

          <h1
            style={{
              fontSize: isMobile ? "2rem" : "clamp(2.2rem, 7vw, 4.6rem)",
              fontWeight: 900,
              margin: 0,
              lineHeight: 1,
            }}
          >
            SVANS-AI
          </h1>

          <p
            style={{
              marginTop: "14px",
              color: "rgba(255,255,255,0.78)",
              fontSize: isMobile ? "0.9rem" : "1rem",
              lineHeight: 1.8,
            }}
          >
            Your AI Guide for Anything
          </p>
        </div>

        <div
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.02)",
            padding: isMobile ? "18px" : "50px",
            borderRadius: isMobile ? "24px" : "40px",
            backdropFilter: "blur(40px)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            width: "100%",
            maxWidth: "900px",
            margin: "0 auto",
            position: "relative",
            zIndex: 10,
            boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
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

        <div
          style={{
            marginTop: "16px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.35)",
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
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "white",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "1rem",
    ...extra,
  };
}

function oauthButtonStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "white",
    cursor: "pointer",
    ...extra,
  };
}

function pillButtonStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "white",
    cursor: "pointer",
    fontSize: "12px",
    letterSpacing: "0.08em",
    fontWeight: 600,
    ...extra,
  };
}
