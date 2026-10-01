import { useEffect, useState } from "react"
import type { Assessment, Patient } from "../types"
import { CLINIC_DAY, PROBE_AREA_CM2, fmtDate, fmtPh, fmtTemp } from "../lib/format"
import { WoundFigure } from "./WoundFigure"

type Phase = "ready" | "contact" | "contact-done" | "optical" | "review"
type Optic = "white" | "fluor" | "nir"

function lotCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const letters = Array.from({ length: 2 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
  const digits = Math.floor(1000 + Math.random() * 9000)
  return `SP1-${letters}${digits}`
}

export function Device({
  patient,
  onCancel,
  onCommit,
}: {
  patient: Patient
  onCancel: () => void
  onCommit: (reading: Assessment) => void
}) {
  const target = patient.pending
  const [phase, setPhase] = useState<Phase>("ready")
  const [progress, setProgress] = useState(0)
  const [livePh, setLivePh] = useState(target.ph)
  const [liveTemp, setLiveTemp] = useState(target.periwoundTempC)
  const [t90, setT90] = useState<number | null>(null)
  const [optic, setOptic] = useState<Optic>("white")
  const [pain, setPain] = useState(target.painNrs)
  const [lot] = useState(lotCode)

  useEffect(() => {
    if (phase !== "contact") return
    const started = performance.now()
    const duration = 4800
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / duration)
      setProgress(t)
      if (t >= 1) {
        setLivePh(target.ph)
        setLiveTemp(target.periwoundTempC)
        setT90(Math.round((8.6 + Math.random() * 3.2) * 10) / 10)
        setPhase("contact-done")
        return
      }
      const sway = 1 - t
      setLivePh(target.ph + (Math.random() - 0.5) * 0.36 * sway)
      setLiveTemp(target.periwoundTempC + (Math.random() - 0.5) * 0.7 * sway)
    }, 90)
    return () => window.clearInterval(id)
  }, [phase, target.periwoundTempC, target.ph])

  useEffect(() => {
    if (phase !== "optical") return
    const started = performance.now()
    const duration = 5200
    const modes: Optic[] = ["white", "fluor", "nir"]
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / duration)
      setProgress(t)
      setOptic(modes[Math.min(2, Math.floor(t * 3))])
      if (t >= 1) setPhase("review")
    }, 90)
    return () => window.clearInterval(id)
  }, [phase])

  function beginContact() {
    setProgress(0)
    setPhase("contact")
  }

  function beginOptical() {
    setProgress(0)
    setOptic("white")
    setPhase("optical")
  }

  function commit() {
    if (t90 == null) return
    onCommit({
      ...target,
      id: `${patient.id}-${CLINIC_DAY}`,
      date: CLINIC_DAY,
      source: "device",
      painNrs: pain,
      qc: { t90Seconds: t90, probeLot: lot, probeAreaCm2: PROBE_AREA_CM2 },
    })
  }

  const opticalLocked = phase === "review"
  const screenMode: Optic = phase === "optical" || phase === "review" ? optic : "white"

  return (
    <section className="device-stage">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Acquisition · {patient.mrn}</p>
          <h1>{patient.name}</h1>
          <p className="lede">
            {patient.wound.location}. Disposable tip {lot}. One cycle, then the tip is discarded.
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </header>

      <div className="device-layout">
        <ol className="steps">
          <li data-state={phase === "ready" || phase === "contact" ? "current" : "done"}>
            <span>1</span>
            <div>
              <strong>Contact</strong>
              <p>pH, temperature, depth, and the assay card. Hold the tip in the bed until the numbers settle.</p>
            </div>
          </li>
          <li data-state={phase === "optical" ? "current" : opticalLocked ? "done" : "wait"}>
            <span>2</span>
            <div>
              <strong>Camera</strong>
              <p>White light, fluorescence, then perfusion. The lens does not touch the wound.</p>
            </div>
          </li>
          <li data-state={phase === "review" ? "current" : "wait"}>
            <span>3</span>
            <div>
              <strong>Confirm</strong>
              <p>Check the upload. Pain is asked, not sensed.</p>
            </div>
          </li>
        </ol>

        <div className="handheld" data-phase={phase}>
          <div className="hand-top">
            <span>Glutease v1</span>
            <span>SP-1</span>
          </div>
          <div className={`lcd ${phase === "optical" || (phase === "review" && optic !== "white") ? "lcd-dark" : ""}`}>
            {phase === "ready" && (
              <div className="lcd-copy">
                <p>Tip seated</p>
                <strong>Ready</strong>
                <span>pH · °C · optics</span>
              </div>
            )}
            {(phase === "contact" || phase === "contact-done") && (
              <div className="lcd-metrics">
                <p>{phase === "contact" ? "Settling" : "Steady"}</p>
                <strong>{fmtPh(livePh)}</strong>
                <em>pH</em>
                <strong className="temp-read">{fmtTemp(liveTemp)}</strong>
                <em>periwound</em>
                {phase === "contact" && (
                  <div className="settle" aria-hidden="true">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
              </div>
            )}
            {(phase === "optical" || phase === "review") && (
              <div className="lcd-optic">
                <WoundFigure assessment={target} skin={patient.skin} mode={screenMode} />
                <p>{optic === "white" ? "White light" : optic === "fluor" ? "Fluorescence" : "Perfusion"}</p>
              </div>
            )}
          </div>
          <div className="lens" data-live={phase === "optical" ? "yes" : "no"} />
          <button
            className="shutter"
            type="button"
            onClick={() => {
              if (phase === "ready") beginContact()
              else if (phase === "contact-done") beginOptical()
            }}
            disabled={phase === "contact" || phase === "optical" || phase === "review"}
            aria-label={phase === "contact-done" ? "Start camera capture" : "Read the wound bed"}
          >
            <span />
          </button>
          <p className="hand-caption">Single-use tip · footprint {PROBE_AREA_CM2.toFixed(1)} cm²</p>
        </div>

        <div className="readout">
          {phase === "ready" && (
            <>
              <h2>Place the tip in the wound bed.</h2>
              <p>
                The SP-1 is a short-contact probe in a glucometer body. The tip reads pH, temperature, and an assay
                card. The camera is on the face, stays off the tissue, and cannot see biofilm.
              </p>
              <button className="btn solid" type="button" onClick={beginContact}>
                Read wound bed
              </button>
            </>
          )}

          {phase === "contact" && (
            <>
              <h2>Waiting for steady state.</h2>
              <p>The specification is a T90 at or under 15 seconds. This playback settles faster so a demo can move.</p>
              <p className="live-line">
                pH {fmtPh(livePh)} · {fmtTemp(liveTemp)}
              </p>
            </>
          )}

          {phase === "contact-done" && (
            <>
              <h2>Contact channels are locked.</h2>
              <ul className="locked-list">
                <li>
                  <span>pH</span>
                  <strong>{fmtPh(target.ph)}</strong>
                </li>
                <li>
                  <span>Periwound</span>
                  <strong>{fmtTemp(target.periwoundTempC)}</strong>
                </li>
                <li>
                  <span>Contralateral</span>
                  <strong>{fmtTemp(target.referenceTempC)}</strong>
                </li>
                <li>
                  <span>Depth</span>
                  <strong>{target.depthMm <= 0 ? "Partial thickness" : `${target.depthMm.toFixed(0)} mm`}</strong>
                </li>
                <li>
                  <span>T90</span>
                  <strong>{t90?.toFixed(1)} s · pass</strong>
                </li>
                <li>
                  <span>Biofilm</span>
                  <strong>{target.biofilm === "present" ? "Present" : "Absent"}</strong>
                </li>
                <li>
                  <span>Diversity</span>
                  <strong>
                    {target.speciesCount} species
                    {target.dominantCount ? `, ${target.dominantCount} dominating` : ""}
                  </strong>
                </li>
                <li>
                  <span>Protease</span>
                  <strong>{target.proteaseIndex}</strong>
                </li>
                <li>
                  <span>Uric acid</span>
                  <strong>{target.uricAcidRelative.toFixed(1)} relative</strong>
                </li>
                <li>
                  <span>Inflammation</span>
                  <strong>{target.inflammation === "persistent" ? "Persistent" : "Resolving"}</strong>
                </li>
              </ul>
              <p>The assay card is not on the camera. Biofilm cannot be seen with the naked eye.</p>
              <button className="btn solid" type="button" onClick={beginOptical}>
                Open camera
              </button>
            </>
          )}

          {phase === "optical" && (
            <>
              <h2>Optical pass.</h2>
              <p>The preview steps through white light, bacterial fluorescence, and a near-infrared oxygen estimate.</p>
              <p className="live-line">
                {optic === "white" ? "White light" : optic === "fluor" ? "Fluorescence" : "Perfusion"} ·{" "}
                {Math.round(progress * 100)}%
              </p>
            </>
          )}

          {phase === "review" && (
            <>
              <h2>Ready to upload.</h2>
              <p>
                {fmtDate(CLINIC_DAY)}. Confirm pain, then send this packet to the chart. The tip {lot} cannot be used
                again.
              </p>
              <div className="pain-box">
                <span>Pain NRS, patient reported</span>
                <div>
                  <button type="button" onClick={() => setPain((value) => Math.max(0, value - 1))} aria-label="Lower pain score">
                    −
                  </button>
                  <strong>{pain}</strong>
                  <button type="button" onClick={() => setPain((value) => Math.min(10, value + 1))} aria-label="Raise pain score">
                    +
                  </button>
                </div>
              </div>
              <div className="mode-switch" role="group" aria-label="Camera mode">
                {(
                  [
                    ["white", "White light"],
                    ["fluor", "Fluorescence"],
                    ["nir", "Perfusion"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" data-on={optic === id ? "yes" : "no"} onClick={() => setOptic(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <ul className="qc-list">
                <li>✓ pH inside 4.0–10.0 · claim ±0.1</li>
                <li>✓ Temperature inside 25–42°C · claim ±0.2°C</li>
                <li>✓ T90 {t90?.toFixed(1)} s · specification ≤ 15 s</li>
                <li>✓ Tip area {PROBE_AREA_CM2.toFixed(1)} cm² · specification ≤ 3.5 cm²</li>
                <li>✓ Biofilm reported by the assay card, not by the image</li>
              </ul>
              <button className="btn solid" type="button" onClick={commit}>
                Upload to chart
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
