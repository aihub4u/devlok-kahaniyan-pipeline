# Devlok Kahaniyan - Automated Video Pipeline

Turns a script into a finished, narrated, AI-animated episode automatically:

```
Script (you write, or draft with ChatGPT/Claude)
  -> Sarvam TTS (narration per scene)
  -> Replicate: locked Krishna reference image (generated once per episode)
  -> Replicate: image-to-video per scene (reuses the SAME reference image -> consistent Krishna)
  -> FFmpeg: mux narration onto each scene, then stitch all scenes into the final MP4
```

## 1. Prerequisites

- Node.js 18+
- Redis running somewhere (BullMQ needs this as the job queue). Options:
  - Local: `docker run -p 6379:6379 redis`
  - Or a free/low-cost Redis add-on on Render (same as your other projects)
- A [Sarvam AI](https://www.sarvam.ai/) API key
- A [Replicate](https://replicate.com/account/api-tokens) API token

## 2. Install

```bash
npm install
cp .env.example .env
# then fill in REDIS_URL, SARVAM_API_KEY, REPLICATE_API_TOKEN in .env
```

Also install ffmpeg on the machine/server this runs on (fluent-ffmpeg is just a wrapper, it needs the real binary):

```bash
# Ubuntu/Render build step
apt-get install -y ffmpeg
```

## 3. Run

Two processes, same as your other queue-based projects (API + worker split):

```bash
# Terminal 1 - the API that accepts new episode requests
npm start

# Terminal 2 - the worker that actually does the generation
npm run worker
```

## 4. Submit your first episode

The sample episode (`src/data/sample-episode.json`) is the Makhan Chor (butter-stealing) story, already
broken into 5 scenes with narration + scripture reference + lesson baked in, matching your format.

```bash
curl -X POST http://localhost:3000/episodes \
  -H "Content-Type: application/json" \
  -d @src/data/sample-episode.json
```

This returns a `jobId`. Check progress with:

```bash
curl http://localhost:3000/episodes/<jobId>
```

When `state` is `completed`, `returnValue.finalOutputPath` points to the finished MP4 inside `./output/<episodeId>/`.

## 5. What each scene needs

Every scene in the JSON payload needs two things:

- `narration` — the exact line(s) Sarvam will speak for this scene
- `motionPrompt` — describes the ACTION for this scene only (Krishna's look stays locked from the
  reference image; this prompt only controls what he's doing/moving)

Keep `motionPrompt`s simple and physical ("reaches for the pot", "smiles and waves") — video models
follow concrete actions much better than abstract ones.

## 6. Cost control knobs

- `concurrency: 1` in `worker.js` — raise this once you've validated cost-per-episode; running scenes
  in parallel finishes faster but multiplies your simultaneous Replicate spend
- `REPLICATE_VIDEO_MODEL` in `.env` — swap between `wan-video/wan-2.5-i2v-fast` (cheap, good for daily
  Shorts) and a stronger model for festival/season-opener episodes. Check current per-second pricing on
  each model's Replicate page before switching, since rates vary by model and change over time.
- Every scene currently makes 1 image call (only once per episode, not per scene) + 1 video call +
  1 Sarvam call. That's your main lever for cost: fewer, longer scenes = fewer paid API calls.

## 7. Known gaps to fill in next

- **Captions**: not wired up yet. Add a Whisper transcription step (via Replicate's whisper model, or
  self-hosted) on `finalOutputPath` to burn in captions before upload — most Shorts are watched muted,
  so this matters more than almost anything else here.
- **Auto-upload**: `.env` has placeholder YouTube fields but no upload step is wired up yet. Recommend
  keeping a manual review step before publishing until you've checked a batch of outputs for accuracy
  and tone — this is mythology content for kids, worth a human check before it goes live.
- **Retry handling**: `attempts: 1` on job submission means a failed episode (e.g. a Replicate timeout)
  won't auto-retry. Bump this once you trust the pipeline's reliability.
- **Reference image reuse across episodes**: right now every episode generates a fresh Krishna reference
  image. Once you find a prompt/seed that nails his look, save that image and reuse it as the `image`
  input for the reference step instead of regenerating from a text prompt every time — this improves
  cross-episode consistency, not just within-episode.
