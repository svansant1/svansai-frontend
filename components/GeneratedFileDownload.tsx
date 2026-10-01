"use client";

import { useEffect, useState } from "react";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const FORMATS: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

type FileAttachment = {
  filePreview: string;
  fileName: string;
  fileType: string;
};

function decodeBase64(value: string): Uint8Array {
  if (
    !value ||
    value.length > MAX_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(
      "The generated file is invalid or exceeds the 8 MB download limit.",
    );
  }
  const decoded = atob(value);
  if (decoded.length > MAX_FILE_BYTES)
    throw new Error("The generated file exceeds the 8 MB download limit.");
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function safeFilename(name: string, extension: string): string {
  const stem = name
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]*$/, "")
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/^\.+|[. ]+$/g, "")
    .slice(0, 110);
  return `${stem || "svans-ai-file"}.${extension}`;
}

/** Validate API data before attaching it to a message or exposing a download. */
export function artifactToChatFile(value: unknown): FileAttachment | null {
  if (value == null) return null;
  if (typeof value !== "object")
    throw new Error("The generated file response was invalid.");
  const artifact = value as Record<string, unknown>;
  const format = typeof artifact.format === "string" ? artifact.format : "";
  if (
    !Object.prototype.hasOwnProperty.call(FORMATS, format) ||
    artifact.mimeType !== FORMATS[format] ||
    typeof artifact.name !== "string" ||
    typeof artifact.base64 !== "string"
  ) {
    throw new Error("The generated file type is not supported for download.");
  }
  const bytes = decodeBase64(artifact.base64);
  if (typeof artifact.size !== "number" || artifact.size !== bytes.length) {
    throw new Error(
      "The generated file was incomplete. Please try generating it again.",
    );
  }
  // Office files must contain a ZIP package, never executable or plain-text bytes.
  if (
    ["docx", "pptx", "xlsx"].includes(format) &&
    !(
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    )
  ) {
    throw new Error("The generated Office file was invalid. Please try again.");
  }
  return {
    filePreview: `data:${FORMATS[format]};base64,${artifact.base64}`,
    fileName: safeFilename(artifact.name, format),
    fileType: FORMATS[format],
  };
}

/** A Blob URL works for real downloads and is released when the card unmounts. */
export default function GeneratedFileDownload({
  filePreview,
  fileName,
  fileType,
}: FileAttachment) {
  const [download, setDownload] = useState<{
    url: string;
    size: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let url = "";
    setDownload(null);
    setError("");
    try {
      const format = Object.keys(FORMATS).find(
        (key) => FORMATS[key] === fileType,
      );
      if (!format || !filePreview.startsWith(`data:${fileType};base64,`)) {
        throw new Error(
          "This saved file is not a supported generated download.",
        );
      }
      const bytes = decodeBase64(
        filePreview.slice(filePreview.indexOf(",") + 1),
      );
      url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: fileType }),
      );
      setDownload({ url, size: bytes.byteLength });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The download could not be prepared.",
      );
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [filePreview, fileType]);

  const extension =
    Object.keys(FORMATS).find((key) => FORMATS[key] === fileType) || "txt";
  return (
    <div
      style={{
        padding: "12px",
        marginBottom: "10px",
        borderRadius: "12px",
        border: "1px solid rgba(125,211,252,0.3)",
        background: "rgba(56,189,248,0.08)",
      }}
    >
      <div style={{ fontWeight: 750, overflowWrap: "anywhere" }}>
        📄 {fileName}
      </div>
      <div style={{ fontSize: "0.78rem", opacity: 0.75, margin: "5px 0 10px" }}>
        {extension.toUpperCase()} file
        {download
          ? ` · ${Math.max(1, Math.ceil(download.size / 1024))} KB`
          : ""}{" "}
        · Review before sharing
      </div>
      {download ? (
        <a
          href={download.url}
          download={safeFilename(fileName, extension)}
          style={{
            display: "inline-block",
            padding: "7px 12px",
            borderRadius: "8px",
            background: "#0e7490",
            color: "white",
            fontWeight: 750,
            textDecoration: "none",
          }}
        >
          Download {extension.toUpperCase()}
        </a>
      ) : (
        <span
          role={error ? "alert" : "status"}
          style={{ fontSize: "0.82rem", color: error ? "#fca5a5" : "inherit" }}
        >
          {error || "Preparing download…"}
        </span>
      )}
    </div>
  );
}
