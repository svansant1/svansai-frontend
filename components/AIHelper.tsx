"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SavedUser = {
  email: string;
  password: string;
};

type AIHelperProps = {
  onSend: (messages: ChatMessage[]) => Promise<string>;
};

const GUEST_LIMIT = 5;

export default function AIHelper({ onSend }: AIHelperProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<SavedUser | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginDismissed, setLoginDismissed] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const storageKey = useMemo(() => {
    if (!user?.email) return null;
    return `svansai-chat-${user.email.trim().toLowerCase()}`;
  }, [user]);

  useEffect(() => {
    const savedUser = localStorage.getItem("svansai_user");

    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as SavedUser;
        setUser(parsed);
      } catch {
        // ignore bad local data
      }
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setMessages([
        {
          role: "assistant",
          content:
            "What would you like help with today? I can guide you step by step.",
        },
      ]);
      return;
    }

    if (!storageKey) return;

    const savedMessages = localStorage.getItem(storageKey);

    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages) as ChatMessage[];
        setMessages(parsed);
        return;
      } catch {
        // ignore bad saved history
      }
    }

    setMessages([
      {
        role: "assistant",
        content:
          "Welcome back. What would you like help with today? I can guide you step by step.",
      },
    ]);
  }, [user, storageKey]);

  useEffect(() => {
    if (!storageKey || !user) return;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey, user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSignup = () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) return;

    const newUser: SavedUser = {
      email: trimmedEmail,
      password: trimmedPassword,
    };

    localStorage.setItem("svansai_user", JSON.stringify(newUser));
    setUser(newUser);
    setShowLogin(false);
    setLoginDismissed(false);
    setEmail("");
    setPassword("");
  };

  const handleLogout = () => {
    localStorage.removeItem("svansai_user");
    setUser(null);
    setShowLogin(false);
    setLoginDismissed(false);
    setEmail("");
    setPassword("");
    setInput("");
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userCount = messages.filter((m) => m.role === "user").length;

    if (!user && userCount >= GUEST_LIMIT && !loginDismissed) {
      setShowLogin(true);
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: input.trim(),
      },
    ];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const reply = await onSend(nextMessages);

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: reply,
        },
      ]);
    } catch (error) {
      console.error(error);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            "I ran into a problem while trying to respond. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
                padding: "34px",
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
                  setLoginDismissed(true);
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
                aria-label="Close login modal"
              >
                ×
              </button>

              <h2
                style={{
                  margin: 0,
                  fontSize: "2rem",
                  fontWeight: 900,
                }}
              >
                Create Account
              </h2>

              <p
                style={{
                  marginTop: "12px",
                  color: "rgba(255,255,255,0.82)",
                  lineHeight: 1.6,
                }}
              >
                Save your conversations and continue learning.
              </p>

              <input
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "14px",
                  marginTop: "18px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: "14px",
                  marginTop: "12px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSignup();
                }}
              />

              <button
                onClick={handleSignup}
                style={{
                  marginTop: "16px",
                  width: "100%",
                  padding: "14px",
                  background: "#38bdf8",
                  color: "#020617",
                  border: "none",
                  borderRadius: "12px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Create Account
              </button>

              <hr
                style={{
                  margin: "22px 0",
                  borderColor: "rgba(255,255,255,0.12)",
                }}
              />

              <button
                style={{
                  width: "100%",
                  padding: "12px",
                  marginBottom: "10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Continue with Google
              </button>

              <button
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Continue with Apple
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            color: "white",
            opacity: 0.6,
            fontSize: "0.82rem",
            margin: 0,
            letterSpacing: "0.12em",
            fontWeight: 700,
          }}
        >
          {loading
            ? "SV IS THINKING..."
            : user
              ? `LOGGED IN AS ${user.email}`
              : "GUEST MODE"}
        </p>

        {user && (
          <button
            onClick={handleLogout}
            style={{
              padding: "9px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Log Out
          </button>
        )}
      </div>

      <div
        style={{
          width: "100%",
          minHeight: "320px",
          maxHeight: "460px",
          overflowY: "auto",
          marginBottom: "18px",
          paddingRight: "4px",
        }}
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={`${msg.role}-${i}-${msg.content.slice(0, 16)}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  maxWidth: "82%",
                  background:
                    msg.role === "user"
                      ? "rgba(56, 189, 248, 0.18)"
                      : "rgba(255, 255, 255, 0.05)",
                  padding: "15px 18px",
                  borderRadius: "18px",
                  color: "white",
                  lineHeight: 1.65,
                  border:
                    msg.role === "user"
                      ? "1px solid rgba(56, 189, 248, 0.24)"
                      : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <strong
                  style={{
                    display: "block",
                    marginBottom: "6px",
                    color: msg.role === "user" ? "#7dd3fc" : "#38bdf8",
                  }}
                >
                  {msg.role === "user" ? "You" : "SV"}
                </strong>

                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <div style={{ opacity: 0.7, color: "white" }}>SV is thinking...</div>
        )}

        <div ref={chatEndRef} />
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Ask a question or answer SV's last prompt..."
        style={{
          width: "100%",
          minHeight: "130px",
          backgroundColor: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "24px",
          padding: "22px",
          color: "white",
          fontSize: "1.05rem",
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
        }}
      />

      <button
        onClick={handleSend}
        disabled={loading}
        style={{
          marginTop: "18px",
          padding: "14px 56px",
          borderRadius: "18px",
          backgroundColor: loading ? "#7dd3fc" : "#38bdf8",
          color: "#020617",
          fontWeight: "900",
          border: "none",
          cursor: loading ? "not-allowed" : "pointer",
          letterSpacing: "0.08em",
        }}
      >
        {loading ? "THINKING..." : "SEND"}
      </button>
    </>
  );
}
