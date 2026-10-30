import { PATIENTS } from "./data/patients"
import { buildPlan, interpret } from "./lib/clinical"

const expected: Record<string, [string, string]> = {
  elena: ["escalate", "Bioburden and thermal barrier"],
  samuel: ["escalate", "Bioburden and thermal barrier"],
  robert: ["escalate", "Perfusion barrier"],
  james: ["watch", "Nonviable tissue barrier"],
  diego: ["watch", "Nonviable tissue barrier"],
  aisha: ["watch", "Residual slough"],
  walter: ["watch", "Residual slough"],
  priya: ["stable", "Healing trajectory"],
  mei: ["stable", "Healing trajectory"],
  helen: ["stable", "Healing trajectory"],
}

let failed = 0
for (const patient of PATIENTS) {
  const call = interpret(patient.pending, patient.history[patient.history.length - 1])
  const plan = buildPlan(patient, patient.pending, [...patient.history, patient.pending])
  const [acuity, barrier] = expected[patient.id]
  const ok = call.acuity === acuity && call.primaryBarrier === barrier && plan.orders.length > 0
  const blob = plan.orders.map((order) => `${order.domain} ${order.action}`).join(" ")
  const compression = /compress/i.test(blob)
  const safety = patient.compressionSafe || !compression
  const banned = plan.orders.some((order) => {
    if (/do not start/i.test(order.action)) return false
    return /\b(start|prescribe|initiate|begin)\b/i.test(order.action) && /allopurinol|bacteriophage|probiotic/i.test(order.action)
  })
  const strip = /\bpH\b|\bbiofilm\b|\bprotease\b|\buric acid\b|\ballopurinol\b|\bassay\b/i.test(
    `${plan.clinicalSummary} ${plan.trendReading} ${blob} ${plan.avoid.join(" ")}`,
  )
  if (!ok || !safety || banned || strip) failed += 1
  if (strip) console.log("  plan still mentions a strip result")
  console.log(
    `${ok && safety ? "ok" : "FAIL"}  ${patient.name.padEnd(18)} ${call.acuity.padEnd(9)} ${call.primaryBarrier}  ·  ${plan.headline}`,
  )
  if (!safety) console.log("  compression recommended despite unsafe ABPI")
}

if (failed) {
  console.error(`${failed} patient checks failed`)
  process.exit(1)
}
console.log("all patient checks passed")
