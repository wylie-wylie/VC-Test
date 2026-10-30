import type { Acuity, Assessment } from "../types"

export const CLINIC_DAY = "2026-09-30"
export const PROBE_AREA_CM2 = 1.8

export const DISCLAIMER =
  "Decision support only. Not a diagnosis, and not an order that executes itself. The covering clinician decides."

export function fmtPh(n: number) {
  return n.toFixed(2)
}

export function fmtTemp(n: number) {
  return `${n.toFixed(1)}°C`
}

export function fmtDelta(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}°C`
}

export function fmtDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function deltaT(a: Assessment) {
  return a.periwoundTempC - a.referenceTempC
}

export function acuityMark(a: Acuity) {
  if (a === "stable") return "✓ Stable"
  if (a === "watch") return "! Watch"
  return "▲ Escalate"
}

export function priorityLabel(p: "now" | "this visit" | "ongoing") {
  if (p === "now") return "Now"
  if (p === "this visit") return "This visit"
  return "Ongoing"
}

export function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}
