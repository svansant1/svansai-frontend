"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionErrorEventLike = Event & { error?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Props = {
  assistantText: string;
  busy: boolean;
  onUtterance: (text: string) => void | Promise<void>;
};

export default function SvansVoiceConversation({
  assistantText,
  busy,
  onUtterance,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState("Voice standby");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const enabledRef = useRef(false);
  const busyRef = useRef(busy);
  const speakingRef = useRef(false);
  const onUtteranceRef = useRef(onUtterance);
  const lastSpokenRef = useRef(assistantText);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (
      !enabledRef.current ||
      busyRef.current ||
      speakingRef.current ||
      recognitionRef.current
    ) {
      return;
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setStatus("Voice input is not supported in this browser");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let heard = "";
      let finalText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const phrase = result?.[0]?.transcript?.trim() ?? "";
        heard += `${phrase} `;
        if (result?.isFinal) finalText += `${phrase} `;
      }
      setTranscript(heard.trim());
      if (finalText.trim()) {
        busyRef.current = true;
        setStatus("SVANS is thinking…");
        recognition.stop();
        void onUtteranceRef.current(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        enabledRef.current = false;
        setEnabled(false);
        setStatus("Microphone permission is required");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setStatus("I lost the microphone. Tap Talk to reconnect.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (enabledRef.current && !busyRef.current && !speakingRef.current) {
        window.setTimeout(startListening, 450);
      }
    };

    try {
      recognition.start();
      setListening(true);
      setStatus("Listening…");
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, []);

  useEffect(() => {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSupported(Boolean(Recognition));
    return () => {
      enabledRef.current = false;
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!enabled || busy || speakingRef.current) return;
    const timer = window.setTimeout(startListening, 250);
    return () => window.clearTimeout(timer);
  }, [busy, enabled, startListening]);

  useEffect(() => {
    const reply = assistantText.trim();
    if (!enabled || busy || !reply || reply === lastSpokenRef.current) return;

    lastSpokenRef.current = reply;
    stopListening();
    if (!("speechSynthesis" in window)) {
      setStatus("Ready");
      startListening();
      return;
    }

    speakingRef.current = true;
    setStatus("SVANS is speaking…");
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    utterance.onend = () => {
      speakingRef.current = false;
      setTranscript("");
      setStatus("Listening…");
      startListening();
    };
    utterance.onerror = utterance.onend;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [assistantText, busy, enabled, startListening, stopListening]);

  const toggle = () => {
    if (enabled) {
      enabledRef.current = false;
      setEnabled(false);
      stopListening();
      window.speechSynthesis?.cancel();
      speakingRef.current = false;
      setStatus("Voice standby");
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    setStatus("Connecting microphone…");
    startListening();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
        padding: "9px 11px",
        borderRadius: "14px",
        border: enabled
          ? "1px solid rgba(56,189,248,0.42)"
          : "1px solid rgba(255,255,255,0.1)",
        background: enabled
          ? "linear-gradient(135deg, rgba(56,189,248,0.13), rgba(168,85,247,0.08))"
          : "rgba(255,255,255,0.035)",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={!supported}
        aria-pressed={enabled}
        style={{
          border: 0,
          borderRadius: "999px",
          padding: "8px 12px",
          background: enabled ? "#38bdf8" : "rgba(255,255,255,0.09)",
          color: enabled ? "#020617" : "white",
          cursor: supported ? "pointer" : "not-allowed",
          fontWeight: 900,
          whiteSpace: "nowrap",
        }}
      >
        {enabled ? "■ End voice" : "● Talk with SVANS"}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: listening ? "#7dd3fc" : "#cbd5e1", fontSize: "0.76rem", fontWeight: 800 }}>
          {status}
        </div>
        {transcript && (
          <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            “{transcript}”
          </div>
        )}
      </div>
    </div>
  );
}
