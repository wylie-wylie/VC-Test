import { PATIENTS } from "./data/patients"
import { buildPlan, interpret } from "./lib/clinical"

const expected: Record<string, [string, string]> = {
  elena: ["escalate", "Biofilm barrier"],
  samuel: ["escalate", "Biofilm barrier"],
  robert: ["escalate", "Perfusion barrier"],
  james: ["watch", "Biofilm barrier"],
  diego: ["watch", "Biofilm barrier"],
  aisha: ["watch", "Biofilm barrier"],
  walter: ["watch", "Healing milieu with residual slough"],
  priya: ["stable", "Healing trajectory"],
  mei: ["stable", "Healing trajectory"],
  helen: ["stable", "Approaching the healing pH band"],
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
  const biofilmOrder = plan.orders.some((order) => order.domain === "Biofilm")
  const biofilmOk = patient.pending.biofilm === "absent" || biofilmOrder
  if (!ok || !safety || banned || !biofilmOk) failed += 1
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
