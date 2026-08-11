#include <math.h>

// Sensor calibrations 
const float TEMP_THRESHOLD_RING_C = 27.0;
const float TEMP_THRESHOLD_PALM_C = 27.0;

// Sensor threshold interval 
const unsigned long SENSOR_SETTLE_MS = 400;

// strip light wait interval
const unsigned long SCAN_HOLD_MS = 10000;   // 10 seconds

const bool DEBUG_TEMPS = false;  // true = debug temps for calibration

// Main-strip channel test
// true cycles though RED -> GREEN -> BLUE -> WHITE -> OFF, ~2s each.
// broken channel = color missing from sequence
const bool TEST_CHANNELS = false;

// Pad LED test. 
// Set true to cycle the four pad LEDs one at a time
const bool TEST_PAD_LEDS = false;

const float THERM_B  = 4275.0;
const float THERM_R0 = 100000.0;

// Pad and Cradle pins 
const int PIN_BUTTON = 2;

const int PIN_RING_AMBER = 3;
const int PIN_RING_GREEN = 4;
const int PIN_PALM_AMBER = 6;
const int PIN_PALM_GREEN = 7;

// LED MOSFET pins for the main RGB strip
const int PIN_STRIP_R = 10, PIN_STRIP_G = 9, PIN_STRIP_B = 11;

const int PIN_TEMP_RING = A0;
const int PIN_TEMP_PALM = A1;

//  Pulsating strip state
char stripState = '0';                 // '0' idle, or 'S'/'D'/'R'
unsigned long stripStateSetAt = 0;     // when scan color started
unsigned long lastBreathMillis = 0;
int breathValue = 20;
int breathDirection = 1;

void setStrip(int r, int g, int b) {
  analogWrite(PIN_STRIP_R, r);
  analogWrite(PIN_STRIP_G, g);
  analogWrite(PIN_STRIP_B, b);
}

void updateStrip() {
  // scan color automatically expires after SCAN_HOLD_MS.
  if (stripState != '0' && millis() - stripStateSetAt >= SCAN_HOLD_MS) {
    stripState = '0';
  }

  switch (stripState) {
    // Scan commands send ('S'/'D'/'R') per-tag status to strip
    case 'S': setStrip(0, 255, 0); break;  // sovereign  - green
    case 'D': setStrip(0, 255, 0); break;  // delegated  - green
    case 'R': setStrip(0, 255, 0); break;  // restricted - green
    case '0':
    default: {                                // idle - breathing blue
      unsigned long now = millis();
      if (now - lastBreathMillis > 8) {
        lastBreathMillis = now;
        breathValue += breathDirection * 3;
        if (breathValue >= 255) { breathValue = 255; breathDirection = -1; }
        if (breathValue <= 20)  { breathValue = 20;  breathDirection = 1; }
      }
      setStrip(0, 0, breathValue);
      break;
    }
  }
}

// ---- Pad LEDs HIGH signal lights them, LOW signal turns them off.
bool biometricActive = false;

void padWaiting(int pinAmber, int pinGreen) { // amber on, green off
  digitalWrite(pinAmber, HIGH);
  digitalWrite(pinGreen, LOW);
}

void padConfirmed(int pinAmber, int pinGreen) { // green on, amber off
  digitalWrite(pinAmber, LOW);
  digitalWrite(pinGreen, HIGH);
}

void padOff(int pinAmber, int pinGreen) { // both dark
  digitalWrite(pinAmber, LOW);
  digitalWrite(pinGreen, LOW);
}

// temperature sensing 
float readTempC(int pin) {
  int a = analogRead(pin);
  if (a <= 0) return -273.15; // guard against divide-by-zero
  float R = 1023.0 / (float) a - 1.0;
  R = THERM_R0 * R;
  return 1.0 / (log(R / THERM_R0) / THERM_B + 1.0 / 298.15) - 273.15;
}

bool ringOk = false, palmOk = false;
bool ringRaw = false, palmRaw = false;
unsigned long ringRawSince = 0, palmRawSince = 0;
bool bothReported = false;
unsigned long lastSensorPoll = 0;

// "if pad occupied?" check: SENSOR_SETTLE_MS before change.
bool settleSensor(float tempC, float threshold, bool &raw, unsigned long &since, bool current) {
  bool nowRaw = tempC >= threshold;
  if (nowRaw != raw) {
    raw = nowRaw;
    since = millis();
    return current;
  }
  if (nowRaw != current && millis() - since >= SENSOR_SETTLE_MS) {
    return nowRaw;
  }
  return current;
}

