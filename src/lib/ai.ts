// ─── AI client — provider-agnostic, local-first, on-demand ───────────────────
// The user brings their own OpenAI-compatible endpoint (AI Credits, OpenRouter,
// DeepSeek direct, Gemini's OpenAI-compat layer…). Settings live ONLY in
// localStorage on this device; calls go through our thin /api/ai proxy so the
// browser never talks cross-origin. Every result is cached in IndexedDB —
// re-viewing costs nothing. No background calls, ever.

import type { AiUsageRecord } from "./types";
import { uid } from "./types";

// ─── settings (localStorage — sync read, device-local) ───────────────────────

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const LS_KEY = "jee-ai-settings";

const DEFAULT_SETTINGS: AISettings = { baseUrl: "", apiKey: "", model: "" };

export function loadAISettings(): AISettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<AISettings>;
    return {
      baseUrl: typeof p.baseUrl === "string" ? p.baseUrl.trim() : "",
      apiKey: typeof p.apiKey === "string" ? p.apiKey.trim() : "",
      model: typeof p.model === "string" ? p.model.trim() : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAISettings(s: AISettings): void {
  window.localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function aiConfigured(s?: AISettings): boolean {
  const v = s ?? loadAISettings();
  return v.baseUrl !== "" && v.apiKey !== "" && v.model !== "";
}

// ─── model presets (₹ per 1M tokens, rough — display only) ───────────────────
// Pick for the user: DeepSeek for STEM reasoning per rupee, Flash for cheap
// structured extraction. Values are conservative public list prices in ₹.

export interface ModelPreset {
  id: string;
  label: string;
  hint: string;
  inCost: number; // ₹ / 1M prompt tokens
  outCost: number; // ₹ / 1M completion tokens
}

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "deepseek-chat", label: "DeepSeek V3 (chat)", hint: "best physics/math per ₹ — recommended", inCost: 25, outCost: 100 },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "cheapest + fastest, great for extraction", inCost: 9, outCost: 36 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", hint: "solid all-rounder on most proxies", inCost: 14, outCost: 54 },
  { id: "claude-3-5-haiku", label: "Claude 3.5 Haiku", hint: "strong writing, pricier per ₹", inCost: 72, outCost: 360 },
];

const FALLBACK_COST: ModelPreset = { id: "", label: "", hint: "", inCost: 20, outCost: 80 };

function costOf(model: string): ModelPreset {
  const m = model.toLowerCase();
  for (const p of MODEL_PRESETS) {
    if (m.includes(p.id.split("-")[0])) return p; // deepseek / gemini / gpt / claude
  }
  return FALLBACK_COST;
}

export function estimateCostINR(model: string, promptTokens: number, completionTokens: number): number {
  const p = costOf(model);
  return Math.round(((promptTokens / 1e6) * p.inCost + (completionTokens / 1e6) * p.outCost) * 1000) / 1000;
}

// ─── the call ────────────────────────────────────────────────────────────────

export interface AIUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface CallAIOpts {
  feature: AiUsageRecord["feature"];
  system: string;
  user: string;
  /** request { type: "json_object" } upstream — best-effort, retried without on failure */
  jsonMode?: boolean;
  /** stream the text as it arrives (ignored for jsonMode) */
  onDelta?: (full: string) => void;
  signal?: AbortSignal;
  temperature?: number;
}

export class AIConfigError extends Error {}
export class AIProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function friendly(status: number, body: string): string {
  const detail = body.slice(0, 200);
  if (status === 401 || status === 403) return "API key rejected — check the key in AI settings.";
  if (status === 402) return "Out of credits on your provider — top up or switch model.";
  if (status === 404) return `Model or URL not found — check the model name and base URL (usually ends with /v1). ${detail}`;
  if (status === 429) return "Rate limited — wait a few seconds and retry.";
  if (status >= 500) return `Provider error (${status}) — try again or switch model.`;
  return `Provider error (${status}). ${detail}`;
}

/**
 * One AI call. Returns the full text; logs usage to IndexedDB.
 * Streams through onDelta when provided (and not jsonMode).
 */
