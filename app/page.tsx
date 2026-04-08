"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import AIHelper from "../components/AIHelper";
import svRobot from "../mascot/sv-robot.png";

export default function HomePage() {
  const [activeZone, setActiveZone] = useState("math");
  const [isTalking, setIsTalking] = useState(false);

  const handleSVSend = async (msg: string) => {
    setIsTalking(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await response.json();

      // Subject Relocation Logic
      const lowMsg = msg.toLowerCase();
      if (
        lowMsg.includes("science") ||
        lowMsg.includes("fedex") ||
        lowMsg.includes("unload")
      ) {
        setActiveZone("science"); // Moves SV to the science/logistics area
      } else {
        setActiveZone("math");
      }

      setTimeout(() => setIsTalking(false), 2000);
      return data.text;
    } catch (error) {
      setIsTalking(false);
      return "System Error: Brain link failed.";
    }
  };

  return (
    <main
      style={{
        backgroundColor: "#020617",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* SV Mascot: Layered at zIndex 50 to peek over the glass */}
      <motion.div
        animate={{
          x: activeZone === "math" ? 0 : 50,
          y: isTalking ? [0, -8, 0] : [0, -4, 0],
          scale: isTalking ? [1, 1.08, 1] : [1, 1.02, 1],
          rotate: isTalking ? [0, -1.5, 1.5, 0] : [0, 0.4, -0.4, 0],
        }}
        transition={{
          x: { type: "spring", stiffness: 45, damping: 16 },
          y: {
            duration: isTalking ? 0.9 : 2.6,
            repeat: Infinity,
            ease: "easeInOut",
          },
          scale: {
            duration: isTalking ? 0.9 : 2.6,
            repeat: Infinity,
            ease: "easeInOut",
          },
          rotate: {
            duration: isTalking ? 0.45 : 2.8,
            repeat: Infinity,
            ease: "easeInOut",
          },
        }}
        style={{
          position: "absolute",
          left: "6%",
          bottom: "8%",
          zIndex: 50,
          pointerEvents: "none",
        }}
      >
        <Image
          src={svRobot}
          alt="SV"
          width={260}
          height={260}
          style={{
            filter: "drop-shadow(0 0 40px rgba(56, 189, 248, 0.35))",
          }}
        />
      </motion.div>

      {/* Main Glass Terminal */}
      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.01)",
          padding: "50px",
          borderRadius: "40px",
          backdropFilter: "blur(40px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          maxWidth: "900px",
          width: "100%",
          zIndex: 10,
        }}
      >
        <AIHelper onSend={handleSVSend} />
      </div>
    </main>
  );
}
