import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({
        text: "I’m here and ready. Ask me anything, and I’ll help you think it through.",
      });
    }

    const latestUserMessage =
      [...messages].reverse().find((m: { role: string; content: string }) => m.role === "user")?.content || "";

    const formattedConversation = messages
      .map((m: { role: string; content: string }) => {
        const speaker = m.role === "assistant" ? "SV" : "User";
        return `${speaker}: ${m.content}`;
      })
      .join("\n");

    const prompt = `
You are SVANS-AI, a broad, highly capable AI guide.

You help with:
- coding
- debugging
- learning
- planning
- writing
- analysis
- brainstorming
- general questions
- life guidance

Behavior:
- Be helpful and intelligent
- If asked about coding, answer directly and clearly
- If a user asks to learn something, guide them step by step
- Ask follow-up questions only when helpful
- Be natural, calm, and useful
- Do not sound robotic

Conversation:
${formattedConversation}

Respond as SVANS-AI.
`;

    let result;

    try {
      result = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
      });
    } catch (proError) {
      console.log("Pro unavailable — switching to Flash");

      try {
        result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });
      } catch (flashError) {
        console.error("SVANS-AI Flash Error:", flashError);

        return NextResponse.json({
          text: fallbackGuide(latestUserMessage),
        });
      }
    }

    const text =
      result?.text ||
      fallbackGuide(latestUserMessage);

    return NextResponse.json({ text });
  } catch (error) {
    console.error("SVANS-AI Route Error:", error);

    return NextResponse.json({
      text: "I’m still here. Give me a little more detail and I’ll help you work through it step by step.",
    });
  }
}

function fallbackGuide(question: string) {
  const q = question.toLowerCase();

  if (
    q.includes("python") ||
    q.includes("coding") ||
    q.includes("programming") ||
    q.includes("code")
  ) {
    return `Yes — I can still help you get started with coding.

A strong way to begin learning Python is:

1. Learn the basic building blocks:
- variables
- print statements
- input
- if statements
- loops
- functions

2. Practice tiny examples first, like:
- printing text
- adding two numbers
- asking for a name
- checking if a number is even or odd

3. Then start building small projects:
- calculator
- quiz game
- number guessing game
- to-do list

To guide you the right way, tell me this:
Are you starting from zero, or do you already know a little Python?`;
  }

  if (
    q.includes("life") ||
    q.includes("career") ||
    q.includes("future") ||
    q.includes("decision")
  ) {
    return `We can work through that together.

A good way to figure it out is:
1. Define the exact problem
2. List your options
3. Look at risks and benefits
4. Decide what matters most right now

Tell me what decision you’re trying to make, and I’ll help you break it down.`;
  }

  return `I’m still here with you. Even if my live model response is delayed, I can still help you think this through.

Let’s start here:
1. What are you trying to figure out?
2. What have you tried already?
3. Where exactly are you getting stuck?

Give me that, and I’ll guide you step by step.`;
}