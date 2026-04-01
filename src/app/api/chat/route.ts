import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;

const buildChatPrompt = (input: {
  question: string;
  analysis: {
    analysis: {
      summary: string;
      safetyScore: number;
      risks: string[];
      permissions: string[];
      redFlags: string[];
      assumptions: string[];
      confidence: string;
    };
    contract: {
      address: string;
      name: string | null;
      compilerVersion: string | null;
      sourceLanguage: string | null;
      files: string[];
    };
  };
}) => {
  const { analysis, contract } = input.analysis;
  return `You are a contract guardian answering non-technical user questions.
Answer ONLY using the analysis context provided. If the question is not covered,
say you don't have enough evidence and suggest what to verify. Keep it concise.

Contract details:
- Address: ${contract.address}
- Name: ${contract.name ?? "Unknown"}
- Compiler: ${contract.compilerVersion ?? "Unknown"}
- Language: ${contract.sourceLanguage ?? "Unknown"}
- Files: ${contract.files.join(", ")}

Analysis summary:
${analysis.summary}

Safety score: ${analysis.safetyScore}/100
Risks: ${analysis.risks.join("; ")}
Permissions: ${analysis.permissions.join("; ")}
Red flags: ${analysis.redFlags.join("; ")}
Assumptions: ${analysis.assumptions.join("; ")}
Confidence: ${analysis.confidence}

User question: ${input.question}`;
};

const callGemini = async (prompt: string) => {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in environment.");
  }
  if (!GEMINI_MODEL) {
    throw new Error("Missing GEMINI_MODEL in environment.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 400,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new Error(
        "Gemini quota exceeded for this model. Try switching GEMINI_MODEL to gemini-2.5-flash or enable billing in Google AI Studio."
      );
    }
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("") ?? "";
  return text.trim();
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const question = String(body?.question ?? "").trim();
    const analysis = body?.analysis;

    if (!question) {
      return NextResponse.json(
        { error: "Missing question." },
        { status: 400 }
      );
    }
    if (!analysis?.analysis || !analysis?.contract) {
      return NextResponse.json(
        { error: "Missing analysis context." },
        { status: 400 }
      );
    }

    const prompt = buildChatPrompt({ question, analysis });
    const answer = await callGemini(prompt);

    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while chatting.",
      },
      { status: 500 }
    );
  }
}
