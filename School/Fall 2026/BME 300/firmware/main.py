# Wound Intelligence capture for the OpenMV N6.
# Color and area: PAG7936. Temperature: Lepton 3.5 in the module socket.
# Fluorescence: P8 enables the 405 nm driver. Slide the long-pass filter in by hand.
# A 1.0 cm sticker in the same frame sets the scale, so the camera height can change.
#
# STREAM sends the live picture to the clinic page over USB.
# Set STREAM = False while the OpenMV IDE is connected, so the IDE can keep its own preview.
# Leave STREAM = True, save this file as main.py, and disconnect the IDE before Read camera.

import json
import sys
import time

import csi
import image
import micropython
from machine import Pin

STREAM = True
DOT_CM = 1.0
MIN_C = 25.0
MAX_C = 42.0

# Fill these from the IDE threshold editor. Each range is
# (L min, L max, A min, A max, B min, B max).
WOUND = []
MARKER = []
# Optional. Leave None until granulation, slough, necrotic, and epithelial
# each have a range. The four percents are then forced to add up to 100.
TISSUE = None

class UserButton:
    def __init__(self):
        self.pin = Pin("SW", Pin.IN, Pin.PULL_UP)

    def value(self):
        return self.pin.value() == 0


button = UserButton()
leds = Pin("P8", Pin.OUT)
leds.value(0)
def open_usb():
    for module_name in ("pyb", "usb", "machine"):
        try:
            module = __import__(module_name)
        except ImportError:
            continue
        ctor = getattr(module, "USB_VCP", None)
        if ctor is None:
            continue
        port = ctor()
        if hasattr(port, "setinterrupt"):
            port.setinterrupt(-1)
        return port
    micropython.kbd_intr(-1)
    return getattr(sys.stdout, "buffer", sys.stdout)


usb = open_usb()


def write_all(data):
    if hasattr(usb, "isconnected") and not usb.isconnected():
        return
    view = memoryview(data)
    sent = 0
    spins = 0
    while sent < len(view):
        piece = view[sent:]
        if hasattr(usb, "send"):
            count = usb.send(piece, timeout=2000)
        else:
            count = usb.write(piece)
        if not count:
            spins += 1
            if spins > 8:
                return
            time.sleep_ms(2)
            continue
        spins = 0
        sent += count


def jpeg_bytes(img, quality):
    try:
        jpg = img.to_jpeg(quality=quality, copy=True)
    except Exception:
        jpg = img.compress(quality=quality)
    raw = jpg.bytearray()
    size = jpg.size()
    if (
        size >= 4
        and raw[0] == 0xFF
        and raw[1] == 0xD8
        and raw[size - 2] == 0xFF
        and raw[size - 1] == 0xD9
    ):
        return raw[:size]
    start = raw.find(b"\xff\xd8")
    end = raw.find(b"\xff\xd9", 0 if start < 0 else start + 2)
    if start >= 0 and end > start:
        return raw[start : end + 2]
    return None


def send_marked(tag, img, quality):
    if not STREAM:
        return
    if hasattr(usb, "isconnected") and not usb.isconnected():
        return
    try:
        payload = jpeg_bytes(img, quality)
    except Exception:
        return
    if not payload:
        return
    try:
        write_all(tag + payload)
    except Exception:
        return


def send_reading(reading):
    raw = json.dumps(reading)
    if not STREAM:
        print(raw)
        return
    payload = raw.encode()
    write_all(b"JSON %d\n" % len(payload))
    write_all(payload)


color = csi.CSI(stream=False)
color.reset(hard=True)
color.pixformat(csi.RGB565)
try:
    color.framesize(csi.QVGA)
except Exception:
    color.framesize(csi.VGA)
try:
    color.framebuffers(2)
except Exception:
    pass
thermal_img = None
thermal = None
radiometry = False
try:
    thermal = csi.CSI(cid=csi.LEPTON)
    thermal.reset(hard=False)
    thermal.pixformat(csi.GRAYSCALE)
    try:
        thermal.framesize(csi.QQVGA)
    except Exception:
        thermal.framesize(csi.QVGA)
    thermal_img = image.Image(thermal.width(), thermal.height(), thermal.pixformat())
except Exception:
    thermal = None
    thermal_img = None


def grab_thermal():
    global radiometry
    if thermal is None or thermal_img is None:
        return
    try:
        got = thermal.snapshot(blocking=False, image=thermal_img)
    except RuntimeError:
        return
    if got is None or radiometry:
        return
    try:
        thermal.ioctl(csi.IOCTL_LEPTON_SET_MODE, True, False)
        thermal.ioctl(csi.IOCTL_LEPTON_SET_RANGE, (MIN_C, MAX_C))
        radiometry = True
    except Exception:
        radiometry = True


