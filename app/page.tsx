"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import AIHelper from "../components/AIHelper";
import type { ChatMessage } from "../components/AIHelper";
import { supabase } from "../lib/supabase";
import svRobot from "../mascot/sv-robot.png";

export default function HomePage() {
  const [isThinking, setIsThinking] = useState(false);
  const [lastThought, setLastThought] = useState("Ready to help.");

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

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth <= 768);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

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

        if (error) {
          setAuthMessage(error.message);
        } else {
          setAuthMessage(
            "Account created. Check your email if confirmation is required.",
          );
        }
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
  };

  const handleSVSend = async (messages: ChatMessage[]) => {
    const latestUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";

    setIsThinking(true);
    setLastThought("Thinking it through...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages }),
      });

      const data = await response.json();

      setTimeout(() => {
        setIsThinking(false);
      }, 1800);

      if (latestUserMessage.length > 55) {
        setLastThought("I found a path forward.");
      } else if (latestUserMessage.trim()) {
        setLastThought(`Working on: "${latestUserMessage}"`);
      } else {
        setLastThought("Ready to help.");
      }

      return data.text || "I’m here, but I didn’t generate a response.";
    } catch (error) {
      console.error(error);

      setTimeout(() => {
        setIsThinking(false);
      }, 1800);

      setLastThought("Still working through it.");

      return "Let’s keep going. Something interrupted my last response, but I can still help.";
    }
  };

  const handleSubmitFeedback = async () => {
    if (!user) {
      setShowLogin(true);
      setShowFeedback(false);
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
        padding: isMobile ? "14px" : "20px",
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
                onClick={() => setShowLogin(false)}
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
                <button
                  onClick={() => setAuthMode("signin")}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background:
                      authMode === "signin"
                        ? "rgba(56,189,248,0.18)"
                        : "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Sign In
                </button>

                <button
                  onClick={() => setAuthMode("signup")}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background:
                      authMode === "signup"
                        ? "rgba(56,189,248,0.18)"
                        : "rgba(255,255,255,0.04)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Sign Up
                </button>
              </div>

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
                  if (e.key === "Enter") handleEmailAuth();
                }}
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
          left: isMobile ? "10px" : "18px",
          bottom: isMobile ? "14px" : "18px",
          zIndex: 40,
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: "20% 20% 12% 20%",
              background: "rgba(56, 189, 248, 0.14)",
              filter: "blur(35px)",
              borderRadius: "999px",
            }}
          />

          <Image
            src={svRobot}
            alt="SV Robot"
            width={isMobile ? 170 : 230}
            height={isMobile ? 170 : 230}
            style={{
              position: "relative",
              filter: "drop-shadow(0 0 40px rgba(56, 189, 248, 0.3))",
            }}
          />

          <AnimatePresence>
            {isThinking && (
              <>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 0, x: 0, scale: 0.6 }}
                    animate={{
                      opacity: [0, 0.9, 0],
                      y: -95 - i * 34,
                      x: 35 + i * 26,
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
                      left: isMobile ? "86px" : "120px",
                      bottom: isMobile ? "90px" : "130px",
                      width: `${16 + i * 6}px`,
                      height: `${16 + i * 6}px`,
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.75)",
                      boxShadow: "0 0 18px rgba(255,255,255,0.18)",
                    }}
                  />
                ))}
              </>
            )}
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            style={{
              position: "absolute",
              left: isMobile ? "105px" : "155px",
              bottom: isMobile ? "145px" : "180px",
              maxWidth: isMobile ? "140px" : "180px",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "22px",
              padding: isMobile ? "8px 12px" : "10px 16px",
              color: "white",
              fontSize: isMobile ? "0.82rem" : "0.95rem",
              fontWeight: 600,
              textAlign: "center",
              lineHeight: 1.35,
              letterSpacing: "0.02em",
              backdropFilter: "blur(18px)",
              boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
            }}
          >
            {lastThought}
          </motion.div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          padding: isMobile ? "24px" : "40px",
          borderRadius: isMobile ? "24px" : "40px",
          backdropFilter: "blur(30px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          maxWidth: "900px",
          width: "100%",
          marginBottom: "20px",
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
            marginBottom: isMobile ? "18px" : 0,
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
            marginBottom: "16px",
          }}
        >
          NEURAL LINK ESTABLISHED
        </p>

        <h1
          style={{
            fontSize: isMobile ? "2.3rem" : "clamp(2.2rem, 7vw, 4.6rem)",
            fontWeight: 900,
            margin: 0,
            lineHeight: 1,
          }}
        >
          SVANS-AI
        </h1>

        <p
          style={{
            marginTop: "18px",
            color: "rgba(255,255,255,0.78)",
            fontSize: isMobile ? "0.95rem" : "1rem",
            lineHeight: 1.8,
          }}
        >
          Your AI Guide for Anything
        </p>
      </div>

      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.02)",
          padding: isMobile ? "20px" : "50px",
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
        <AIHelper onSend={handleSVSend} />
      </div>

      <div
        style={{
          position: "fixed",
          bottom: "10px",
          right: "14px",
          fontSize: "11px",
          color: "rgba(255,255,255,0.35)",
          letterSpacing: "0.08em",
          zIndex: 1000,
        }}
      >
        SVANS-AI • Built by Shawn Vansant
      </div>
    </main>
  );
}
