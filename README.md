# Devlok Kahaniyan - Automated Video Pipeline

Turns a script into a finished, narrated, animated episode automatically:

```
Script (you write, or draft with ChatGPT/Claude)
  -> Sarvam TTS (narration per scene)
  -> Replicate: locked Krishna reference image (generated once per episode)
  -> Replicate: one still illustration per scene (same character description reused
     as a prompt prefix each time - keeps Krishna's look consistent, no video model needed)
  -> FFmpeg: Ken Burns pan/zoom motion on each still, matched to its narration length
  -> FFmpeg: mux narration onto each scene, then stitch all scenes into the final MP4
```

**No AI video generation model is used.** Early testing showed Replicate video models
(Wan 2.5 I2V Fast) cost $0.068-0.102 per SECOND of output video - a single 7-10 minute
episode would run $28-40, and a realistic posting schedule (30 Shorts + 8 long-form
episodes/month) would cost roughly $350/month just for video generation. Static illustrated
scenes with FFmpeg motion cost fractions of a cent per scene instead, and is genuinely how
most successful story-narration channels operate - it fits a kids' storybook format
naturally, arguably better than hyper-animated video would.

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

Install ffmpeg if you don't already have it:

```bash
# Ubuntu / Render build step
apt-get update && apt-get install -y ffmpeg

# Mac
brew install ffmpeg
```

### Login

The whole app (UI + API) is behind server-side HTTP Basic Auth. Set `ADMIN_USERNAME` and
`ADMIN_PASSWORD` in your environment - the app will refuse to start serving requests without
them (fails closed, not open). When you visit the site, your browser will show a native login
prompt.

### Cost Dashboard

There's a "Cost Dashboard" tab in the UI showing estimated cost per episode (Sarvam + Replicate
images) and a running total. These are **estimates**, not real billing - Replicate/Sarvam don't
return live pricing in their API responses, so the app estimates using:
- Replicate: number of images generated × the flat per-image rate you set in
  `REPLICATE_IMAGE_COST_PER_IMAGE`
- Sarvam: character count sent × the rate you set in `SARVAM_COST_PER_1000_CHARS`

Check your actual current rates on Replicate's model page and Sarvam's pricing page, and set
those env vars accordingly. Leave a rate at `0` and that cost line just shows as unconfigured
instead of a misleading number.

## 3. Run it - three ways

### Option A: Web UI (recommended - do everything from the browser)

```bash
npm start
```

Then open **http://localhost:3000** (you'll be prompted to log in). You'll see a form to:
- Enter the episode ID, title, and Krishna reference image prompt
- Add/remove scenes, each with narration + a scene description
- Click **"Load sample episode"** to auto-fill the Makhan Chor example
- Click **"Generate episode"** and watch a live progress bar
- Preview and download the finished video right in the page once it's done
- Check the **Cost Dashboard** tab for estimated spend per episode

### Option B: CLI (good for quick one-off tests or scripting)

```bash
node src/generate.js src/data/sample-episode.json
```

Runs the whole pipeline in your terminal, printing progress as it goes.

### Option C: API directly (if you're integrating this into something else)

```bash
curl -X POST http://localhost:3000/episodes \
  -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @src/data/sample-episode.json
```

Returns a `jobId` immediately while generation runs in the background. Check progress:

```bash
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" http://localhost:3000/episodes/<jobId>
```

## 4. What each scene needs

Every scene in the JSON payload needs two things:

- `narration` - the exact line(s) Sarvam will speak for this scene
- `sceneDescription` - describes what the illustration shows (Krishna's look stays
  consistent because the reference image prompt is automatically prepended to this text
  before it's sent to the image model)

## 5. Cost control knobs

- `REPLICATE_IMAGE_COST_PER_IMAGE` - check Flux Schnell's current rate on its Replicate page
- Every episode makes 1 reference image call + 1 image call per scene + 1 Sarvam call per
  scene. Fewer, longer scenes = fewer paid API calls per episode.
- Generate one episode first and check your actual Replicate usage dashboard before scripting
  out a whole month's worth of episodes.

## 6. Known gaps to fill in next

- **Captions**: not wired up yet. Add a Whisper transcription step (via Replicate's whisper
  model, or self-hosted) on the final output before upload - most Shorts are watched muted,
  so this matters more than almost anything else here.
- **Auto-upload**: no YouTube/Instagram upload step yet. Recommend a manual review step before
  publishing anyway, so you can eyeball scripture accuracy and tone before anything goes live.
- **Persistent output storage**: if you deploy this (e.g. on Render), the filesystem is
  ephemeral - finished videos disappear on redeploy/restart unless you add a persistent disk
  or upload the final file to S3/Cloudinary/Drive as the last pipeline step.
- **Character consistency tuning**: consistency currently comes from reusing the same
  descriptive prompt text on every scene, not true image-to-image conditioning. If Krishna's
  look drifts noticeably between scenes, that's the first thing to iterate on - try making the
  reference description even more specific (exact clothing details, exact facial features).
