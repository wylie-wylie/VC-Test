import type { Acuity, Assessment, Finding, Order, Patient, Plan } from "../types"
import { CLINIC_DAY, PROBE_AREA_CM2, deltaT, fmtDelta, fmtPh, fmtTemp } from "./format"

export const PRIMARY = {
  perfusion: "Perfusion barrier",
  biofilm: "Biofilm barrier",
  bioburden: "Bioburden and thermal barrier",
  alkaline: "Alkaline biochemical barrier",
  protease: "Protease barrier",
  tissue: "Nonviable tissue barrier",
  moisture: "Moisture barrier",
  healingSlough: "Healing milieu with residual slough",
  healing: "Healing trajectory",
  approaching: "Approaching the healing pH band",
  transitional: "Transitional biochemical milieu",
} as const

export type ReadingCall = {
  acuity: Acuity
  primaryBarrier: string
  supportingBarriers: string[]
  deltaT: number
  phCall: "healing" | "transitional" | "alkaline" | "verify"
  tempCall: "neutral" | "warm" | "infection" | "hypoperfusion" | "verify"
  fluorCall: "low" | "moderate" | "high"
  oxygenCall: "adequate" | "borderline" | "impaired"
  tissueBarrier: boolean
  moisture: "dry" | "balanced" | "excess"
  diversity: "normal" | "low" | "borderline"
  protease: "elevated" | "not elevated"
  uric: "elevated" | "borderline" | "lower"
}

export function priorOf(history: Assessment[], reading: Assessment) {
  const earlier = history.filter((item) => item.date < reading.date)
  return earlier[earlier.length - 1]
}

export function phCallOf(ph: number): ReadingCall["phCall"] {
  if (ph < 4 || ph > 10) return "verify"
  if (ph >= 5.5 && ph <= 6.5) return "healing"
  if (ph >= 7.15 && ph <= 8.9) return "alkaline"
  if (ph > 6.5 && ph < 7.15) return "transitional"
  return "verify"
}

