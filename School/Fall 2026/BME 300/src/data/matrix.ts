import type { BiomarkerRow, MatrixRow } from "../types"

export const BIOMARKERS: BiomarkerRow[] = [
  {
    biomarker: "Bacterial biofilm",
    meaning:
      "Biofilm in a chronic wound keeps inflammation going, disrupts collagen, blocks epithelialization, lowers oxygen availability, and raises resistance to antibiotics and immune cells.",
    normal: "Absent",
    abnormal: "Present",
    therapy:
      "Bedside first move is disruption: surfactant cleanse and, when perfusion allows, removal of the film and slough. An antibiotic alone is a poor match for biofilm. Literature routes include probiotics, bacterial signaling inhibitors, enzymes, bacteriophages, and immunomodulation. Those routes are not started from this screen.",
    image: "Cannot be seen with the naked eye. The camera does not show it.",
    status: "Literature",
  },
  {
    biomarker: "Bacterial diversity",
    meaning:
      "Lower diversity lets a few pathogenic, biofilm-forming species dominate and keeps inflammation in place.",
    normal: "12–20 or more species, with none dominating",
    abnormal: "About 10 species or fewer, with 1–3 dominating",
    therapy:
      "Probiotics are the described route once disruption is underway. A probiotic is not started from this profile alone.",
    image: "Not a photograph. The assay card reports a species count.",
    status: "Literature",
  },
  {
    biomarker: "Protease",
    meaning:
      "Excess protease, including matrix metalloproteinases and neutrophil elastase, breaks down collagen, growth factors, and the new matrix. The wound keeps clearing tissue instead of building it.",
    normal: "Not elevated. On this console an MMP-style index under 13 is not elevated.",
    abnormal:
      "Elevated. One published point-of-care concept treated nonhealing as human neutrophil elastase above 5 and/or MMP activity of at least 13. That cut is assay-specific. It is not a universal threshold for every wound type.",
    therapy:
      "After the bed is clean, and if perfusion allows, a protease-modulating dressing in the collagen or oxidized-regenerated-cellulose class. Also treat the driver, often biofilm and persistent inflammation. Do not put a moist protease dressing on dry ischemic eschar.",
    image: "Not visible. Assay card, not the lens.",
    status: "Literature",
  },
  {
    biomarker: "Uric acid",
    meaning:
      "Uric acid is the end of purine breakdown through xanthine oxidase, and that reaction also releases oxidants. Higher wound-fluid uric acid has tracked with more severe venous ulcers. It fits a hypoxic, oxidatively stressed bed.",
    normal:
      "Lower relative wound-fluid uric acid, as in less severe ulcers. This console calls a relative index under 1.5 the lower band. There is no universal µmol/L reference interval.",
    abnormal:
      "Relative index 2.0 or higher. In published venous-ulcer fluid, the more severe ulcers (PUSH 10–16) carried higher uric acid than less severe ulcers (PUSH 3–9).",
    therapy:
      "Treat the hypoxia and the inflammatory driver. Xanthine oxidase inhibition has been proposed as a research route. Do not start allopurinol from this profile. This is not a serum gout test.",
    image: "Not visible. Relative wound-fluid assay, not a photograph and not a serum lab.",
    status: "Literature",
  },
  {
    biomarker: "Inflammation",
    meaning:
      "Inflammation is the immune response to tissue damage and microorganisms. Signals recruit immune cells to clear bacteria and damaged tissue. Chronic wounds stay in that state, so tissue damage continues and the wound does not move into proliferation.",
    normal: "A temporary rise, then inflammatory signals fall as healing progresses.",
    abnormal: "Persistent elevation of pro-inflammatory cytokines such as IL-6, IL-8, IL-1, and TNF-α.",
    therapy:
      "Treat what is holding the wound there: biofilm, pressure, ischemia, or nonviable tissue. Do not add a systemic steroid from this screen.",
    image: "Not a color on the photograph. The assay card reports the pattern, not a four-cytokine panel.",
    status: "Literature",
  },
  {
    biomarker: "pH",
    meaning:
      "Healing beds sit slightly acidic. A stalled chronic wound is often alkaline, which favors protease activity and a hostile surface for epithelial cells.",
    normal: "Healing band 5.5–6.5",
    abnormal: "Alkaline stall 7.15–8.9. The sensor still reports 4.0–10.0.",
    therapy:
      "Find the driver, usually biofilm, bioburden, or nonviable tissue. Recheck pH with a new tip. Do not chase the number with an unreviewed topical.",
    image: "Number on the contact screen. Design claim ±0.1 pH.",
    status: "Baseline",
  },
  {
    biomarker: "Temperature",
    meaning:
      "A warm periwound can mark inflammation or infection. A cold periwound can mark poor blood supply. This probe compares the wound edge with contralateral intact skin.",
    normal: "Close to contralateral intact skin, inside the 32–39°C design point.",
    abnormal: "≥ +2.0°C thermal infection signature. ≤ −2.0°C hypoperfusion signature. Capture range is 25–42°C.",
    therapy:
      "A hot bed supports an infection workup, not an automatic antibiotic. A cold bed is a perfusion problem first: vascular review before debridement or compression.",
    image: "Number on the contact screen. Design claim ±0.2°C. T90 within 15 seconds.",
    status: "Baseline",
  },
]

