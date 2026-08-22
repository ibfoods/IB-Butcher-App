# Setting Up Receipt Printing at a New Location

Follow this checklist for **every** location's Epson TM-T88VII (or same-family
TM printer). It's the same steps every time — nothing here is
Woodbury-specific except the example IP addresses.

Two one-time things are being set up: the printer, and each iPad/device that
will print from it. Do the printer once. Do the device step once **per
iPad**, not once per location — if a location has 3 iPads, do step 3 three
times.

---

## Part 1 — Get the printer on WiFi (skip if already done)

1. Make sure the OT-WL06 WiFi dongle is firmly seated in one of the
   printer's USB-A ports (not the USB-B port — that's for USB/wired setup
   only).
2. From a Windows PC on the same network, install **EpsonNet Config**
   (search "EpsonNet Config download" — free from Epson).
3. Connect the printer to that PC via USB temporarily, open EpsonNet Config,
   select the printer.
4. Under **Network → Basic Settings → Wi-Fi**: enter the store's WiFi name
   and password. Leave IP Address on **Automatic** (DHCP) — do **not** set a
   manual/static IP here. (A manual IP caused a full day of broken printing
   at Woodbury — DHCP is simpler and just works.)
5. Click **Set**, unplug the USB cable, power-cycle the printer.
6. Confirm it's on the network: hold the Feed button while powering on to
   print a status sheet, or check that the printer's WiFi light goes solid.
   Note the IP address it gets assigned.

## Part 2 — Enable ePOS-Print on the printer

1. On any device on the same WiFi network, open a browser and go to
   `http://<printer's IP>` (from step 6 above).
2. Click **Administrator Login** — password is the printer's serial number
   (find it on the sticker on the bottom of the printer, or via Product
   Status on the same web page).
3. Go to **TM-Intelligent → Services → ePOS-Print**.
4. Set it to **Enable**. If it won't let you (grayed out), that means
   **ePOS-Device** is currently enabled instead — go to
   **Services → ePOS-Device** first, set it to **Disable**, then come back
   and enable ePOS-Print.
5. Click **Apply & Restart**. The printer will reboot.

## Part 3 — Trust the printer's certificate on each iPad

This is the step that has to be repeated per device, not per location.

1. On the iPad, open Safari and go to `https://<printer's IP>` (note:
   **https**, not http).
2. You'll get a certificate warning — this is expected, the printer uses a
   self-signed certificate. **Note:** iOS Safari does not reliably offer a
   simple "proceed anyway" click-through the way desktop browsers do. If you
   don't see a way past the warning, use the Configuration Profile method
   instead:
   - On a Mac: open the printer's `https://<ip>` page in Safari, click the
     padlock/certificate icon in the address bar, export the certificate as
     a `.cer` file.
   - Open **Apple Configurator 2** (free, Mac App Store) → create a new
     profile → add a **Certificate** payload → drop in the exported `.cer`
     file → save as a `.mobileconfig` file.
   - AirDrop or email that `.mobileconfig` file to the iPad.
3. On the iPad: **Settings → General → VPN & Device Management** → tap the
   downloaded profile → **Install**.
4. Then: **Settings → General → About → Certificate Trust Settings** →
   toggle **Full Trust** on for the printer's certificate.
5. Confirm it worked: back in Safari, visit `https://<printer's ip>` again —
   it should load cleanly with no warning now.

## Part 4 — Point the app at this printer

1. In the Butcher App: **Admin → Printers**.
2. Enter the printer's IP address for this location.
3. Save.
4. Test: open any order, tap **Print Receipt**. It should print directly,
   no popup, no browser print dialog.

---

## If something doesn't work

- **Print button times out / falls back to browser print:** almost always
  means Part 3 (certificate trust) wasn't completed on that specific
  device, or the printer's IP changed (DHCP leases can occasionally
  reassign — check Part 1 step 6 again).
- **Can't enable ePOS-Print, stays grayed out:** ePOS-Device wasn't
  disabled first — see Part 2, step 4.
- **Printer not reachable at all:** confirm the device printing and the
  printer are on the exact same WiFi network (not a guest network or a
  different VLAN with the same-looking name).

See `PRINTER_ARCHITECTURE.md` in this repo for the full diagnostic history
and the alternate (relay-based) approach, kept as a fallback option if a
location's network setup makes the certificate-trust method impractical
(e.g., a large number of shared/rotating devices where per-device setup
isn't realistic).
