import type { ExudateAmount, TissueFrac } from "../types"

export type CameraReading = {
  periwoundTempC: number
  referenceTempC: number
  fluorescenceIndex: number
  areaCm2: number
  lengthCm: number
  widthCm: number
  tissue: TissueFrac
  exudate: ExudateAmount
  exudateCharacter: string
  periwound: string[]
}

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  readable: ReadableStream<Uint8Array> | null
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>
  }
}

const EXUDATE: ExudateAmount[] = ["none", "scant", "moderate", "heavy"]

function numberField(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The camera left ${label} out of the reading.`)
  }
  return value
}

export function parseCameraLine(line: string): CameraReading {
  const start = line.indexOf("{")
  const parsed = JSON.parse(start >= 0 ? line.slice(start) : line) as Record<string, unknown>
  const tissue = parsed.tissue as Record<string, unknown> | undefined
  if (!tissue) throw new Error("The camera left the tissue fractions out of the reading.")
  const exudate = parsed.exudate
  return {
    periwoundTempC: numberField(parsed.periwoundTempC, "periwound temperature"),
    referenceTempC: numberField(parsed.referenceTempC, "contralateral temperature"),
    fluorescenceIndex: numberField(parsed.fluorescenceIndex, "fluorescence"),
    areaCm2: numberField(parsed.areaCm2, "area"),
    lengthCm: numberField(parsed.lengthCm, "length"),
    widthCm: numberField(parsed.widthCm, "width"),
    tissue: {
      granulation: numberField(tissue.granulation, "granulation"),
      slough: numberField(tissue.slough, "slough"),
      necrotic: numberField(tissue.necrotic, "necrotic tissue"),
      epithelial: numberField(tissue.epithelial, "epithelial tissue"),
    },
    exudate: EXUDATE.includes(exudate as ExudateAmount) ? (exudate as ExudateAmount) : "moderate",
    exudateCharacter: typeof parsed.exudateCharacter === "string" ? parsed.exudateCharacter : "color frame",
    periwound: Array.isArray(parsed.periwound) ? parsed.periwound.filter((item) => typeof item === "string") : [],
  }
}

function concat(left: Uint8Array, right: Uint8Array) {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left)
  merged.set(right, left.length)
  return merged
}

function findPair(buffer: Uint8Array, first: number, second: number, from = 0) {
  for (let index = from; index < buffer.length - 1; index += 1) {
    if (buffer[index] === first && buffer[index + 1] === second) return index
  }
  return -1
}

function takeJson(prefix: Uint8Array, onReading: (reading: CameraReading) => void) {
  const text = new TextDecoder().decode(prefix)
  const start = text.lastIndexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return
  try {
    onReading(parseCameraLine(text.slice(start, end + 1)))
  } catch {
    // Text between pictures is only a reading when it is the camera's JSON line.
  }
}

const MAX_JPEG = 500_000

function jpegEnd(buffer: Uint8Array, soi: number) {
  let index = soi + 2
  while (index + 1 < buffer.length) {
    if (buffer[index] !== 0xff) return -2
    while (index < buffer.length && buffer[index] === 0xff) index += 1
    if (index >= buffer.length) return -1
    const marker = buffer[index]
    index += 1
    if (marker === 0xd9) return index
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xda) {
      while (index + 1 < buffer.length) {
        if (buffer[index] !== 0xff) {
          index += 1
          continue
        }
        const next = buffer[index + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          index += 2
          continue
        }
        if (next === 0xff) {
          index += 1
          continue
        }
        if (next === 0xd9) return index + 2
        return -2
      }
      return -1
    }
    if (index + 1 >= buffer.length) return -1
    const length = (buffer[index] << 8) | buffer[index + 1]
    if (length < 2) return -2
    if (index + length > buffer.length) return -1
    index += length
  }
  return -1
}

function consume(
  buffer: Uint8Array,
  onFrame: (kind: "color" | "thermal", frame: Blob) => void,
  onReading: (reading: CameraReading) => void,
) {
  let rest = buffer
  while (rest.length > 1) {
    const soi = findPair(rest, 0xff, 0xd8)
    if (soi < 0) {
      if (rest.length > 1) takeJson(rest.subarray(0, rest.length - 1), onReading)
      return new Uint8Array(rest.subarray(rest.length - 1))
    }
    if (soi > 0) takeJson(rest.subarray(0, Math.max(0, soi - 3)), onReading)
    const end = jpegEnd(rest, soi)
    if (end === -1) {
      const keep = Math.max(0, soi - 3)
      if (rest.length - keep > MAX_JPEG) {
        rest = rest.subarray(soi + 2)
        continue
      }
      return new Uint8Array(rest.subarray(keep))
    }
    if (end < 0) {
      rest = rest.subarray(soi + 2)
      continue
    }
    const jpeg = rest.slice(soi, end)
    const thermal = soi >= 3 && rest[soi - 3] === 0x57 && rest[soi - 2] === 0x49 && rest[soi - 1] === 0x54
    if (jpeg.length > 500 && jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9) {
      onFrame(thermal ? "thermal" : "color", new Blob([jpeg], { type: "image/jpeg" }))
    }
    rest = rest.subarray(end)
  }
  return new Uint8Array(rest)
}

export async function openCameraStream(handlers: {
  onFrame: (kind: "color" | "thermal", frame: Blob) => void
  onReading: (reading: CameraReading) => void
}) {
  const serial = (navigator as SerialNavigator).serial
  if (!serial) throw new Error("Open this page in Chrome to reach the camera.")
  const port = await serial.requestPort()
  await port.open({ baudRate: 115200 })
  const reader = port.readable?.getReader()
  if (!reader) {
    await port.close()
    throw new Error("The camera port sent nothing.")
  }
  let stopped = false
  const pump = (async () => {
    let buffer = new Uint8Array()
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done || !value) break
        buffer = consume(concat(buffer, value), handlers.onFrame, handlers.onReading)
      }
    } catch {
      // Closing the port cancels the reader.
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // The lock is already gone when cancel finished the read.
      }
    }
  })()
  return {
    close: async () => {
      stopped = true
      await reader.cancel().catch(() => undefined)
      await pump.catch(() => undefined)
      await port.close().catch(() => undefined)
    },
  }
}
