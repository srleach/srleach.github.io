---
title: "Decoding a hot tub: the Jacuzzi \"encrypted\" RS485 protocol"
description: "The encryption on a Jacuzzi J235's control bus is one random byte and a fixed key stream. How I worked that out, with a decoder that runs in your browser."
pubDatetime: 2026-11-09T12:00:00Z
featured: true
tags:
  - home-automation
  - rs485
  - reverse-engineering
---

I have a Jacuzzi J235 in the garden and a project called
[spa2mqtt](https://github.com/srleach/spa2mqtt) that connects its control bus to Home
Assistant. Last week I rebuilt it from the ground up and released it as v2.0.0. Along the
way I worked out that the "encryption" these boards are known for is one random byte per
frame plus a fixed key stream.

This post covers how the bus works, how the cipher fell apart, and what changed in the
rebuild. There is a decoder further down that runs in your browser.

## Why now

The first version dates from May 2025. It was a Sundance decoder I'd forked, wrapped in a
Docker container, reading the tub through an EW11A RS485-to-WiFi adapter and publishing to
MQTT. Temperature and setpoint were reliable. The pump sensors were copied from someone
else's tub and I never saw them change. A few buttons worked some of the time. Then it sat
largely untouched until this autumn.

Three things brought me back this autumn:

- **Running cost.** As the air gets colder the tub loses heat faster and the heater runs
  more. To do anything about that I need to control the setpoint reliably and trust the
  heater and pump state. Watching a temperature graph isn't enough.
- **The EW11A phones home.** It regularly tries to contact an external service, and I
  couldn't find a setting to stop it. I don't want that on the tub's control bus.
- **Better hardware.** I had an ESP32 board with RS485 on board, which can run ESPHome and
  talk to Home Assistant directly.

## The bus

The board, the topside panel and any add-on modules share a two-wire, half-duplex RS485 bus
at 115200 baud. It is a variant of the Balboa protocol, and every frame has the same shape:

```
 0     1     2      3     4      5 .. N-3     N-2   N-1
 7E | LEN | ADDR | MID | TYPE | payload ... | CRC | 7E
```

`LEN` counts from itself through the CRC. There is no byte stuffing, so a `7E` can appear
inside a payload, and a receiver has to frame by length and not by scanning for the flag.
The CRC is a textbook CRC-8: polynomial `0x07`, initial value `0x02`, final XOR `0x02`.

On my tub the traffic looks like this:

| Type | Direction | Meaning | Rate |
|---|---|---|---|
| `C4` | board to all | Status: clock, temperatures, pumps, heater | about 3.3 per second |
| `CA` | board to all | Lights status | 1 per second |
| `06` | board to one channel | Clear to send | about 45 per second |
| `CC` | panel to board | Button press, sent in reply to every clear-to-send | about 45 per second |
| `00` | board to all | "Any new clients?" poll | 1 per second |

The board polls each client channel with a clear-to-send, and a client may only transmit in
the gap straight after its own. The panel answers every poll with a `CC` frame, carrying
button code `0x00` when nobody is pressing anything.

## The "encryption"

Capture a few status frames from an idle tub and they look nothing alike. That is why these
boards are called encrypted, and why the existing open-source decoders treat them as a
separate family from plain Balboa boards.

Two decoding methods had been published:

- **The pairwise fold**, from HyperActiveJ's Sundance 780 work. XOR each pair of payload
  bytes together and you get 16 stable bytes. Some fields then need a further constant:
  the hour is "XOR 6" and the temperature is "XOR 2".
- **A key stream**, from David Holland-Moritz's
  [pyjacuzzi](https://github.com/dhmsjs/pyjacuzzi). Derive a key from the first payload
  byte, then XOR each byte with that key and a counter that runs down modulo 64. The
  minute needs an extra `^ 0x08` "for some unknown reason".

They look like different algorithms. They are the same cipher.

The first payload byte is a random key, `K`, chosen fresh for each frame. Every other
payload byte is XORed with it. In my oldest capture, 54 frames use 49 different keys, yet
`payload XOR K` is identical for every frame taken in the same tub state. Nothing else
about the frame changes.

That explains the fold: XOR two adjacent bytes and `K` cancels out, whatever it was. It
also explains the constants. Each folded value is two adjacent plaintext bytes XORed
together, so "temperature XOR 2" is the temperature byte next to a neighbour that happens
to hold `0x02`, and "hour XOR 6" is a key stream constant.

### What the fold loses

The fold turns 32 bytes into 16, which is fine while only one byte of each pair carries
data. On this board that isn't always true. The day of month and the month sit in adjacent
bytes, and the fold merges them into `(day << 3) XOR month`. From January to July the month
fits in the low three bits and the two can be separated. From August the month needs a
fourth bit, which lands on top of the day's lowest bit. On 4 November the fold reads the
day as 5.

So I moved to decoding each byte separately. Remove the key, then remove a fixed key stream:

```
plain[i] = payload[i] ^ payload[0] ^ S[i]
S[i]     = 0x19 ^ ((31 - i + adjust[i]) mod 64)
adjust   = -8 at bytes 5, 14, 15 and 22, otherwise 0
```

This is pyjacuzzi's key stream with four bytes corrected. I found the corrections by
calibrating against values I could check independently: the wall clock, the date, and what
the topside display was showing. I don't know why those four bytes differ. With the
corrections in place, every field is a plain read of a byte or a few of its bits, with no
per-field constants.

| Byte | Field |
|---|---|
| 1 | Hour |
| 2 | Bit 6: pump 1 running |
| 3 | Bit 2: pump 2 |
| 5 | Bits 0–2: day of week. Bits 3–4: pump 1 speed. Bit 5: set mode |
| 10 | Water temperature |
| 14 | Bits 3–7: day of month |
| 15 | Bits 0–3: month |
| 16 | Setpoint |
| 19 | Year − 2000 |
| 21 | Bit 6: heater |
| 22 | Minute |

Button frames are simpler still. The payload is `[K, K ^ 0xE0 ^ code]`, so the button code
is the two bytes XORed together with `0xE0`.

## Try it

Paste hex from the bus, or pick a sample. Everything runs in your browser. The frames are
real: the J235 ones are from my tub, and the other two were published by the Sundance and
pyjacuzzi projects.

<link rel="stylesheet" href="/assets/css/spa-decoder.css" />
<div id="spa-decoder" class="decoder not-prose">
  <p>The decoder needs JavaScript. The source is at <a href="/assets/js/spa-decoder.js">/assets/js/spa-decoder.js</a>.</p>
</div>
<script src="/assets/js/spa-decoder.js" defer></script>

The decoding logic is about 150 lines of JavaScript with no dependencies, ported from the
Python in spa2mqtt. You can read it at [/assets/js/spa-decoder.js](/assets/js/spa-decoder.js).

The Sundance 780 and pyjacuzzi samples matter. I calibrated the key stream only on my own
J235, and it decodes both of those frames to valid dates with the right weekday. The
pyjacuzzi frame was labelled by its author with the date, time and both temperatures, and
every value matches. The fold gets the year wrong on both. So the cipher and the key stream
are shared across at least three boards in the family.

## Nine minutes of labelled capture

The other half of the work was finding out what the bits mean. For eighteen months my pump
sensors had been guesses inherited from a different tub.

I wrote a capture tool that only receives, with no code path that can write to the bus. Then
I stood at the tub with a list of actions and typed a label into the terminal after each
one: "p1 press 2", "display 38.5C", "lights blue". Nine minutes gave me 51,242 frames, no
CRC errors and 37 labels.

That one capture settled most of the open questions:

- **Pump 1 has two speeds.** Two bits give off, low or high, and a separate bit says it is
  running at all. The J235 has no circulation pump and circulates on pump 1 low. My old
  "main pump" sensor was really "pump 1 on high".
- **The first temperature press does nothing to the setpoint.** It only puts the panel into
  set mode. Further presses within about five seconds each move the setpoint by 0.5 °C.
  Version 1 worked out how many presses it needed and sent exactly that many, so it was
  always one short.
- **Heating has a sequence.** Pump 1 starts on low, a second bit follows about 40 seconds
  later (I think it is heat demand), and the heater bit comes on about 17 seconds after
  that.
- **The panel is the only client.** It answers every poll, so there is no idle channel to
  borrow, which is how the Sundance decoder sent its commands.

## The rebuild

With the protocol on firmer ground, I rewrote the bridge.

**Tub definitions are data.** A tub is a YAML file checked against a JSON Schema: the
message types, the key stream, a field map and the Home Assistant entities. Every field
records its evidence and a status of confirmed, inferred or hypothesis. Supporting another
Balboa-family tub should mean writing a YAML file and no code.

**The layers are separate.** Transport, protocol, tub logic and Home Assistant each stand
alone. The bus state machine does no I/O, so a mock board can drive it in tests, and the
captures replay through the whole stack.

**Transmit is off by default.** The bridge never writes to the bus unless you turn
transmit on, and never at start-up. All writes go through one function, and a test fails
if anything else writes to the transport. Version 1 claimed a bus channel as soon as it
started, whether or not you had asked it to do anything.

**Setpoint control is closed-loop.** There is no "set temperature" command on these boards,
only button presses. The controller sends one press, waits for the next status frames to
confirm it, and retries a bounded number of times. It reads the set-mode bit, so it knows
when a press was only the wake-up.

**There is a native ESPHome component.** It reads the same YAML definitions at compile
time. Its C++ core has no framework dependencies and is tested off the device against the
same captures as the Python. With an ESP32 on the bus there is no EW11A, no MQTT broker
and no container in between.

## What's still unknown

A few fields remain unexplained: two maintenance counters, a manual circulation bit I have
never seen set, and a display code whose values I can't yet map. The
[protocol reference](https://seanrleach.co.uk/spa2mqtt/protocol/) lists every claim with
its evidence and status, including the ones I'm unsure of.

If you have a Balboa-family tub, encrypted or not, the capture tool and a labelled session
are the quickest way to get it supported. One warning: wiring anything into a spa's control
bus is at your own risk.

## Credit

This builds on other people's work:
[garbled1/pybalboa](https://github.com/garbled1/pybalboa) for the Balboa framing and CRC,
HyperActiveJ's Sundance 780 decoder (now
[pete-jorgensen/SundanceHotTub2MQTT](https://github.com/pete-jorgensen/SundanceHotTub2MQTT))
for the fold, the button codes and the lights map,
[dhmsjs/pyjacuzzi](https://github.com/dhmsjs/pyjacuzzi) for the key stream, and
[Iraithium/sundance-rs485-controller](https://github.com/Iraithium/sundance-rs485-controller)
for showing it could be done on an ESP32.

The code is at [github.com/srleach/spa2mqtt](https://github.com/srleach/spa2mqtt), and the
documentation is at [seanrleach.co.uk/spa2mqtt](https://seanrleach.co.uk/spa2mqtt/).
