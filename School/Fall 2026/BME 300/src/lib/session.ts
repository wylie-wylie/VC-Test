import type { Assessment, Plan } from "../types"

const SESSION_KEY = "strata.session.v3"

export type StoredPlan = {
  plan: Plan
  createdAt: string
}

export type Session = {
  readings: Record<string, Assessment>
  plans: Record<string, StoredPlan>
  shiftCount: number
}

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
