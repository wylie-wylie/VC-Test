import type { Patient } from "../types"
import { interpret } from "../lib/clinical"
import { CLINIC_DAY, acuityMark, deltaT, fmtDate, fmtDelta, fmtTemp, titleCase } from "../lib/format"

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
  onAcquire,
  onGenerate,
}: {
  patient: Patient
  fresh: boolean
  onAcquire: () => void
  onGenerate: () => void
}) {
  const reading = patient.history[patient.history.length - 1]
  const prior = patient.history[patient.history.length - 2]
  const call = interpret(reading, prior)
  const today = reading.date === CLINIC_DAY && reading.source === "device"
  const tissueLead = (
    [
      ["granulation", reading.tissue.granulation],
      ["slough", reading.tissue.slough],
      ["necrotic", reading.tissue.necrotic],
      ["epithelial", reading.tissue.epithelial],
    ] as const
  ).reduce((lead, part) => (part[1] > lead[1] ? part : lead))

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
            {today ? "Repeat reading" : "New reading"}
          </button>
          <button className="btn solid" type="button" onClick={onGenerate}>
            Treatment plan
          </button>
        </div>
      </header>

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
            <dt>Glucose</dt>
            <dd>{[patient.hba1c && `HbA1c ${patient.hba1c}`, patient.recentGlucose].filter(Boolean).join(" · ")}</dd>
          </div>
        )}
      </dl>

      <p className="chart-note">{patient.chartNote}</p>

      {fresh && today && (
        <p className="banner" role="status">
          Reading uploaded {fmtDate(reading.date)}.
        </p>
      )}
      {!today && (
        <p className="banner quiet">
          Showing the {fmtDate(reading.date)} visit. No reading yet today.
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

      <div className="tiles">
        <article>
          <p>Temperature</p>
          <strong>{fmtDelta(call.deltaT)}</strong>
          <span>
            {fmtTemp(reading.periwoundTempC)} vs {fmtTemp(reading.referenceTempC)}
          </span>
        </article>
        <article>
          <p>Fluorescence</p>
          <strong>{reading.fluorescenceIndex.toFixed(0)}</strong>
          <span>
            {call.fluorCall === "bright" ? "■ Bright" : call.fluorCall === "signal" ? "● Signal" : "✓ Quiet"}
          </span>
        </article>
        <article>
          <p>Area</p>
          <strong>{reading.areaCm2.toFixed(1)}</strong>
          <span>
            cm² · {reading.lengthCm.toFixed(1)} × {reading.widthCm.toFixed(1)} cm
          </span>
        </article>
        <article className="tile-wide">
          <p>Tissue</p>
          <strong>
            {tissueLead[1]}% {tissueLead[0]}
          </strong>
          <span>
            {call.tissueBarrier ? "■ Nonviable" : "✓ Viable bed"} · granulation {reading.tissue.granulation}% · slough{" "}
            {reading.tissue.slough}% · necrotic {reading.tissue.necrotic}% · epithelial {reading.tissue.epithelial}%
          </span>
        </article>
        <article>
          <p>Exudate</p>
          <strong>{titleCase(reading.exudate)}</strong>
          <span>
            {call.moisture === "excess" ? "■ Excess" : call.moisture === "dry" ? "● Dry" : "✓ Balanced"} ·{" "}
            {titleCase(reading.exudateCharacter)}
          </span>
        </article>
        <article>
          <p>Periwound</p>
          <strong>{reading.periwound.length ? titleCase(reading.periwound[0]) : "Intact"}</strong>
          <span>
            {reading.periwound.length > 1
              ? reading.periwound.slice(1).map(titleCase).join(", ")
              : reading.periwound.length
                ? "Skin around the wound"
                : "No skin change"}
          </span>
        </article>
      </div>

      <div className="trends">
          <h2>Trend</h2>
          {(
            [
              ["Temperature", patient.history.map((item) => deltaT(item)), fmtDelta(call.deltaT)],
              ["Fluorescence", patient.history.map((item) => item.fluorescenceIndex), reading.fluorescenceIndex.toFixed(0)],
              ["Area", patient.history.map((item) => item.areaCm2), reading.areaCm2.toFixed(1)],
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

      <div className="table-scroll">
        <table className="history">
          <caption>Visit history</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Delta</th>
              <th>Fluorescence</th>
              <th>Area</th>
              <th>Exudate</th>
              <th>Granulation</th>
              <th>Slough</th>
              <th>Necrotic</th>
              <th>Periwound</th>
            </tr>
          </thead>
          <tbody>
            {[...patient.history].reverse().map((item) => (
              <tr key={item.id} data-today={item.date === CLINIC_DAY ? "yes" : "no"}>
                <td>{fmtDate(item.date)}{item.source === "device" ? " · uploaded" : ""}</td>
                <td>{fmtDelta(deltaT(item))}</td>
                <td>{item.fluorescenceIndex.toFixed(0)}</td>
                <td>{item.areaCm2.toFixed(1)} cm²</td>
                <td>
                  {item.exudate}, {item.exudateCharacter}
                </td>
                <td>{item.tissue.granulation}%</td>
                <td>{item.tissue.slough}%</td>
                <td>{item.tissue.necrotic}%</td>
                <td>{item.periwound.length ? item.periwound.map(titleCase).join(", ") : "Intact"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
