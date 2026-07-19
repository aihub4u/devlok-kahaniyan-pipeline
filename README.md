# Devlok Kahaniyan - Automated Video Pipeline

Turns a script into a finished, narrated, AI-animated episode automatically:

```
Script (you write, or draft with ChatGPT/Claude)
  -> Sarvam TTS (narration per scene)
  -> Replicate: locked Krishna reference image (generated once per episode)
  -> Replicate: image-to-video per scene (reuses the SAME reference image -> consistent Krishna)
  -> FFmpeg: mux narration onto each scene, then stitch all scenes into the final MP4
```

No queue, no Redis - just a script that runs start to finish. Good fit for a solo creator
generating a handful of episodes at a time rather than serving concurrent traffic.

## 1. Prerequisites

- Node.js 18+
- A [Sarvam AI](https://www.sarvam.ai/) API key
- A [Replicate](https://replicate.com/account/api-tokens) API token
- ffmpeg installed on your machine (fluent-ffmpeg is a wrapper, it needs the real binary)

## 2. Install

```bash
npm install
cp .env.example .env
# then fill in ADMIN_USERNAME, ADMIN_PASSWORD, SARVAM_API_KEY, and REPLICATE_API_TOKEN in .env
```

### Login

The whole app (UI + API) is behind server-side HTTP Basic Auth. Set `ADMIN_USERNAME` and
`ADMIN_PASSWORD` in your environment - the app will refuse to start serving requests without
them (fails closed, not open). When you visit the site, your browser will show a native login
prompt.

### Cost Dashboard

There's a "Cost Dashboard" tab in the UI showing estimated cost per episode (Sarvam + Replicate)
and a running total. These are **estimates**, not real billing - Replicate/Sarvam don't return
live pricing in their API responses, so the app estimates using:
- Replicate: actual compute time returned by the API × the rate you set in `REPLICATE_IMAGE_COST_PER_SEC`
  / `REPLICATE_VIDEO_COST_PER_SEC`
- Sarvam: character count sent × the rate you set in `SARVAM_COST_PER_1000_CHARS`

Check your actual current rates on Replicate's model pages and Sarvam's pricing page, and set
those env vars accordingly. Leave a rate at `0` and that cost line just shows as unconfigured
instead of a misleading number.

Install ffmpeg if you don't already have it:

```bash
# Ubuntu / Render build step
apt-get update && apt-get install -y ffmpeg

# Mac
brew install ffmpeg
```

## 3. Run it - three ways

### Option A: Web UI (recommended - do everything from the browser)

```bash
npm start
```

Then open **http://localhost:3000** in your browser. You'll see a form to:
- Enter the episode ID, title, and Krishna reference image prompt
- Add/remove scenes, each with narration + a motion prompt
- Click **"Load sample episode"** to auto-fill the Makhan Chor example
- Click **"Generate episode"** and watch a live progress bar
- Preview and download the finished video right in the page once it's done

This is the easiest way to use the pipeline day-to-day - no terminal commands needed once
the server is running.

### Option B: CLI (good for quick one-off tests or scripting)

```bash
node src/generate.js src/data/sample-episode.json
```

Runs the whole pipeline in your terminal, printing progress as it goes, and tells you where
the finished MP4 landed when it's done.

### Option C: API directly (if you're integrating this into something else)

```bash
npm start
```

```bash
curl -X POST http://localhost:3000/episodes \
  -H "Content-Type: application/json" \
  -d @src/data/sample-episode.json
```

Returns a `jobId` immediately while generation runs in the background. Check progress:

```bash
curl http://localhost:3000/episodes/<jobId>
```

Note: job status is stored in memory, so it resets if the server restarts, and only tracks
jobs submitted since the last restart. That's fine for one person generating episodes in
batches; if you ever need job history to survive restarts or run multiple server instances,
that's when a real queue (Redis + BullMQ) earns its place - not before.

## 4. What each scene needs

Every scene in the JSON payload needs two things:

- `narration` - the exact line(s) Sarvam will speak for this scene
- `motionPrompt` - describes the ACTION for this scene only (Krishna's look stays locked from
  the reference image; this prompt only controls what he's doing/moving)

Keep `motionPrompt`s simple and physical ("reaches for the pot", "smiles and waves") - video
models follow concrete actions much better than abstract ones.

## 5. Cost control knobs

- `REPLICATE_VIDEO_MODEL` in `.env` - swap between `wan-video/wan-2.5-i2v-fast` (cheap, good
  for daily Shorts) and a stronger model for festival/season-opener episodes. Check current
  per-second pricing on each model's Replicate page before switching, since rates vary by
  model and change over time.
- Every episode makes 1 image call (once, not per scene) + 1 video call per scene + 1 Sarvam
  call per scene. Fewer, longer scenes = fewer paid API calls per episode.
- Generate one episode first and check your actual Replicate usage dashboard before scripting
  out a whole month's worth of episodes.

## 6. Known gaps to fill in next

- **Captions**: not wired up yet. Add a Whisper transcription step (via Replicate's whisper
  model, or self-hosted) on the final output before upload - most Shorts are watched muted,
  so this matters more than almost anything else here.
- **Auto-upload**: no YouTube/Instagram upload step yet. Recommend a manual review step before
  publishing anyway, so you can eyeball scripture accuracy and tone before anything goes live.
- **Reference image reuse across episodes**: right now every episode generates a fresh Krishna
  reference image. Once you find a prompt/seed that nails his look, save that image and reuse
  it directly as the reference input instead of regenerating from text each time - this helps
  cross-episode consistency, not just within-episode.
- **Persistent output storage**: if you deploy this (e.g. on Render), the filesystem is
  ephemeral - finished videos disappear on redeploy/restart unless you add a persistent disk
  or upload the final file to S3/Cloudinary/Drive as the last pipeline step.
