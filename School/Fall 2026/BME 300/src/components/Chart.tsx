import { useState } from "react"
import type { Patient } from "../types"
import { interpret } from "../lib/clinical"
import { CLINIC_DAY, acuityMark, deltaT, fmtDate, fmtDelta, fmtPh, fmtTemp } from "../lib/format"
import { WoundFigure } from "./WoundFigure"

function Spark({ values }: { values: number[] }) {
  const width = 148
  const height = 42
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * (width - 8) + 4
    const y = height - 6 - ((value - min) / span) * (height - 14)
    return { x, y }
  })
  const last = points[points.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      <circle cx={last.x} cy={last.y} r="2.6" />
    </svg>
  )
}

export function Chart({
  patient,
  fresh,
  hasKey,
  onAcquire,
  onGenerate,
}: {
  patient: Patient
  fresh: boolean
  hasKey: boolean
  onAcquire: () => void
  onGenerate: () => void
}) {
  const reading = patient.history[patient.history.length - 1]
  const prior = patient.history[patient.history.length - 2]
  const call = interpret(reading, prior)
  const [mode, setMode] = useState<"white" | "fluor" | "nir">("white")
  const today = reading.date === CLINIC_DAY && reading.source === "device"

  return (
    <section className="chart">
      <header className="patient-head">
        <div>
          <p className="eyebrow">{patient.mrn}</p>
          <h1>{patient.name}</h1>
          <p className="lede">
            {patient.age} · {patient.sex} · {patient.wound.etiology} · {patient.wound.location}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" type="button" onClick={onAcquire}>
            {today ? "Repeat reading" : "Acquire reading"}
          </button>
          <button className="btn solid" type="button" onClick={onGenerate}>
            Generate treatment plan
          </button>
        </div>
      </header>

      <p className="action-note">
        {hasKey
          ? "The plan keeps these measurements. Gemini writes the treatment language."
          : "No Gemini key yet. The plan will come from the measurement matrix, in the same clinician format."}
      </p>

      <dl className="facts">
        <div>
          <dt>Classification</dt>
          <dd>
            {patient.wound.classification} · {patient.wound.durationWeeks} weeks
          </dd>
        </div>
        <div>
          <dt>Conditions</dt>
          <dd>{patient.comorbidities.join(", ")}</dd>
        </div>
        <div>
          <dt>Allergies</dt>
          <dd>{patient.allergies}</dd>
        </div>
        <div>
          <dt>Perfusion note</dt>
          <dd>{patient.abpiLabel}</dd>
        </div>
        <div>
          <dt>Mechanical</dt>
          <dd>{patient.mechanical}</dd>
        </div>
        {(patient.hba1c || patient.recentGlucose) && (
          <div>
            <dt>Glucose context</dt>
            <dd>{[patient.hba1c && `HbA1c ${patient.hba1c}`, patient.recentGlucose].filter(Boolean).join(" · ")}</dd>
          </div>
        )}
      </dl>

      <p className="chart-note">{patient.chartNote}</p>

      {fresh && today && (
        <p className="banner" role="status">
          Uploaded {fmtDate(reading.date)} from SP-1
          {reading.qc ? ` · lot ${reading.qc.probeLot} · tip discarded after this cycle` : ""}. T90{" "}
          {reading.qc?.t90Seconds.toFixed(1)} s.
        </p>
      )}
      {!today && (
        <p className="banner quiet">
          No SP-1 upload for {fmtDate(CLINIC_DAY)}. The chart below is the {fmtDate(reading.date)} visit.
        </p>
      )}

      <div className={`callout acuity-${call.acuity}`}>
        <p className={`acuity-mark acuity-${call.acuity}`}>{acuityMark(call.acuity)}</p>
        <div>
          <p className="eyebrow">Primary barrier</p>
          <h2>{call.primaryBarrier}</h2>
          <p>
            {call.supportingBarriers.length
              ? `Also present: ${call.supportingBarriers.join(" · ")}`
              : "No additional barrier flagged on this reading."}
          </p>
        </div>
      </div>

      <h2 className="section-label">Biomarkers</h2>
      <div className="tiles tiles-bio">
        <article>
          <p>Biofilm</p>
          <strong>{reading.biofilm === "present" ? "Present" : "Absent"}</strong>
          <span>{reading.biofilm === "present" ? "■ Present" : "✓ Absent"} · not on the image</span>
        </article>
        <article>
          <p>Diversity</p>
          <strong>{reading.speciesCount}</strong>
          <span>
            {call.diversity === "low" ? "■ Low diversity" : call.diversity === "borderline" ? "● Borderline" : "✓ None dominating"}
          </span>
        </article>
        <article>
          <p>Protease</p>
          <strong>{reading.proteaseIndex}</strong>
          <span>{call.protease === "elevated" ? "■ Elevated" : "✓ Not elevated"} · index</span>
        </article>
        <article>
          <p>Uric acid</p>
          <strong>{reading.uricAcidRelative.toFixed(1)}</strong>
          <span>{call.uric === "elevated" ? "■ Elevated" : call.uric === "borderline" ? "● Borderline" : "✓ Lower band"} · relative</span>
        </article>
        <article>
          <p>Inflammation</p>
          <strong>{reading.inflammation === "persistent" ? "Persistent" : "Resolving"}</strong>
          <span>{reading.inflammation === "persistent" ? "■ Persistent" : "✓ Resolving"} · pattern</span>
        </article>
        <article>
          <p>pH</p>
          <strong>{fmtPh(reading.ph)}</strong>
          <span>{call.phCall === "healing" ? "✓ Healing range" : call.phCall === "alkaline" ? "■ Barrier" : call.phCall === "transitional" ? "● Transitional" : "● Verify"}</span>
        </article>
        <article>
          <p>Temperature delta</p>
          <strong>{fmtDelta(call.deltaT)}</strong>
          <span>
            {fmtTemp(reading.periwoundTempC)} vs {fmtTemp(reading.referenceTempC)}
          </span>
        </article>
      </div>

      <h2 className="section-label">Acquisition</h2>
      <div className="tiles">
        <article>
          <p>pH</p>
          <strong>{fmtPh(reading.ph)}</strong>
          <span>{call.phCall === "healing" ? "✓ Healing range" : call.phCall === "alkaline" ? "■ Barrier" : call.phCall === "transitional" ? "● Transitional" : "● Verify"}</span>
        </article>
        <article>
          <p>Temperature delta</p>
          <strong>{fmtDelta(call.deltaT)}</strong>
          <span>
            {fmtTemp(reading.periwoundTempC)} vs {fmtTemp(reading.referenceTempC)}
          </span>
        </article>
        <article>
          <p>Area</p>
          <strong>{reading.areaCm2.toFixed(1)}</strong>
          <span>cm² · {reading.lengthCm.toFixed(1)} × {reading.widthCm.toFixed(1)} cm</span>
        </article>
        <article>
          <p>Fluorescence</p>
          <strong>{reading.fluorescenceIndex}</strong>
          <span>{call.fluorCall === "high" ? "■ High signal" : call.fluorCall === "moderate" ? "● Moderate signal" : "✓ Low signal"}</span>
        </article>
        <article>
          <p>Estimated StO2</p>
          <strong>{reading.sto2}%</strong>
          <span>{call.oxygenCall === "impaired" ? "■ Impaired" : call.oxygenCall === "borderline" ? "● Borderline" : "✓ Adequate"}</span>
        </article>
        <article>
          <p>Pain NRS</p>
          <strong>{reading.painNrs}</strong>
          <span>{reading.painNrs >= 7 ? "■ Severe" : reading.painNrs >= 5 ? "● Needs a plan" : "✓ Tolerable"} · reported</span>
        </article>
      </div>

      <div className="split">
        <figure>
          <div className="mode-switch" role="group" aria-label="Optical review">
            {(
              [
                ["white", "White light"],
                ["fluor", "Fluorescence"],
                ["nir", "Perfusion"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" data-on={mode === id ? "yes" : "no"} onClick={() => setMode(id)}>
                {label}
              </button>
            ))}
          </div>
          <WoundFigure assessment={reading} skin={patient.skin} mode={mode} />
          <figcaption>
            Optical schematic of the tissue fractions. Biofilm cannot be seen in this image.
          </figcaption>
        </figure>
        <div className="trends">
          <h2>Since the first visit on this chart</h2>
          {(
            [
              ["pH", patient.history.map((item) => item.ph), fmtPh(reading.ph)],
              ["Protease", patient.history.map((item) => item.proteaseIndex), String(reading.proteaseIndex)],
              ["Uric acid", patient.history.map((item) => item.uricAcidRelative), reading.uricAcidRelative.toFixed(1)],
              ["Species", patient.history.map((item) => item.speciesCount), String(reading.speciesCount)],
            ] as const
          ).map(([label, values, current]) => (
            <div key={label} className="trend">
              <div>
                <span>{label}</span>
                <strong>{current}</strong>
              </div>
              <Spark values={[...values]} />
            </div>
          ))}
        </div>
      </div>

      <div className="table-scroll">
        <table className="history">
          <caption>Visit history</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Biofilm</th>
              <th>Species</th>
              <th>Protease</th>
              <th>Uric acid</th>
              <th>Inflammation</th>
              <th>pH</th>
              <th>Delta</th>
              <th>Area</th>
              <th>Fluorescence</th>
            </tr>
          </thead>
          <tbody>
            {[...patient.history].reverse().map((item) => (
              <tr key={item.id} data-today={item.date === CLINIC_DAY ? "yes" : "no"}>
                <td>{fmtDate(item.date)}{item.source === "device" ? " · SP-1" : ""}</td>
                <td>{item.biofilm === "present" ? "Present" : "Absent"}</td>
                <td>
                  {item.speciesCount}
                  {item.dominantCount ? ` · ${item.dominantCount} dominating` : ""}
                </td>
                <td>{item.proteaseIndex}</td>
                <td>{item.uricAcidRelative.toFixed(1)}</td>
                <td>{item.inflammation === "persistent" ? "Persistent" : "Resolving"}</td>
                <td>{fmtPh(item.ph)}</td>
                <td>{fmtDelta(deltaT(item))}</td>
                <td>{item.areaCm2.toFixed(1)} cm²</td>
                <td>{item.fluorescenceIndex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
