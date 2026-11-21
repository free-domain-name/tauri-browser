# Demo video script — 40 seconds

A screen recording with burned-in captions and a recorded voice-over. The whole thing is shot on a headless Linux virtual display, so it is reproducible on a machine with no screen attached.

---

## Shot list

| Time | On screen | Caption (burned in) | Voice-over |
| --- | --- | --- | --- |
| 0:00–0:04 | App window opens on the start page, dark Default skin. Cursor moves to the address bar. | "Free Domain Browser — an open-source desktop browser" | "This is Free Domain Browser, an open-source desktop browser." |
| 0:04–0:08 | Type a name into the address bar. | "Resolves names against a community registry before public DNS" | "It resolves names against a community registry before public DNS." |
| 0:08–0:14 | The page loads and the address bar still shows the name that was typed. | "Registry has a record → the name you typed stays" | "With a record, the name stays and a resolver proxy fetches the content." |
| 0:14–0:18 | Type a name that is not in the registry. An ordinary site loads through normal DNS. | "No record → normal DNS" | "Without a record, it falls back to normal DNS." |
| 0:18–0:23 | The reviews / stumble page: one name with its community reviews, the discussion thread and the vote counts. | "Reviews per domain, votes as GitHub reactions" | "The registry is public on GitHub, with votes as GitHub reactions." |
| 0:23–0:26 | Open the appearance menu and switch to another skin. | "Seven skins, an editor, light and dark themes" | "Seven skins, an editor, light and dark themes." |
| 0:26–0:29 | Open the community chat panel next to a tab; a message arrives. | "Community chat — peer-to-peer over iroh-gossip through a public relay, plus a project chat server" | "The chat is peer-to-peer over iroh-gossip." |
| 0:29–0:36 | Back on the app window; a small overlay card lists the two caveats. | "Not notarized. HTTPS for overridden names is out of scope: plain HTTP" | "The builds are not notarized, so expect a prompt. HTTPS for overridden names is out of scope: plain HTTP." |
| 0:36–0:40 | End card: app name, project page URL, extension link, GPL-3.0-only badge. | "Free Domain Browser — GPL-3.0-only" | "Free Domain Browser, GPL-3.0-only, on macOS, Windows and Linux." |

The voice-over is about 95 words, which is roughly 40 seconds at a calm pace. The timings above are derived from it: read each line once, unhurried, and let the shot run to the end of the line.

---

## Recording setup

**Display.** The app runs on a headless Linux virtual display, so the capture is identical on any machine.

```bash
# 1920x1080 virtual display, 24-bit colour
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

# run the app inside the virtual display
DISPLAY=:99 npm run dev        # or run the built AppImage / Debian package

# capture the root window to PNG frames
DISPLAY=:99 import -window root -silent /tmp/frames/%04d.png
```

**Driving the UI.** Type the names with `xdotool` so the frames are scripted and repeatable, and pause long enough for the caption to land:

```bash
DISPLAY=:99 xdotool type --delay 60 "myproject"
DISPLAY=:99 xdotool key Return
sleep 3
```

**Audio.** Record the voice-over separately as a WAV (any quiet room, any microphone) and mux it in at the end. Keep the voice-over at a neutral level; the app itself is quiet.

**Keep the recording honest.**

- Show the address bar with the typed name visible whenever a registry name is on screen. That is the point of the project.
- Do not show a lock icon for an overridden name. Overridden names are plain HTTP, and the caption says so.
- Keep the caveats card in the edit. It is 7 seconds of a 40-second video, and it belongs there.

---

## Checklist: frames to a 1080p MP4 and a looping GIF

**Frames**

- [ ] Capture at 1920×1080, one PNG per frame, no scaling applied at capture time.
- [ ] Keep the frame count honest: roughly 30 frames per second of final video, so about 1200 frames for 40 seconds.
- [ ] Check the first and last frame by eye. A half-typed name or a dropped final frame is the usual giveaway.

**MP4**

- [ ] Encode with `ffmpeg -framerate 30 -i /tmp/frames/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out.mp4`.
- [ ] `yuv420p` and the even dimensions are required for playback in browsers and on phones.
- [ ] Mux the voice-over: `ffmpeg -i out.mp4 -i voiceover.wav -c:v copy -c:a aac -b:a 128k -shortest final.mp4`.
- [ ] Burn in the captions, or ship them as a sidecar `.srt`. For burned-in text, use the `drawtext` filter with the caption strings from the shot list; keep them in the lower third and clear of the address bar.
- [ ] Verify the output is 1920×1080, 30 fps, under about 10 MB, and plays with sound in a browser.

**Looping GIF**

- [ ] Cut a shorter loop for the GIF — the address-bar shot (0:04–0:14) on its own works best.
- [ ] `ffmpeg -i clip.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 out.gif`.
- [ ] Keep the GIF under about 3 MB. Drop the frame rate to 10 fps or the width to 640 px if it is larger.
- [ ] The GIF loops back to the first frame, so start and end it on the same visual state — the typed name in the address bar works well.

**Before publishing**

- [ ] The captions state that the builds are not notarized and that HTTPS for overridden names is out of scope.
- [ ] The end card shows the project page and the releases link.
- [ ] No download counts, no user counts, no performance claims appear anywhere in the video.