export async function callAI(opts: CallAIOpts): Promise<{ text: string; usage: AIUsage }> {
  const s = loadAISettings();
  if (!aiConfigured(s)) {
    throw new AIConfigError("AI is not set up yet — add your provider URL, key and model in AI settings.");
  }
  const stream = Boolean(opts.onDelta) && !opts.jsonMode;

  const body = {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature ?? 0.3,
    stream,
    jsonMode: opts.jsonMode === true,
  };

  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new AIProviderError("Could not reach the AI proxy — is the dev server running?");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIProviderError(friendly(res.status, text), res.status);
  }

  if (stream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let usage: AIUsage = { prompt_tokens: 0, completion_tokens: 0 };
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = j.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            full += delta;
            opts.onDelta?.(full);
          }
          if (j.usage) {
            usage = {
              prompt_tokens: j.usage.prompt_tokens ?? 0,
              completion_tokens: j.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          // keep-alive comment or partial line — ignore
        }
      }
    }
    if (usage.completion_tokens === 0) {
      // provider didn't include usage — estimate (≈4 chars/token)
      usage = { prompt_tokens: Math.round((opts.system.length + opts.user.length) / 4), completion_tokens: Math.round(full.length / 4) };
    }
    await logUsage(opts.feature, s.model, usage);
    return { text: full, usage };
  }

  // non-stream
  const j = (await res.json()) as {
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const usage: AIUsage = {
    prompt_tokens: j.usage?.prompt_tokens ?? Math.round((opts.system.length + opts.user.length) / 4),
    completion_tokens: j.usage?.completion_tokens ?? Math.round((j.content ?? "").length / 4),
  };
  await logUsage(opts.feature, s.model, usage);
  return { text: j.content ?? "", usage };
}

async function logUsage(feature: AiUsageRecord["feature"], model: string, u: AIUsage): Promise<void> {
  try {
    const { put } = await import("./idb");
    await put("ai_usage", {
      id: uid(),
      feature,
      model,
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      cost_inr: estimateCostINR(model, u.prompt_tokens, u.completion_tokens),
      created_at: Date.now(),
    });
  } catch {
    // usage logging is best-effort — never block the feature
  }
}

/** Tiny round-trip used by the settings dialog's "Test connection". */
export async function testAIConnection(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const s = loadAISettings();
    const { text } = await callAI({
      feature: "test",
      system: "Reply with exactly: OK",
      user: "ping",
      temperature: 0,
    });
    return { ok: true, model: s.model };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─── AI cache helpers (IndexedDB) ────────────────────────────────────────────

export async function aiCacheGet<T>(id: string): Promise<T | undefined> {
  const { get } = await import("./idb");
  const row = await get("ai_cache", id);
  return row ? (row.payload as T) : undefined;
}

export async function aiCacheSet(feature: "explain" | "coach", key: string, payload: unknown): Promise<void> {
  const { put } = await import("./idb");
  const s = loadAISettings();
  await put("ai_cache", {
    id: `${feature}:${key}`,
    feature,
    key,
    payload,
    model: s.model,
    created_at: Date.now(),
  });
}

export async function aiCacheDel(id: string): Promise<void> {
  const { del } = await import("./idb");
  await del("ai_cache", id);
}

// ─── PDF → text (digital PDFs; pdf.js text layer, same engine as key import) ─

export async function extractPdfText(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    text += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
    if (text.length > 600_000) break; // safety cap (~150k tokens)
  }
  doc.destroy();
  return text.slice(0, 600_000);
}

/** Split raw paper text into model-sized chunks that break on page boundaries. */
export function chunkText(text: string, target = 14_000): string[] {
  if (text.length <= target) return [text];
  const paras = text.split(/\n{2,}/); // page separators from extractPdfText
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length + 2 > target && cur.length > 0) {
      chunks.push(cur);
      cur = "";
    }
    // a single huge "paragraph" (run-together page) — hard split
    if (p.length > target) {
      for (let i = 0; i < p.length; i += target) chunks.push(p.slice(i, i + target));
    } else {
      cur += (cur ? "\n\n" : "") + p;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** Models sometimes wrap JSON in fences or prose — dig the JSON out. */
export function parseLooseJson<T = unknown>(text: string): T | null {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(t) as T;
  } catch {
    const start = t.search(/[{[]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
