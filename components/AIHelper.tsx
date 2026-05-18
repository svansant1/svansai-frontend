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

type ResponseMode = "auto" | "direct" | "guide" | "tutor";

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
const MAX_FILE_MB = 10;

const PASSWORD_PROMPT = "enter owner password:";
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

const RESPONSE_MODES: Array<{
  id: ResponseMode;
  label: string;
  title: string;
}> = [
  { id: "auto", label: "Auto", title: "Let SVANSAI choose the best style" },
  { id: "direct", label: "Direct", title: "Answer first, then explain briefly" },
  { id: "guide", label: "Guide", title: "Show how to get the answer" },
  { id: "tutor", label: "Tutor", title: "Hint and coach before revealing" },
];

function isImageType(type: string) {
  return type.startsWith("image/");
}

function isPdfType(type: string) {
  return type === "application/pdf";
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(
        <strong key={`bold-${match.index}`} style={{ fontWeight: 850 }}>
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      nodes.push(
        <code
          key={`inline-code-${match.index}`}
          style={{
            padding: "2px 5px",
            borderRadius: "6px",
            background: "rgba(15, 23, 42, 0.62)",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            color: "#bae6fd",
            fontSize: "0.92em",
          }}
        >
          {match[3]}
        </code>,
      );
    } else if (match[4] && match[5]) {
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          style={{
            color: "#7dd3fc",
            fontWeight: 750,
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          {match[4]}
        </a>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : text;
}

function renderMarkdownTextBlock(text: string, blockKey: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;

    const value = paragraph.join(" ").trim();
    paragraph = [];

    if (!value) return;

    elements.push(
      <p
        key={`${blockKey}-p-${elements.length}`}
        style={{ margin: "0 0 12px" }}
      >
        {renderInlineMarkdown(value)}
      </p>,
    );
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      return;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const fontSize =
        level === 1 ? "1.22rem" : level === 2 ? "1.1rem" : "1rem";

      elements.push(
        <div
          key={`${blockKey}-h-${lineIndex}`}
          style={{
            margin: elements.length === 0 ? "0 0 9px" : "16px 0 9px",
            color: "#e0f2fe",
            fontSize,
            fontWeight: 900,
            lineHeight: 1.3,
          }}
        >
          {renderInlineMarkdown(heading[2].trim())}
        </div>,
      );
      return;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      elements.push(
        <div
          key={`${blockKey}-bullet-${lineIndex}`}
          style={{
            display: "flex",
            gap: "9px",
            margin: "0 0 8px",
            alignItems: "flex-start",
          }}
        >
          <span style={{ color: "#38bdf8", lineHeight: 1.65 }}>•</span>
          <span style={{ flex: 1 }}>
            {renderInlineMarkdown(bullet[1].trim())}
          </span>
        </div>,
      );
      return;
    }

    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      flushParagraph();
      elements.push(
        <div
          key={`${blockKey}-number-${lineIndex}`}
          style={{
            display: "flex",
            gap: "9px",
            margin: "0 0 8px",
            alignItems: "flex-start",
          }}
        >
          <span
            style={{ color: "#38bdf8", fontWeight: 850, minWidth: "1.4em" }}
          >
            {numbered[1]}.
          </span>
          <span style={{ flex: 1 }}>
            {renderInlineMarkdown(numbered[2].trim())}
          </span>
        </div>,
      );
      return;
    }

    const quote = /^>\s+(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      elements.push(
        <blockquote
          key={`${blockKey}-quote-${lineIndex}`}
          style={{
            margin: "10px 0 12px",
            padding: "8px 12px",
            borderLeft: "3px solid rgba(56,189,248,0.6)",
            background: "rgba(56,189,248,0.07)",
            borderRadius: "8px",
            color: "rgba(255,255,255,0.88)",
          }}
        >
          {renderInlineMarkdown(quote[1].trim())}
        </blockquote>,
      );
      return;
    }

    paragraph.push(line);
  });

  flushParagraph();

  return (
    <div key={blockKey} style={{ whiteSpace: "normal" }}>
      {elements}
    </div>
  );
}

