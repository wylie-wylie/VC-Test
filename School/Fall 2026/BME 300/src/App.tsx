import { useEffect, useMemo, useRef, useState } from "react"
import { PATIENTS } from "./data/patients"
import { Chart } from "./components/Chart"
import { Device } from "./components/Device"
import { MatrixView } from "./components/MatrixView"
import { PlanView } from "./components/PlanView"
import { applyNarrative, buildGeminiPrompt, buildPlan, interpret } from "./lib/clinical"
import { acuityMark, fmtDelta, fmtPh } from "./lib/format"
import { writeWithGemini } from "./lib/gemini"
import {
  DEFAULT_MODEL,
  emptySession,
  loadApiKey,
  loadModel,
  loadSession,
  saveApiKey,
  saveModel,
  saveSession,
  type Session,
} from "./lib/session"
import type { Assessment, Patient } from "./types"

type View = "chart" | "plan" | "matrix" | "device"

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
  const [apiKey, setApiKey] = useState(loadApiKey)
  const [model, setModel] = useState(loadModel)
  const [draftKey, setDraftKey] = useState(loadApiKey)
  const [draftModel, setDraftModel] = useState(loadModel)
  const [selectedId, setSelectedId] = useState(PATIENTS[0].id)
  const [view, setView] = useState<View>("chart")
  const [dialog, setDialog] = useState<"settings" | "about" | null>(null)
  const [writingId, setWritingId] = useState<string | null>(null)
  const [writeError, setWriteError] = useState("")
  const [freshId, setFreshId] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const requestRef = useRef(0)

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
    setWriteError("")
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
    setWriteError("")
    setView("chart")
  }

  async function generate() {
    const draft = buildPlan(patient, reading, patient.history)
    const token = requestRef.current + 1
    requestRef.current = token
    setView("plan")
    setWriteError("")
    setSession((current) => ({
      ...current,
      plans: {
        ...current.plans,
        [patient.id]: { plan: draft, source: "matrix", createdAt: new Date().toISOString() },
      },
    }))
    if (!apiKey) return

    setWritingId(patient.id)
    try {
      const narrative = await writeWithGemini({
        apiKey,
        model,
        prompt: buildGeminiPrompt(patient, reading, patient.history, draft),
      })
      if (requestRef.current !== token) return
      const plan = applyNarrative(draft, narrative, patient)
      setSession((current) => ({
        ...current,
        plans: {
          ...current.plans,
          [patient.id]: { plan, source: "gemini", model, createdAt: new Date().toISOString() },
        },
      }))
    } catch (error) {
      if (requestRef.current !== token) return
      setWriteError(error instanceof Error ? error.message : "Gemini request failed.")
    } finally {
      if (requestRef.current === token) setWritingId(null)
    }
  }

  function saveSettings() {
    const nextKey = draftKey.trim()
    const nextModel = draftModel.trim() || DEFAULT_MODEL
    setApiKey(nextKey)
    setModel(nextModel)
    setDraftModel(nextModel)
    saveApiKey(nextKey)
    saveModel(nextModel)
    setDialog(null)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <p>Glutease v1</p>
          <span>Wound barrier console</span>
        </div>
        <p className="census-label">Clinic day 30 Sep 2026 · {ranked.length} synthetic patients</p>
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
                    pH {fmtPh(item.history[item.history.length - 1].ph)} · {fmtDelta(call.deltaT)}
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
              Profile
            </button>
            <button type="button" data-on={view === "matrix" ? "yes" : "no"} onClick={() => setView("matrix")}>
              Matrix
            </button>
          </nav>
          <div className="top-meta">
            <span>
              {session.shiftCount} of 30 this shift
            </span>
            <span>{apiKey ? "Gemini key saved" : "Matrix only"}</span>
            <button type="button" className="text-btn" onClick={() => setDialog("settings")}>
              Settings
            </button>
            <button type="button" className="text-btn" onClick={() => setDialog("about")}>
              About
            </button>
          </div>
        </header>

        <main ref={mainRef}>
          {view === "chart" && (
            <Chart
              patient={patient}
              fresh={freshId === patient.id}
              hasKey={Boolean(apiKey)}
              onAcquire={() => setView("device")}
              onGenerate={() => void generate()}
            />
          )}
          {view === "device" && (
            <Device key={patient.id} patient={patient} onCancel={() => setView("chart")} onCommit={commit} />
          )}
          {view === "plan" && (
            <PlanView
              patient={patient}
              reading={reading}
              stored={session.plans[patient.id]}
              writing={writingId === patient.id}
              error={writeError}
              hasKey={Boolean(apiKey)}
              onGenerate={() => void generate()}
            />
          )}
          {view === "matrix" && <MatrixView />}
        </main>
      </div>

      {dialog && (
        <div className="modal-back" role="presentation" onClick={() => setDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            {dialog === "settings" ? (
              <>
                <h2 id="dialog-title">Gemini</h2>
                <p>
                  The key stays in this browser. Use a class key, not a production key. The barrier call is computed
                  here. Gemini only writes the treatment narrative.
                </p>
                <label>
                  API key
                  <input
                    type="password"
                    value={draftKey}
                    autoComplete="off"
                    onChange={(event) => setDraftKey(event.target.value)}
                  />
                </label>
                <label>
                  Model
                  <input value={draftModel} onChange={(event) => setDraftModel(event.target.value)} />
                </label>
                <div className="modal-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setSession(emptySession())
                      setFreshId(null)
                      setWriteError("")
                    }}
                  >
                    Clear uploads
                  </button>
                  <button className="btn solid" type="button" onClick={saveSettings}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="dialog-title">About this prototype</h2>
                <p>
                  Glutease v1 is the first-semester console for a multimodal chronic-wound barrier system. The handheld
                  reads like a glucometer and sees with a camera. The chart shows the upload. The profile turns that
                  upload into a treatment plan.
                </p>
                <p>
                  Client Dr. Matthew Chambers. Advisor Dr. Mehmet Orman. BME 300, fall 2026. Ethan Brockman, Wylie
                  Liu, Aidan Burich, Malika Chebaclo, Paula Carreon, Riley Verbooman.
                </p>
                <p>Ten patients are synthetic. Nothing here is a medical device.</p>
                <button className="btn solid" type="button" onClick={() => setDialog(null)}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
