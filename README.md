# hakoscan

A local web dashboard for the Nissan Consult I diagnostic port (the grey
14-pin connector on most ~1989–2000 Nissans), using a Consult-to-USB cable.

## Run

```sh
npm install
npm start        # real car: http://localhost:3100
npm run mock     # simulated ECU, no car needed
```

Set `PORT=...` to use a different port.

## Supported cars & ECUs

The app reads the ECU part number on connect and looks it up in
`src/ecu-db.js`. Nissan part numbers are `23710-` plus a 5-char suffix; the
table matches exact suffixes first, then the 3-char family prefix. The list is
community-sourced and intentionally small — add your own as you identify them.

| ECU part number | Engine | Car |
| --- | --- | --- |
| 23710-04U00 / 04U01 (family 04U) | RB20DET | R32 Skyline (MT) |
| 23710-05U… (family) | RB26DETT | R32 GT-R (BNR32) |
| 23710-21U60 / 21U01 (family 21U) | RB25DET | R33 Skyline |
| 23710-24U00 / 24U01 (family 24U) | RB26DETT | R33 GT-R (BCNR33) |
| 23710-0A903 (family 0A9) | RB26DETT | Stagea 260RS Autech (WGNC34) |
| 23710-53F… / 54F… (family) | KA24DE | S13 240SX (1991–94) |
| 23710-70F… (family) | KA24DE | S14 240SX (1995) |
| 23710-72F… (family) | KA24DE | S14 240SX (1996) |
| 23710-81F… (family) | KA24DE | S14 240SX (1997–98) |

A family (prefix) match is reported as such; an unknown ECU still works for
live data and fault codes — it's just not named.

## Usage

1. Plug the Consult cable into the car and your computer, turn the ignition on
   (engine running or not).
2. Open the dashboard, pick the serial port (USB adapters usually show up on
   macOS as `/dev/tty.usbserial-*` — FTDI-based cables may need the FTDI VCP
   driver on older macOS, recent versions have a built-in driver).
3. Connect — the app sends the Consult init sequence (`FF FF EF`) and waits
   for the ECU's `0x10` ack, then reads the ECU part number.
4. Live data: pick sensors and Start. Fault codes: Read / Clear.
5. Register scan: sweep the ECU's data registers to discover which addresses
   respond on your car — useful for finding sensors not in the default map.

## Notes

- Protocol: 9600 baud 8N1. Commands are acked by the ECU with their bitwise
  inverse; data arrives in `FF <len> <data>` frames. See `src/consult.js`.
- The sensor register map in `src/sensors.js` covers the common addresses
  (RPM, MAF, coolant, O2, speed, battery, TPS, IAT, injector pulse, timing,
  AAC, A/F alpha). Not every ECU supports every register — deselect any that
  read garbage for your car.
- Code 55 means "no malfunction".
