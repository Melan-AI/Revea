import { NextRequest, NextResponse } from "next/server";

type EtherscanSourceResult = {
  SourceCode: string;
  ContractName?: string;
  CompilerVersion?: string;
  Language?: string;
};

type ParsedSource = {
  combinedSource: string;
  files: string[];
};

const ETHERSCAN_BASE_URL =
  process.env.ETHERSCAN_BASE_URL ?? "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;

const isAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value);

const parseEtherscanSource = (rawSource: string, contractName?: string): ParsedSource => {
  const trimmed = rawSource?.trim() ?? "";
  if (!trimmed) {
    return { combinedSource: "", files: contractName ? [contractName] : [] };
  }

  const maybeJson = trimmed.startsWith("{") || trimmed.startsWith("{{");
  if (!maybeJson) {
    return {
      combinedSource: trimmed,
      files: contractName ? [contractName] : ["Contract.sol"],
    };
  }

  try {
    const normalized =
      trimmed.startsWith("{{") && trimmed.endsWith("}}")
        ? trimmed.slice(1, -1)
        : trimmed;
    const parsed = JSON.parse(normalized);
    if (!parsed?.sources) {
      return {
        combinedSource: trimmed,
        files: contractName ? [contractName] : ["Contract.sol"],
      };
    }
    const entries = Object.entries(parsed.sources) as Array<
      [string, { content?: string } | string]
    >;
    const files = entries.map(([file]) => file);
    const combinedSource = entries
      .map(([file, data]) => {
        const content = typeof data === "string" ? data : data?.content ?? "";
        return `// File: ${file}\n${content}`;
      })
      .join("\n\n");
    return { combinedSource, files };
  } catch {
    return {
      combinedSource: trimmed,
      files: contractName ? [contractName] : ["Contract.sol"],
    };
  }
};

const buildAnalysisPrompt = (input: {
  address: string;
  contractName?: string;
  compilerVersion?: string;
  language?: string;
  source: string;
  retryNote?: string;
}) => {
  const sourceLimit = 20000;
  const trimmedSource =
    input.source.length > sourceLimit
      ? `${input.source.slice(0, sourceLimit)}\n// ... truncated`
      : input.source;

  return `You are a smart contract security analyst. Analyze the verified Ethereum contract below.

Provide plain-English, non-technical insights in 4-6 sentences. Use cautious language if details are missing. Avoid hype.
If a list would be empty, include a single item "None found" or "Not enough evidence".
${input.retryNote ? `\nRevision note: ${input.retryNote}\n` : ""}

Contract details:
- Address: ${input.address}
- Name: ${input.contractName ?? "Unknown"}
- Compiler: ${input.compilerVersion ?? "Unknown"}
- Language: ${input.language ?? "Unknown"}

Verified source:
${trimmedSource}`;
};

const analysisSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Plain-English summary in 3-5 sentences.",
    },
    safetyScore: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Safety score from 0 to 100.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Short bullet phrases describing risk signals.",
      minItems: 1,
    },
    permissions: {
      type: "array",
      items: { type: "string" },
      description: "Owner/admin capabilities and privileged roles.",
      minItems: 1,
    },
    redFlags: {
      type: "array",
      items: { type: "string" },
      description: "Critical concerns, if any.",
      minItems: 1,
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "Any assumptions made due to missing info.",
      minItems: 1,
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Confidence level for the analysis.",
    },
  },
  required: [
    "summary",
    "safetyScore",
    "risks",
    "permissions",
    "redFlags",
    "assumptions",
    "confidence",
  ],
  additionalProperties: false,
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
          temperature: 0.15,
          maxOutputTokens: 900,
          responseMimeType: "application/json",
          responseJsonSchema: analysisSchema,
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

const parseAnalysisJson = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response did not include JSON.");
  }
  const jsonText = text.slice(start, end + 1);
  return JSON.parse(jsonText);
};