def send_views(color_frame):
    send_marked(b"WIC", color_frame, 28)
    if thermal_img is not None:
        send_marked(b"WIT", thermal_img, 40)


def gray_to_c(mean):
    return (mean * (MAX_C - MIN_C)) / 255.0 + MIN_C


def scale_rect(rect, src, dst):
    x, y, w, h = rect
    return (
        int(x * dst.width() / src.width()),
        int(y * dst.height() / src.height()),
        max(1, int(w * dst.width() / src.width())),
        max(1, int(h * dst.height() / src.height())),
    )


def reference_temp(img, wound_rect):
    boxes = (
        (0, 0, 40, 40),
        (img.width() - 40, 0, 40, 40),
        (0, img.height() - 40, 40, 40),
        (img.width() - 40, img.height() - 40, 40, 40),
    )
    wx, wy, ww, wh = wound_rect
    vals = []
    for x, y, bw, bh in boxes:
        cx = x + bw // 2
        cy = y + bh // 2
        if wx <= cx <= wx + ww and wy <= cy <= wy + wh:
            continue
        vals.append(img.get_statistics(roi=(x, y, bw, bh)).mean())
    if not vals:
        vals.append(img.get_statistics().mean())
    return gray_to_c(sum(vals) / len(vals))


def tissue_fractions(img, roi):
    keys = ("granulation", "slough", "necrotic", "epithelial")
    if not TISSUE:
        return {key: 0 for key in keys}
    counts = {}
    for key in keys:
        blobs = img.find_blobs(TISSUE[key], roi=roi, pixels_threshold=8, area_threshold=8, merge=True)
        counts[key] = sum(blob.pixels() for blob in blobs)
    total = sum(counts.values())
    if total <= 0:
        return {key: 0 for key in keys}
    raw = {key: counts[key] * 100.0 / total for key in keys}
    out = {key: int(raw[key]) for key in keys}
    leftover = 100 - sum(out.values())
    order = sorted(keys, key=lambda key: raw[key] - out[key], reverse=True)
    for i in range(leftover):
        out[order[i % len(order)]] += 1
    return out


def fluorescence_index(img, roi):
    stats = img.get_statistics(roi=roi)
    value = stats.l_mean() if hasattr(stats, "l_mean") else stats.mean()
    return max(0, min(100, int(value)))


def largest(blobs):
    return max(blobs, key=lambda blob: blob.pixels())


armed = True
mode = "aim"
pending = None

while True:
    try:
        display = color.snapshot()
    except RuntimeError:
        time.sleep_ms(20)
        continue
    grab_thermal()

    if not WOUND or not MARKER:
        pass
    elif mode == "filter" and pending is not None:
        if button.value() and armed:
            armed = False
            leds.value(1)
            time.sleep_ms(150)
            display = color.snapshot()
            grab_thermal()
            signal = fluorescence_index(display, pending["rect"])
            leds.value(0)
            send_reading(
                {
                    "periwoundTempC": pending["peri"],
                    "referenceTempC": pending["reference"],
                    "fluorescenceIndex": signal,
                    "areaCm2": pending["area"],
                    "lengthCm": pending["length"],
                    "widthCm": pending["width"],
                    "tissue": pending["tissue"],
                    "exudate": "moderate",
                    "exudateCharacter": "color frame",
                    "periwound": [],
                }
            )
            mode = "aim"
            pending = None
        elif not button.value():
            armed = True
    else:
        wounds = display.find_blobs(WOUND, pixels_threshold=200, area_threshold=200, merge=True)
        marks = display.find_blobs(MARKER, pixels_threshold=40, area_threshold=40, merge=True)
        if wounds:
            display.draw_rectangle(largest(wounds).rect())
        if marks:
            display.draw_rectangle(largest(marks).rect(), color=(0, 255, 0))
        if button.value() and armed and wounds and marks:
            armed = False
            wound = largest(wounds)
            mark = largest(marks)
            cm = DOT_CM / ((mark.w() + mark.h()) / 2)
            peri = 0.0
            reference = 0.0
            if thermal_img is not None:
                roi = scale_rect(wound.rect(), display, thermal_img)
                peri = gray_to_c(thermal_img.get_statistics(roi=roi).mean())
                reference = reference_temp(thermal_img, roi)
            pending = {
                "rect": wound.rect(),
                "peri": round(peri, 1),
                "reference": round(reference, 1),
                "area": round(wound.pixels() * cm * cm, 1),
                "length": round(max(wound.w(), wound.h()) * cm, 1),
                "width": round(min(wound.w(), wound.h()) * cm, 1),
                "tissue": tissue_fractions(display, wound.rect()),
            }
            mode = "filter"
        elif not button.value():
            armed = True

    send_views(display)