export function interpret(reading: Assessment, prior?: Assessment): ReadingCall {
  const delta = deltaT(reading)
  const phCall = phCallOf(reading.ph)
  let tempCall: ReadingCall["tempCall"] = "neutral"
  if (reading.periwoundTempC < 25 || reading.periwoundTempC > 42) tempCall = "verify"
  else if (delta >= 2) tempCall = "infection"
  else if (delta >= 1.2) tempCall = "warm"
  else if (delta <= -2) tempCall = "hypoperfusion"

  const fluorCall: ReadingCall["fluorCall"] =
    reading.fluorescenceIndex >= 50 ? "high" : reading.fluorescenceIndex >= 20 ? "moderate" : "low"
  const oxygenCall: ReadingCall["oxygenCall"] =
    reading.sto2 < 40 ? "impaired" : reading.sto2 < 60 ? "borderline" : "adequate"
  const tissueBarrier = reading.tissue.necrotic >= 20 || reading.tissue.slough >= 40
  const moisture: ReadingCall["moisture"] =
    reading.exudate === "none"
      ? "dry"
      : reading.exudate === "heavy" ||
          (reading.exudate === "moderate" && reading.periwound.includes("maceration"))
        ? "excess"
        : "balanced"

  const perfusion = tempCall === "hypoperfusion" || oxygenCall === "impaired"
  const hotBurden =
    tempCall === "infection" || (fluorCall === "high" && (phCall === "alkaline" || tempCall === "warm"))
  const diversity: ReadingCall["diversity"] =
    reading.speciesCount >= 12 && reading.dominantCount === 0
      ? "normal"
      : reading.speciesCount <= 10 && reading.dominantCount >= 1 && reading.dominantCount <= 3
        ? "low"
        : "borderline"
  const protease: ReadingCall["protease"] = reading.proteaseIndex >= 13 ? "elevated" : "not elevated"
  const uric: ReadingCall["uric"] =
    reading.uricAcidRelative >= 2 ? "elevated" : reading.uricAcidRelative >= 1.5 ? "borderline" : "lower"
  const severeHeat =
    (tempCall === "infection" && fluorCall !== "low") || (fluorCall === "high" && phCall === "alkaline")

  let primaryBarrier: string = PRIMARY.healing
  let acuity: Acuity = "stable"

  if (perfusion) {
    primaryBarrier = PRIMARY.perfusion
    acuity = "escalate"
  } else if (reading.biofilm === "present") {
    primaryBarrier = PRIMARY.biofilm
    acuity = severeHeat ? "escalate" : "watch"
  } else if (hotBurden) {
    primaryBarrier = PRIMARY.bioburden
    acuity = severeHeat ? "escalate" : "watch"
  } else if (phCall === "alkaline") {
    primaryBarrier = PRIMARY.alkaline
    acuity = "watch"
  } else if (protease === "elevated") {
    primaryBarrier = PRIMARY.protease
    acuity = "watch"
  } else if (tissueBarrier) {
    primaryBarrier = PRIMARY.tissue
    acuity = "watch"
  } else if (moisture === "excess") {
    primaryBarrier = PRIMARY.moisture
    acuity = "watch"
  } else if (phCall === "healing" && (reading.tissue.slough >= 30 || reading.painNrs >= 5)) {
    primaryBarrier = PRIMARY.healingSlough
    acuity = "watch"
  } else if (phCall === "transitional") {
    const improving = prior ? prior.ph > reading.ph : false
    const quiet =
      fluorCall === "low" &&
      tempCall === "neutral" &&
      !tissueBarrier &&
      oxygenCall === "adequate" &&
      reading.biofilm === "absent" &&
      protease === "not elevated" &&
      reading.inflammation === "resolving" &&
      diversity === "normal"
    if (improving && quiet) {
      primaryBarrier = PRIMARY.approaching
      acuity = "stable"
    } else {
      primaryBarrier = PRIMARY.transitional
      acuity = "watch"
    }
  } else if (phCall === "verify" || tempCall === "verify") {
    primaryBarrier = "Sensor check required"
    acuity = "watch"
  }

  const supporting: string[] = []
  const push = (item: string) => {
    if (!supporting.includes(item) && supporting.length < 6) supporting.push(item)
  }
  if (primaryBarrier !== PRIMARY.biofilm && reading.biofilm === "present") push("Biofilm present")
  if (diversity === "low") push("Low bacterial diversity")
  if (primaryBarrier !== PRIMARY.protease && protease === "elevated") push("Elevated protease")
  if (uric === "elevated") push("Elevated uric acid")
  if (reading.inflammation === "persistent") push("Persistent inflammation")
  if (primaryBarrier !== PRIMARY.alkaline && phCall === "alkaline") push("Alkaline pH")
  if (primaryBarrier !== PRIMARY.bioburden && primaryBarrier !== PRIMARY.biofilm && tempCall === "warm") {
    push("Warming trend")
  }
  if (primaryBarrier !== PRIMARY.bioburden && fluorCall === "high") push("High fluorescence")
  if (tissueBarrier && primaryBarrier !== PRIMARY.tissue) push("Nonviable tissue")
  else if (reading.tissue.slough >= 30 && reading.tissue.slough < 40 && primaryBarrier !== PRIMARY.healingSlough) {
    push("Residual slough")
  }
  if (moisture === "excess" && primaryBarrier !== PRIMARY.moisture) push("Excess moisture")
  if (oxygenCall === "borderline") push("Borderline oxygen signal")
  if (prior && reading.areaCm2 >= prior.areaCm2 * 1.1) push("Area increasing")

  return {
    acuity,
    primaryBarrier,
    supportingBarriers: supporting,
    deltaT: delta,
    phCall,
    tempCall,
    fluorCall,
    oxygenCall,
    tissueBarrier,
    moisture,
    diversity,
    protease,
    uric,
  }
}

function statusForPh(call: ReadingCall["phCall"]) {
  if (call === "healing") return "✓ Healing range"
  if (call === "alkaline") return "■ Barrier"
  if (call === "transitional") return "● Transitional"
  return "● Verify sensor"
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
  const phBit = prior
    ? `pH moved from ${fmtPh(prior.ph)} to ${fmtPh(reading.ph)}`
    : `pH is ${fmtPh(reading.ph)}`
  const tempBit = `the periwound is ${fmtDelta(call.deltaT)} versus contralateral skin`
  const fluorBit = prior
    ? `fluorescence moved from ${prior.fluorescenceIndex} to ${reading.fluorescenceIndex}`
    : `fluorescence index is ${reading.fluorescenceIndex}`
  const biofilmBit =
    prior && prior.biofilm !== reading.biofilm
      ? `Biofilm changed from ${prior.biofilm} to ${reading.biofilm}`
      : `Biofilm is ${reading.biofilm}`
  const proteaseBit = prior
    ? `protease index moved from ${prior.proteaseIndex} to ${reading.proteaseIndex}`
    : `protease index is ${reading.proteaseIndex}`
  return `${sentence(phBit)}, ${tempBit}, and ${fluorBit}. ${sentence(biofilmBit)}, and ${proteaseBit}. ${areaPhrase(reading.areaCm2, prior)}`
}

