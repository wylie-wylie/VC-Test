import type { Acuity, Assessment, Finding, Order, Patient, Plan } from "../types"
import { deltaT, fmtDelta, fmtTemp } from "./format"

export const PRIMARY = {
  perfusion: "Perfusion barrier",
  bioburden: "Bioburden and thermal barrier",
  tissue: "Nonviable tissue barrier",
  moisture: "Moisture barrier",
  healingSlough: "Residual slough",
  healing: "Healing trajectory",
} as const

export type ReadingCall = {
  acuity: Acuity
  primaryBarrier: string
  supportingBarriers: string[]
  deltaT: number
  tempCall: "neutral" | "warm" | "infection" | "hypoperfusion" | "verify"
  fluorCall: "quiet" | "signal" | "bright"
  tissueBarrier: boolean
  moisture: "dry" | "balanced" | "excess"
}

export function priorOf(history: Assessment[], reading: Assessment) {
  const earlier = history.filter((item) => item.date < reading.date)
  return earlier[earlier.length - 1]
}

export function fluorCallOf(index: number): ReadingCall["fluorCall"] {
  if (index >= 50) return "bright"
  if (index >= 20) return "signal"
  return "quiet"
}

export function interpret(reading: Assessment, prior?: Assessment): ReadingCall {
  const delta = deltaT(reading)
  const fluorCall = fluorCallOf(reading.fluorescenceIndex)
  let tempCall: ReadingCall["tempCall"] = "neutral"
  if (reading.periwoundTempC < 25 || reading.periwoundTempC > 42) tempCall = "verify"
  else if (delta >= 2) tempCall = "infection"
  else if (delta >= 1.2) tempCall = "warm"
  else if (delta <= -2) tempCall = "hypoperfusion"

  const tissueBarrier = reading.tissue.necrotic >= 20 || reading.tissue.slough >= 40
  const moisture: ReadingCall["moisture"] =
    reading.exudate === "none"
      ? "dry"
      : reading.exudate === "heavy" ||
          (reading.exudate === "moderate" && reading.periwound.includes("maceration"))
        ? "excess"
        : "balanced"

  let primaryBarrier: string = PRIMARY.healing
  let acuity: Acuity = "stable"

  if (tempCall === "hypoperfusion") {
    primaryBarrier = PRIMARY.perfusion
    acuity = "escalate"
  } else if (tempCall === "infection") {
    primaryBarrier = PRIMARY.bioburden
    acuity = "escalate"
  } else if (tissueBarrier) {
    primaryBarrier = PRIMARY.tissue
    acuity = "watch"
  } else if (moisture === "excess") {
    primaryBarrier = PRIMARY.moisture
    acuity = "watch"
  } else if (reading.tissue.slough >= 30) {
    primaryBarrier = PRIMARY.healingSlough
    acuity = "watch"
  } else if (tempCall === "verify") {
    primaryBarrier = "Sensor check required"
    acuity = "watch"
  }

  const supporting: string[] = []
  const push = (item: string) => {
    if (!supporting.includes(item) && supporting.length < 6) supporting.push(item)
  }
  if (fluorCall === "bright") push("Bright fluorescence")
  if (tempCall === "warm" && primaryBarrier !== PRIMARY.bioburden) push("Warming trend")
  if (tissueBarrier && primaryBarrier !== PRIMARY.tissue) push("Nonviable tissue")
  else if (reading.tissue.slough >= 30 && reading.tissue.slough < 40 && primaryBarrier !== PRIMARY.healingSlough) {
    push("Residual slough")
  }
  if (moisture === "excess" && primaryBarrier !== PRIMARY.moisture) push("Excess moisture")
  if (prior && reading.areaCm2 >= prior.areaCm2 * 1.1) push("Area increasing")

  return {
    acuity,
    primaryBarrier,
    supportingBarriers: supporting,
    deltaT: delta,
    tempCall,
    fluorCall,
    tissueBarrier,
    moisture,
  }
}

function statusForTemp(call: ReadingCall["tempCall"]) {
  if (call === "neutral") return "✓ Near reference"
  if (call === "warm") return "● Warming"
  if (call === "infection") return "■ Infection signature"
  if (call === "hypoperfusion") return "■ Hypoperfusion"
  return "● Verify sensor"
}