export const MATRIX: MatrixRow[] = [
  {
    parameter: "Depth",
    channel: "Contact probe",
    envelope: "One cycle, at most 5 minutes, then discard the tip",
    expected: "Partial thickness or a stable shallow bed",
    barrier: "Deepening trend, or depth that raises probe-to-bone concern",
    treatment:
      "Deep beds need a packing plan from the clinician who owns the wound. Exposed bone or tendon is an escalation, not a dressing choice.",
    status: "Extension",
  },
  {
    parameter: "Area, length, width",
    channel: "White-light camera",
    envelope: "Many chronic wounds are about 2–5 cm². Some run larger, near 13 cm². Probe footprint stays ≤ 3.5 cm².",
    expected: "Area falling visit to visit",
    barrier: "Area rising, or flat after a period of closure",
    treatment:
      "Pair the area trend with the barrier call. A falling area in the healing pH band supports holding the current regimen.",
    status: "Extension",
  },
  {
    parameter: "Tissue fractions",
    channel: "White-light camera",
    envelope: "Granulation, slough, necrotic, epithelial. Estimates, summed to 100%.",
    expected: "Granulation and epithelial tissue dominate",
    barrier: "Necrotic ≥ 20% or slough ≥ 40%",
    treatment:
      "If perfusion allows, nonviable tissue is a debridement question. Dry stable eschar on an ischemic limb is left intact until vascular review.",
    status: "Extension",
  },
  {
    parameter: "Exudate",
    channel: "White-light camera",
    envelope: "None, scant, moderate, heavy. Character is an optical estimate.",
    expected: "Scant to moderate serous drainage",
    barrier: "Heavy drainage, purulence, or periwound maceration",
    treatment:
      "Match absorbency to volume. Protect macerated skin. Purulence changes the bioburden reading; it does not by itself choose an antibiotic.",
    status: "Extension",
  },
  {
    parameter: "Fluorescence index",
    channel: "Fluorescence optics",
    envelope: "0–100 optical scale",
    expected: "Under 20, low signal",
    barrier: "50 or higher, high bioburden signal. 20–49 is moderate.",
    treatment:
      "An optical bioburden signal, never a culture and never a biofilm photograph. High signal plus a hot bed supports culture consideration and a short-course antimicrobial dressing.",
    status: "Extension",
  },
  {
    parameter: "Estimated StO2",
    channel: "Near-infrared optics",
    envelope: "Percent estimate",
    expected: "60% or higher",
    barrier: "Under 40% impaired. 40–59% borderline.",
    treatment:
      "Low oxygen supports a perfusion workup. It is not an arterial blood gas and it does not clear a limb for compression.",
    status: "Extension",
  },
  {
    parameter: "Pain NRS",
    channel: "Clinician entered",
    envelope: "0–10, reported by the patient",
    expected: "Falling, and tolerable during dressing changes",
    barrier: "5 or higher, or a sudden jump",
    treatment:
      "Treat pain before the dressing. New severe pain is an escalation sign, especially with a cold bed or a deep wound.",
    status: "Context",
  },
]

export const MATRIX_NOTE =
  "pH and temperature are the baseline channels in the team PDS dated 17 Sep 2026. Temperature is compared with contralateral skin. The PDS also describes infection and ischemia against core temperature, which this cycle does not measure. Biofilm, diversity, protease, uric acid, and inflammation are literature rows. Protease uses one published assay idea, not a universal cutoff. Uric acid is a relative wound-fluid index because that literature did not establish a µmol/L reference interval. Biofilm cannot be seen with the naked eye."
