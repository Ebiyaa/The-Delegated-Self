# Delegated Self Build Guide

An installation where a visitor scans a printed Soul Document, confirms presence with two body-heat pads, chooses how much authority to delegate to a "Custodian," watches that choice play out, and gets 10 seconds to intervene before the consequence lands.

## The interaction, end to end

1. **Idle** — main LED strip breathes blue, screen reads "Scan your Soul ID".
2. **Tag scanned** — the strip turns solid **green** for **exactly 10 seconds**, then returns to breathing blue on its own. All three tags light green; the per-tag distinction is still tracked internally (it decides near-miss vs consequence later) and per-tag colors can be restored by editing three lines in `updateStrip()`. **No video plays at this stage** — the screen goes straight to the biometric prompt.
3. **Biometric check** — the ring cradle and palm pad go live immediately on scan, both pads lighting **amber**. Each pad's amber swaps to **green** once its own temperature sensor is satisfied. When both pads are green, the flow advances.
4. **Persona choice** — three large cards: *Cautious*, *Balanced*, *Autonomous*, under the heading "How would you like to delegate to your Custodian?"
5. **Scenario video** — the chosen persona's video plays fullscreen.
6. **Intervention countdown** — "Your custodian is about to _[action]_ in 10 seconds. Press the button to intervene," with a large red countdown.
7. **Outcome** —
   - **Button pressed** → *near-miss* video if the visitor scanned tag 1 or 2 (sovereign/delegated); *consequence* video if they scanned tag 3 (restricted).
   - **Countdown expires** → *consequence* video, regardless of tag.
8. Back to idle.

Press **Esc** at any point to abort and reset to idle. The **Reset** button in the header does the same.

## Parts

- ACR122U-A9 NFC reader + your 3 existing tags
- Arduino Uno
- Main analog RGB LED strip + 3× IRLB8748 MOSFETs + 3× 220Ω resistors (as already built)
- 2× Grove Temperature Sensor v1.3
- 4× single-colour 5mm LEDs — 2 amber and 2 green (one pair per pad)
- 4× 220Ω resistors (one per pad LED; 220Ω–1kΩ also fine)
- Pinball controller button
- External 5V supply for the main strip

## Pin map

| Arduino | Connects to |
|---|---|
| D2 | Pinball button (other leg → GND, uses `INPUT_PULLUP`) |
| D3 | Ring cradle — **amber** LED |
| D4 | Ring cradle — **green** LED |
| D6 | Palm pad — **amber** LED |
| D7 | Palm pad — **green** LED |
| D9 / D10 / D11 | Main strip R / G / B → MOSFET gates via 220Ω |
| A0 | Grove temp sensor — ring cradle (SIG) |
| A1 | Grove temp sensor — palm pad (SIG) |

D5, D8, D12 and D13 are unused and free for future additions.

Both Grove sensors also need VCC → 5V and GND → GND. Everything shares one common ground: Arduino GND, the strip supply's negative, and all sensor/LED grounds.

### Pad LED wiring

Four ordinary single-colour LEDs — no common pin, no anode/cathode flag, no colour-order guesswork. Each one wires identically:

```
LED long leg (+)  →  220Ω resistor  →  its Arduino pin
LED short leg (−) →  GND
```

Four LEDs, four resistors, four pins. Exactly one LED per pad is lit at a time: amber while waiting, green once confirmed.

If an LED doesn't light, its legs are the wrong way round — LEDs only conduct in one direction, so turn it around. Any resistor from 220Ω to 1kΩ works; lower is brighter.

**To test the LEDs before wiring the sensors**, set `TEST_PAD_LEDS = true` in the sketch and upload. It lights each of the four in turn, ~1.5s each, naming them over serial so you can confirm every LED and pin. Set it back to `false` when done.

## Setup

### 1. Install dependencies

```
cd continuum-scan/server
npm install
```

### 2. Flash the Arduino

Open `arduino/continuum_scan/continuum_scan.ino` in the Arduino IDE, select **Arduino Uno** and the right port, and upload. **Close the IDE afterwards** — it holds the serial port and will block `server.js`.

No libraries are required; the sketch uses only built-in functions.

### 3. Calibrate the temperature threshold

Body heat vs. room temperature differs by space, so calibrate on site:

1. In the sketch, set `const bool DEBUG_TEMPS = true;` and upload.
2. Run `npm start` and watch the terminal for `[calibration] TEMP:<ring>,<palm>` lines.
3. Note the readings with nothing touching the pads, then with a finger/palm resting on them.
4. Set `TEMP_THRESHOLD_C` to a value between the two (default is `27.0`).
5. Set `DEBUG_TEMPS = false` and re-upload.

`SENSOR_SETTLE_MS` (default 400ms) controls how long a reading must hold before it's accepted — raise it if the pads flicker between amber and green.

### 4. Add your videos

Drop these into `public/videos/`:

| File | Plays when |
|---|---|
| `sovereign.mp4` | Tag 1 — *currently unused; scans skip straight to the biometric prompt* |
| `delegated.mp4` | Tag 2 — *currently unused* |
| `restricted.mp4` | Tag 3 — *currently unused* |
| `scenario_cautious.mp4` | Cautious Persona card clicked |
| `scenario_balanced.mp4` | Balanced Persona card clicked |
| `scenario_autonomous.mp4` | Autonomous Persona card clicked |
| `near_miss.mp4` | Button pressed, tag 1 or 2 |
| `consequence.mp4` | Button pressed with tag 3, **or** countdown expired |

The three tag videos were copied over from `soul-scanner`. The other five still need to be added — filenames are configurable in `server/config/personas.json`.

### 5. Customise the persona text

`server/config/personas.json` holds each card's label, description, video path, and the `action` string that fills in "Your custodian is about to **_____** in 10 seconds." Edit these to match your footage.

### 6. Run it

```
npm start
```

Then open `public/index.html` in Chrome. For a kiosk display:

```
chrome --app="file:///path/to/continuum-scan/public/index.html" --kiosk
```

## How the pieces talk

**Server → Arduino** (single characters): `0` idle, `S` sovereign, `D` delegated, `R` restricted, `B` begin biometric sensing, `E` end it.

**Arduino → Server** (text lines): `SENS:<ring>,<palm>` when either pad changes, `BOTH:1` when both are satisfied, `BTN:1` on button press.

The 10-second scan-color timer lives **on the Arduino**, so it's unaffected by video length or anything happening in the browser.

## Troubleshooting

**Pads never turn green** — the threshold is probably too high for your room. Follow the calibration steps above; ambient temperature in a cold gallery can leave skin contact reading lower than you'd expect.

**A pad LED never lights** — its legs are reversed. LEDs conduct one way only; turn it around. Confirm with `TEST_PAD_LEDS = true`, which lights each LED in turn regardless of the sensors.

**Amber and green are swapped on a pad** — the two LEDs are on each other's pins. Swap the wires, or swap the pin numbers in the sketch.

**Both pads go green without anyone touching them** — threshold too low; the sensors are reading ambient as contact.

**Button does nothing** — it only registers during the 10-second countdown, by design. Check the terminal for `BTN:1` when you press it; if that appears but nothing happens on screen, the countdown wasn't running.

**"Resource busy" when uploading** — `server.js` or the Arduino IDE's Serial Monitor still has the port. Stop `npm start` (Ctrl+C) and close Serial Monitor, then upload.

**Video won't autoplay** — click once anywhere on the page after loading; browsers require one user gesture before allowing programmatic playback.

**Arduino not found** — `server.js` auto-detects it by USB vendor ID and retries every 5 seconds, so it usually recovers on its own. Check the terminal for what it actually sees.