function areaPhrase(current: number, prior?: Assessment) {
  if (!prior) return "No earlier area is on the chart."
  const pct = ((current - prior.areaCm2) / prior.areaCm2) * 100
  const rounded = Math.abs(pct).toFixed(0)
  if (pct <= -10) return `Area is down ${rounded}% from the prior visit.`
  if (pct >= 10) return `Area is up ${rounded}% from the prior visit.`
  const direction = pct > 1 ? "slightly up" : pct < -1 ? "slightly down" : "essentially flat"
  return `Area is ${direction} (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%), inside a 10% band.`
}

function trendReading(reading: Assessment, prior: Assessment | undefined, call: ReadingCall) {
  const tempBit = `the periwound is ${fmtDelta(call.deltaT)} versus contralateral skin`
  const fluorBit = prior
    ? `fluorescence moved from ${prior.fluorescenceIndex.toFixed(0)} to ${reading.fluorescenceIndex.toFixed(0)}`
    : `fluorescence index is ${reading.fluorescenceIndex.toFixed(0)}`
  return `${sentence(tempBit)}. ${sentence(fluorBit)}. ${areaPhrase(reading.areaCm2, prior)}`
}

function sentence(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function statusForFluor(call: ReadingCall["fluorCall"]) {
  if (call === "bright") return "■ Bright"
  if (call === "signal") return "● Signal"
  return "✓ Quiet"
}

function findingsFor(reading: Assessment, call: ReadingCall, prior?: Assessment): Finding[] {
  const areaNote = prior ? areaPhrase(reading.areaCm2, prior) : "First area on this chart."
  const envelope =
    reading.periwoundTempC < 32 || reading.periwoundTempC > 39
      ? "Outside the 32–39°C capture point, inside the 25–42°C range."
      : "Inside the 32–39°C capture point."
  return [
    {
      parameter: "Periwound temperature",
      value: `${fmtTemp(reading.periwoundTempC)} (${fmtDelta(call.deltaT)} vs contralateral ${fmtTemp(reading.referenceTempC)})`,
      reference: "Barrier at ≥ +2.0°C or ≤ −2.0°C vs contralateral skin",
      status: statusForTemp(call.tempCall),
      note: `${envelope} Lepton radiometric reading.`,
    },
    {
      parameter: "Fluorescence",
      value: `Index ${reading.fluorescenceIndex.toFixed(0)}`,
      reference: "Quiet under 20. Bright at 50 or above.",
      status: statusForFluor(call.fluorCall),
      note: "405 nm excitation through the long-pass filter. A light signal, not a culture.",
    },
    {
      parameter: "Area",
      value: `${reading.areaCm2.toFixed(1)} cm² · ${reading.lengthCm.toFixed(1)} × ${reading.widthCm.toFixed(1)} cm`,
      reference: "Falling area supports the current regimen",
      status: prior && reading.areaCm2 >= prior.areaCm2 * 1.1 ? "■ Rising" : "✓ Trend noted",
      note: areaNote,
    },
    {
      parameter: "Tissue",
      value: `${reading.tissue.granulation}% granulation · ${reading.tissue.slough}% slough · ${reading.tissue.necrotic}% necrotic · ${reading.tissue.epithelial}% epithelial`,
      reference: "Barrier if necrotic ≥ 20% or slough ≥ 40%",
      status: call.tissueBarrier ? "■ Nonviable tissue" : "✓ Viable bed dominates",
      note: "Color-frame surface estimate, not histology.",
    },
    {
      parameter: "Exudate",
      value: `${reading.exudate}, ${reading.exudateCharacter}`,
      reference: "Heavy or macerating drainage is a barrier signal",
      status: call.moisture === "excess" ? "■ Excess moisture" : call.moisture === "dry" ? "● Dry" : "✓ Balanced",
      note: reading.periwound.length
        ? `Periwound: ${reading.periwound.join(", ")}.`
        : "Periwound skin looks intact on the color frame.",
    },
  ]
}

function order(
  domain: string,
  priority: Order["priority"],
  action: string,
  rationale: string,
): Order {
  return { domain, priority, action, rationale }
}

function followUp(acuity: Acuity) {
  if (acuity === "escalate") return "Reassess within 48–72 hours, sooner if systemic signs appear."
  if (acuity === "watch") return "Reassess in about 7 days, sooner if drainage or warmth increases."
  return "Reassess in 1–2 weeks to confirm the area is still falling and the temperature is still quiet."
}

function summaryFor(reading: Assessment, call: ReadingCall) {
  const delta = fmtDelta(call.deltaT)
  const fluor = reading.fluorescenceIndex.toFixed(0)
  if (call.primaryBarrier === PRIMARY.perfusion) {
    return `Periwound temperature is ${delta} versus contralateral skin. That cold bed is a perfusion barrier. Vascular review comes before debridement or compression.`
  }
  if (call.primaryBarrier === PRIMARY.bioburden) {
    return `Periwound temperature is ${delta} versus contralateral skin. Fluorescence index is ${fluor}. Together these fit a hot bed. This does not start an antibiotic.`
  }
  if (call.primaryBarrier === PRIMARY.tissue) {
    return `Nonviable tissue is the leading finding: slough ${reading.tissue.slough}% and necrotic tissue ${reading.tissue.necrotic}%. Temperature is ${delta} versus contralateral skin. Debridement is only reasonable if perfusion is adequate.`
  }
  if (call.primaryBarrier === PRIMARY.moisture) {
    return `Drainage and the periwound skin are ahead of the other signals. Exudate is ${reading.exudate} and ${reading.exudateCharacter}. The dressing has to move fluid without flooding intact skin.`
  }
  if (call.primaryBarrier === PRIMARY.healingSlough) {
    return `Temperature is ${delta} versus contralateral skin. Residual slough is ${reading.tissue.slough}%. The surface is mostly viable and still needs a simple dressing plan.`
  }
  return `The periwound is ${delta} versus contralateral skin and the fluorescence index is ${fluor}. Area and the tissue surface support holding a regimen that is already closing the wound.`
}

function goalsFor(patient: Patient, call: ReadingCall): string[] {
  const goals = [`Address the leading barrier: ${call.primaryBarrier.toLowerCase()}.`]
  if (patient.etiologyKey === "dfu") goals.push("Keep pressure off the ulcer for every step that can be controlled.")
  if (patient.etiologyKey === "vlu") goals.push("Control venous hypertension if perfusion allows compression.")
  if (patient.etiologyKey === "pressure") goals.push("Remove pressure and shear at the injury for the full day, not only at dressing changes.")
  if (patient.etiologyKey === "arterial" || call.primaryBarrier === PRIMARY.perfusion) {
    goals.push("Protect the limb while perfusion is defined. Do not trade a dry eschar for a wet ischemic wound.")
  }
  if (patient.etiologyKey === "dehiscence") goals.push("Keep the surgical team in charge of closure and of anything placed in the wound.")
  goals.push("Repeat the same measurements at the next visit.")
  return goals.slice(0, 5)
}

function buildOrders(patient: Patient, reading: Assessment, call: ReadingCall): Order[] {
  const orders: Order[] = []
  const perfOk = call.tempCall !== "hypoperfusion" && patient.compressionSafe
  const leaveDry =
    call.primaryBarrier === PRIMARY.perfusion &&
    (reading.exudate === "scant" || reading.exudate === "none") &&
    reading.tissue.necrotic >= 40

  if (call.primaryBarrier === PRIMARY.perfusion) {
    orders.push(
      order(
        "Perfusion",
        "now",
        "Same-week vascular assessment. Record rest pain, pulses, and the ABPI already on the chart. Keep the limb warm and dependent pressure off the heel.",
        `The bed is ${fmtDelta(call.deltaT)} versus contralateral skin.`,
      ),
    )
    if ((reading.exudate === "scant" || reading.exudate === "none") && reading.tissue.necrotic >= 40) {
      orders.push(
        order(
          "Debridement",
          "this visit",
          "Leave dry, stable eschar intact. Do not soften it and do not sharply debride it until the vascular plan is set.",
          "A closed ischemic eschar is a biologic cover. Opening it without perfusion creates a deeper wound.",
        ),
      )
    }
  }

  if (patient.etiologyKey === "dehiscence") {
    orders.push(
      order(
        "Surgical review",
        "now",
        "Ask the surgical service to see this open wound before any new packing or closure plan. Do not close it here.",
        "An open incision stays with the team that made it.",
      ),
    )
  }

  orders.push(
    leaveDry
      ? order(
          "Cleansing",
          "this visit",
          "Keep the eschar dry. Clean only the surrounding skin, and do not soak the heel.",
          "A wet ischemic eschar softens, traps fluid, and becomes a worse wound.",
        )
      : order(
          "Cleansing",
          "this visit",
          "Cleanse the bed and the periwound with normal saline or a non-cytotoxic wound cleanser. Pat intact skin dry.",
          "This removes loose debris without a harsh antiseptic on granulation.",
        ),
  )

  if (call.primaryBarrier === PRIMARY.bioburden) {
    orders.push(
      order(
        "Bioburden",
        "this visit",
        "If there is purulence or spreading erythema, consider a culture. A non-antibiotic antimicrobial dressing such as PHMB is reasonable while that exam happens. Do not start a systemic antibiotic from this visit.",
        `The periwound is ${fmtDelta(call.deltaT)} versus contralateral skin. Temperature does not identify an organism.`,
      ),
    )
  }

  if (perfOk && (reading.tissue.necrotic >= 20 || reading.tissue.slough >= 40) && call.primaryBarrier !== PRIMARY.perfusion) {
    orders.push(
      order(
        "Debridement",
        "this visit",
        reading.tissue.necrotic >= 20
          ? "A qualified clinician can consider conservative sharp removal of loose necrotic tissue, then reassess the base."
          : "Consider autolytic or conservative sharp removal of loose slough if it is blocking the epithelial edge.",
        `Slough is ${reading.tissue.slough}% and necrotic tissue is ${reading.tissue.necrotic}%. Perfusion on this reading does not forbid debridement.`,
      ),
    )
  } else if (perfOk && reading.tissue.slough >= 30 && reading.tissue.slough < 40) {
    orders.push(
      order(
        "Debridement",
        "ongoing",
        "Residual slough can be managed with an atraumatic dressing that supports autolysis. Sharp debridement only if the edge stalls.",
        "Temperature is quiet. Do not add an antimicrobial just to treat slough.",
      ),
    )
  }

  if (leaveDry) {
    orders.push(
      order(
        "Dressing",
        "this visit",
        "Paint a dry protective cover only. No hydrogel, no occlusive film, no iodine dressing.",
        "The goal is protection from the mattress, not moisture.",
      ),
    )
  } else if (call.moisture === "excess") {
    orders.push(
      order(
        "Dressing",
        "this visit",
        "Use an absorptive dressing such as an alginate, gelling fiber, or foam, and a skin barrier film on macerated periwound. Match the change frequency to strike-through, not to habit.",
        `Exudate is ${reading.exudate} and ${reading.exudateCharacter}.`,
      ),
    )
  } else if (call.moisture === "dry" && call.primaryBarrier !== PRIMARY.perfusion) {
    orders.push(
      order(
        "Dressing",
        "this visit",
        "Add moisture with a hydrogel or a non-adherent moist contact layer. Do not dry the bed further.",
        "A dry but perfused bed stalls. An ischemic dry eschar is the exception, and that path is handled above.",
      ),
    )
  } else if (call.primaryBarrier === PRIMARY.healing) {
    orders.push(
      order(
        "Dressing",
        "this visit",
        "Keep a simple protective, non-adherent dressing. Do not add an antimicrobial because the numbers look calm.",
        "Extra antiseptic on a healing bed is cost and irritation without a target.",
      ),
    )
  } else {
    orders.push(
      order(
        "Dressing",
        "this visit",
        "Choose a non-adherent dressing that keeps the bed moist but not macerated. Revisit the class if drainage changes before the next appointment.",
        "Moisture balance is ordinary here, so the dressing should not become the treatment.",
      ),
    )
  }

  if (patient.etiologyKey === "dfu") {
    orders.push(
      order(
        "Offloading",
        "now",
        `Make offloading non-optional. Current note: ${patient.mechanical}. A total contact cast or a knee-high removable walker that actually stays on is the standard for a plantar ulcer when perfusion allows.`,
        "A correct dressing under a walking foot will not close a Wagner ulcer.",
      ),
    )
  }

  if (patient.etiologyKey === "vlu" && patient.compressionSafe) {
    orders.push(
      order(
        "Compression",
        "this visit",
        patient.mechanical.toLowerCase().includes("not currently")
          ? `Start compression. ABPI is ${patient.abpiLabel}. Recheck if the foot becomes pale, numb, or newly painful after the wrap.`
          : `Continue compression. ABPI is ${patient.abpiLabel}. Ask about slip, pain overnight, and who reapplies it.`,
        "Venous hypertension is the disease. The dressing only manages the surface.",
      ),
    )
  }

  if (patient.etiologyKey === "pressure") {
    orders.push(
      order(
        "Pressure",
        "now",
        `Rebuild the offloading plan for the whole day. Current note: ${patient.mechanical}. Confirm the support surface and a turning or heel-float schedule the site can actually keep.`,
        "Stage and sacral injuries recur in the hours between dressing changes.",
      ),
    )
  }

  if (patient.hba1c) {
    orders.push(
      order(
        "Glucose",
        "ongoing",
        `Ask the clinician managing diabetes to review control. Last HbA1c is ${patient.hba1c}${patient.recentGlucose ? `, recent glucose ${patient.recentGlucose}` : ""}.`,
        "Glucose control changes infection risk and closure.",
      ),
    )
  }

  if (patient.etiologyKey === "arterial") {
    orders.push(
      order(
        "Protection",
        "ongoing",
        "Shield the heel from the mattress. Do not wrap the limb to reduce swelling.",
        "Compression on an arterial ulcer is a harm, not a style of dressing.",
      ),
    )
  }

  if (/adhesive/i.test(patient.allergies)) {
    orders.push(
      order(
        "Fixation",
        "this visit",
        "Secure the dressing with a silicone border or a bandage. Do not use acrylate tape on the skin.",
        `Allergy listed: ${patient.allergies}.`,
      ),
    )
  }

  return orders
}

function avoidFor(patient: Patient, reading: Assessment, call: ReadingCall) {
  const avoid = ["Do not start a systemic antibiotic from this visit."]
  if (!patient.compressionSafe || call.primaryBarrier === PRIMARY.perfusion) {
    avoid.push("Do not apply compression. Perfusion on this chart does not support it.")
  }
  if (call.primaryBarrier === PRIMARY.perfusion && reading.tissue.necrotic >= 40) {
    avoid.push("Do not moisten or debride intact dry eschar until vascular review.")
  }
  if (/sulfa/i.test(patient.allergies)) {
    avoid.push("Do not use silver sulfadiazine. Sulfa allergy is on the chart.")
  }
  if (/iodine/i.test(patient.allergies)) {
    avoid.push("Do not use iodine or cadexomer iodine dressings. Iodine allergy is on the chart.")
  }
  if (/adhesive/i.test(patient.allergies)) {
    avoid.push("Do not use standard medical acrylate tape on the skin.")
  }
  if (patient.etiologyKey === "dehiscence") {
    avoid.push("Do not close this incision at the bedside.")
  }
  if (call.primaryBarrier === PRIMARY.healing) {
    avoid.push("Do not add an antimicrobial dressing to a bed that is already in a healing pattern.")
  }
  return avoid
}

function uncertaintiesFor() {
  return [
    "Fluorescence is a 405 nm light signal. It is not a culture and it does not name an organism.",
    "Temperature is compared with contralateral skin in the same thermal frame. Core temperature is not measured.",
    "Tissue percents are a color-frame estimate of the surface, not a biopsy.",
    "Area is only comparable when the camera height stays fixed.",
  ]
}

export function buildPlan(patient: Patient, reading: Assessment, history: Assessment[]): Plan {
  const prior = priorOf(history, reading)
  const call = interpret(reading, prior)
  const acuityLabel = call.acuity === "stable" ? "Stable" : call.acuity === "watch" ? "Watch" : "Escalate"
  return {
    headline: headlineFor(call.primaryBarrier),
    primaryBarrier: call.primaryBarrier,
    supportingBarriers: call.supportingBarriers,
    acuity: call.acuity,
    acuityLabel,
    clinicalSummary: summaryFor(reading, call),
    trendReading: trendReading(reading, prior, call),
    findings: findingsFor(reading, call, prior),
    goals: goalsFor(patient, call),
    orders: buildOrders(patient, reading, call),
    avoid: avoidFor(patient, reading, call),
    monitoring: [
      "Repeat the color frame, the fluorescence frame, and the thermal frame at the next visit.",
      "Keep the camera height the same so the area change is comparable.",
    ],
    followUp: followUp(call.acuity),
    escalation: [
      "Fever, rigors, fast heart rate, confusion, or glucose that the usual clinician calls unstable.",
      "Erythema that spreads, crepitus, bullae, or pain that jumps.",
      "Probe to bone, exposed tendon, or a sudden increase in depth.",
      "A colder bed than this reading, rest pain, or a new pale foot after compression.",
    ],
    uncertainties: uncertaintiesFor(),
  }
}

function headlineFor(primary: string) {
  switch (primary) {
    case PRIMARY.perfusion:
      return "Cold bed"
    case PRIMARY.bioburden:
      return "Hot bed"
    case PRIMARY.tissue:
      return "Nonviable tissue on the surface"
    case PRIMARY.moisture:
      return "Moisture is ahead of the other signals"
    case PRIMARY.healingSlough:
      return "Residual slough on a quiet bed"
    case PRIMARY.healing:
      return "The wound is in a healing pattern"
    default:
      return primary
  }
}