function sentence(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function findingsFor(reading: Assessment, call: ReadingCall, prior?: Assessment): Finding[] {
  const depth =
    reading.depthMm <= 0 ? "Partial thickness" : `${reading.depthMm.toFixed(0)} mm`
  const areaNote = prior
    ? areaPhrase(reading.areaCm2, prior)
    : "First area on this chart."
  const envelope =
    reading.periwoundTempC < 32 || reading.periwoundTempC > 39
      ? "Outside the 32–39°C design point, inside the 25–42°C capture range."
      : "Inside the 32–39°C design point."

  const diversityValue =
    reading.dominantCount === 0
      ? `${reading.speciesCount} species, none dominating`
      : `${reading.speciesCount} species, ${reading.dominantCount} dominating`
  return [
    {
      parameter: "Bacterial biofilm",
      value: reading.biofilm === "present" ? "Present" : "Absent",
      reference: "Absent",
      status: reading.biofilm === "present" ? "■ Present" : "✓ Absent",
      note: "Assay card. Biofilm cannot be seen with the naked eye, so the camera does not show it.",
    },
    {
      parameter: "Bacterial diversity",
      value: diversityValue,
      reference: "12–20 or more species, none dominating",
      status: call.diversity === "low" ? "■ Low diversity" : call.diversity === "borderline" ? "● Borderline" : "✓ Diverse",
      note: "About 10 or fewer species, with 1–3 dominating, is the abnormal pattern.",
    },
    {
      parameter: "Protease",
      value: `Index ${reading.proteaseIndex}`,
      reference: "Not elevated when the MMP-style index is under 13",
      status: call.protease === "elevated" ? "■ Elevated" : "✓ Not elevated",
      note: "Assay-specific cut from a published point-of-care concept. Not a universal threshold.",
    },
    {
      parameter: "Uric acid",
      value: `${reading.uricAcidRelative.toFixed(1)} relative`,
      reference: "Lower band under 1.5. No universal µmol/L interval.",
      status: call.uric === "elevated" ? "■ Elevated" : call.uric === "borderline" ? "● Borderline" : "✓ Lower band",
      note: "Relative wound-fluid index. Not a serum gout test.",
    },
    {
      parameter: "Inflammation",
      value: reading.inflammation === "persistent" ? "Persistent" : "Resolving",
      reference: "Temporary rise, then signals fall",
      status: reading.inflammation === "persistent" ? "■ Persistent" : "✓ Resolving",
      note: "Pattern only. Not a measured IL-6, IL-8, IL-1, and TNF-α panel.",
    },
    {
      parameter: "Wound bed pH",
      value: fmtPh(reading.ph),
      reference: "Healing 5.5 to 6.5. Alkaline stall 7.15 to 8.9",
      status: statusForPh(call.phCall),
      note: "Electrochemical channel. Design claim ±0.1 pH.",
    },
    {
      parameter: "Periwound temperature",
      value: `${fmtTemp(reading.periwoundTempC)} (${fmtDelta(call.deltaT)} vs contralateral ${fmtTemp(reading.referenceTempC)})`,
      reference: "Barrier at ≥ +2.0°C or ≤ −2.0°C vs contralateral skin",
      status: statusForTemp(call.tempCall),
      note: `${envelope} Design claim ±0.2°C.`,
    },
    {
      parameter: "Depth",
      value: depth,
      reference: "Trend matters more than a single depth",
      status: reading.depthMm >= 8 ? "■ Deep bed" : "✓ Recorded",
      note: "Contact channel. Partial thickness is stored as 0 mm.",
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
      note: "White-light estimate, not histology.",
    },
    {
      parameter: "Exudate",
      value: `${reading.exudate}, ${reading.exudateCharacter}`,
      reference: "Heavy, purulent, or macerating drainage is a barrier signal",
      status: call.moisture === "excess" ? "■ Excess moisture" : call.moisture === "dry" ? "● Dry" : "✓ Balanced",
      note: reading.periwound.length
        ? `Periwound: ${reading.periwound.join(", ")}.`
        : "Periwound not flagged.",
    },
    {
      parameter: "Fluorescence index",
      value: `${reading.fluorescenceIndex} / 100`,
      reference: "Low < 20 · moderate 20–49 · high ≥ 50",
      status:
        call.fluorCall === "high" ? "■ High signal" : call.fluorCall === "moderate" ? "● Moderate signal" : "✓ Low signal",
      note: "Optical bioburden signal. Not a culture and not a species.",
    },
    {
      parameter: "Estimated StO2",
      value: `${reading.sto2}%`,
      reference: "Adequate ≥ 60% · impaired < 40%",
      status:
        call.oxygenCall === "impaired"
          ? "■ Impaired"
          : call.oxygenCall === "borderline"
            ? "● Borderline"
            : "✓ Adequate",
      note: "Near-infrared estimate. Not an arterial blood gas.",
    },
    {
      parameter: "Pain NRS",
      value: `${reading.painNrs} / 10`,
      reference: "Patient reported. Not a sensor channel.",
      status: reading.painNrs >= 7 ? "■ Severe" : reading.painNrs >= 5 ? "● Needs a plan" : "✓ Tolerable",
      note: "Entered by the clinician at the bedside.",
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
  if (acuity === "watch") return "Reassess in about 7 days, sooner if drainage, pain, or warmth increases."
  return "Reassess in 1–2 weeks to confirm the area is still falling and the pH band is holding."
}

function summaryFor(reading: Assessment, call: ReadingCall) {
  const ph = fmtPh(reading.ph)
  const delta = fmtDelta(call.deltaT)
  if (call.primaryBarrier === PRIMARY.perfusion) {
    return `Periwound temperature is ${delta} versus contralateral skin and estimated StO2 is ${reading.sto2}%. That pattern is a perfusion barrier. Relative uric acid is ${reading.uricAcidRelative.toFixed(1)} and the protease index is ${reading.proteaseIndex}. Vascular review comes before debridement, compression, or a moist protease dressing.`
  }
  if (call.primaryBarrier === PRIMARY.biofilm) {
    return `Biofilm is present. It is not visible on the image. It keeps inflammation going, blocks epithelialization, and raises tolerance to antibiotics. pH is ${ph}, the thermal delta is ${delta}, and the protease index is ${reading.proteaseIndex}. Diversity is ${reading.speciesCount} species with ${reading.dominantCount} dominating. This is not a culture.`
  }
  if (call.primaryBarrier === PRIMARY.protease) {
    return `The protease index is ${reading.proteaseIndex}, at or above the assay cut of 13. Excess protease breaks down the matrix the wound is trying to build. The cut is assay-specific, not a universal lab range.`
  }
  if (call.primaryBarrier === PRIMARY.bioburden) {
    return `Periwound temperature is ${delta} versus contralateral skin and the fluorescence index is ${reading.fluorescenceIndex}. Wound bed pH is ${ph}. Together these fit a bioburden barrier, not a restored acid mantle. This is not a culture and it does not start an antibiotic.`
  }
  if (call.primaryBarrier === PRIMARY.alkaline) {
    return `Wound bed pH is ${ph}, inside the alkaline stall range of 7.15–8.9. Healing beds in the same reference sit nearer 5.5–6.5. Temperature and fluorescence do not currently meet the high-bioburden rule.`
  }
  if (call.primaryBarrier === PRIMARY.tissue) {
    return `Nonviable tissue is the leading finding: slough ${reading.tissue.slough}% and necrotic tissue ${reading.tissue.necrotic}%. pH is ${ph}. Debridement is only reasonable if perfusion is adequate.`
  }
  if (call.primaryBarrier === PRIMARY.moisture) {
    return `Drainage and the periwound skin are ahead of the other signals. Exudate is ${reading.exudate} and ${reading.exudateCharacter}. The dressing has to move fluid without flooding intact skin.`
  }
  if (call.primaryBarrier === PRIMARY.healingSlough) {
    return `pH ${ph} sits in the healing band and the thermal and fluorescence signals are quiet. Residual slough is ${reading.tissue.slough}% and pain is ${reading.painNrs}/10, so the bed is biochemically favorable and still uncomfortable.`
  }
  if (call.primaryBarrier === PRIMARY.approaching) {
    return `pH ${ph} is still between the healing band and the alkaline stall range, and it is moving toward 5.5–6.5. Thermal, fluorescence, and oxygen signals are quiet.`
  }
  if (call.primaryBarrier === PRIMARY.transitional) {
    return `pH ${ph} is transitional: above the healing band and below the alkaline stall cut at 7.15. It needs a short follow-up rather than a new diagnosis.`
  }
  return `pH ${ph} is in the healing band, the periwound is ${delta} versus contralateral skin, and fluorescence is low at ${reading.fluorescenceIndex}. The measurements support holding a regimen that is already closing the wound.`
}

function goalsFor(patient: Patient, reading: Assessment, call: ReadingCall): string[] {
  const goals = [`Address the leading barrier: ${call.primaryBarrier.toLowerCase()}.`]
  if (reading.biofilm === "present" && call.primaryBarrier !== PRIMARY.perfusion) {
    goals.push("Disrupt biofilm at the bedside. An antibiotic alone is unlikely to clear it.")
  }
  if (patient.etiologyKey === "dfu") goals.push("Keep pressure off the ulcer for every step that can be controlled.")
  if (patient.etiologyKey === "vlu") goals.push("Control venous hypertension if perfusion allows compression.")
  if (patient.etiologyKey === "pressure") goals.push("Remove pressure and shear at the injury for the full day, not only at dressing changes.")
  if (patient.etiologyKey === "arterial" || call.primaryBarrier === PRIMARY.perfusion) {
    goals.push("Protect the limb while perfusion is defined. Do not trade a dry eschar for a wet ischemic wound.")
  }
  if (patient.etiologyKey === "dehiscence") goals.push("Keep the surgical team in charge of closure and of anything placed in the wound.")
  goals.push("Repeat pH, temperature, and the assay card on a new tip so the next decision uses a comparable pair.")
  return goals.slice(0, 5)
}

function buildOrders(patient: Patient, reading: Assessment, call: ReadingCall): Order[] {
  const orders: Order[] = []
  const perfOk = call.oxygenCall !== "impaired" && call.tempCall !== "hypoperfusion" && patient.compressionSafe
  const leaveDry =
    call.primaryBarrier === PRIMARY.perfusion &&
    call.fluorCall === "low" &&
    (reading.exudate === "scant" || reading.exudate === "none") &&
    reading.tissue.necrotic >= 40

  if (reading.painNrs >= 4) {
    orders.push(
      order(
        "Pain",
        "now",
        `Treat pain before the dressing. The reported score is ${reading.painNrs}/10. Use an atraumatic contact layer and confirm analgesia with the covering clinician.`,
        "A painful dressing change is a reason people abandon offloading and compression.",
      ),
    )
  }

  if (call.primaryBarrier === PRIMARY.perfusion) {
    orders.push(
      order(
        "Perfusion",
        "now",
        "Same-week vascular assessment. Record rest pain, pulses, and the ABPI already on the chart. Keep the limb warm and dependent pressure off the heel.",
        `The bed is ${fmtDelta(call.deltaT)} versus contralateral skin and estimated StO2 is ${reading.sto2}%.`,
      ),
    )
    if (call.fluorCall === "low" && (reading.exudate === "scant" || reading.exudate === "none") && reading.tissue.necrotic >= 40) {
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

  if (patient.etiologyKey === "dehiscence" || reading.depthMm >= 8) {
    orders.push(
      order(
        "Surgical review",
        "now",
        "Ask the surgical service to see this open wound before any new packing or closure plan. Do not close it from this profile.",
        reading.depthMm >= 8
          ? `Depth is ${reading.depthMm.toFixed(0)} mm. Depth, purulence, and a hot bed need a surgeon's exam, not a surface dressing alone.`
          : "An open incision stays with the team that made it.",
      ),
    )
  }

  if (reading.biofilm === "present" && !leaveDry) {
    orders.push(
      order(
        "Biofilm",
        "this visit",
        "Biofilm is present and will not appear on the camera. Cleanse with a surfactant and, because perfusion allows it, have a qualified clinician remove loose film and slough. Do not expect a systemic antibiotic alone to clear it.",
        "Biofilm sustains inflammation, blocks epithelialization, lowers local oxygen, and raises tolerance to antibiotics and immune cells.",
      ),
    )
    orders.push(
      order(
        "Biofilm routes",
        "ongoing",
        "Literature routes include probiotics, bacterial signaling inhibitors, enzymes, bacteriophages, and immunomodulation. None of those is started from this screen.",
        reading.speciesCount <= 10
          ? `Diversity is low at ${reading.speciesCount} species, with ${reading.dominantCount} dominating. Probiotics are the described diversity route only after disruption is underway.`
          : "These are candidate routes, not bedside orders.",
      ),
    )
  }

  if (call.protease === "elevated" && !leaveDry) {
    orders.push(
      order(
        "Protease",
        "this visit",
        "After the bed is clean, use a protease-modulating dressing in the collagen or oxidized-regenerated-cellulose class.",
        `The MMP-style index is ${reading.proteaseIndex}. The published cut used here is 13, and it is assay-specific.`,
      ),
    )
  }

  if (call.uric === "elevated") {
    orders.push(
      order(
        "Uric acid",
        "ongoing",
        "Relative uric acid is high. Treat the hypoxia and the inflammatory driver. Do not start allopurinol from this profile, and do not read this as a serum gout result.",
        `Relative index ${reading.uricAcidRelative.toFixed(1)}. Higher wound-fluid uric acid has tracked with more severe ulcers.`,
      ),
    )
  }

  if (reading.inflammation === "persistent") {
    orders.push(
      order(
        "Inflammation",
        "this visit",
        "Inflammation is persistent rather than resolving. Treat the driver: biofilm, pressure, ischemia, or nonviable tissue. Do not add a systemic steroid from this screen.",
        "A chronic wound stuck in inflammation keeps damaging tissue and does not move into proliferation. The assay card is a pattern, not a cytokine panel.",
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
          "This removes loose debris without a chemical that shifts pH or burns granulation.",
        ),
  )

  if (call.primaryBarrier === PRIMARY.bioburden || (call.fluorCall === "high" && call.phCall === "alkaline")) {
    orders.push(
      order(
        "Bioburden",
        "this visit",
        "Consider a culture if the clinician sees purulence or spreading erythema. A short course of a non-antibiotic antimicrobial dressing, such as PHMB, is reasonable while that exam happens. Do not start a systemic antibiotic from this screen.",
        `Fluorescence is ${reading.fluorescenceIndex} and the thermal delta is ${fmtDelta(call.deltaT)}. Neither result identifies an organism.`,
      ),
    )
  } else if (call.fluorCall === "moderate" && call.phCall === "alkaline") {
    orders.push(
      order(
        "Bioburden",
        "this visit",
        "Fluorescence is moderate and the bed is alkaline. Reinforce local care and offloading or compression first. Move to a culture if drainage turns purulent or the thermal delta reaches +2.0°C.",
        "Alkalinity and a rising optical signal can be an early stall. They are not yet a high-bioburden call.",
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
        "The biochemical band is better than the tissue surface. Do not escalate to an antimicrobial just to treat slough.",
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
  } else if (call.primaryBarrier === PRIMARY.healing || call.primaryBarrier === PRIMARY.approaching) {
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
        `Loop in the clinician managing diabetes. Last HbA1c on this chart is ${patient.hba1c}${patient.recentGlucose ? `, recent glucose ${patient.recentGlucose}` : ""}. The probe did not measure glucose.`,
        "Glycemic control changes infection risk and closure. It is context, not a channel on this device.",
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
  const avoid = [
    "Do not reuse the wound-contact tip. One reading, then discard it.",
    "Do not let a color on the screen be the only carrier of a warning. Every call on this profile is written in words.",
    "Do not call the camera image a biofilm test. Biofilm cannot be seen with the naked eye.",
    "Do not start a probiotic, bacteriophage, enzyme product, or allopurinol from this screen.",
  ]
  if (reading.biofilm === "present") {
    avoid.push("Do not rely on a systemic antibiotic alone while biofilm is present.")
  }
  if (reading.inflammation === "persistent") {
    avoid.push("Do not add a systemic steroid to suppress this inflammatory pattern.")
  }
  if (!patient.compressionSafe || call.primaryBarrier === PRIMARY.perfusion) {
    avoid.push("Do not apply compression. Perfusion on this chart does not support it.")
  }
  if (call.primaryBarrier === PRIMARY.perfusion && reading.tissue.necrotic >= 40 && call.fluorCall === "low") {
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
    avoid.push("Do not primarily close this incision from a bedside profile.")
  }
  if (call.primaryBarrier === PRIMARY.healing || call.primaryBarrier === PRIMARY.approaching) {
    avoid.push("Do not add an antimicrobial dressing to a bed that is already in a healing pattern.")
  }
  return avoid
}

function uncertaintiesFor(reading: Assessment) {
  const items = [
    "pH and temperature are the baseline channels in the 17 Sep 2026 PDS. Biofilm, diversity, protease, uric acid, and inflammation are literature rows.",
    "Biofilm cannot be seen with the naked eye. Fluorescence is not a biofilm photograph.",
    "The protease index uses one published assay idea, an MMP-style cut of 13, and is not a universal threshold.",
    "Uric acid is a relative wound-fluid index, not a serum lab, and this console has no µmol/L reference interval.",
    "Inflammation is a pattern, not a measured IL-6, IL-8, IL-1, and TNF-α panel.",
    "Optical channels stay labeled as extensions until the literature review closes.",
    "Fluorescence and StO2 are device estimates. They are not a culture and not an arterial blood gas.",
    "Temperature is compared with contralateral skin. The PDS also describes infection and ischemia against core temperature, which this cycle does not measure.",
  ]
  if (reading.areaCm2 < PROBE_AREA_CM2) {
    items.push(
      `Wound area is ${reading.areaCm2.toFixed(1)} cm² and the tip footprint is ${PROBE_AREA_CM2.toFixed(1)} cm². Expect contact with intact skin and read the pH with that limit.`,
    )
  }
  items.push("Synthetic patient. Demonstration only.")
  return items
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
    goals: goalsFor(patient, reading, call),
    orders: buildOrders(patient, reading, call),
    avoid: avoidFor(patient, reading, call),
    monitoring: [
      "Repeat pH, temperature, and the assay card at the next visit with a new tip. Biofilm will still not appear on the photograph.",
      "Recapture area with the same optical mode so the percent change is comparable.",
      "Record pain NRS the same way, before the dressing comes off if that was the method today.",
    ],
    followUp: followUp(call.acuity),
    escalation: [
      "Fever, rigors, fast heart rate, confusion, or glucose that the usual clinician calls unstable.",
      "Erythema that spreads, crepitus, bullae, or pain that jumps.",
      "Probe to bone, exposed tendon, or a sudden increase in depth.",
      "A colder bed than this reading, rest pain, or a new pale foot after compression.",
    ],
    uncertainties: uncertaintiesFor(reading),
  }
}

function headlineFor(primary: string) {
  switch (primary) {
    case PRIMARY.perfusion:
      return "Cold bed, low oxygen signal"
    case PRIMARY.biofilm:
      return "Biofilm is holding this bed"
    case PRIMARY.protease:
      return "Protease activity is above the assay cut"
    case PRIMARY.bioburden:
      return "Hot bed with a high optical bioburden signal"
    case PRIMARY.alkaline:
      return "Alkaline stall"
    case PRIMARY.tissue:
      return "Nonviable tissue on the surface"
    case PRIMARY.moisture:
      return "Moisture is ahead of the other signals"
    case PRIMARY.healingSlough:
      return "Healing chemistry, residual slough and pain"
    case PRIMARY.approaching:
      return "pH is moving into the healing band"
    case PRIMARY.transitional:
      return "pH is between healing and stall"
    case PRIMARY.healing:
      return "Measurements sit in a healing pattern"
    default:
      return primary
  }
}

export function enforceSafety(plan: Plan, patient: Patient): Plan {
  const avoid = new Set(plan.avoid)
  avoid.add("Do not reuse a wound-contact tip across patients or visits.")
  if (!patient.compressionSafe) {
    avoid.add("Do not apply compression. Perfusion is not adequate for it.")
  }
  const orders = plan.orders
    .filter((item) => patient.compressionSafe || !/compress/i.test(`${item.domain} ${item.action}`))
    .map((item) => {
      if (/\b(start|prescribe|initiate|begin|give)\b/i.test(item.action) && /antibiotic/i.test(item.action)) {
        return {
          ...item,
          action:
            "Do not start a systemic antibiotic from this profile. The covering clinician decides after looking for cellulitis, abscess, or osteomyelitis, and may obtain a culture.",
        }
      }
      if (/\b(start|prescribe|initiate|begin|give)\b/i.test(item.action) && /allopurinol|bacteriophage|probiotic/i.test(item.action)) {
        return {
          ...item,
          action:
            "Do not start allopurinol, a bacteriophage, or a probiotic from this profile. Those are literature routes. The covering clinician decides whether one belongs in the plan.",
        }
      }
      return item
    })
  return {
    ...plan,
    avoid: [...avoid],
    orders,
    findings: plan.findings,
    acuity: plan.acuity,
    primaryBarrier: plan.primaryBarrier,
  }
}

export type GeminiNarrative = {
  headline: string
  clinicalSummary: string
  trendReading: string
  goals: string[]
  orders: Order[]
  avoid: string[]
  monitoring: string[]
  followUp: string
  escalation: string[]
  uncertainties: string[]
}

export function applyNarrative(base: Plan, narrative: GeminiNarrative, patient: Patient): Plan {
  const mergedUncertainties = [
    ...narrative.uncertainties,
    ...base.uncertainties.filter(
      (item) =>
        item.includes("baseline channels") ||
        item.includes("Synthetic patient") ||
        item.includes("tip footprint") ||
        item.includes("cannot be seen") ||
        item.includes("relative wound-fluid") ||
        item.includes("not a measured"),
    ),
  ]
  return enforceSafety(
    {
      ...base,
      headline: narrative.headline.trim() || base.headline,
      clinicalSummary: narrative.clinicalSummary.trim() || base.clinicalSummary,
      trendReading: narrative.trendReading.trim() || base.trendReading,
      goals: narrative.goals.length ? narrative.goals : base.goals,
      orders: narrative.orders.length ? narrative.orders : base.orders,
      avoid: narrative.avoid.length ? narrative.avoid : base.avoid,
      monitoring: narrative.monitoring.length ? narrative.monitoring : base.monitoring,
      followUp: narrative.followUp.trim() || base.followUp,
      escalation: narrative.escalation.length ? narrative.escalation : base.escalation,
      uncertainties: mergedUncertainties,
    },
    patient,
  )
}

export function toMultimodalRecord(patient: Patient, reading: Assessment) {
  return {
    schema: "glutease.woundbarrier.v1",
    clinicDay: CLINIC_DAY,
    patient: { mrn: patient.mrn, display: patient.name },
    wound: patient.wound,
    etiologyKey: patient.etiologyKey,
    allergies: patient.allergies,
    abpi: patient.abpiLabel,
    compressionSafe: patient.compressionSafe,
    mechanical: patient.mechanical,
    acquisition: {
      source: reading.source,
      date: reading.date,
      probe: reading.qc ?? null,
    },
    channels: {
      electrochemical: { ph: reading.ph, claim: "±0.1" },
      thermal: {
        periwoundC: reading.periwoundTempC,
        contralateralC: reading.referenceTempC,
        deltaC: Number(deltaT(reading).toFixed(2)),
        claim: "±0.2°C",
      },
      contact: { depthMm: reading.depthMm },
      whiteLight: {
        areaCm2: reading.areaCm2,
        lengthCm: reading.lengthCm,
        widthCm: reading.widthCm,
        tissuePercent: reading.tissue,
        exudate: reading.exudate,
        exudateCharacter: reading.exudateCharacter,
        periwound: reading.periwound,
      },
      fluorescence: { index: reading.fluorescenceIndex, scale: "0-100", notABiofilmTest: true },
      perfusionOptics: { sto2Percent: reading.sto2 },
      assayCard: {
        biofilm: reading.biofilm,
        biofilmVisibleToEye: false,
        speciesCount: reading.speciesCount,
        dominantCount: reading.dominantCount,
        proteaseIndex: reading.proteaseIndex,
        proteaseElevatedAtOrAbove: 13,
        uricAcidRelative: reading.uricAcidRelative,
        uricAcidUnit: "relative wound-fluid index, not µmol/L",
        inflammation: reading.inflammation,
        inflammationIsCytokinePanel: false,
      },
      clinicianEntered: { painNrs: reading.painNrs },
    },
  }
}

export function historyTable(history: Assessment[]) {
  return history
    .map((item) => {
      const delta = deltaT(item)
      return `${item.date}  pH ${fmtPh(item.ph)}  ΔT ${fmtDelta(delta)}  biofilm ${item.biofilm}  species ${item.speciesCount} (${item.dominantCount} dominating)  protease ${item.proteaseIndex}  uric ${item.uricAcidRelative.toFixed(1)}  inflammation ${item.inflammation}  area ${item.areaCm2.toFixed(1)} cm²  fluor ${item.fluorescenceIndex}  StO2 ${item.sto2}%  pain ${item.painNrs}`
    })
    .join("\n")
}

export function buildGeminiPrompt(patient: Patient, reading: Assessment, history: Assessment[], draft: Plan) {
  const priorHistory = history.filter((item) => item.id !== reading.id)
  return `Write the clinician-facing treatment narrative for this wound visit.

The barrier call is already decided. Do not change it.
Primary barrier: ${draft.primaryBarrier}
Acuity: ${draft.acuityLabel}
Supporting: ${draft.supportingBarriers.join("; ") || "none"}

Patient
${patient.name}, ${patient.age}, ${patient.sex}, MRN ${patient.mrn}
Allergies: ${patient.allergies}
Comorbidities: ${patient.comorbidities.join(", ")}
ABPI: ${patient.abpiLabel}
Compression allowed by ABPI rule: ${patient.compressionSafe ? "yes" : "no"}
Mechanical plan already in use: ${patient.mechanical}
Chart note: ${patient.chartNote}
HbA1c: ${patient.hba1c ?? "not on file"}
Recent glucose: ${patient.recentGlucose ?? "not on file"}
Wound: ${patient.wound.etiology}, ${patient.wound.location}, ${patient.wound.classification}, ${patient.wound.durationWeeks} weeks, onset ${patient.wound.onset}

Hard rules
- If compression allowed is no, do not recommend compression in any order.
- Do not tell the clinician to start, prescribe, or name a systemic antibiotic.
- Do not invent labs, imaging, cultures, or exam findings that are not listed.
- Fluorescence is not a culture and not a biofilm test. Biofilm cannot be seen with the naked eye.
- Do not tell the clinician to start allopurinol, a bacteriophage, a probiotic, or a systemic steroid.
- Protease index 13 is an assay-specific cut, not a universal lab range. Uric acid is a relative index, not µmol/L.
- StO2 is not an arterial blood gas.
- Dry stable eschar on an ischemic limb stays intact until vascular review.
- Allergy list is binding.
- Use dressing classes, not brand names.
- Say "consistent with" and "consider". The clinician confirms.
- Keep the primary barrier wording intact inside the summary.
- Write for a wound clinic, in plain sentences, specific to this visit.

Prior visits
${historyTable(priorHistory)}

This visit, the only numbers you may use
${JSON.stringify(toMultimodalRecord(patient, reading), null, 2)}

Matrix draft you may sharpen, not contradict
Headline: ${draft.headline}
Summary: ${draft.clinicalSummary}
Trend: ${draft.trendReading}
Goals:
${draft.goals.map((item) => `- ${item}`).join("\n")}
Orders:
${draft.orders.map((item) => `- ${item.priority} | ${item.domain} | ${item.action}`).join("\n")}
Avoid:
${draft.avoid.map((item) => `- ${item}`).join("\n")}

Return JSON with headline, clinicalSummary, trendReading, goals, orders, avoid, monitoring, followUp, escalation, uncertainties.
orders items have domain, priority (now | this visit | ongoing), action, rationale.
Four to eight orders. Each action is one or two sentences a clinician can follow at the bedside.`
}
