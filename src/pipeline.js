const path = require('path');
const fs = require('fs');
const { generateVoiceover } = require('./lib/sarvam');
const { generateReferenceImage, generateSceneVideo } = require('./lib/replicate');
const { muxSceneAudioVideo, concatScenes } = require('./lib/assemble');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

/**
 * Runs the full script -> voiceover -> AI video -> assembled episode pipeline.
 *
 * @param {object} episodeData - see src/data/sample-episode.json for the shape
 * @param {(pct: number, message: string) => void} [onProgress] - optional progress callback
 */
async function generateEpisode(episodeData, onProgress = () => {}) {
  const { episodeId, referenceImagePrompt, scenes } = episodeData;

  if (!episodeId || !referenceImagePrompt || !Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('episodeId, referenceImagePrompt, and a non-empty scenes[] array are required');
  }

  const episodeDir = path.join(OUTPUT_DIR, episodeId);
  fs.mkdirSync(episodeDir, { recursive: true });

  // Step 1: lock Krishna's appearance once, reuse this image for every scene below
  onProgress(5, 'Generating reference image');
  const referenceImagePath = path.join(episodeDir, 'reference.png');
  await generateReferenceImage(referenceImagePrompt, referenceImagePath);

  const sceneClips = [];
  const progressPerScene = 85 / scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneTag = `scene-${String(i + 1).padStart(2, '0')}`;

    onProgress(5 + progressPerScene * i, `Scene ${i + 1}/${scenes.length}: narration`);
    const audioPath = path.join(episodeDir, `${sceneTag}.wav`);
    await generateVoiceover(scene.narration, audioPath);

    onProgress(5 + progressPerScene * i + progressPerScene * 0.3, `Scene ${i + 1}/${scenes.length}: animating`);
    const rawVideoPath = path.join(episodeDir, `${sceneTag}-raw.mp4`);
    await generateSceneVideo(referenceImagePath, scene.motionPrompt, rawVideoPath);

    onProgress(5 + progressPerScene * i + progressPerScene * 0.8, `Scene ${i + 1}/${scenes.length}: muxing audio`);
    const finalScenePath = path.join(episodeDir, `${sceneTag}-final.mp4`);
    await muxSceneAudioVideo(rawVideoPath, audioPath, finalScenePath);

    sceneClips.push(finalScenePath);
    onProgress(5 + progressPerScene * (i + 1), `Scene ${i + 1}/${scenes.length}: done`);
  }

  onProgress(95, 'Stitching final episode');
  const finalOutputPath = path.join(episodeDir, `${episodeId}-FINAL.mp4`);
  await concatScenes(sceneClips, finalOutputPath);

  onProgress(100, 'Done');
  return { finalOutputPath };
}

module.exports = { generateEpisode };
