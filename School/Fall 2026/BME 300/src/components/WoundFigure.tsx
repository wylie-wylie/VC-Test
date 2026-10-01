import type { Assessment } from "../types"

type Mode = "white" | "fluor" | "nir"

function hash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function blob(rand: () => number, cx: number, cy: number, rx: number, ry: number) {
  const steps = 14
  const points = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2 - Math.PI / 2
    const jitter = 0.78 + rand() * 0.38
    return [cx + Math.cos(angle) * rx * jitter, cy + Math.sin(angle) * ry * jitter]
  })
  const [first, ...rest] = points
  return `M ${first[0].toFixed(1)} ${first[1].toFixed(1)} ${rest
    .map((point) => `L ${point[0].toFixed(1)} ${point[1].toFixed(1)}`)
    .join(" ")} Z`
}

function oxygenColor(sto2: number) {
  const t = Math.min(1, Math.max(0, (sto2 - 25) / 55))
  const red = Math.round(42 + t * 176)
  const green = Math.round(78 - t * 18)
  const blue = Math.round(148 - t * 96)
  return `rgb(${red} ${green} ${blue})`
}

export function WoundFigure({
  assessment,
  skin,
  mode,
}: {
  assessment: Assessment
  skin: string
  mode: Mode
}) {
  const rand = mulberry32(hash(`${assessment.id}-${mode}`))
  const outline = blob(rand, 180, 124, 96, 62)
  const clipId = `bed-${assessment.id}-${mode}`
  const { tissue } = assessment
  const regions = [
    { color: "#8e2c2c", amount: tissue.granulation },
    { color: "#c2a84e", amount: tissue.slough },
    { color: "#2b261f", amount: tissue.necrotic },
    { color: "#efc3b8", amount: tissue.epithelial },
  ]
  const spots = Array.from({ length: Math.max(5, Math.round(assessment.fluorescenceIndex / 6)) }, (_, index) => ({
    cx: 180 + (rand() - 0.5) * 130,
    cy: 124 + (rand() - 0.5) * 84,
    r: 1.8 + rand() * (assessment.fluorescenceIndex > 50 ? 4.5 : 2.4),
    fill: rand() > (assessment.fluorescenceIndex > 55 ? 0.45 : 0.82) ? "#ff5d68" : "#d6ff67",
    key: index,
  }))

  return (
    <svg className="wound" viewBox="0 0 360 250" role="img" aria-label={`${mode} optical schematic`}>
      <defs>
        <clipPath id={clipId}>
          <path d={outline} />
        </clipPath>
      </defs>
      <rect width="360" height="250" rx="16" fill={mode === "white" ? skin : mode === "fluor" ? "#101614" : "#1a2430"} />
      {mode === "white" &&
        Array.from({ length: 22 }, (_, index) => (
          <circle key={index} cx={24 + rand() * 312} cy={18 + rand() * 214} r={0.4 + rand()} fill="rgba(70,42,28,0.16)" />
        ))}
      <path d={outline} fill={mode === "nir" ? oxygenColor(assessment.sto2) : mode === "fluor" ? "#101614" : "#6d3030"} />
      {mode === "white" &&
        regions.map((region) =>
          region.amount < 6 ? null : (
            <path
              key={region.color}
              d={blob(rand, 180 + (rand() - 0.5) * 36, 124 + (rand() - 0.5) * 22, 34 + region.amount / 4, 22 + region.amount / 7)}
              fill={region.color}
              opacity={0.42 + region.amount / 180}
              clipPath={`url(#${clipId})`}
            />
          ),
        )}
      {mode === "white" && (
        <path d={outline} fill="none" stroke="#f3cfc6" strokeWidth={Math.max(3, tissue.epithelial / 5)} />
      )}
      {mode === "fluor" &&
        spots.map((spot) => (
          <circle key={spot.key} cx={spot.cx} cy={spot.cy} r={spot.r} fill={spot.fill} clipPath={`url(#${clipId})`} />
        ))}
      {mode === "nir" && (
        <text x="180" y="132" textAnchor="middle" fill="#f7f4ee" fontSize="28" fontFamily="Outfit, sans-serif">
          {assessment.sto2}%
        </text>
      )}
      {mode === "white" && (
        <text x="180" y="232" textAnchor="middle" fill="#1c1915" fontSize="13" fontFamily="Outfit, sans-serif">
          {assessment.lengthCm.toFixed(1)} × {assessment.widthCm.toFixed(1)} cm
        </text>
      )}
    </svg>
  )
}
