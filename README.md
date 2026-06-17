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
