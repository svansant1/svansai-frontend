"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  submitMessageFeedback,
  getFeedbackSummary,
  getTotalViews,
} from "@/lib/db/engagement";
import { supabase } from "@/lib/supabase";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  filePreview?: string;
  fileName?: string;
  fileType?: string;
  isPassword?: boolean;
  orchestration?: ChatOrchestration;
};

type ChatOrchestration = {
  route?: string;
  coordinator?: string;
  recommendedModules?: string[];
  responseMode?: string;
  capabilities?: string[];
  commandCenter?: string[];
  mind?: {
    primaryIntent?: string;
    confidence?: number;
    activeTask?: {
      type?: string;
      subject?: string;
      goal?: string;
    };
    permissionPosture?: {
      localFiles?: string;
      writes?: string;
      auditRequired?: boolean;
      note?: string;
    };
  };
  analytics?: {
    providerSelected?: string;
    qualityScore?: number;
    fallbackUsed?: boolean;
    liveSearchAttempted?: boolean;
    liveSearchResults?: number;
  };
};

type AttachedFile = {
  name: string;
  type: string;
  base64: string;
  dataUrl: string;
  size: number;
};

type ResponseMode = "auto" | "direct" | "guide" | "tutor" | "build" | "debug";
type WritingContext =
  | "general"
  | "casual"
  | "professional"
  | "academic"
  | "sensitive";
type MemoryCategory =
  | "writing_preference"
  | "learning_progress"
  | "personal_preference"
  | "project_context";
type ProfileMemory = { id: string; category: MemoryCategory; summary: string };

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
const MAX_ATTACHMENTS = 30;
const MAX_TOTAL_FILE_MB = 40;
const MAX_MESSAGE_CHARS = 30_000;
const ACCEPTED_EXTENSION_PATTERN =
  /\.(py|ts|tsx|js|jsx|java|c|cpp|cs|go|rb|rs|swift|kt|md|txt|json|html|css|csv|tsv|xlsx|pdf)$/i;

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
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  { id: "auto", label: "Auto", title: "Let SVANS-AI choose the best style" },
  {
    id: "direct",
    label: "Direct",
    title: "Answer first, then explain briefly",
  },
  { id: "guide", label: "Guide", title: "Show how to get the answer" },
  { id: "tutor", label: "Tutor", title: "Hint and coach before revealing" },
  {
    id: "build",
    label: "Build",
    title: "Plan, implement, and verify project changes",
  },
  {
    id: "debug",
    label: "Debug",
    title: "Diagnose problems and find the smallest fix",
  },
];

