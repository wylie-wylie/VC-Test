import { useEffect, useMemo, useRef, useState } from "react"
import { PATIENTS } from "./data/patients"
import { Chart } from "./components/Chart"
import { Device } from "./components/Device"
import { PlanView } from "./components/PlanView"
import { buildPlan, interpret } from "./lib/clinical"
import { acuityMark, fmtDelta } from "./lib/format"
import { loadSession, saveSession, type Session } from "./lib/session"
import type { Assessment, Patient } from "./types"

type View = "chart" | "plan" | "device"

function withReading(patient: Patient, reading?: Assessment): Patient {
  if (!reading) return patient
  return {
    ...patient,
    history: [...patient.history.filter((item) => item.date !== reading.date), reading],
  }
}

function latestCall(patient: Patient) {
  const reading = patient.history[patient.history.length - 1]
  const prior = patient.history[patient.history.length - 2]
  return interpret(reading, prior)
}

const ACUITY_RANK = { escalate: 0, watch: 1, stable: 2 }

export function App() {
  const [session, setSession] = useState<Session>(() => loadSession())
  const [selectedId, setSelectedId] = useState(PATIENTS[0].id)
  const [view, setView] = useState<View>("chart")
  const [freshId, setFreshId] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    saveSession(session)
  }, [session])

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [view, selectedId])

  const patients = useMemo(
    () => PATIENTS.map((patient) => withReading(patient, session.readings[patient.id])),
    [session],
  )

  const ranked = useMemo(
    () =>
      [...patients].sort((a, b) => {
        const byAcuity = ACUITY_RANK[latestCall(a).acuity] - ACUITY_RANK[latestCall(b).acuity]
        return byAcuity || a.name.localeCompare(b.name)
      }),
    [patients],
  )

  const patient = patients.find((item) => item.id === selectedId) ?? patients[0]
  const reading = patient.history[patient.history.length - 1]

  function selectPatient(id: string) {
    setSelectedId(id)
    setView("chart")
  }

  function commit(next: Assessment) {
    setSession((current) => {
      const plans = { ...current.plans }
      delete plans[patient.id]
      return {
        ...current,
        shiftCount: current.readings[patient.id] ? current.shiftCount : current.shiftCount + 1,
        readings: { ...current.readings, [patient.id]: next },
        plans,
      }
    })
    setFreshId(patient.id)
    setView("chart")
  }

  function generate() {
    const plan = buildPlan(patient, reading, patient.history)
    setView("plan")
    setSession((current) => ({
      ...current,
      plans: {
        ...current.plans,
        [patient.id]: { plan, createdAt: new Date().toISOString() },
      },
    }))
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <p>Wound Intelligence</p>
          <span>Wound clinic</span>
        </div>
        <p className="census-label">Clinic day 30 Sep 2026 · {ranked.length} patients</p>
        <ul className="census">
          {ranked.map((item) => {
            const call = latestCall(item)
            const uploaded = session.readings[item.id]
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="census-btn"
                  data-active={item.id === patient.id ? "yes" : "no"}
                  onClick={() => selectPatient(item.id)}
                >
                  <span className="census-top">
                    <strong>{item.name}</strong>
                    <em className={`mini acuity-${call.acuity}`}>{acuityMark(call.acuity)}</em>
                  </span>
                  <span>
                    {item.wound.etiology} · {item.wound.location}
                  </span>
                  <span className="census-meta">
                    {fmtDelta(call.deltaT)}
                    {uploaded ? " · today" : ""}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <nav aria-label="Sections">
            <button type="button" data-on={view === "chart" ? "yes" : "no"} onClick={() => setView("chart")}>
              Chart
            </button>
            <button type="button" data-on={view === "plan" ? "yes" : "no"} onClick={() => setView("plan")}>
              Plan
            </button>
          </nav>
        </header>

        <main ref={mainRef}>
          {view === "chart" && (
            <Chart
              patient={patient}
              fresh={freshId === patient.id}
              onAcquire={() => setView("device")}
              onGenerate={generate}
            />
          )}
          {view === "device" && (
            <Device key={patient.id} patient={patient} onCancel={() => setView("chart")} onCommit={commit} />
          )}
          {view === "plan" && (
            <PlanView patient={patient} reading={reading} stored={session.plans[patient.id]} onGenerate={generate} />
          )}
        </main>
      </div>
    </div>
  )
}
