"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  submitMessageFeedback,
  getFeedbackSummary,
  getTotalViews,
} from "@/lib/db/engagement";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  filePreview?: string;
  fileName?: string;
  fileType?: string;
  isPassword?: boolean;
};

type AttachedFile = {
  name: string;
  type: string;
  base64: string;
  dataUrl: string;
  size: number;
};

type UserState = {
  id: string;
  email: string;
};

type AIHelperProps = {
  user: UserState | null;
  onRequestLogin: () => void;
  initialMessages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
  conversationId?: string | null;
};

const GUEST_LIMIT = 5;
const MAX_STORED_MESSAGES = 40;
const MAX_FILE_MB = 10;

// SV response that triggers password mode
const PASSWORD_PROMPT = "enter owner password:";

// SV responses that end password mode
const PASSWORD_SUCCESS = "owner mode enabled";
const PASSWORD_FAIL = "incorrect password";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/javascript",
  "text/typescript",
  "text/html",
  "text/css",
  "application/json",
  "application/x-python",
  "text/x-python",
  "text/x-java-source",
  "text/x-c",
  "text/x-cpp",
];

function isImageType(type: string) {
  return type.startsWith("image/");
}

function isPdfType(type: string) {
  return type === "application/pdf";
}

export default function AIHelper({
  user,
  onRequestLogin,
  initialMessages,
  onMessagesChange,
  conversationId,
}: AIHelperProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginDismissed, setLoginDismissed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [fileError, setFileError] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    Record<number, "up" | "down" | null>
  >({});
  const [feedbackSummary, setFeedbackSummary] = useState<
    Record<number, { up: number; down: number }>
  >({});
  const [totalViews, setTotalViews] = useState(0);

  // ─── Password mode — switches textarea to masked input ────────────────────
  const [isPasswordMode, setIsPasswordMode] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ─── KEY FIX: stable ref to onMessagesChange ──────────────────────────────
  // Calling onMessagesChange from a useEffect watching [messages] was the root
  // cause of all duplicate/wipe bugs. The ref lets us call it once inside
  // handleSend after the assistant replies — never from an effect.
  const onMessagesChangeRef = useRef(onMessagesChange);
  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

  // ─── Stable session ID ────────────────────────────────────────────────────
  const sessionId = useMemo(() => {
    if (typeof window === "undefined") return "ssr";
    const key = "svansai-session-id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  }, []);

  const storageKey = useMemo(() => {
    if (!user?.email) return "svansai-guest-chat";
    return `svansai-chat-${user.email.trim().toLowerCase()}`;
  }, [user]);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ─── Load messages when conversation changes ──────────────────────────────
  // Does NOT call onMessagesChange — loading must never trigger a save
  useEffect(() => {
    if (conversationId && initialMessages) {
      setMessages(
        initialMessages.length
          ? initialMessages
          : [
              {
                role: "assistant",
                content: "What would you like help with today?",
              },
            ],
      );
      return;
    }

    setMessages([
      {
        role: "assistant",
        content: user
          ? "What would you like help with today?"
          : "What would you like help with today? I can guide you step by step. You can also attach images, PDFs, or code files.",
      },
    ]);
  }, [user, initialMessages, conversationId]);

  // ─── REMOVED: onMessagesChange useEffect ─────────────────────────────────
  // The old code had: useEffect(() => { onMessagesChange?.(messages); }, [messages, onMessagesChange])
  // This fired on every setMessages call including loads, causing wipes and duplicates.
  // onMessagesChange is now called ONLY inside handleSend after the assistant replies.

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!conversationId) {
      setFeedbackSummary({});
      return;
    }
    void (async () => {
      const summary = await getFeedbackSummary(conversationId);
      setFeedbackSummary(summary);
    })();
  }, [conversationId, messages.length]);

  useEffect(() => {
    void (async () => {
      const views = await getTotalViews();
      setTotalViews(views);
    })();
  }, []);

  // ─── Auto-focus password input when mode activates ────────────────────────
  useEffect(() => {
    if (isPasswordMode) {
      setTimeout(() => passwordInputRef.current?.focus(), 80);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isPasswordMode]);

  // ─── Watch SV responses to toggle password mode ───────────────────────────
  const checkPasswordMode = (svResponse: string) => {
    const lower = svResponse.toLowerCase();
    if (lower.includes(PASSWORD_PROMPT)) {
      setIsPasswordMode(true);
    }
    if (lower.includes(PASSWORD_SUCCESS) || lower.includes(PASSWORD_FAIL)) {
      setIsPasswordMode(false);
    }
  };

  const notifyThinking = (thinking: boolean, msg?: string) => {
    window.dispatchEvent(
      new CustomEvent(thinking ? "sv-thinking-start" : "sv-thinking-end", {
        detail: {
          message:
            msg || (thinking ? "Thinking it through..." : "Ready to help."),
        },
      }),
    );
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("");
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (
      !ACCEPTED_TYPES.includes(file.type) &&
      !file.name.match(
        /\.(py|ts|tsx|js|jsx|java|c|cpp|cs|go|rb|rs|swift|kt|md)$/i,
      )
    ) {
      setFileError(
        "That file type isn't supported. Try an image, PDF, or code/text file.",
      );
      return;
    }

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setFileError(`File is too large. Max size is ${MAX_FILE_MB}MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setAttachedFile({
        name: file.name,
        type: file.type || "text/plain",
        base64,
        dataUrl,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setFileError("");
  };

  const handleFeedback = async (messageIndex: number, vote: "up" | "down") => {
    if (!conversationId) return;

    setFeedbackState((prev) => ({ ...prev, [messageIndex]: vote }));

    await submitMessageFeedback({
      conversationId,
      messageIndex,
      vote,
      userId: user?.id ?? null,
    });

    setFeedbackSummary((prev) => {
      const current = prev[messageIndex] ?? { up: 0, down: 0 };
      return {
        ...prev,
        [messageIndex]: {
          up: current.up + (vote === "up" ? 1 : 0),
          down: current.down + (vote === "down" ? 1 : 0),
        },
      };
    });
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedFile) || loading) return;

    const userCount = messages.filter((m) => m.role === "user").length;

    if (!user && userCount >= GUEST_LIMIT && !loginDismissed) {
      setLoginDismissed(true);
      onRequestLogin();
    }

    const userMessage: ChatMessage = {
      role: "user",
      content:
        input.trim() ||
        (attachedFile ? `[Attached: ${attachedFile.name}]` : ""),
      filePreview: attachedFile?.dataUrl,
      fileName: attachedFile?.name,
      fileType: attachedFile?.type,
      isPassword: isPasswordMode,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");

    const fileToSend = attachedFile;
    setAttachedFile(null);
    setLoading(true);
    notifyThinking(
      true,
      fileToSend ? "Reading your file..." : "Thinking it through...",
    );

    try {
      const body: Record<string, unknown> = {
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        sessionId,
      };

      if (fileToSend) {
        body.file = {
          name: fileToSend.name,
          type: fileToSend.type,
          base64: fileToSend.base64,
        };
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const reply: string =
        data?.text?.trim() ||
        "I processed that but didn't generate a response. Try sending it again.";

      // Check if SV's reply changes password mode
      checkPasswordMode(reply);

      const finalMessages = [
        ...nextMessages,
        { role: "assistant" as const, content: reply },
      ];
      setMessages(finalMessages);
      notifyThinking(false, "Ready to help.");

      // ─── Save ONCE here, after assistant replies ───────────────────────────
      // Never from a useEffect — that was the root cause of all save bugs.
      onMessagesChangeRef.current?.(finalMessages);
    } catch (error) {
      console.error("SEND_ERROR:", error);
      setIsPasswordMode(false);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            "Something interrupted my response. Please send it again and I'll pick right back up.",
        },
      ]);
      notifyThinking(false, "Still here.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Shared send on Enter ─────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ width: "100%" }}>
      {/* Status bar */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            color: "white",
            opacity: 0.6,
            fontSize: "0.78rem",
            margin: 0,
            letterSpacing: "0.12em",
            fontWeight: 700,
            wordBreak: "break-word",
          }}
        >
          {loading
            ? "SV IS THINKING..."
            : isPasswordMode
              ? "OWNER AUTHENTICATION"
              : user
                ? `LOGGED IN AS ${user.email}`
                : "GUEST MODE"}
        </p>
      </div>

      {/* Chat window */}
      <div
        style={{
          width: "100%",
          minHeight: isMobile ? "260px" : "320px",
          maxHeight: isMobile ? "380px" : "460px",
          overflowY: "auto",
          marginBottom: "16px",
          paddingRight: "2px",
          borderRadius: "20px",
          scrollBehavior: "smooth",
          boxSizing: "border-box",
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
                  maxWidth: isMobile ? "88%" : "82%",
                  background:
                    msg.role === "user"
                      ? "rgba(56, 189, 248, 0.18)"
                      : "rgba(255, 255, 255, 0.05)",
                  padding: isMobile ? "12px 14px" : "15px 18px",
                  borderRadius: "18px",
                  color: "white",
                  lineHeight: 1.65,
                  fontSize: isMobile ? "0.93rem" : "1rem",
                  border:
                    msg.role === "user"
                      ? "1px solid rgba(56, 189, 248, 0.24)"
                      : "1px solid rgba(255,255,255,0.08)",
                  wordBreak: "break-word",
                }}
              >
                <strong
                  style={{
                    display: "block",
                    marginBottom: "5px",
                    color: msg.role === "user" ? "#7dd3fc" : "#38bdf8",
                    fontSize: isMobile ? "0.82rem" : "0.9rem",
                  }}
                >
                  {msg.role === "user" ? "You" : "SV"}
                </strong>

                {/* Image preview */}
                {msg.filePreview && isImageType(msg.fileType || "") && (
                  <img
                    src={msg.filePreview}
                    alt={msg.fileName || "Attached image"}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "220px",
                      borderRadius: "10px",
                      marginBottom: "8px",
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                )}

                {/* Non-image file badge */}
                {msg.fileName && !isImageType(msg.fileType || "") && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "rgba(255,255,255,0.07)",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      marginBottom: "8px",
                      fontSize: "0.82rem",
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>
                      {isPdfType(msg.fileType || "") ? "📄" : "📎"}
                    </span>
                    <span style={{ opacity: 0.85, wordBreak: "break-all" }}>
                      {msg.fileName}
                    </span>
                  </div>
                )}

                {/* Password bubble — shows fixed dots, never the actual content */}
                {msg.isPassword ? (
                  <div
                    style={{
                      letterSpacing: "0.2em",
                      fontSize: "1rem",
                      color: "rgba(255,255,255,0.25)",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                    }}
                  >
                    {"●".repeat(8)}
                  </div>
                ) : (
                  <>
                    {msg.content && !msg.content.startsWith("[Attached:") && (
                      <div style={{ whiteSpace: "pre-wrap" }}>
                        {msg.content}
                      </div>
                    )}
                    {msg.content.startsWith("[Attached:") &&
                      !msg.filePreview &&
                      !msg.fileName && (
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {msg.content}
                        </div>
                      )}
                  </>
                )}

                {/* Thumbs removed from bubbles — now only in header Feedback button */}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <div
            style={{
              opacity: 0.6,
              color: "white",
              fontSize: "0.88rem",
              paddingLeft: "4px",
            }}
          >
            SV is thinking...
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* File attachment preview */}
      {attachedFile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "rgba(56,189,248,0.08)",
            border: "1px solid rgba(56,189,248,0.2)",
            borderRadius: "14px",
            padding: "10px 14px",
            marginBottom: "10px",
            boxSizing: "border-box",
          }}
        >
          {isImageType(attachedFile.type) ? (
            <img
              src={attachedFile.dataUrl}
              alt={attachedFile.name}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : (
            <span style={{ fontSize: "1.6rem", flexShrink: 0 }}>
              {isPdfType(attachedFile.type) ? "📄" : "📎"}
            </span>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                color: "white",
                fontSize: "0.85rem",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {attachedFile.name}
            </p>
            <p
              style={{
                margin: 0,
                color: "rgba(255,255,255,0.45)",
                fontSize: "0.75rem",
              }}
            >
              {(attachedFile.size / 1024).toFixed(0)} KB
            </p>
          </div>

          <button
            onClick={removeAttachment}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: "999px",
              color: "white",
              cursor: "pointer",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.85rem",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {fileError && (
        <p
          style={{
            color: "#f87171",
            fontSize: "0.82rem",
            marginBottom: "8px",
            marginTop: 0,
          }}
        >
          {fileError}
        </p>
      )}

      {/* Input area */}
      <div style={{ width: "100%", boxSizing: "border-box" }}>
        {/* PASSWORD MODE — single line masked input */}
        {isPasswordMode ? (
          <div style={{ position: "relative" }}>
            <input
              ref={passwordInputRef}
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter password..."
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{
                width: "100%",
                padding: isMobile ? "18px 20px" : "22px 24px",
                backgroundColor: "rgba(56, 189, 248, 0.06)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                borderRadius: "20px",
                color: "white",
                fontSize: isMobile ? "1.1rem" : "1.3rem",
                letterSpacing: "0.25em",
                outline: "none",
                boxSizing: "border-box",
                display: "block",
                fontFamily: "monospace",
              }}
            />
            {/* Lock icon hint */}
            <div
              style={{
                position: "absolute",
                right: "16px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "rgba(56,189,248,0.6)",
                fontSize: "1rem",
                pointerEvents: "none",
              }}
            >
              🔒
            </div>
          </div>
        ) : (
          /* NORMAL MODE — textarea */
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedFile
                ? "Add a message about this file, or just hit Send..."
                : "Ask anything or follow up on SV's last response..."
            }
            style={{
              width: "100%",
              minHeight: isMobile ? "100px" : "130px",
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: "20px",
              padding: isMobile ? "16px" : "22px",
              color: "white",
              fontSize: isMobile ? "0.95rem" : "1.05rem",
              outline: "none",
              resize: "none",
              boxSizing: "border-box",
              display: "block",
            }}
          />
        )}

        {/* Bottom row: attach + send */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginTop: "14px",
            alignItems: "center",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={
              ACCEPTED_TYPES.join(",") +
              ",.py,.ts,.tsx,.js,.jsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.swift,.kt,.md"
            }
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />

          {/* Hide attach button in password mode */}
          {!isPasswordMode && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach file"
              style={{
                padding: "14px 18px",
                borderRadius: "16px",
                backgroundColor: attachedFile
                  ? "rgba(56,189,248,0.2)"
                  : "rgba(255,255,255,0.06)",
                border: attachedFile
                  ? "1px solid rgba(56,189,248,0.4)"
                  : "1px solid rgba(255,255,255,0.12)",
                color: "white",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: "1.1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              📎
            </button>
          )}

          <button
            onClick={handleSend}
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: "16px",
              backgroundColor: isPasswordMode
                ? "rgba(56,189,248,0.85)"
                : loading
                  ? "#7dd3fc"
                  : "#38bdf8",
              color: "#020617",
              fontWeight: 900,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: "0.08em",
              fontSize: "0.95rem",
            }}
          >
            {loading ? "THINKING..." : isPasswordMode ? "SUBMIT" : "SEND"}
          </button>
        </div>
      </div>
    </div>
  );
}
