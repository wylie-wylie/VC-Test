import { useEffect, useRef, useState } from "react"
import type { Assessment, Patient } from "../types"
import { type CameraReading, openCameraStream } from "../lib/camera"
import { CLINIC_DAY, fmtDate, fmtTemp, titleCase } from "../lib/format"

type Phase = "ready" | "capture" | "listen" | "review"

function ScreenGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="lcd-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const IRONBOW = Array.from({ length: 256 }, (_, index) => {
  const t = index / 255
  const stops: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],
    [0.2, 90, 0, 120],
    [0.45, 210, 30, 20],
    [0.7, 250, 150, 0],
    [0.88, 255, 230, 140],
    [1, 255, 255, 255],
  ]
  let lower = stops[0]
  let upper = stops[stops.length - 1]
  for (let stop = 0; stop < stops.length - 1; stop += 1) {
    if (t >= stops[stop][0] && t <= stops[stop + 1][0]) {
      lower = stops[stop]
      upper = stops[stop + 1]
      break
    }
  }
  const span = upper[0] - lower[0] || 1
  const mix = (t - lower[0]) / span
  return [
    Math.round(lower[1] + (upper[1] - lower[1]) * mix),
    Math.round(lower[2] + (upper[2] - lower[2]) * mix),
    Math.round(lower[3] + (upper[3] - lower[3]) * mix),
  ]
})

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
  const [liveTemp, setLiveTemp] = useState(target.periwoundTempC)
  const [camera, setCamera] = useState<CameraReading | null>(null)
  const [cameraNote, setCameraNote] = useState("")
  const sessionRef = useRef<{ close: () => Promise<void> } | null>(null)
  const colorCanvas = useRef<HTMLCanvasElement>(null)
  const thermalCanvas = useRef<HTMLCanvasElement>(null)
  const colorTicket = useRef(0)
  const thermalTicket = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      void sessionRef.current?.close()
    }
  }, [])

  function paintFrame(kind: "color" | "thermal", frame: Blob) {
    const canvas = kind === "color" ? colorCanvas.current : thermalCanvas.current
    const tickets = kind === "color" ? colorTicket : thermalTicket
    const ticket = tickets.current + 1
    tickets.current = ticket
    const url = URL.createObjectURL(frame)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (!aliveRef.current || ticket !== tickets.current || !canvas) return
      const ctx = canvas.getContext("2d", { willReadFrequently: kind === "thermal" })
      if (!ctx) return
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
      }
      ctx.drawImage(img, 0, 0)
      if (kind !== "thermal") return
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = pixels.data
      for (let index = 0; index < data.length; index += 4) {
        const color = IRONBOW[data[index]]
        data[index] = color[0]
        data[index + 1] = color[1]
        data[index + 2] = color[2]
      }
      ctx.putImageData(pixels, 0, 0)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  useEffect(() => {
    if (phase !== "capture") return
    const started = performance.now()
    const duration = 2800
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / duration)
      setProgress(t)
      if (t >= 1) {
        setLiveTemp(target.periwoundTempC)
        setPhase("review")
        return
      }
      const sway = 1 - t
      setLiveTemp(target.periwoundTempC + (Math.random() - 0.5) * 0.7 * sway)
    }, 90)
    return () => window.clearInterval(id)
  }, [phase, target.periwoundTempC])

  function beginCapture() {
    setCamera(null)
    setCameraNote("")
    setProgress(0)
    setPhase("capture")
  }

  async function readCamera() {
    setCamera(null)
    setCameraNote("")
    setPhase("listen")
    try {
      await sessionRef.current?.close()
      sessionRef.current = await openCameraStream({
        onFrame: paintFrame,
        onReading: (reading) => {
          if (!aliveRef.current) return
          setCamera(reading)
          setLiveTemp(reading.periwoundTempC)
          setPhase("review")
        },
      })
    } catch (error) {
      if (!aliveRef.current) return
      setPhase("ready")
      if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "AbortError")) return
      setCameraNote(error instanceof Error ? error.message : "The camera did not answer.")
    }
  }

  function cancel() {
    void sessionRef.current?.close()
    sessionRef.current = null
    onCancel()
  }

  function commit() {
    void sessionRef.current?.close()
    sessionRef.current = null
    onCommit({
      ...target,
      ...(camera ?? {}),
      id: `${patient.id}-${CLINIC_DAY}`,
      date: CLINIC_DAY,
      source: "device",
    })
  }

  const shown = camera ?? target
  const rows: Array<[string, string]> = [
    ["Periwound", fmtTemp(shown.periwoundTempC)],
    ["Contralateral", fmtTemp(shown.referenceTempC)],
    ["Fluorescence", shown.fluorescenceIndex.toFixed(0)],
    ["Area", `${shown.areaCm2.toFixed(1)} cm²`],
    ["Granulation", `${shown.tissue.granulation}%`],
    ["Slough", `${shown.tissue.slough}%`],
    ["Necrotic", `${shown.tissue.necrotic}%`],
    ["Epithelial", `${shown.tissue.epithelial}%`],
    ["Exudate", titleCase(shown.exudate)],
    ["Periwound skin", shown.periwound.length ? titleCase(shown.periwound[0]) : "Intact"],
  ]

  return (
    <section className="device-stage">
      <header className="stage-head">
        <div>
          <p className="eyebrow">New reading · {patient.mrn}</p>
          <h1>{patient.name}</h1>
          <p className="lede">{patient.wound.location}. Color, thermal, and fluorescence.</p>
        </div>
        <button className="btn ghost" type="button" onClick={cancel}>
          Cancel
        </button>
      </header>

      <div className="device-layout">
        <ol className="steps">
          <li data-state={phase === "ready" || phase === "capture" || phase === "listen" ? "current" : "done"}>
            <span>1</span>
            <div>
              <strong>Capture</strong>
              <p>Aim the camera at the wound and hold still.</p>
            </div>
          </li>
          <li data-state={phase === "review" ? "current" : "wait"}>
            <span>2</span>
            <div>
              <strong>Confirm</strong>
              <p>Check the frame readings, then send them to the chart.</p>
            </div>
          </li>
        </ol>

        <div className="handheld" data-phase={phase}>
          <div className="hand-top">
            <span>Wound Intelligence</span>
          </div>
          <div className="lcd">
            {phase === "ready" && (
              <div className="lcd-copy">
                <p>Camera seated</p>
                <strong>Ready</strong>
                <span>Color · thermal · fluorescence</span>
              </div>
            )}
            {phase === "capture" && (
              <div className="lcd-metrics">
                <p>Capturing</p>
                <strong className="temp-read">{fmtTemp(liveTemp)}</strong>
                <em>periwound</em>
                <div className="settle" aria-hidden="true">
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            )}
            {(phase === "listen" || phase === "review") && (
              <div className="lcd-pair">
                <figure>
                  <canvas ref={colorCanvas} className="lcd-pane" width={320} height={240} />
                  <figcaption>Color</figcaption>
                </figure>
                <figure>
                  <canvas ref={thermalCanvas} className="lcd-pane" width={320} height={240} />
                  <figcaption>Thermal</figcaption>
                </figure>
              </div>
            )}
            {phase === "review" && <ScreenGrid rows={rows} />}
          </div>
          <p className="hand-caption">Color and thermal</p>
        </div>

        <div className="readout">
          {phase === "ready" && (
            <>
              <h2>Aim the camera at the wound.</h2>
              <p>One capture takes the color frame, the Lepton frame, and the 405 nm frame.</p>
              <div className="readout-actions">
                <button className="btn solid" type="button" onClick={readCamera}>
                  Read camera
                </button>
                <button className="btn ghost" type="button" onClick={beginCapture}>
                  Demonstration
                </button>
              </div>
              {cameraNote ? <p className="live-line">{cameraNote}</p> : null}
            </>
          )}

          {phase === "listen" && (
            <>
              <h2>Live view is on.</h2>
              <p>Aim with the picture. Press the button with the sticker in view, slide the filter in, then press again.</p>
            </>
          )}

          {phase === "capture" && (
            <>
              <h2>Hold still.</h2>
              <p>The thermal frame is settling.</p>
              <p className="live-line">{fmtTemp(liveTemp)} periwound</p>
            </>
          )}

          {phase === "review" && (
            <>
              <h2>Ready to send.</h2>
              <p>{fmtDate(CLINIC_DAY)}. These are the camera readings for this visit.</p>
              <button className="btn solid" type="button" onClick={commit}>
                Add to chart
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
