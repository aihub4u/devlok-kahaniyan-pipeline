const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REPLICATE_API = 'https://api.replicate.com/v1';
const REQUEST_TIMEOUT_MS = 30 * 1000; // per HTTP request - prevents a single stuck
// network call from hanging forever regardless of any outer retry/timeout logic

const headers = () => ({
  Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
  'Content-Type': 'application/json',
});

/**
 * Kicks off a prediction and polls until it's done.
 * Retries on failure with backoff, since Replicate occasionally returns transient
 * internal errors that typically succeed on a retry.
 *
 * IMPORTANT: every individual axios call below has its own `timeout` set. Without
 * this, a single stuck network request (no response ever arriving) hangs forever -
 * axios has no default timeout, and a timer that only checks time BETWEEN poll
 * iterations can't catch a hang that happens INSIDE one of those awaits.
 */
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // overall ceiling per attempt across all polls

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
