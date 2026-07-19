const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Turns a still image into a video clip with slow zoom/pan motion (the "Ken Burns
 * effect"), matched exactly to the given duration. This replaces paying for an AI
 * video generation model - it's free (just local FFmpeg processing) and is the
 * standard technique most story-narration channels use for illustrated content.
 */
/**
 * Re-encodes a video to consistent dimensions/codec settings so clips from different
 * sources (a Wan-generated video vs an FFmpeg Ken Burns clip) can be safely concatenated.
 */
async function normalizeVideo(inputPath, outPath) {
  const width = parseInt(process.env.FRAME_WIDTH || '540', 10);
  const height = parseInt(process.env.FRAME_HEIGHT || '960', 10);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        `-vf scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        '-c:v libx264',
        '-preset ultrafast',
        '-threads 1',
        '-pix_fmt yuv420p',
        '-an', // strip audio - narration gets muxed on separately later
      ])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

/**
 * Grabs the last frame of a video as a still image - used to extend a short AI-generated
 * clip with a Ken Burns pan when the narration runs longer than the clip itself, so the
 * motion continues from where the clip left off instead of jump-cutting to a static frame.
 */
async function extractLastFrame(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions(['-sseof -1']) // seek to ~1s before end
      .outputOptions(['-vframes 1', '-q:v 2'])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

/**
 * Builds the silent (no audio yet) scene clip: a short AI-animated clip, extended with
 * a Ken Burns pan on its last frame if the narration runs longer than the clip itself.
 * Trims the clip down if narration is shorter. Narration audio gets muxed on afterward.
 */
async function buildScenePicture(rawClipPath, targetDurationSeconds, workDir, sceneTag) {
  const clipDuration = await getDuration(rawClipPath);
  const normalizedClipPath = path.join(workDir, `${sceneTag}-normalized.mp4`);
  await normalizeVideo(rawClipPath, normalizedClipPath);

  if (clipDuration >= targetDurationSeconds) {
    // Clip is already long enough (or longer) - just trim it down
    const trimmedPath = path.join(workDir, `${sceneTag}-trimmed.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(normalizedClipPath)
        .outputOptions(['-c copy', `-t ${targetDurationSeconds}`])
        .on('end', () => resolve())
        .on('error', reject)
        .save(trimmedPath);
    });
    return trimmedPath;
  }

  // Clip is shorter than the narration - extend with a Ken Burns pan on its last frame
  const remainingSeconds = targetDurationSeconds - clipDuration;
  const lastFramePath = path.join(workDir, `${sceneTag}-lastframe.jpg`);
  await extractLastFrame(normalizedClipPath, lastFramePath);

  const extensionPath = path.join(workDir, `${sceneTag}-extension.mp4`);
  await applyKenBurns(lastFramePath, remainingSeconds, extensionPath);

  const combinedPath = path.join(workDir, `${sceneTag}-combined.mp4`);
  await concatScenes([normalizedClipPath, extensionPath], combinedPath);
  return combinedPath;
}

async function applyKenBurns(imagePath, durationSeconds, outPath) {
  const fps = 20; // lower fps = fewer frames to hold in memory during zoompan
  const width = parseInt(process.env.FRAME_WIDTH || '540', 10);
  const height = parseInt(process.env.FRAME_HEIGHT || '960', 10);
  const totalFrames = Math.round(durationSeconds * fps);

  // Slow, gentle zoom-in - subtle enough not to feel dizzying in a kids' story format
  const zoomExpr = "min(zoom+0.0012,1.15)";

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop 1', `-framerate ${fps}`])
      .outputOptions([
        `-vf scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${zoomExpr}':d=${totalFrames}:s=${width}x${height}:fps=${fps}`,
        '-pix_fmt yuv420p',
        `-t ${durationSeconds}`,
        '-threads 1', // keep memory/CPU footprint predictable on small hosting instances
        '-preset ultrafast', // lower encoder memory/CPU use, at a small quality cost
      ])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

/**
 * Muxes narration audio onto a (silent) video clip, stretching/trimming to match
 * if there's a small mismatch between the two durations.
 */
async function muxSceneAudioVideo(videoPath, audioPath, outPath) {
  const audioDuration = await getDuration(audioPath);
  const videoDuration = await getDuration(videoPath);

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    if (videoDuration < audioDuration) {
      command
        .input(videoPath)
        .inputOptions(['-stream_loop', '-1'])
        .input(audioPath)
        .outputOptions(['-c:v libx264', '-preset ultrafast', '-threads 1', '-c:a aac', '-shortest', `-t ${audioDuration}`]);
    } else {
      command
        .input(videoPath)
        .input(audioPath)
        .outputOptions(['-c:v libx264', '-preset ultrafast', '-threads 1', '-c:a aac', `-t ${audioDuration}`]);
    }

    command
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

/**
 * Concatenates all scene clips (in order) into the final episode video.
 */
async function concatScenes(sceneClipPaths, outPath) {
  const listFile = path.join(path.dirname(outPath), 'concat_list.txt');
  const fileContent = sceneClipPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(listFile, fileContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

module.exports = {
  applyKenBurns,
  muxSceneAudioVideo,
  concatScenes,
  getDuration,
  normalizeVideo,
  extractLastFrame,
  buildScenePicture,
};
