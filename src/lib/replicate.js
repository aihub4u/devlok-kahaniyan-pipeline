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
 * Generates the locked Krishna reference image for the episode.
 * Reuse the SAME reference image across every scene's video generation
 * call below - this is what keeps Krishna looking consistent throughout.
 * Returns { path, predictTime }.
 */
async function generateReferenceImage(prompt, outPath) {
  const { output, predictTime } = await runModel(process.env.REPLICATE_IMAGE_MODEL, {
    prompt,
    aspect_ratio: '9:16', // portrait, matches Shorts/Reels; use "16:9" for long-form
    output_format: 'png',
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  const filePath = await downloadFile(imageUrl, outPath);
  return { path: filePath, predictTime };
}

/**
 * Animates the reference image into a short video clip for one scene.
 * `motionPrompt` describes the action for THIS scene only
 * (e.g. "Krishna reaches into a clay pot of butter and smiles").
 * Returns { path, predictTime }.
 */
async function generateSceneVideo(referenceImagePath, motionPrompt, outPath) {
  // Replicate needs a public URL or base64 data URI for image inputs
  const imageBuffer = fs.readFileSync(referenceImagePath);
  const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const { output, predictTime } = await runModel(process.env.REPLICATE_VIDEO_MODEL, {
    image: base64Image,
    prompt: motionPrompt,
    resolution: '720p',
  });

  const videoUrl = Array.isArray(output) ? output[0] : output;
  const filePath = await downloadFile(videoUrl, outPath);
  return { path: filePath, predictTime };
}

module.exports = { runModel, generateReferenceImage, generateSceneVideo, downloadFile };
