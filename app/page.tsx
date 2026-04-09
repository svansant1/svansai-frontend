"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import AIHelper from "../components/AIHelper";
import type { ChatMessage } from "../components/AIHelper";
import svRobot from "../mascot/sv-robot.png";

export default function HomePage() {
  const [isThinking, setIsThinking] = useState(false);
  const [lastThought, setLastThought] = useState("Ready to help.");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

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
      setIsThinking(false);
      setLastThought("Still working through it.");
      return "I’m still here. Something interrupted my response, but let’s keep going. Tell me a little more and I’ll help you figure it out.";
    }
  };

  const handleSubmitFeedback = () => {
    if (!feedbackText.trim()) return;

    const existing = localStorage.getItem("svansai_feedback");
    const parsed = existing ? JSON.parse(existing) : [];

    parsed.push({
      message: feedbackText.trim(),
      createdAt: new Date().toISOString(),
    });

    localStorage.setItem("svansai_feedback", JSON.stringify(parsed));
    setFeedbackText("");
    setShowFeedback(false);
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
        padding: "20px",
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
                padding: "34px",
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
                aria-label="Close feedback modal"
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
                Submit Feedback
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={{
          position: "fixed",
          left: "18px",
          bottom: "18px",
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
            width={230}
            height={230}
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
                      left: "120px",
                      bottom: "130px",
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
              left: "155px",
              bottom: "180px",
              maxWidth: "180px",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "22px",
              padding: "10px 16px",
              color: "white",
              fontSize: "0.95rem",
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
          padding: "40px",
          borderRadius: "40px",
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
            position: "absolute",
            top: "20px",
            right: "25px",
            display: "flex",
            gap: "10px",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => setShowFeedback(true)}
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

          <button
            onClick={() => {
              const event = new CustomEvent("openLogin");
              window.dispatchEvent(event);
            }}
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
            fontSize: "clamp(2.2rem, 7vw, 4.6rem)",
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
            fontSize: "1rem",
            lineHeight: 1.8,
          }}
        >
          Your AI Guide for Anything
        </p>
      </div>

      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.02)",
          padding: "50px",
          borderRadius: "40px",
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
