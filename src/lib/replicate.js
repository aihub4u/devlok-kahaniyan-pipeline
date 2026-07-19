const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REPLICATE_API = 'https://api.replicate.com/v1';
const REQUEST_TIMEOUT_MS = 30 * 1000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

const headers = () => ({
  Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
  'Content-Type': 'application/json',
});

async function runModel(model, input, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const create = await axios.post(
        `${REPLICATE_API}/models/${model}/predictions`,
        { input },
        { headers: headers(), timeout: REQUEST_TIMEOUT_MS }
      );

      let prediction = create.data;
      const pollUrl = prediction.urls.get;
      const startTime = Date.now();

      while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          throw new Error(`Replicate prediction timed out after ${POLL_TIMEOUT_MS / 1000}s (last status: ${prediction.status})`);
        }
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await axios.get(pollUrl, { headers: headers(), timeout: REQUEST_TIMEOUT_MS });
        prediction = poll.data;
      }

      if (prediction.status === 'failed') {
        throw new Error(`Replicate prediction failed: ${JSON.stringify(prediction.error)}`);
      }

      return { output: prediction.output };
    } catch (err) {
      lastError = err;
      const reason = err.code === 'ECONNABORTED' ? 'request timed out' : err.message;
      if (attempt < retries) {
        const backoffMs = 3000 * (attempt + 1);
        console.log(`Replicate call failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoffMs}ms: ${reason}`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError;
}

async function downloadFile(url, outPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, response.data);
  return outPath;
}

/**
 * Builds the correct input payload for whichever image model is configured.
 * Different model families use different parameter names for the same concept -
 * Flux uses "aspect_ratio", SDXL uses fixed "width"/"height" pairs. Sending the
 * wrong shape doesn't always error clearly, so this keeps each model's actual
 * expected schema in one place rather than guessing per call site.
 */
function buildImageInput(model, prompt) {
  if (model.includes('sdxl')) {
    // SDXL only supports specific (width, height) pairs - arbitrary values can
    // cause unintended cropping. 768x1344 is Stability's documented 9:16 pair.
    const isPortrait = (process.env.IMAGE_ASPECT_RATIO || '9:16') === '9:16';
    return {
      prompt,
      width: isPortrait ? 768 : 1344,
      height: isPortrait ? 1344 : 768,
      num_inference_steps: 30,
      guidance_scale: 7.5,
      scheduler: 'K_EULER',
      negative_prompt: 'blurry, low quality, distorted, disfigured, extra limbs',
    };
  }

  // Default: Flux-family models
  return {
    prompt,
    aspect_ratio: process.env.IMAGE_ASPECT_RATIO || '9:16',
    output_format: 'png',
  };
}

async function generateReferenceImage(prompt, outPath) {
  const model = process.env.REPLICATE_IMAGE_MODEL;
  const { output } = await runModel(model, buildImageInput(model, prompt));
  const imageUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(imageUrl, outPath);
}

async function generateSceneImage(referenceImagePrompt, sceneDescription, outPath) {
  const model = process.env.REPLICATE_IMAGE_MODEL;
  const combinedPrompt = `${referenceImagePrompt}. Scene: ${sceneDescription}`;
  const { output } = await runModel(model, buildImageInput(model, combinedPrompt));
  const imageUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(imageUrl, outPath);
}

async function generateSceneVideoClip(imagePath, motionPrompt, outPath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const { output } = await runModel(process.env.REPLICATE_VIDEO_MODEL || 'wan-video/wan-2.2-i2v-fast', {
    image: base64Image,
    prompt: motionPrompt,
    resolution: process.env.VIDEO_RESOLUTION || '480p',
  });

  const videoUrl = Array.isArray(output) ? output[0] : output;
  return downloadFile(videoUrl, outPath);
}

module.exports = { runModel, generateReferenceImage, generateSceneImage, generateSceneVideoClip, downloadFile };
