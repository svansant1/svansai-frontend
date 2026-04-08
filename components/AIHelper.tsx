"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface AIHelperProps {
  onSend: (message: string) => string | Promise<string>;
}

export default function AIHelper({ onSend }: AIHelperProps) {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");

  const handleAction = async () => {
    if (!input.trim()) return;
    setResponse("");
    const res = await onSend(input);
    setResponse(res);
  };

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <p
        style={{
          color: "white",
          opacity: 0.3,
          fontSize: "0.85rem",
          marginBottom: "20px",
        }}
      >
        SV IS AWAITING COMMAND
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Input learning parameters..."
        style={{
          width: "100%",
          minHeight: "160px",
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "24px",
          padding: "25px",
          color: "white",
          fontSize: "1.1rem",
          outline: "none",
          resize: "none",
        }}
      />

      <button
        onClick={handleAction}
        style={{
          marginTop: "20px",
          padding: "14px 60px",
          borderRadius: "18px",
          backgroundColor: "#38bdf8",
          color: "#020617",
          fontWeight: "900",
          border: "none",
          cursor: "pointer",
          letterSpacing: "0.1em",
        }}
      >
        INITIALIZE
      </button>

      {response && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginTop: "30px",
            padding: "25px",
            backgroundColor: "rgba(255, 255, 255, 0.03)",
            borderRadius: "24px",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            width: "100%",
            color: "white",
            textAlign: "left",
          }}
        >
          <strong
            style={{ color: "#38bdf8", display: "block", marginBottom: "5px" }}
          >
            SV:
          </strong>
          {response}
        </motion.div>
      )}
    </div>
  );
}