function formatLabel(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isImageType(type: string) {
  return type.startsWith("image/");
}

function isPdfType(type: string) {
  return type === "application/pdf";
}

function readBrowserFile(file: File): Promise<AttachedFile> {
  const browserFile = file as File & { webkitRelativePath?: string };
  const displayName = browserFile.webkitRelativePath || file.name;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${displayName}.`));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve({
        name: displayName,
        type: file.type || "text/plain",
        base64: dataUrl.split(",")[1] || "",
        dataUrl,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function extractAssistantImage(content: string) {
  const markerPattern =
    /\n?\n?\[\[SVANS_IMAGE:([^:\]]+):([^:\]]+):([A-Za-z0-9+/=]+)\]\]/;
  const match = content.match(markerPattern);
  if (!match) return { content, image: null };

  const [, type, name, base64] = match;
  return {
    content: content.replace(markerPattern, "").trim(),
    image: {
      filePreview: `data:${type};base64,${base64}`,
      fileName: name || "updated-checklist.svg",
      fileType: type || "image/svg+xml",
    },
  };
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

    const lines = paragraph.map((line) => line.trim()).filter(Boolean);
    paragraph = [];

    if (!lines.length) return;

    elements.push(
      <p
        key={`${blockKey}-p-${elements.length}`}
        style={{ margin: "0 0 12px" }}
      >
        {lines.map((line, index) => (
          <span key={`${blockKey}-p-line-${elements.length}-${index}`}>
            {renderInlineMarkdown(line)}
            {index < lines.length - 1 && <br />}
          </span>
        ))}
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

function normalizeQuizPaste(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const looksLikeQuiz =
    /\bGroup of answer choices\b/i.test(normalized) &&
    /\bQuestion\s+\d+/i.test(normalized);

  if (!looksLikeQuiz) {
    return text;
  }

  return normalized
    .replace(
      /\s*Flag question:\s*Question\s+(\d+)\s*/gi,
      "\n\n--------------------\n\nQuestion $1\n\n",
    )
    .replace(
      /\bQuestion\s+(\d+)\s+Question\s+\1\s*(\d+)\s*pts?\b/gi,
      "Question $1\n$2 pts\n\n",
    )
    .replace(
      /^Question\s+(\d+)\s*(\d+)\s*pts?\s*/i,
      "Question $1\n$2 pts\n\n",
    )
    .replace(
      /\s*Group of answer choices\s*/gi,
      "\n\nGroup of answer choices\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
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
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const [showVoiceProfile, setShowVoiceProfile] = useState(false);
  const [voiceContext, setVoiceContext] = useState<WritingContext>("general");
  const [voiceSample, setVoiceSample] = useState("");
  const [toneNotes, setToneNotes] = useState("");
  const [preserveVoice, setPreserveVoice] = useState(true);
  const [correctEnglish, setCorrectEnglish] = useState(true);
  const [preserveSlang, setPreserveSlang] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [profileMemories, setProfileMemories] = useState<ProfileMemory[]>([]);
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>(
    "personal_preference",
  );
  const [memorySummary, setMemorySummary] = useState("");
  const [showAttachmentDetails, setShowAttachmentDetails] = useState(false);
  const attachedFile = attachedFiles[0] ?? null;
  const attachmentTotalKb = Math.round(
    attachedFiles.reduce((sum, file) => sum + file.size, 0) / 1024,
  );
  const attachedFolderNames = Array.from(
    new Set(
      attachedFiles
        .filter((file) => /[\\/]/.test(file.name))
        .map((file) => file.name.split(/[\\/]/)[0])
        .filter(Boolean),
    ),
  );
  const attachmentSummaryLabel =
    attachedFolderNames.length === 1
      ? attachedFolderNames[0]
      : attachedFolderNames.length > 1
        ? `${attachedFolderNames.length} folders`
        : attachedFiles.length === 1
          ? attachedFiles[0]?.name
          : `${attachedFiles.length} files`;

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const onMessagesChangeRef = useRef(onMessagesChange);

  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

  useEffect(() => {
    if (!/^Added\b/.test(fileError)) return;

    const timer = window.setTimeout(() => {
      setFileError((current) => (/^Added\b/.test(current) ? "" : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [fileError]);

  const sessionId = useMemo(() => {
    if (typeof window === "undefined") return "ssr";

    const key = "SVANS-AI-session-id";
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
    if (conversationId && initialMessages !== undefined) {
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

    if (conversationId) return;

    setMessages([
      {
        role: "assistant",
        content: user
          ? "What would you like help with today?"
          : "What would you like help with today? I can guide you step by step. You can also attach images, PDFs, or code files.",
      },
    ]);
  }, [user, initialMessages, conversationId]);

  const handleModuleBadgeClick = (item: string) => {
    const normalized = item.toLowerCase();
    if (normalized.includes("debugger") || normalized.includes("debug")) {
      setResponseMode("debug");
      setInput((current) => current || "Help me debug this.");
    } else if (normalized.includes("sandbox") || normalized.includes("build")) {
      setResponseMode("build");
      setInput((current) => current || "Help me test this safely in Sandbox.");
    } else if (
      normalized.includes("shield") ||
      normalized.includes("protect")
    ) {
      setInput((current) => current || "Check this for safety and risk.");
    } else if (normalized.includes("teaching")) {
      setResponseMode("tutor");
    } else if (normalized.includes("writing")) {
      setInput((current) => current || "Help me refine this writing.");
    }
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const chatScroll = chatScrollRef.current;
    if (!chatScroll) return;

    chatScroll.scrollTo({
      top: chatScroll.scrollHeight,
      behavior: "smooth",
    });
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

  useEffect(() => {
    if (!showVoiceProfile || !user) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch("/api/profile/writing", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const result = await response.json();
        const profile = result?.profile;
        if (profile) {
          setVoiceContext(profile.defaultContext ?? "general");
          setToneNotes(profile.toneNotes ?? "");
          setPreserveVoice(profile.preserveVoice ?? true);
          setCorrectEnglish(profile.correctEnglish ?? true);
          setPreserveSlang(profile.preserveIntentionalSlang ?? true);
        }
      }

      const memoryResponse = await fetch("/api/profile/memory", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (memoryResponse.ok) {
        const memoryResult = await memoryResponse.json();
        setProfileMemories(memoryResult?.memories ?? []);
      }
    })();
  }, [showVoiceProfile, user]);

  const saveVoiceProfile = async () => {
    if (!user) {
      onRequestLogin();
      return;
    }
    setVoiceStatus("Saving...");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setVoiceStatus("Please sign in again.");
      return;
    }
    const samples = voiceSample.trim()
      ? { [voiceContext]: [voiceSample.trim()] }
      : undefined;
    const response = await fetch("/api/profile/writing", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        preserveVoice,
        correctEnglish,
        preserveIntentionalSlang: preserveSlang,
        defaultContext: voiceContext,
        toneNotes,
        ...(samples ? { samples } : {}),
      }),
    });
    setVoiceStatus(
      response.ok ? "Voice profile saved." : "Could not save the profile.",
    );
    if (response.ok) setVoiceSample("");
  };

  const addProfileMemory = async () => {
    if (!memorySummary.trim()) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return onRequestLogin();
    const response = await fetch("/api/profile/memory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        category: memoryCategory,
        summary: memorySummary,
      }),
    });
    if (response.ok) {
      setMemorySummary("");
      setShowVoiceProfile(false);
      setTimeout(() => setShowVoiceProfile(true), 0);
    }
  };

  const deleteProfileMemory = async (id?: string) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch(
      `/api/profile/memory${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (response.ok)
      setProfileMemories((current) =>
        id ? current.filter((memory) => memory.id !== id) : [],
      );
  };

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
    const rawSelected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!rawSelected.length) return;

    const validSelected = rawSelected.filter((file) => {
      const acceptedExtension = ACCEPTED_EXTENSION_PATTERN.test(file.name);
      return (
        (ACCEPTED_TYPES.includes(file.type) || acceptedExtension) &&
        file.size <= MAX_FILE_MB * 1024 * 1024
      );
    });

    if (!validSelected.length) {
      setFileError(
        `No supported files were found. Supported folder files include code, text, markdown, PDFs, images, CSV/TSV, JSON, HTML/CSS, and Excel files up to ${MAX_FILE_MB}MB each.`,
      );
      return;
    }

    const selected = validSelected.slice(
      0,
      Math.max(0, MAX_ATTACHMENTS - attachedFiles.length),
    );

    if (!selected.length) {
      setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    if (attachedFiles.length + selected.length > MAX_ATTACHMENTS) {
      setFileError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }

    if (rawSelected.length !== validSelected.length) {
      setFileError(
        `Added ${selected.length} supported file${selected.length === 1 ? "" : "s"}. Skipped ${rawSelected.length - validSelected.length} unsupported or oversized item${rawSelected.length - validSelected.length === 1 ? "" : "s"}.`,
      );
    }

    const totalBytes = [...attachedFiles, ...selected].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    if (totalBytes > MAX_TOTAL_FILE_MB * 1024 * 1024) {
      setFileError(
        `Combined attachments cannot exceed ${MAX_TOTAL_FILE_MB}MB.`,
      );
      return;
    }

    const converted = await Promise.all(selected.map(readBrowserFile));
    setAttachedFiles((current) =>
      [...current, ...converted].slice(0, MAX_ATTACHMENTS),
    );
    setShowAttachmentDetails(false);

    if (
      rawSelected.length > selected.length &&
      rawSelected.length === validSelected.length
    ) {
      setFileError(
        `Added the first ${selected.length} supported files. Folder review is limited to ${MAX_ATTACHMENTS} files per message.`,
      );
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setFileError("");
  };

  const moveAttachment = (index: number, direction: -1 | 1) => {
    setAttachedFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const inferThinkingStatus = (
    message: string,
    filesToSend: AttachedFile[],
  ) => {
    const normalized = message.toLowerCase();

    if (
      /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/.test(
        normalized,
      )
    ) {
      return "Generating image...";
    }

    if (
      /\b(sc(a|u)m|fraud|legit|trustworthy|bbb|safe site|fake site)\b/.test(
        normalized,
      )
    ) {
      return "Checking site reputation...";
    }

    if (
      /\b(search|browse|internet|current|latest|today|source|research|website|url|domain)\b/.test(
        normalized,
      )
    ) {
      return "Searching web...";
    }

    if (
      /\b(answer choices|group of answer choices|quiz|homework|complete the|sample output)\b/.test(
        normalized,
      )
    ) {
      return "Using education solver...";
    }

    if (filesToSend.length) {
      if (filesToSend.some((file) => /[\\/]/.test(file.name))) {
        return "Analyzing folder upload...";
      }
      if (filesToSend.every((file) => isImageType(file.type))) {
        return `Analyzing ${filesToSend.length} image${filesToSend.length === 1 ? "" : "s"}...`;
      }
      if (filesToSend.some((file) => isPdfType(file.type))) {
        return "Reading your documents...";
      }
      return "Reading your files...";
    }

    return "Thinking it through...";
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
    if ((!input.trim() && attachedFiles.length === 0) || loading) return;

    if (input.length > MAX_MESSAGE_CHARS) {
      setFileError(
        `That paste is too long for one message (${input.length.toLocaleString()} characters). Split it into smaller parts or attach it as a .txt/PDF file. Example: "Summarize the OS components section" or "Make 10 quiz questions from this section."`,
      );
      return;
    }

    const userCount = messages.filter((m) => m.role === "user").length;

    if (!user && userCount >= GUEST_LIMIT && !loginDismissed) {
      setLoginDismissed(true);
      onRequestLogin();
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content:
        input.trim() ||
        (attachedFiles.length
          ? attachedFiles.every((file) => isImageType(file.type))
            ? `Please analyze this image. [Attached: ${attachedFiles.map((file) => file.name).join(", ")}]`
            : `[Attached: ${attachedFiles.map((file) => file.name).join(", ")}]`
          : ""),
      filePreview: attachedFile?.dataUrl,
      fileName: attachedFile?.name,
      fileType: attachedFile?.type,
      isPassword: isPasswordMode,
    };

    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    onMessagesChangeRef.current?.(nextMessages);
    setInput("");

    const filesToSend = attachedFiles;

    setAttachedFiles([]);
    setShowAttachmentDetails(false);
    setFileError("");
    setLoading(true);

    notifyThinking(true, inferThinkingStatus(userMessage.content, filesToSend));

    try {
      const body: Record<string, unknown> = {
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        sessionId,
        responseMode,
      };

      if (filesToSend.length) {
        body.files = filesToSend.map((file) => ({
          name: file.name,
          type: file.type,
          base64: file.base64,
        }));
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          if (typeof errorData?.error === "string") {
            errorMessage = errorData.error;
          } else if (typeof errorData?.text === "string") {
            errorMessage = errorData.text;
          }
        } catch {
          // keep the HTTP fallback
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      const replySource =
        data?.text ?? data?.response ?? data?.answer ?? data?.message ?? "";

      const rawReply =
        typeof replySource === "string" && replySource.trim()
          ? replySource.trim()
          : "I processed that but didn't generate a response. Try sending it again.";
      const assistantImage = extractAssistantImage(rawReply);
      const reply = assistantImage.content || "Done.";

      checkPasswordMode(reply);

      const finalMessages = [
        ...nextMessages,
        {
          role: "assistant" as const,
          content: reply,
          orchestration: data?.orchestration,
          ...(assistantImage.image ?? {}),
        },
      ];

      setMessages(finalMessages);
      notifyThinking(false, "Ready to help.");

      onMessagesChangeRef.current?.(finalMessages);
    } catch (error) {
      console.error("SEND_ERROR:", error);
      const message =
        error instanceof Error &&
        error.message &&
        !/^HTTP \d+$/i.test(error.message)
          ? error.message
          : "Something interrupted my response. Please send it again and I'll pick right back up.";

      setIsPasswordMode(false);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: message,
        },
      ]);
      notifyThinking(false, "Still here.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async (
  e: React.ClipboardEvent<HTMLTextAreaElement>,
) => {
  const pastedText = e.clipboardData.getData("text/plain");

  if (pastedText && input.length + pastedText.length > MAX_MESSAGE_CHARS) {
    e.preventDefault();

    setFileError(
      `That paste is larger than one chat message can handle. Split it into smaller parts or attach it as a .txt/PDF file. Example: "Explain the kernel with an example" or "Quiz me on file systems."`,
    );

    return;
  }

  const formattedText = normalizeQuizPaste(pastedText);

  if (formattedText !== pastedText) {
    e.preventDefault();

    const textarea = e.currentTarget;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;

    const nextInput =
      input.slice(0, selectionStart) +
      formattedText +
      input.slice(selectionEnd);

    setInput(nextInput);

    window.requestAnimationFrame(() => {
      const cursorPosition = selectionStart + formattedText.length;

      textareaRef.current?.setSelectionRange(
        cursorPosition,
        cursorPosition,
      );
    });
  }

  const items = e.clipboardData.items;

  for (let i = 0; i < items.length; i += 1) {
    if (!items[i].type.includes("image")) continue;

    const file = items[i].getAsFile();
    if (!file) continue;

    const reader = new FileReader();

    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl !== "string") return;

      setAttachedFiles((current) =>
        [
          ...current,
          {
            name: "pasted-image.png",
            type: file.type,
            base64: dataUrl.split(",")[1] || "",
            dataUrl,
            size: file.size,
          },
        ].slice(0, MAX_ATTACHMENTS),
      );
    };

    reader.readAsDataURL(file);

    if (attachedFiles.length >= MAX_ATTACHMENTS) break;
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
        height: "100%",
        minHeight: 0,
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
        ref={chatScrollRef}
        style={{
          width: "100%",
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: "none",
          overflowY: "auto",
          overflowX: "hidden",
          marginBottom: isMobile ? "14px" : "18px",
          padding: isMobile ? "2px 10px 18px 0" : "4px 14px 4px 0",
          borderRadius: "18px",
          scrollBehavior: "smooth",
          scrollbarGutter: "stable",
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
                  {msg.role === "user" ? "You" : "SVANS-AI"}
                </strong>

                {msg.role === "assistant" && msg.orchestration && (
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      flexWrap: "wrap",
                      marginBottom: "8px",
                      alignItems: "center",
                      paddingBottom: "6px",
                      borderBottom: "1px solid rgba(125,211,252,0.1)",
                    }}
                    aria-label="SVANS-AI module metadata"
                  >
                    <span
                      style={{
                        color: "rgba(186,230,253,0.68)",
                        fontSize: "0.66rem",
                        fontWeight: 900,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Modules used
                    </span>
                    {[
                      ...(msg.orchestration.recommendedModules ?? []),
                      ...(msg.orchestration.capabilities ?? []),
                    ]
                      .slice(0, 8)
                      .map((item) => (
                        <button
                          key={`${i}-${item}`}
                          type="button"
                          onClick={() => handleModuleBadgeClick(item)}
                          title={`Use ${formatLabel(item)}`}
                          style={{
                            fontSize: "0.68rem",
                            letterSpacing: "0.04em",
                            padding: "3px 7px",
                            borderRadius: "999px",
                            color: "#bae6fd",
                            border: "1px solid rgba(125,211,252,0.22)",
                            background: "rgba(56,189,248,0.08)",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {formatLabel(item)}
                        </button>
                      ))}
                  </div>
                )}

                {msg.role === "assistant" &&
                  msg.orchestration?.commandCenter?.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gap: "6px",
                        marginBottom: "10px",
                        padding: "9px 10px",
                        borderRadius: "14px",
                        border: "1px solid rgba(125,211,252,0.16)",
                        background:
                          "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(168,85,247,0.06))",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                          flexWrap: "wrap",
                          color: "#bae6fd",
                          fontSize: "0.72rem",
                          fontWeight: 900,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        SVANS-Mind
                        {typeof msg.orchestration.mind?.confidence ===
                          "number" && (
                          <span
                            style={{
                              color: "rgba(226,232,240,0.72)",
                              fontWeight: 800,
                              letterSpacing: "0.02em",
                              textTransform: "none",
                            }}
                          >
                            {Math.round(
                              msg.orchestration.mind.confidence * 100,
                            )}
                            % confidence
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        {msg.orchestration.commandCenter
                          .slice(0, 6)
                          .map((status) => (
                            <span
                              key={`${i}-${status}`}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "999px",
                                background: "rgba(15,23,42,0.36)",
                                border: "1px solid rgba(148,163,184,0.16)",
                                color: "rgba(226,232,240,0.9)",
                                fontSize: "0.72rem",
                                fontWeight: 750,
                              }}
                            >
                              {status}
                            </span>
                          ))}
                      </div>
                      {msg.orchestration.mind?.permissionPosture?.note && (
                        <div
                          style={{
                            color: "rgba(226,232,240,0.68)",
                            fontSize: "0.72rem",
                          }}
                        >
                          Permission:{" "}
                          {msg.orchestration.mind.permissionPosture.note}
                        </div>
                      )}
                    </div>
                  )}

                {msg.filePreview && isImageType(msg.fileType || "") && (
                  <div style={{ marginBottom: "8px" }}>
                    <img
                      src={msg.filePreview}
                      alt={msg.fileName || "Attached image"}
                      style={{
                        maxWidth: "100%",
                        maxHeight: msg.role === "assistant" ? "420px" : "220px",
                        borderRadius: "10px",
                        marginBottom: "8px",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                    {msg.role === "assistant" && (
                      <a
                        href={msg.filePreview}
                        download={msg.fileName || "svans-ai-image.png"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "7px 10px",
                          borderRadius: "999px",
                          border: "1px solid rgba(125,211,252,0.24)",
                          background: "rgba(56,189,248,0.09)",
                          color: "#bae6fd",
                          textDecoration: "none",
                          fontSize: "0.78rem",
                          fontWeight: 850,
                        }}
                      >
                        ⬇ Download image
                      </a>
                    )}
                  </div>
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

        <div />
      </div>

      <div
        style={{
          width: "100%",
          flex: "0 0 auto",
          transition: "margin-top 0.25s ease",
          boxSizing: "border-box",
        }}
      >
        {attachedFiles.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginBottom: "10px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                background: "rgba(56,189,248,0.08)",
                border: "1px solid rgba(56,189,248,0.22)",
                borderRadius: "14px",
                padding: "9px 12px",
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: "1.35rem" }}>
                {attachedFolderNames.length ? "🗂️" : "📎"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "#7dd3fc",
                    fontSize: "0.68rem",
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {attachedFolderNames.length ? "Folder ready" : "Files ready"}
                </div>
                <div
                  style={{
                    color: "white",
                    fontSize: "0.86rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {attachmentSummaryLabel}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.48)",
                    fontSize: "0.72rem",
                  }}
                >
                  {attachedFiles.length} file
                  {attachedFiles.length === 1 ? "" : "s"} • {attachmentTotalKb}{" "}
                  KB
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAttachmentDetails((current) => !current)}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: "999px",
                  color: "white",
                  cursor: "pointer",
                  padding: "7px 11px",
                  fontSize: "0.76rem",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {showAttachmentDetails ? "Hide files" : "Show files"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachedFiles([]);
                  setShowAttachmentDetails(false);
                  setFileError("");
                }}
                aria-label="Clear attachments"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: "999px",
                  color: "white",
                  cursor: "pointer",
                  width: "30px",
                  height: "30px",
                }}
              >
                ×
              </button>
            </div>

            {showAttachmentDetails && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "1fr"
                    : "repeat(2, minmax(0, 1fr))",
                  gap: "8px",
                  maxHeight: isMobile ? "180px" : "220px",
                  overflowY: "auto",
                  paddingRight: "3px",
                }}
              >
                {attachedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      background: "rgba(56,189,248,0.06)",
                      border: "1px solid rgba(56,189,248,0.14)",
                      borderRadius: "14px",
                      padding: "8px 10px",
                      minWidth: 0,
                    }}
                  >
                    {isImageType(file.type) ? (
                      <img
                        src={file.dataUrl}
                        alt={file.name}
                        style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "8px",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: "1.15rem" }}>
                        {isPdfType(file.type) ? "📄" : "📎"}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: "#7dd3fc",
                          fontSize: "0.65rem",
                          fontWeight: 900,
                        }}
                      >
                        FILE {index + 1}
                      </div>
                      <div
                        style={{
                          color: "white",
                          fontSize: "0.78rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {file.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      aria-label={`Remove ${file.name}`}
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        borderRadius: "999px",
                        color: "white",
                        cursor: "pointer",
                        width: "26px",
                        height: "26px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            <div style={{ marginBottom: "10px" }}>
              <button
                type="button"
                onClick={() => setShowVoiceProfile((value) => !value)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "12px",
                  border: "1px solid rgba(125,211,252,0.25)",
                  background: "rgba(56,189,248,0.08)",
                  color: "#bae6fd",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Voice Profile
              </button>
              {showVoiceProfile && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "12px",
                    borderRadius: "14px",
                    background: "rgba(15,23,42,0.55)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginBottom: "8px",
                    }}
                  >
                    <select
                      value={voiceContext}
                      onChange={(event) =>
                        setVoiceContext(event.target.value as WritingContext)
                      }
                      style={{
                        padding: "8px",
                        borderRadius: "9px",
                        background: "#0f172a",
                        color: "white",
                      }}
                    >
                      {(
                        [
                          "general",
                          "casual",
                          "professional",
                          "academic",
                          "sensitive",
                        ] as const
                      ).map((context) => (
                        <option key={context} value={context}>
                          {context}
                        </option>
                      ))}
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        checked={preserveVoice}
                        onChange={(event) =>
                          setPreserveVoice(event.target.checked)
                        }
                      />{" "}
                      Preserve my voice
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={correctEnglish}
                        onChange={(event) =>
                          setCorrectEnglish(event.target.checked)
                        }
                      />{" "}
                      Correct English
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={preserveSlang}
                        onChange={(event) =>
                          setPreserveSlang(event.target.checked)
                        }
                      />{" "}
                      Keep intentional slang
                    </label>
                  </div>
                  <input
                    value={toneNotes}
                    onChange={(event) => setToneNotes(event.target.value)}
                    placeholder="Tone notes, such as warm, direct, and concise"
                    style={{
                      width: "100%",
                      padding: "9px",
                      marginBottom: "8px",
                      borderRadius: "9px",
                      boxSizing: "border-box",
                    }}
                  />
                  <textarea
                    value={voiceSample}
                    onChange={(event) => setVoiceSample(event.target.value)}
                    placeholder="Optional approved writing sample (20+ characters)"
                    style={{
                      width: "100%",
                      minHeight: "70px",
                      padding: "9px",
                      borderRadius: "9px",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginTop: "8px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={saveVoiceProfile}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "9px",
                        border: 0,
                        background: "#38bdf8",
                        color: "#020617",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Save profile
                    </button>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      {voiceStatus}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: "14px",
                      paddingTop: "12px",
                      borderTop: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <strong>User-controlled memory</strong>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        marginTop: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <select
                        value={memoryCategory}
                        onChange={(event) =>
                          setMemoryCategory(
                            event.target.value as MemoryCategory,
                          )
                        }
                        style={{
                          padding: "8px",
                          borderRadius: "9px",
                          background: "#0f172a",
                          color: "white",
                        }}
                      >
                        <option value="writing_preference">
                          Writing preference
                        </option>
                        <option value="learning_progress">
                          Learning progress
                        </option>
                        <option value="personal_preference">
                          Personal preference
                        </option>
                        <option value="project_context">Project context</option>
                      </select>
                      <input
                        value={memorySummary}
                        onChange={(event) =>
                          setMemorySummary(event.target.value)
                        }
                        placeholder="What should SVANS-AI remember?"
                        style={{
                          flex: 1,
                          minWidth: "220px",
                          padding: "8px",
                          borderRadius: "9px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={addProfileMemory}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "9px",
                          cursor: "pointer",
                        }}
                      >
                        Remember
                      </button>
                      {profileMemories.length > 0 && (
                        <button
                          type="button"
                          onClick={() => deleteProfileMemory()}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "9px",
                            cursor: "pointer",
                          }}
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {profileMemories.map((memory) => (
                      <div
                        key={memory.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          marginTop: "7px",
                          fontSize: "0.82rem",
                        }}
                      >
                        <span>
                          <strong>
                            {memory.category.replaceAll("_", " ")}:
                          </strong>{" "}
                          {memory.summary}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteProfileMemory(memory.id)}
                          aria-label="Delete memory"
                          style={{
                            border: 0,
                            background: "transparent",
                            color: "#fca5a5",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!isPasswordMode && (
            <div
              aria-label="Response mode"
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "repeat(3, minmax(0, 1fr))"
                  : showAdvancedModes
                    ? "repeat(6, minmax(0, 1fr))"
                    : "minmax(0, 1fr) auto",
                gap: "8px",
                marginBottom: isMobile ? "12px" : "10px",
              }}
            >
              {RESPONSE_MODES.filter(
                (mode) => showAdvancedModes || mode.id === "auto",
              ).map((mode) => {
                const active = responseMode === mode.id;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    title={mode.title}
                    aria-pressed={active}
                    onClick={() => setResponseMode(mode.id)}
                    style={{
                      padding: isMobile ? "9px 8px" : "8px 12px",
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
              {!showAdvancedModes && (
                <button
                  type="button"
                  onClick={() => setShowAdvancedModes(true)}
                  style={{
                    padding: isMobile ? "9px 8px" : "8px 12px",
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.045)",
                    color: "rgba(255,255,255,0.72)",
                    cursor: "pointer",
                    fontSize: isMobile ? "0.78rem" : "0.84rem",
                    fontWeight: 850,
                  }}
                >
                  Advanced modes
                </button>
              )}
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
                minHeight: isMobile ? "100px" : "92px",
                backgroundColor: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: "20px",
                padding: isMobile ? "16px" : "16px 18px",
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
              marginTop: isMobile ? "14px" : "10px",
              alignItems: "center",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={
                ACCEPTED_TYPES.join(",") +
                ",.py,.ts,.tsx,.js,.jsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.swift,.kt,.md,.txt,.json,.html,.css,.csv,.tsv,.xlsx,.pdf"
              }
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept={
                ACCEPTED_TYPES.join(",") +
                ",.py,.ts,.tsx,.js,.jsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.swift,.kt,.md,.txt,.json,.html,.css,.csv,.tsv,.xlsx,.pdf"
              }
              onChange={handleFileSelect}
              style={{ display: "none" }}
              {...{ webkitdirectory: "", directory: "" }}
            />

            {!isPasswordMode && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title="Attach file"
                  style={{
                    padding: isMobile ? "14px 18px" : "12px 16px",
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
                <button
                  onClick={() => folderInputRef.current?.click()}
                  disabled={loading}
                  title="Attach folder"
                  style={{
                    padding: isMobile ? "14px 18px" : "12px 16px",
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
                  🗂️
                </button>
              </>
            )}

            <button
              onClick={handleSend}
              disabled={loading}
              style={{
                flex: 1,
                padding: isMobile ? "14px" : "12px",
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
