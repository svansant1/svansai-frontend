import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ text: "Please enter a question." }, { status: 400 });
    }

    const prompt = `
You are SV, a tutoring AI for students of all ages.

Rules:
- Be helpful and clear
- Break questions down step by step
- Do not always jump straight to the final answer
- Guide the student when possible
- Keep explanations easy to understand unless they ask for advanced detail

Student question:
${message}
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text =
      result.text ||
      "I’m connected, but I didn’t generate a response.";

    return NextResponse.json({ text });
  } catch (error) {
    console.error("SV Neural Error:", error);
    return NextResponse.json(
      { text: "System Error: Brain link failed." },
      { status: 500 }
    );
  }
}