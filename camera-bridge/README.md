# Daji camera bridge

Shows your Dahua cameras live in the desk (Live cameras). A small program at the ground reads pictures from the camera recorder (NVR/XVR) and sends them to the Daji server over HTTPS. **Do not open or port-forward the recorder to the internet.** The bridge only calls out, so nothing at the ground is exposed.

The recorder keeps doing the recording. Daji shows only the latest picture of each camera and stores nothing.

## What you need at the ground
- A PC or Raspberry Pi that stays on and is on the same network as the recorder (a spare office PC is fine).
- [Node.js](https://nodejs.org) 18 or newer.
- [ffmpeg](https://ffmpeg.org/download.html) (on Windows: unzip it and add its `bin` folder to PATH, or put the full path in `"ffmpeg"` in bridge.json).
- A **view-only** user on the recorder (Dahua web page, Setup, Account). Do not use the admin login.
- The RTSP port (554) must be on in the recorder (it is by default).

## Find the recorder's address
The bridge needs the recorder's address on the ground's network (it looks like `192.168.1.108`). Three ways, easiest first:
1. On the PC at the ground run `node find-recorder.mjs`. It looks for recorders on the local network (it only checks which ports answer; it never signs in) and prints the address to use.
2. On the recorder's own screen: right-click, **Main Menu**, **Network**, **TCP/IP**; the **IP Address** line.
3. In the router's list of connected devices, look for one named like `NVR`, `XVR` or `Dahua`.

Then ask whoever looks after the router (or the camera installer) to give the recorder a **fixed address** (a DHCP reservation, or a static IP on the recorder in that same TCP/IP screen), so it does not change after a power cut.

## Set up
1. In the desk open **Live cameras** and choose **Add camera**. Give it a name. Copy the block it shows (`id` and `token`); it is shown once.
2. Copy `bridge.example.json` to `bridge.json` and fill in the recorder's address (from above), the view-only user and password, and one entry per camera. `channel` is the camera number on the recorder (1, 2, 3…). Add the password in the environment variable `BRIDGE_NVR_PASSWORD` instead if you prefer not to store it in the file.
3. Run `node bridge.mjs`. You should see "starting" lines and no errors, and the camera shows Live in the desk within a few seconds.
4. To keep it running after a restart: on Windows use Task Scheduler (run at start-up, `node bridge.mjs`); on Linux/Pi use a systemd service or `pm2 start bridge.mjs`.

## How it behaves
- About 4 pictures a second, 960 px wide, from the recorder's small "sub stream" (about 100 KB a second per camera). With nobody watching, it sends one picture every 10 seconds so the camera still shows as online.
- If the internet drops, it keeps retrying. If a camera stops, it restarts that camera.
- To stop one camera, switch it off in the desk. To cut off a bridge, choose **New secret** (the old secret stops working at once).

## Trouble
- `server answered 401`: the camera id or token in bridge.json is wrong or was replaced.
- `cannot run ffmpeg`: ffmpeg is not installed or not on PATH.
- ffmpeg errors mentioning 401/Unauthorized: wrong recorder user or password.
- No picture but no errors: the channel number is wrong, or RTSP is off on the recorder.
- Non-Dahua cameras: change the address pattern in `rtspUrl` in lib.mjs.

## No PC at the ground?
See `docs/CAMERAS.md` for the Imou cloud option and why the bridge is still the recommended way.
