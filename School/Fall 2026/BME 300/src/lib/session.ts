import type { Assessment, Plan } from "../types"

const SESSION_KEY = "strata.session.v2"
const API_KEY = "strata.geminiKey"
const MODEL_KEY = "strata.model"

export type StoredPlan = {
  plan: Plan
  source: "matrix" | "gemini"
  model?: string
  createdAt: string
}

export type Session = {
  readings: Record<string, Assessment>
  plans: Record<string, StoredPlan>
  shiftCount: number
}

export const DEFAULT_MODEL = "gemini-2.5-flash"

export function emptySession(): Session {
  return { readings: {}, plans: {}, shiftCount: 0 }
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return emptySession()
    const parsed = JSON.parse(raw) as Session
    return {
      readings: parsed.readings ?? {},
      plans: parsed.plans ?? {},
      shiftCount: parsed.shiftCount ?? 0,
    }
  } catch {
    return emptySession()
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadApiKey() {
  return localStorage.getItem(API_KEY) ?? ""
}

export function saveApiKey(key: string) {
  if (key.trim()) localStorage.setItem(API_KEY, key.trim())
  else localStorage.removeItem(API_KEY)
}

export function loadModel() {
  return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL
}

export function saveModel(model: string) {
  localStorage.setItem(MODEL_KEY, model.trim() || DEFAULT_MODEL)
}
