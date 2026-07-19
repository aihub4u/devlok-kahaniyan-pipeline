const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REPLICATE_API = 'https://api.replicate.com/v1';

const headers = () => ({
  Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
  'Content-Type': 'application/json',
});

/**
 * Kicks off a prediction and polls until it's done.
 * Returns { output, predictTime } - predictTime (seconds) is used for cost estimation,
 * since Replicate bills by compute time, not per-call.
 */
async function runModel(model, input) {
  const create = await axios.post(
    `${REPLICATE_API}/models/${model}/predictions`,
    { input },
    { headers: headers() }
  );

  let prediction = create.data;
  const pollUrl = prediction.urls.get;

  // Poll every 3s until the model finishes. Video models can take 1-3 min.
  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await axios.get(pollUrl, { headers: headers() });
    prediction = poll.data;
  }

  if (prediction.status === 'failed') {
    throw new Error(`Replicate prediction failed: ${JSON.stringify(prediction.error)}`);
  }

  const predictTime = prediction.metrics && prediction.metrics.predict_time
    ? prediction.metrics.predict_time
    : null;

  return { output: prediction.output, predictTime };
}

async function downloadFile(url, outPath) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, response.data);
  return outPath;
}

/**
 * Generates the locked Krishna reference image for the episode. This is the visual
 * anchor - its exact wording gets reused as a prefix on every scene's prompt below,
 * which is what keeps Krishna looking consistent without needing a trained LoRA or
 * paying for image-to-image/reference-based video models.
 */
async function generateReferenceImage(prompt, outPath) {
  const { output } = await runModel(process.env.REPLICATE_IMAGE_MODEL, {
    prompt,
    aspect_ratio: process.env.IMAGE_ASPECT_RATIO || '9:16',
    output_format: 'png',
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(imageUrl, outPath);
}

/**
 * Generates one still image for a scene. `referenceImagePrompt` (Krishna's locked
 * look) is prepended verbatim so every scene shares the same character description -
 * this text-level consistency is the low-cost substitute for a trained LoRA or a
 * reference-conditioned video model.
 */
async function generateSceneImage(referenceImagePrompt, sceneDescription, outPath) {
  const combinedPrompt = `${referenceImagePrompt}. Scene: ${sceneDescription}`;

  const { output } = await runModel(process.env.REPLICATE_IMAGE_MODEL, {
    prompt: combinedPrompt,
    aspect_ratio: process.env.IMAGE_ASPECT_RATIO || '9:16',
    output_format: 'png',
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(imageUrl, outPath);
}

module.exports = { runModel, generateReferenceImage, generateSceneImage, downloadFile };
