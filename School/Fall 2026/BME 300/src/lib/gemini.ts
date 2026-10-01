import type { Order } from "../types"
import type { GeminiNarrative } from "./clinical"

const SYSTEM = `You are the treatment-plan writer for Glutease v1, a prototype chronic-wound console used by clinicians.
You translate a fixed barrier call into bedside guidance.
You never change the measurements, the primary barrier, or the acuity.
You never diagnose. You never invent results.
You write short, concrete clinical prose.`

type GeminiBody = {
  systemInstruction: { parts: { text: string }[] }
  contents: { role: string; parts: { text: string }[] }[]
  generationConfig: {
    temperature: number
    maxOutputTokens: number
    responseMimeType: string
    thinkingConfig?: { thinkingBudget: number }
  }
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function asList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => asText(item)).filter(Boolean)
}

export function parseNarrative(value: unknown): GeminiNarrative {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini returned a plan that was not an object.")
  }
  const raw = value as Record<string, unknown>
  const priorities = new Set(["now", "this visit", "ongoing"])
  const orders: Order[] = (Array.isArray(raw.orders) ? raw.orders : [])
    .map((item) => {
      const order = item as Record<string, unknown>
      const priority = asText(order.priority)
      return {
        domain: asText(order.domain) || "Care",
        priority: (priorities.has(priority) ? priority : "this visit") as Order["priority"],
        action: asText(order.action),
        rationale: asText(order.rationale),
      }
    })
    .filter((order) => order.action)

  const narrative: GeminiNarrative = {
    headline: asText(raw.headline),
    clinicalSummary: asText(raw.clinicalSummary),
    trendReading: asText(raw.trendReading),
    goals: asList(raw.goals),
    orders,
    avoid: asList(raw.avoid),
    monitoring: asList(raw.monitoring),
    followUp: asText(raw.followUp),
    escalation: asList(raw.escalation),
    uncertainties: asList(raw.uncertainties),
  }

  if (!narrative.clinicalSummary || narrative.orders.length === 0) {
    throw new Error("Gemini returned a plan without a summary or orders.")
  }
  return narrative
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] ?? text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("Gemini did not return JSON.")
  return JSON.parse(body.slice(start, end + 1)) as unknown
}

function textFromResponse(payload: unknown) {
  const data = payload as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(data.error.message)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("\n")
    .trim()
  if (!text) throw new Error("Gemini returned an empty response.")
  return text
}

async function post(model: string, apiKey: string, body: GeminiBody) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed (${response.status}).`)
  }
  return payload
}

export async function writeWithGemini(args: { apiKey: string; model: string; prompt: string }) {
  const base: GeminiBody = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  let payload: unknown
  try {
    payload = await post(args.model, args.apiKey, base)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (!/thinking/i.test(message)) throw error
    const { thinkingConfig, ...rest } = base.generationConfig
    void thinkingConfig
    payload = await post(args.model, args.apiKey, { ...base, generationConfig: rest })
  }

  return parseNarrative(extractJson(textFromResponse(payload)))
}
