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
 * Works for any Replicate model - pass the model string ("owner/model")
 * and the input object that model expects.
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

  return prediction.output;
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
 */
async function generateReferenceImage(prompt, outPath) {
  const output = await runModel(process.env.REPLICATE_IMAGE_MODEL, {
    prompt,
    aspect_ratio: '9:16', // portrait, matches Shorts/Reels; use "16:9" for long-form
    output_format: 'png',
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(imageUrl, outPath);
}

/**
 * Animates the reference image into a short video clip for one scene.
 * `motionPrompt` describes the action for THIS scene only
 * (e.g. "Krishna reaches into a clay pot of butter and smiles").
 */
async function generateSceneVideo(referenceImagePath, motionPrompt, outPath) {
  // Replicate needs a public URL or base64 data URI for image inputs
  const imageBuffer = fs.readFileSync(referenceImagePath);
  const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const output = await runModel(process.env.REPLICATE_VIDEO_MODEL, {
    image: base64Image,
    prompt: motionPrompt,
    resolution: '720p',
  });

  const videoUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(videoUrl, outPath);
}

module.exports = { runModel, generateReferenceImage, generateSceneVideo, downloadFile };
