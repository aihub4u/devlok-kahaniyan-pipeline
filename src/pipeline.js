const path = require('path');
const fs = require('fs');
const { generateVoiceover } = require('./lib/sarvam');
const { generateReferenceImage, generateSceneVideo } = require('./lib/replicate');
const { muxSceneAudioVideo, concatScenes } = require('./lib/assemble');
const { estimateSarvamCost, estimateReplicateCost, sum, getRates } = require('./lib/costs');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const COST_LOG_PATH = path.join(OUTPUT_DIR, 'cost-log.json');

function appendToCostLog(entry) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let log = [];
  if (fs.existsSync(COST_LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(COST_LOG_PATH, 'utf-8'));
    } catch (e) {
      log = [];
    }
  }
  log.push(entry);
  fs.writeFileSync(COST_LOG_PATH, JSON.stringify(log, null, 2));
}

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

  const costBreakdown = {
    referenceImage: null,
    scenes: [],
    totalEstCost: null,
    currency: getRates().currency,
  };

  // Step 1: lock Krishna's appearance once, reuse this image for every scene below
  onProgress(5, 'Generating reference image');
  const referenceImagePath = path.join(episodeDir, 'reference.png');
  const refImageResult = await generateReferenceImage(referenceImagePrompt, referenceImagePath);
  const refImageCost = estimateReplicateCost(refImageResult.predictTime, 'image');
  costBreakdown.referenceImage = {
    predictTimeSeconds: refImageResult.predictTime,
    estCost: refImageCost,
  };

  const sceneClips = [];
  const progressPerScene = 85 / scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneTag = `scene-${String(i + 1).padStart(2, '0')}`;

    onProgress(5 + progressPerScene * i, `Scene ${i + 1}/${scenes.length}: narration`);
    const audioPath = path.join(episodeDir, `${sceneTag}.wav`);
    const audioResult = await generateVoiceover(scene.narration, audioPath);
    const sarvamCost = estimateSarvamCost(audioResult.characterCount);

    onProgress(5 + progressPerScene * i + progressPerScene * 0.3, `Scene ${i + 1}/${scenes.length}: animating`);
    const rawVideoPath = path.join(episodeDir, `${sceneTag}-raw.mp4`);
    const videoResult = await generateSceneVideo(referenceImagePath, scene.motionPrompt, rawVideoPath);
    const videoCost = estimateReplicateCost(videoResult.predictTime, 'video');

    onProgress(5 + progressPerScene * i + progressPerScene * 0.8, `Scene ${i + 1}/${scenes.length}: muxing audio`);
    const finalScenePath = path.join(episodeDir, `${sceneTag}-final.mp4`);
    await muxSceneAudioVideo(rawVideoPath, audioPath, finalScenePath);

    sceneClips.push(finalScenePath);
    costBreakdown.scenes.push({
      scene: i + 1,
      sarvamCharacterCount: audioResult.characterCount,
      sarvamEstCost: sarvamCost,
      videoPredictTimeSeconds: videoResult.predictTime,
      videoEstCost: videoCost,
    });

    onProgress(5 + progressPerScene * (i + 1), `Scene ${i + 1}/${scenes.length}: done`);
  }

  onProgress(95, 'Stitching final episode');
  const finalOutputPath = path.join(episodeDir, `${episodeId}-FINAL.mp4`);
  await concatScenes(sceneClips, finalOutputPath);

  // Roll up total estimated cost across every step
  const allCosts = [
    costBreakdown.referenceImage.estCost,
    ...costBreakdown.scenes.flatMap((s) => [s.sarvamEstCost, s.videoEstCost]),
  ];
  costBreakdown.totalEstCost = sum(allCosts);

  fs.writeFileSync(
    path.join(episodeDir, 'costs.json'),
    JSON.stringify(costBreakdown, null, 2)
  );

  appendToCostLog({
    episodeId,
    title: episodeData.title || episodeId,
    generatedAt: new Date().toISOString(),
    ...costBreakdown,
  });

  onProgress(100, 'Done');
  return { finalOutputPath, costBreakdown };
}

module.exports = { generateEpisode };
