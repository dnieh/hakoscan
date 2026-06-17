# hakoscan

A local web dashboard for the Nissan Consult I diagnostic port (the grey
14-pin connector on most ~1989–2000 Nissans), using a Consult-to-USB cable.

## Run

```sh
npm install
npm start        # real car: http://localhost:3100
npm run mock     # simulated ECU, no car needed
```

Set `PORT=...` to use a different port. (The default avoids 3000, which
Docker Desktop often occupies.)

## Usage

1. Plug the Consult cable into the car and your computer, turn the ignition on
   (engine running or not).
2. Open the dashboard, pick the serial port (USB adapters usually show up on
   macOS as `/dev/tty.usbserial-*` — FTDI-based cables may need the FTDI VCP
   driver on older macOS, recent versions have a built-in driver).
3. Connect — the app sends the Consult init sequence (`FF FF EF`) and waits
   for the ECU's `0x10` ack, then reads the ECU part number.
4. Live data: pick sensors and Start. Fault codes: Read / Clear.

## I/M readiness (1996+ USDM cars)

Consult I has no public command for SRT/readiness status, so the app reads it
the way smog stations do: OBDII Mode 01 PID 01 via an ELM327 USB adapter on
the 16-pin OBDII connector. Pick "OBDII (ELM327)" as the connection type,
select the adapter's serial port, and use the readiness panel. Consult
features (live data, faults, register scan) need the Consult connection type.

## Notes

- Protocol: 9600 baud 8N1. Commands are acked by the ECU with their bitwise
  inverse; data arrives in `FF <len> <data>` frames. See `src/consult.js`.
- The sensor register map in `src/sensors.js` covers the common addresses
  (RPM, MAF, coolant, O2, speed, battery, TPS, IAT, injector pulse, timing,
  AAC, A/F alpha). Not every ECU supports every register — deselect any that
  read garbage for your car.
- Code 55 means "no malfunction".
