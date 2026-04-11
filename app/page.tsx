"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import AIHelper from "../components/AIHelper";
import { supabase } from "../lib/supabase";
import svRobot from "../mascot/sv-robot.png";

export default function HomePage() {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);

  // ─── Login modal ──────────────────────────────────────────────────────────
  const [showLogin, setShowLogin] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  // ─── Feedback modal ───────────────────────────────────────────────────────
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  // ─── Robot state ──────────────────────────────────────────────────────────
  const [isThinking, setIsThinking] = useState(false);
  const [lastThought, setLastThought] = useState("Ready to help.");

  // ─── Layout ───────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ─── Single Supabase auth listener ────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ─── Robot thinking — driven by events from AIHelper ─────────────────────
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

  const aiUser =
    user?.id && user?.email ? { id: user.id, email: user.email } : null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "white",
    boxSizing: "border-box",
    outline: "none",
    fontSize: "1rem",
  };

  // ─── Robot component — reused in two positions ────────────────────────────
  const RobotMascot = ({ size }: { size: number }) => (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Thought bubble */}
      <div
        style={{
          position: "absolute",
          bottom: size + 8,
          left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: "22px",
          padding: "8px 14px",
          color: "white",
          fontSize: "0.82rem",
          fontWeight: 600,
          textAlign: "center",
          backdropFilter: "blur(18px)",
          boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
        }}
      >
        {lastThought}
      </div>

      {/* Glow */}
      <div
        style={{
          position: "absolute",
          inset: "20% 20% 12% 20%",
          background: "rgba(56, 189, 248, 0.14)",
          filter: "blur(30px)",
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
          filter: "drop-shadow(0 0 30px rgba(56, 189, 248, 0.3))",
        }}
      />

      {/* Thinking dots */}
      <AnimatePresence>
        {isThinking &&
          [0, 1, 2].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{
                opacity: [0, 0.9, 0],
                y: -(40 + i * 18),
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
                width: `${12 + i * 5}px`,
                height: `${12 + i * 5}px`,
                borderRadius: "999px",
                background: "rgba(255,255,255,0.75)",
                boxShadow: "0 0 14px rgba(255,255,255,0.18)",
              }}
            />
          ))}
      </AnimatePresence>
    </div>
  );

  return (
    <main
      style={{
        background:
          "radial-gradient(circle at top, rgba(14,165,233,0.18), transparent 35%), linear-gradient(135deg, #020617 0%, #0f172a 45%, #111827 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "14px 14px 32px" : "20px",
        position: "relative",
        overflow: "hidden",
        color: "white",
      }}
    >
      {/* Background orbs */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 18%), radial-gradient(circle at 80% 30%, rgba(245,158,11,0.10), transparent 18%), radial-gradient(circle at 30% 80%, rgba(168,85,247,0.10), transparent 20%)",
          pointerEvents: "none",
        }}
      />

      {/* ── Login modal ── */}
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

              <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
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
                style={{ ...inputStyle, marginTop: "18px" }}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEmailAuth();
                }}
                style={{ ...inputStyle, marginTop: "12px" }}
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
                onClick={() => handleOAuth("apple")}
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

      {/* ── Feedback modal ── */}
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

      {/* ── DESKTOP ONLY: Robot fixed bottom-left ── */}
      {!isMobile && (
        <div
          style={{
            position: "fixed",
            left: "18px",
            bottom: "18px",
            zIndex: 40,
            pointerEvents: "none",
          }}
        >
          <RobotMascot size={230} />
        </div>
      )}

      {/* ── Header card ── */}
      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          padding: isMobile ? "20px 20px 16px" : "40px",
          borderRadius: isMobile ? "24px" : "40px",
          backdropFilter: "blur(30px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          maxWidth: "900px",
          width: "100%",
          marginBottom: "16px",
          textAlign: "center",
          position: "relative",
          zIndex: 10,
          boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
        }}
      >
        {/* Top-right buttons */}
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
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              cursor: "pointer",
              fontSize: "12px",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Feedback
          </button>

          {user ? (
            <button
              onClick={handleLogout}
              style={{
                padding: "8px 18px",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                cursor: "pointer",
                fontSize: "12px",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              Log Out
            </button>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              style={{
                padding: "8px 18px",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                cursor: "pointer",
                fontSize: "12px",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
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

      {/* ── MOBILE ONLY: Robot sits between header and chat ── */}
      {isMobile && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            width: "100%",
            marginBottom: "8px",
            paddingTop: "28px", // space for thought bubble above robot
            zIndex: 10,
            position: "relative",
          }}
        >
          <RobotMascot size={130} />
        </div>
      )}

      {/* ── Chat card ── */}
      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.02)",
          padding: isMobile ? "18px" : "50px",
          borderRadius: isMobile ? "24px" : "40px",
          backdropFilter: "blur(40px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          maxWidth: "900px",
          width: "100%",
          position: "relative",
          zIndex: 10,
          boxShadow: "0 20px 80px rgba(0,0,0,0.35)",
        }}
      >
        <AIHelper user={aiUser} onRequestLogin={() => setShowLogin(true)} />
      </div>

      {/* ── Footer ── */}
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
    </main>
  );
}
