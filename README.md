# Stage Cover

Records a play from the front row. After you press the red Record button, the whole phone screen becomes a picture you chose (your social @). The camera keeps recording underneath. Volume up or volume down is the only way to stop. Tapping the screen does nothing, so an accidental touch does not drop the recording.

The video is saved to the iPhone Photos app.

## Before the play

1. Open Stage Cover and allow the camera, microphone, and Photos access.
2. Choose the picture people behind you should see.
3. Point the preview at the stage. Use **0.5 wide** if you need the whole stage, **1x** for a tighter view, or **Selfie** for the screen-side camera.
4. Leave **Flash off**. Flash would light up the stage and the people around you.
5. For a full-length play, use **1080p** and **30 fps**. 4K is sharper and fills the phone faster. An iPhone 14 records 4K at 30 fps. 60 fps is available at 1080p and 720p. If a combination is not supported, the phone uses the closest one.
6. Do one short test at home. Press record, confirm the screen is only your picture, then press a volume button. Open Photos and play the clip.
7. At the show, do not lock the phone and do not swipe down from the top corner. Either one can interrupt the recording. The screen stays awake on its own. If a volume button does not stop the recording, swipe up and close Stage Cover. That take may not be saved.

A free Apple ID install expires after 7 days. Install Stage Cover the day before the play, or the morning of the play.

## Build the app on Windows

This PC cannot compile an iPhone app locally. A Mac in the cloud compiles it, then Sideloadly or AltStore on Windows signs it with your Apple ID and installs it on the iPhone 14.

Expo Go cannot run this app. The camera controls and volume-button stop need the installed build.

### Path A — GitHub Actions, then Sideloadly (free Apple ID)

1. Create a GitHub repository and push this folder to it. A public repository gets free Mac build minutes. A private repository spends the paid Mac minutes much faster.
2. On GitHub, open **Actions**, choose **Build unsigned iPhone app**, and run it.
3. When it finishes, download the artifact `StageCover-unsigned.ipa`.
4. Install [Sideloadly](https://sideloadly.io/) on this PC (AltStore works too).
5. Plug in the iPhone, unlock it, and tap Trust.
6. Drag the IPA into Sideloadly, sign in with your normal Apple ID, and click Start.
7. On the iPhone, open Settings → General → VPN & Device Management and trust the developer certificate if iOS asks.

If Apple says the app needs a verification code, it is emailed to that Apple ID. Enter it in Sideloadly.

### Path B — Expo EAS Build

EAS can also compile the IPA. A device build asks for an Apple Developer Program membership (the paid account). A free Apple ID usually stops at that step, which is why Path A is the one that matches Sideloadly.

```bash
npm install -g eas-cli
npx eas-cli login
npx eas-cli build --platform ios --profile sideload
```

Download the IPA from the Expo site and install it with Sideloadly the same way as Path A.