void updateSensors() {
  if (millis() - lastSensorPoll < 50) return; // poll at ~20Hz
  lastSensorPoll = millis();

  int ringRawAdc = analogRead(PIN_TEMP_RING);
  int palmRawAdc = analogRead(PIN_TEMP_PALM);
  float ringC = readTempC(PIN_TEMP_RING);
  float palmC = readTempC(PIN_TEMP_PALM);

  // Throttle the debug print
  static unsigned long lastDebugPrint = 0;
  if (DEBUG_TEMPS && millis() - lastDebugPrint >= 250) {
    lastDebugPrint = millis();
    // Raw ADC is printed alongside the temperature
    //   0        -> pin shorted to GND, or sensor not powered
    //   1023     -> pin shorted to 5V, or SIG disconnected from the board
    //   drifting -> pin floating, 
    //   ~300-700 -> active reading
    Serial.print("TEMP: ring adc="); Serial.print(ringRawAdc);
    Serial.print(" ("); Serial.print(ringC, 1); Serial.print("C ");
    Serial.print(ringC >= TEMP_THRESHOLD_RING_C ? "OVER" : "under");
    Serial.print(")   palm adc="); Serial.print(palmRawAdc);
    Serial.print(" ("); Serial.print(palmC, 1); Serial.print("C ");
    Serial.print(palmC >= TEMP_THRESHOLD_PALM_C ? "OVER" : "under");
    Serial.println(")");
  }

  bool prevRing = ringOk, prevPalm = palmOk;
  ringOk = settleSensor(ringC, TEMP_THRESHOLD_RING_C, ringRaw, ringRawSince, ringOk);
  palmOk = settleSensor(palmC, TEMP_THRESHOLD_PALM_C, palmRaw, palmRawSince, palmOk);

  if (!biometricActive) return;

  if (ringOk != prevRing || palmOk != prevPalm) {
    Serial.print("SENS:");
    Serial.print(ringOk ? 1 : 0);
    Serial.print(",");
    Serial.println(palmOk ? 1 : 0);
  }

  //  pad sensor lights
  if (ringOk) padConfirmed(PIN_RING_AMBER, PIN_RING_GREEN);
  else        padWaiting(PIN_RING_AMBER, PIN_RING_GREEN);

  if (palmOk) padConfirmed(PIN_PALM_AMBER, PIN_PALM_GREEN);
  else        padWaiting(PIN_PALM_AMBER, PIN_PALM_GREEN);

  if (ringOk && palmOk && !bothReported) {
    bothReported = true;
    Serial.println("BOTH:1");
  }
  if (!(ringOk && palmOk)) bothReported = false;
}

// intervention button
bool lastButtonState = HIGH;
unsigned long lastButtonChange = 0;

void updateButton() {
  bool state = digitalRead(PIN_BUTTON);
  if (state != lastButtonState && millis() - lastButtonChange > 40) {
    lastButtonChange = millis();
    if (lastButtonState == HIGH && state == LOW) {
      Serial.println("BTN:1");
    }
    lastButtonState = state;
  }
}

// Serial in 
void handleSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    switch (c) {
      case 'S': case 'D': case 'R':
        stripState = c;
        stripStateSetAt = millis();
        break;
      case '0':
        stripState = '0';
        break;
      case 'B':
        biometricActive = true;
        bothReported = false;
        // Both pads start amber
        padWaiting(PIN_RING_AMBER, PIN_RING_GREEN);
        padWaiting(PIN_PALM_AMBER, PIN_PALM_GREEN);
        break;
      case 'E':
        biometricActive = false;
        padOff(PIN_RING_AMBER, PIN_RING_GREEN);
        padOff(PIN_PALM_AMBER, PIN_PALM_GREEN);
        break;
      default:
        break;   // ignore newlines
    }
  }
}

// test modes 

void runChannelTest() {
  const unsigned long STEP_MS = 2000;
  static int step = -1;
  static unsigned long lastStep = 0;

  if (millis() - lastStep < STEP_MS && step >= 0) return;
  lastStep = millis();
  step = (step + 1) % 5;

  switch (step) {
    case 0: setStrip(255, 0, 0);     Serial.println("TEST: RED");               break;
    case 1: setStrip(0, 255, 0);     Serial.println("TEST: GREEN");             break;
    case 2: setStrip(0, 0, 255);     Serial.println("TEST: BLUE");              break;
    case 3: setStrip(255, 255, 255); Serial.println("TEST: WHITE (all three)"); break;
    case 4: setStrip(0, 0, 0);       Serial.println("TEST: OFF");               break;
  }
}

void runPadLedTest() {
  const unsigned long STEP_MS = 1500;
  static int step = -1;
  static unsigned long lastStep = 0;

  if (millis() - lastStep < STEP_MS && step >= 0) return;
  lastStep = millis();
  step = (step + 1) % 5;

  padOff(PIN_RING_AMBER, PIN_RING_GREEN);
  padOff(PIN_PALM_AMBER, PIN_PALM_GREEN);

  switch (step) {
    case 0: digitalWrite(PIN_RING_AMBER, HIGH); Serial.println("TEST: ring AMBER (D3)"); break;
    case 1: digitalWrite(PIN_RING_GREEN, HIGH); Serial.println("TEST: ring GREEN (D4)"); break;
    case 2: digitalWrite(PIN_PALM_AMBER, HIGH); Serial.println("TEST: palm AMBER (D6)"); break;
    case 3: digitalWrite(PIN_PALM_GREEN, HIGH); Serial.println("TEST: palm GREEN (D7)"); break;
    case 4:                                     Serial.println("TEST: all pad LEDs OFF"); break;
  }
}

// Setup / loop 

void setup() {
  Serial.begin(9600);

  pinMode(PIN_STRIP_R, OUTPUT);
  pinMode(PIN_STRIP_G, OUTPUT);
  pinMode(PIN_STRIP_B, OUTPUT);

  int padPins[] = { PIN_RING_AMBER, PIN_RING_GREEN,
                    PIN_PALM_AMBER, PIN_PALM_GREEN };
  for (int i = 0; i < 4; i++) pinMode(padPins[i], OUTPUT);

  pinMode(PIN_BUTTON, INPUT_PULLUP);

  padOff(PIN_RING_AMBER, PIN_RING_GREEN);
  padOff(PIN_PALM_AMBER, PIN_PALM_GREEN);
  setStrip(0, 0, 255);
}

void loop() {
  if (TEST_CHANNELS) { runChannelTest(); return; }
  if (TEST_PAD_LEDS) { runPadLedTest(); return; }

  handleSerial();
  updateStrip();
  updateSensors();
  updateButton();
}
