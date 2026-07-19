require('dotenv').config();
const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { connection } = require('./queue');
const { generateVoiceover } = require('./lib/sarvam');
const { generateReferenceImage, generateSceneVideo } = require('./lib/replicate');
const { muxSceneAudioVideo, concatScenes } = require('./lib/assemble');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

/**
 * Expected job data shape - see src/data/sample-episode.json for a full example:
 * {
 *   episodeId: "s1e01-makhan-chor",
 *   title: "Krishna Steals the Butter",
 *   referenceImagePrompt: "...", // locks Krishna's look for the whole episode
 *   scenes: [
 *     { narration: "...", motionPrompt: "..." },
 *     ...
 *   ]
 * }
 */
async function processEpisode(job) {
  const { episodeId, referenceImagePrompt, scenes } = job.data;
  const episodeDir = path.join(OUTPUT_DIR, episodeId);
  fs.mkdirSync(episodeDir, { recursive: true });

  // Step 1: lock Krishna's appearance once, reuse this image for every scene below
  await job.updateProgress(5);
  const referenceImagePath = path.join(episodeDir, 'reference.png');
  await generateReferenceImage(referenceImagePrompt, referenceImagePath);

  const sceneClips = [];
  const progressPerScene = 85 / scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneTag = `scene-${String(i + 1).padStart(2, '0')}`;

    // Step 2: narration for this scene
    const audioPath = path.join(episodeDir, `${sceneTag}.wav`);
    await generateVoiceover(scene.narration, audioPath);

    // Step 3: animate the locked reference image with this scene's action
    const rawVideoPath = path.join(episodeDir, `${sceneTag}-raw.mp4`);
    await generateSceneVideo(referenceImagePath, scene.motionPrompt, rawVideoPath);

    // Step 4: mux narration onto the clip, stretching/trimming to match
    const finalScenePath = path.join(episodeDir, `${sceneTag}-final.mp4`);
    await muxSceneAudioVideo(rawVideoPath, audioPath, finalScenePath);

    sceneClips.push(finalScenePath);
    await job.updateProgress(5 + progressPerScene * (i + 1));
  }

  // Step 5: stitch every scene into the finished episode
  const finalOutputPath = path.join(episodeDir, `${episodeId}-FINAL.mp4`);
  await concatScenes(sceneClips, finalOutputPath);

  await job.updateProgress(100);
  return { finalOutputPath };
}

const worker = new Worker('devlok-episodes', processEpisode, {
  connection,
  concurrency: 1, // raise this once you've confirmed cost/quality per video
});

worker.on('completed', (job, result) => {
  console.log(`[done] ${job.data.episodeId} -> ${result.finalOutputPath}`);
});

worker.on('failed', (job, err) => {
  console.error(`[failed] ${job?.data?.episodeId}:`, err.message);
});

console.log('Devlok Kahaniyan worker listening for jobs...');
