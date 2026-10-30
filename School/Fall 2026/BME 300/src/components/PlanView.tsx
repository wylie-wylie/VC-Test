import type { Patient, Plan } from "../types"
import type { StoredPlan } from "../lib/session"
import { DISCLAIMER, acuityMark, fmtDate, priorityLabel } from "../lib/format"
import type { Assessment } from "../types"

export function PlanView({
  patient,
  reading,
  stored,
  onGenerate,
}: {
  patient: Patient
  reading: Assessment
  stored?: StoredPlan
  onGenerate: () => void
}) {
  const plan: Plan | undefined = stored?.plan

  return (
    <section className="plan-wrap">
      <div className="plan-toolbar no-print">
        <div>
          <p className="eyebrow">{patient.mrn}</p>
          <h1>Treatment plan</h1>
        </div>
        <div className="head-actions">
          <button className="btn ghost" type="button" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn solid" type="button" onClick={onGenerate}>
            {stored ? "Refresh" : "Write plan"}
          </button>
        </div>
      </div>

      {!plan && (
        <div className="empty-plan no-print">
          <p>No plan for this visit yet.</p>
          <button className="btn solid" type="button" onClick={onGenerate}>
            Write plan
          </button>
        </div>
      )}

      {plan && (
        <article className="plan-sheet">
          <header className="sheet-head">
            <div>
              <p>
                {patient.name} · {fmtDate(reading.date)}
              </p>
              <h2>{plan.headline}</h2>
            </div>
            <p className={`acuity-mark acuity-${plan.acuity}`}>{acuityMark(plan.acuity)}</p>
          </header>

          <dl className="sheet-id">
            <div>
              <dt>Wound</dt>
              <dd>
                {patient.wound.etiology} · {patient.wound.location}
              </dd>
            </div>
            <div>
              <dt>Allergies</dt>
              <dd>{patient.allergies}</dd>
            </div>
            <div>
              <dt>Perfusion</dt>
              <dd>{patient.abpiLabel}</dd>
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
            <h3>Orders</h3>
            <ol className="orders">
              {plan.orders.map((item, index) => (
                <li key={`${item.domain}-${index}`}>
                  <div className="order-top">
                    <span>{item.domain}</span>
                    <span>{priorityLabel(item.priority)}</span>
                  </div>
                  <p>{item.action}</p>
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

          <section>
            <h3>Follow-up</h3>
            <p>{plan.followUp}</p>
          </section>

          <footer className="sheet-foot">
            <p>{DISCLAIMER}</p>
          </footer>
        </article>
      )}

    </section>
  )
}
