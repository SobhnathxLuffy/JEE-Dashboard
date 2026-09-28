// ─── /api/ai — thin OpenAI-compatible proxy (BYO endpoint) ───────────────────
// The client sends { baseUrl, apiKey, model, messages, … } with EVERY request;
// nothing is stored, logged or cached server-side. This route only exists so
// the browser avoids cross-origin calls and so provider errors become friendly
// messages. Works with any OpenAI-shaped API: AI Credits, OpenRouter, DeepSeek
// direct, Gemini's OpenAI-compat layer, local Ollama, …

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiProxyBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  jsonMode?: boolean;
}

function upstreamUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed; // full endpoint pasted
  return `${trimmed}/chat/completions`;
}

async function forward(
  body: AiProxyBody,
  useJsonMode: boolean
): Promise<Response> {
  const endpoint = upstreamUrl(body.baseUrl!);
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    stream: body.stream === true,
  };
  if (body.stream === true) payload.stream_options = { include_usage: true };
  if (useJsonMode) payload.response_format = { type: "json_object" };

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${body.apiKey}`,
    },
    body: JSON.stringify(payload),
    // extraction + coach reports can be long; explanation streams meanwhile
    signal: AbortSignal.timeout(280_000),
  });
}

export async function POST(req: Request) {
  let body: AiProxyBody;
  try {
    body = (await req.json()) as AiProxyBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.baseUrl || !body.apiKey || !body.model || !Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: "Missing baseUrl / apiKey / model / messages — set them up in AI settings." },
      { status: 400 }
    );
  }

  let upstream: Response;
  try {
    upstream = await forward(body, body.jsonMode === true);
    // json_object is unsupported by some models/proxies — retry plain once
    if (!upstream.ok && body.jsonMode === true && (upstream.status === 400 || upstream.status === 422)) {
      const detail = await upstream.text().catch(() => "");
      if (/response_format|json[_ ]?object|json_mode/i.test(detail)) {
        upstream = await forward(body, false);
      }
    }
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError"
      ? "The provider took too long to answer — try a smaller PDF chunk or a faster model."
      : `Could not reach the provider at ${upstreamUrl(body.baseUrl)} — check the base URL.`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    // pass the status through — the client maps it to a friendly message
    return NextResponse.json(
      { error: text.slice(0, 500) || `Provider returned ${upstream.status}` },
      { status: upstream.status }
    );
  }

  if (body.stream === true && upstream.body) {
    // pass the SSE stream straight through
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // non-stream: lift the completion content out so the client stays simple
  const j = (await upstream.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    | null;
  if (!j) {
    return NextResponse.json({ error: "Provider returned an unreadable response." }, { status: 502 });
  }
  return NextResponse.json({
    content: j.choices?.[0]?.message?.content ?? "",
    usage: j.usage ?? null,
  });
}