function renderMessageContent(content: string) {
  const parts = content.split(/```([\w-]*)\n?([\s\S]*?)```/g);

  return parts.map((part, index) => {
    if (index % 3 === 1) return null;

    if (index % 3 === 2) {
      const language = parts[index - 1]?.trim();

      return (
        <pre
          key={`code-${index}`}
          style={{
            margin: "12px 0",
            padding: "14px 16px",
            borderRadius: "12px",
            background: "rgba(2, 6, 23, 0.58)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            color: "#e5f4ff",
            overflowX: "auto",
            whiteSpace: "pre",
            fontSize: "0.92rem",
            lineHeight: 1.55,
            boxSizing: "border-box",
          }}
        >
          {language && (
            <div
              style={{
                color: "#7dd3fc",
                fontSize: "0.72rem",
                fontWeight: 800,
                letterSpacing: "0.08em",
                marginBottom: "8px",
                textTransform: "uppercase",
              }}
            >
              {language}
            </div>
          )}
          <code>{part.trim()}</code>
        </pre>
      );
    }

    return renderMarkdownTextBlock(part, `text-${index}`);
  });
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
  const [isPasswordMode, setIsPasswordMode] = useState(false);
  const [responseMode, setResponseMode] = useState<ResponseMode>("auto");

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const onMessagesChangeRef = useRef(onMessagesChange);

  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

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

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);

    update();
    window.addEventListener("resize", update);

    return () => window.removeEventListener("resize", update);
  }, []);

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

  useEffect(() => {
    if (isPasswordMode) {
      setTimeout(() => passwordInputRef.current?.focus(), 80);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isPasswordMode]);

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

    const hasAcceptedExtension = file.name.match(
      /\.(py|ts|tsx|js|jsx|java|c|cpp|cs|go|rb|rs|swift|kt|md)$/i,
    );

    if (!ACCEPTED_TYPES.includes(file.type) && !hasAcceptedExtension) {
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
      fileToSend
        ? isImageType(fileToSend.type)
          ? "Analyzing your image..."
          : isPdfType(fileToSend.type)
            ? "Reading your PDF..."
            : "Reading your file..."
        : "Thinking it through...",
    );

    try {
      const body: Record<string, unknown> = {
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        sessionId,
        responseMode,
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

      const replySource =
        data?.text ?? data?.response ?? data?.answer ?? data?.message ?? "";

      const reply =
        typeof replySource === "string" && replySource.trim()
          ? replySource.trim()
          : "I processed that but didn't generate a response. Try sending it again.";

      checkPasswordMode(reply);

      const finalMessages = [
        ...nextMessages,
        { role: "assistant" as const, content: reply },
      ];

      setMessages(finalMessages);
      notifyThinking(false, "Ready to help.");

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

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;

    for (let i = 0; i < items.length; i += 1) {
      if (!items[i].type.includes("image")) continue;

      const file = items[i].getAsFile();
      if (!file) continue;

      const reader = new FileReader();

      reader.onload = (event) => {
        const dataUrl = event.target?.result;
        if (typeof dataUrl !== "string") return;

        setAttachedFile({
          name: "pasted-image.png",
          type: file.type,
          base64: dataUrl.split(",")[1] || "",
          dataUrl,
          size: file.size,
        });
      };

      reader.readAsDataURL(file);
      break;
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    if (isPasswordMode) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }

      return;
    }

    if (isMobile) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "auto",
        minHeight: isMobile ? "560px" : "720px",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        minWidth: 0,
      }}
    >
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

      <div
        style={{
          width: "100%",
          flex: "1 1 auto",
          minHeight: isMobile ? "300px" : "430px",
          maxHeight: isMobile ? "58dvh" : "none",
          overflowY: isMobile ? "auto" : "visible",
          overflowX: "hidden",
          marginBottom: isMobile ? "14px" : "18px",
          padding: isMobile ? "2px 4px 18px 0" : "4px 10px 4px 0",
          borderRadius: "18px",
          scrollBehavior: "smooth",
          boxSizing: "border-box",
          WebkitOverflowScrolling: "touch",
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
                  width: msg.role === "assistant" ? "100%" : "auto",
                  maxWidth:
                    msg.role === "assistant"
                      ? "100%"
                      : isMobile
                        ? "88%"
                        : "72%",
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
                  overflowWrap: "anywhere",
                  boxSizing: "border-box",
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
                      <div>{renderMessageContent(msg.content)}</div>
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

      <div
        style={{
          width: "100%",
          flex: "0 0 auto",
          transition: "margin-top 0.25s ease",
          boxSizing: "border-box",
        }}
      >
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

        <div style={{ width: "100%", boxSizing: "border-box" }}>
          {!isPasswordMode && (
            <div
              aria-label="Response mode"
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "repeat(2, minmax(0, 1fr))"
                  : "repeat(4, minmax(0, 1fr))",
                gap: "8px",
                marginBottom: "12px",
              }}
            >
              {RESPONSE_MODES.map((mode) => {
                const active = responseMode === mode.id;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    title={mode.title}
                    aria-pressed={active}
                    onClick={() => setResponseMode(mode.id)}
                    style={{
                      padding: isMobile ? "9px 8px" : "10px 12px",
                      borderRadius: "14px",
                      border: active
                        ? "1px solid rgba(56,189,248,0.58)"
                        : "1px solid rgba(255,255,255,0.12)",
                      background: active
                        ? "linear-gradient(135deg, rgba(56,189,248,0.24), rgba(168,85,247,0.14))"
                        : "rgba(255,255,255,0.045)",
                      color: active ? "#e0f2fe" : "rgba(255,255,255,0.72)",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: isMobile ? "0.78rem" : "0.84rem",
                      fontWeight: 850,
                      letterSpacing: "0.02em",
                      boxShadow: active
                        ? "0 10px 24px rgba(56,189,248,0.12)"
                        : "none",
                      opacity: loading ? 0.72 : 1,
                    }}
                    disabled={loading}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          )}

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
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                attachedFile
                  ? "Add a message about this file, or use SEND to ask about it..."
                  : isMobile
                    ? "Ask anything... tap SEND when ready."
                    : "Ask anything... Enter to send, Shift+Enter for a new line."
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
                backdropFilter: "blur(18px)",
                boxShadow:
                  "0 14px 40px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            />
          )}

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
    </div>
  );
}
