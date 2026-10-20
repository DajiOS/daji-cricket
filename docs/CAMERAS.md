# Cameras: setup steps and the Imou cloud option

## Recommended: the camera bridge (already built)
The desk's **Live cameras** page works today through `camera-bridge/`, a small program on a PC at the ground that reads pictures from the Dahua recorder and sends them to the server over HTTPS. Nothing at the ground is opened to the internet, there is no monthly quota, and no camera picture passes through a third party.

### Steps (about 30 minutes at the ground)
1. **A PC that stays on** at the ground, on the same router as the recorder (a spare office PC or a Raspberry Pi). Install [Node.js](https://nodejs.org) (18 or newer) and [ffmpeg](https://ffmpeg.org/download.html).
2. **Copy the `camera-bridge` folder** onto it.
3. **Find the recorder's address**: run `node find-recorder.mjs` in that folder. It prints something like `192.168.1.108  ports 80, 554, 37777  Dahua recorder`. (Or read it on the recorder's screen: Main Menu, Network, TCP/IP.)
4. **Fix that address** in the router (a DHCP reservation) so it survives a power cut.
5. **Make a view-only user on the recorder**: open `http://<recorder address>` in a browser, sign in as admin, Setup (or System), Account, Add user, give it only "Live" rights. Do not use the admin login in the bridge.
6. **Check RTSP is on**: same web page, Network, Port: RTSP port 554 (on by default).
7. **Add the cameras in the desk**: Live cameras, Add camera, one per channel. Copy the `id` and `token` it shows (shown once). These are secrets: they go only into `bridge.json` on that PC, never in chat or git.
8. **Fill in `bridge.json`** (copy from `bridge.example.json`): the recorder address, the view-only user, one entry per camera with its channel number. Put the recorder password in the environment variable `BRIDGE_NVR_PASSWORD` instead of the file if you prefer.
9. **Start it**: `node bridge.mjs`. The cameras show **Live** in the desk within a few seconds.
10. **Keep it running after a restart**: Windows Task Scheduler (at start-up, `node bridge.mjs`), or on Linux / Pi `pm2 start bridge.mjs` or a systemd service.
11. Give staff who should watch the right **Can watch live cameras** in Team.

The Go-live check (Settings) turns green for cameras once one is sending pictures.

## The Imou cloud option (evaluated, not built)
Imou is Dahua's consumer cloud brand. A Dahua recorder can be added to the Imou Life app by its serial number, after which the **Imou Open Platform** API can hand out live-stream addresses, with no PC at the ground.

What it would take, based on public descriptions of the API (the Home Assistant Imou integration, client libraries and developer posts; check each point against Imou's own developer documentation before building):
- A developer account on the Imou Open Platform, giving an **App ID and App Secret**. The secret would live only in `deploy/.env` on the server.
- The recorder added to an Imou account (Imou Life app, scan the QR code on the recorder). This sends the cameras through Imou's cloud.
- Server calls: get an access token, then `bindDeviceLive` and `getLiveStreamInfo` per channel, which return **HLS** stream addresses (main or sub stream).
- Desk changes: the Live cameras page plays motion-JPEG today; it would need an HLS player (hls.js) for Imou cameras, and a per-camera "source" setting (bridge or Imou).
- **Limits**: a free monthly quota of API requests per App ID (reported as 30,000) that live viewing also uses; the platform's regions are listed as North America and China, so latency from Surat and where the video is held should be checked; the cameras depend on Imou's cloud being up.

**Recommendation**: keep the bridge. It is built, tested, private and free. Build the Imou option only if a PC cannot be left on at the ground; it is roughly a day's work (server client, HLS player in the desk, tests) once an Imou developer account exists.

### What only you can do
- Leave a PC on at the ground and copy the bridge onto it (or decide on Imou instead).
- Create the view-only user on the recorder.
- For Imou only: register the developer account, add the recorder to Imou Life, and decide whether sending camera video through Imou's cloud is acceptable (mention it to the advocate under the privacy notice, since it involves video of customers).

Sources for the Imou points: [Home Assistant Imou integration](https://www.home-assistant.io/integrations/imou/), [imouapi changelog](https://data.safetycli.com/changelogs/imouapi), [openHAB community thread on the Imou cloud API](https://community.openhab.org/t/imou-cameras-on-openhab-cloud-api-mqtt-bridge-no-official-binding/169656).
