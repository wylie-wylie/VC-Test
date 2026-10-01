import type { Patient, Plan } from "../types"
import type { StoredPlan } from "../lib/session"
import { DISCLAIMER, acuityMark, fmtDate, priorityLabel } from "../lib/format"
import { toMultimodalRecord } from "../lib/clinical"
import type { Assessment } from "../types"

export function PlanView({
  patient,
  reading,
  stored,
  writing,
  error,
  hasKey,
  onGenerate,
}: {
  patient: Patient
  reading: Assessment
  stored?: StoredPlan
  writing: boolean
  error: string
  hasKey: boolean
  onGenerate: () => void
}) {
  const plan: Plan | undefined = stored?.plan

  return (
    <section className="plan-wrap">
      <div className="plan-toolbar no-print">
        <div>
          <p className="eyebrow">Clinician profile</p>
          <h1>Wound barrier profile</h1>
        </div>
        <div className="head-actions">
          <button className="btn ghost" type="button" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn solid" type="button" onClick={onGenerate} disabled={writing}>
            {writing
              ? "Writing with Gemini…"
              : hasKey
                ? stored
                  ? "Rewrite with Gemini"
                  : "Generate treatment plan"
                : stored
                  ? "Refresh plan"
                  : "Generate treatment plan"}
          </button>
        </div>
      </div>

      {!plan && (
        <div className="empty-plan no-print">
          <p>No profile for this reading yet. The measurement matrix can write one immediately. Gemini rewrites the narrative if a key is saved.</p>
          <button className="btn solid" type="button" onClick={onGenerate}>
            Generate treatment plan
          </button>
        </div>
      )}

      {error && <p className="banner warn no-print">{error} The matrix profile is still on the page.</p>}
      {writing && plan && <p className="banner no-print">Gemini is rewriting the narrative. The barrier call and the numbers stay put.</p>}

      {plan && (
        <article className="plan-sheet">
          <header className="sheet-head">
            <div>
              <p>Glutease v1 · Wound barrier profile</p>
              <h2>{plan.headline}</h2>
            </div>
            <p className={`acuity-mark acuity-${plan.acuity}`}>{acuityMark(plan.acuity)}</p>
          </header>

          <dl className="sheet-id">
            <div>
              <dt>Patient</dt>
              <dd>
                {patient.name} · {patient.age} · {patient.sex}
              </dd>
            </div>
            <div>
              <dt>MRN</dt>
              <dd>{patient.mrn}</dd>
            </div>
            <div>
              <dt>Reading</dt>
              <dd>
                {fmtDate(reading.date)} · {reading.source === "device" ? "SP-1 upload" : "Prior clinic visit"}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{stored?.source === "gemini" ? `Gemini · ${stored.model}` : "Measurement matrix"}</dd>
            </div>
          </dl>

          <section>
            <h3>Barrier</h3>
            <p className="barrier-line">{plan.primaryBarrier}</p>
            <p>{plan.clinicalSummary}</p>
            <p className="support-line">
              {plan.supportingBarriers.length
                ? `Also present: ${plan.supportingBarriers.join(" · ")}`
                : "No additional barrier flagged."}
            </p>
          </section>

          <section>
            <h3>Trend</h3>
            <p>{plan.trendReading}</p>
          </section>

          <section>
            <h3>Measurements</h3>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Reference</th>
                  <th>Call</th>
                </tr>
              </thead>
              <tbody>
                {plan.findings.map((finding) => (
                  <tr key={finding.parameter}>
                    <td>
                      <strong>{finding.parameter}</strong>
                      <span>{finding.note}</span>
                    </td>
                    <td>{finding.value}</td>
                    <td>{finding.reference}</td>
                    <td>{finding.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Goals</h3>
            <ul>
              {plan.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3>This visit</h3>
            <ol className="orders">
              {plan.orders.map((item, index) => (
                <li key={`${item.domain}-${index}`}>
                  <div className="order-top">
                    <span>{item.domain}</span>
                    <span>{priorityLabel(item.priority)}</span>
                  </div>
                  <p>{item.action}</p>
                  <p className="why">{item.rationale}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="two">
            <div>
              <h3>Do not</h3>
              <ul>
                {plan.avoid.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Watch for</h3>
              <ul>
                {plan.escalation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="two">
            <div>
              <h3>Follow-up</h3>
              <p>{plan.followUp}</p>
              <h3>Monitor</h3>
              <ul>
                {plan.monitoring.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Limits of this profile</h3>
              <ul>
                {plan.uncertainties.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <footer className="sheet-foot">
            <p>{DISCLAIMER}</p>
            <p>
              Wound {patient.wound.etiology.toLowerCase()}, {patient.wound.location.toLowerCase()},{" "}
              {patient.wound.classification}. Allergies: {patient.allergies}. {patient.abpiLabel}.
            </p>
          </footer>
        </article>
      )}

      <details className="record no-print">
        <summary>Multimodal record passed to the decision layer</summary>
        <pre>{JSON.stringify(toMultimodalRecord(patient, reading), null, 2)}</pre>
      </details>
    </section>
  )
}
