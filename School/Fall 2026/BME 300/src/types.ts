export type ExudateAmount = "none" | "scant" | "moderate" | "heavy"
export type BiofilmCall = "absent" | "present"
export type InflammationCall = "resolving" | "persistent"

export type TissueFrac = {
  granulation: number
  slough: number
  necrotic: number
  epithelial: number
}

export type Assessment = {
  id: string
  date: string
  source: "clinic" | "device"
  ph: number
  periwoundTempC: number
  referenceTempC: number
  depthMm: number
  areaCm2: number
  lengthCm: number
  widthCm: number
  tissue: TissueFrac
  exudate: ExudateAmount
  exudateCharacter: string
  fluorescenceIndex: number
  sto2: number
  painNrs: number
  periwound: string[]
  biofilm: BiofilmCall
  speciesCount: number
  dominantCount: number
  proteaseIndex: number
  uricAcidRelative: number
  inflammation: InflammationCall
  qc?: {
    t90Seconds: number
    probeLot: string
    probeAreaCm2: number
  }
}

export type EtiologyKey = "dfu" | "vlu" | "pressure" | "arterial" | "dehiscence"

export type Patient = {
  id: string
  mrn: string
  name: string
  age: number
  sex: "Female" | "Male"
  comorbidities: string[]
  allergies: string
  hba1c?: string
  recentGlucose?: string
  abpiLabel: string
  abpiValue: number | null
  compressionSafe: boolean
  etiologyKey: EtiologyKey
  mechanical: string
  chartNote: string
  skin: string
  wound: {
    etiology: string
    location: string
    classification: string
    onset: string
    durationWeeks: number
  }
  history: Assessment[]
  pending: Assessment
}

export type Acuity = "stable" | "watch" | "escalate"

export type Finding = {
  parameter: string
  value: string
  reference: string
  status: string
  note: string
}

export type Order = {
  domain: string
  priority: "now" | "this visit" | "ongoing"
  action: string
  rationale: string
}

export type Plan = {
  headline: string
  primaryBarrier: string
  supportingBarriers: string[]
  acuity: Acuity
  acuityLabel: string
  clinicalSummary: string
  trendReading: string
  findings: Finding[]
  goals: string[]
  orders: Order[]
  avoid: string[]
  monitoring: string[]
  followUp: string
  escalation: string[]
  uncertainties: string[]
}

export type BiomarkerRow = {
  biomarker: string
  meaning: string
  normal: string
  abnormal: string
  therapy: string
  image: string
  status: "Baseline" | "Literature"
}

export type MatrixRow = {
  parameter: string
  channel: string
  envelope: string
  expected: string
  barrier: string
  treatment: string
  status: "Extension" | "Context"
}
