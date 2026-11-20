# BlacRec

Records a play from the front row. After you press Rec, the whole phone screen becomes a cover you chose. The camera keeps recording underneath. Volume controls stop / mark / fake power depending on mode.

The video is saved in the in-app Recordings library (and Photos if auto-save is on).

## Before the play

1. Open BlacRec and allow the camera, microphone, and Photos access.
2. Pick a **cover**: Image, Black, Text, Lock, or Playlist.
3. Optionally turn on **Use phone regularly** if you need to leave the app while it keeps recording.
4. Do one short test at home. Press record, confirm the cover looks right, then stop with **volume down**.

A free Apple ID install expires after 7 days. Install BlacRec the day before the play, or the morning of the play.

## Build the app on Windows

### Path A — GitHub Actions, then Sideloadly (free Apple ID)

1. Push this folder to a GitHub repository.
2. On GitHub, open **Actions**, choose **Build unsigned iPhone app**, and run it.
3. When it finishes, download the artifact `BlacRec-unsigned.ipa`.
4. Install [Sideloadly](https://sideloadly.io/) on this PC.
5. Plug in the iPhone, unlock it, and tap Trust.
6. Drag the IPA into Sideloadly, sign in with your Apple ID, and click Start.
7. On the iPhone, open Settings → General → VPN & Device Management and trust the developer certificate if iOS asks.

### Path B — Expo EAS Build

```bash
npm install -g eas-cli
npx eas-cli login
npx eas-cli build --platform ios --profile preview
```