const isWeakAnalysis = (analysis: {
  summary?: string;
  safetyScore?: number;
  risks?: unknown[];
  permissions?: unknown[];
  redFlags?: unknown[];
  assumptions?: unknown[];
}) => {
  const summary = String(analysis?.summary ?? "").trim();
  const summaryTooShort = summary.length < 220;
  const scoreInvalid =
    typeof analysis?.safetyScore !== "number" ||
    Number.isNaN(analysis?.safetyScore);
  const listEmpty = (list?: unknown[]) => !Array.isArray(list) || list.length === 0;
  return (
    summaryTooShort ||
    scoreInvalid ||
    listEmpty(analysis?.risks) ||
    listEmpty(analysis?.permissions) ||
    listEmpty(analysis?.redFlags) ||
    listEmpty(analysis?.assumptions)
  );
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const address = String(body?.address ?? "").trim();

    if (!isAddress(address)) {
      return NextResponse.json(
        { error: "Invalid Ethereum address." },
        { status: 400 }
      );
    }

    if (!ETHERSCAN_API_KEY) {
      return NextResponse.json(
        { error: "Missing ETHERSCAN_API_KEY in environment." },
        { status: 500 }
      );
    }

    const url = new URL(ETHERSCAN_BASE_URL);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("chainid", "1");
    url.searchParams.set("address", address);
    url.searchParams.set("apikey", ETHERSCAN_API_KEY);

    const sourceResponse = await fetch(url.toString());
    if (!sourceResponse.ok) {
      return NextResponse.json(
        { error: "Failed to reach Etherscan." },
        { status: 502 }
      );
    }
    const sourcePayload = await sourceResponse.json();
    if (sourcePayload?.status !== "1") {
      return NextResponse.json(
        {
          error:
            sourcePayload?.result ??
            "Etherscan did not return verified source.",
        },
        { status: 404 }
      );
    }

    const contractData: EtherscanSourceResult | undefined =
      sourcePayload?.result?.[0];

    const parsed = parseEtherscanSource(
      contractData?.SourceCode ?? "",
      contractData?.ContractName
    );

    if (!parsed.combinedSource) {
      return NextResponse.json(
        { error: "No verified source code found for this address." },
        { status: 404 }
      );
    }

    const basePrompt = buildAnalysisPrompt({
      address,
      contractName: contractData?.ContractName,
      compilerVersion: contractData?.CompilerVersion,
      language: contractData?.Language,
      source: parsed.combinedSource,
    });

    const responseText = await callGemini(basePrompt);
    let analysis: any;
    try {
      analysis = parseAnalysisJson(responseText);
    } catch {
      analysis = {
        summary:
          responseText ||
          "The model could not provide a structured response.",
        safetyScore: 0,
        risks: ["Unable to parse model output."],
        permissions: ["Not enough evidence."],
        redFlags: ["Output formatting issue."],
        assumptions: ["Model output was not valid JSON."],
        confidence: "low",
      };
    }

    if (isWeakAnalysis(analysis)) {
      const retryPrompt = buildAnalysisPrompt({
        address,
        contractName: contractData?.ContractName,
        compilerVersion: contractData?.CompilerVersion,
        language: contractData?.Language,
        source: parsed.combinedSource,
        retryNote:
          "Your previous output was incomplete. Ensure 4-6 sentences in summary, valid safetyScore, and all arrays populated with at least one item.",
      });
      try {
        const retryText = await callGemini(retryPrompt);
        analysis = parseAnalysisJson(retryText);
      } catch {
        // Keep the first response if retry fails.
      }
    }

    const normalized = {
      summary: String(analysis?.summary ?? "No summary available."),
      safetyScore: Math.max(
        0,
        Math.min(100, Number(analysis?.safetyScore ?? 0))
      ),
      risks: Array.isArray(analysis?.risks)
        ? analysis.risks.map((item: unknown) => String(item))
        : ["No specific risks listed."],
      permissions: Array.isArray(analysis?.permissions)
        ? analysis.permissions.map((item: unknown) => String(item))
        : ["No explicit admin permissions noted."],
      redFlags: Array.isArray(analysis?.redFlags)
        ? analysis.redFlags.map((item: unknown) => String(item))
        : ["No critical red flags identified."],
      assumptions: Array.isArray(analysis?.assumptions)
        ? analysis.assumptions.map((item: unknown) => String(item))
        : ["Analysis based on available verified source."],
      confidence:
        analysis?.confidence === "high" ||
        analysis?.confidence === "medium" ||
        analysis?.confidence === "low"
          ? analysis.confidence
          : "medium",
    };

    return NextResponse.json({
      analysis: normalized,
      contract: {
        address,
        name: contractData?.ContractName ?? null,
        compilerVersion: contractData?.CompilerVersion ?? null,
        sourceLanguage: contractData?.Language ?? null,
        files: parsed.files.length ? parsed.files : ["Contract.sol"],
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error during analysis.",
      },
      { status: 500 }
    );
  }
}
