const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Generates narration audio for one block of text using Sarvam TTS.
 * Docs: https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
 *
 * IMPORTANT: v2 and v3 accept different parameter sets - sending a v2-only param
 * (pitch, loudness, enable_preprocessing) to v3, or vice versa (temperature to v2),
 * can cause errors. This builds the request body based on which model is configured.
 *
 * Valid speakers (case-sensitive, lowercase only):
 *   bulbul:v2 -> anushka (default), manisha, vidya, arya, abhilash, karun, hitesh
 *   bulbul:v3 -> shubh (default), aditya, ritu, priya, neha, rahul, pooja, rohan,
 *                simran, kavya, amit, dev, ishita, shreya, ratan, varun, manan,
 *                sumit, roopa, kabir, aayan, ashutosh, advait, anand, tanya, tarun,
 *                sunny, mani, gokul, vijay, shruti, suhani, mohit, kavitha, rehan,
 *                soham, rupali
 *
 * Returns { path, characterCount } - characterCount is used for cost estimation.
 */
async function generateVoiceover(text, outPath) {
  const model = process.env.SARVAM_TTS_MODEL || 'bulbul:v2';
  const isV3 = model.startsWith('bulbul:v3');

  const body = {
    text, // NOT "inputs" - the current API takes a single string field called "text"
    target_language_code: process.env.SARVAM_LANGUAGE_CODE || 'hi-IN',
    speaker: process.env.SARVAM_VOICE || (isV3 ? 'shubh' : 'anushka'),
    model,
    pace: parseFloat(process.env.SARVAM_PACE || '0.95'), // slightly slower - better for kids' storytelling pace
    speech_sample_rate: parseInt(process.env.SARVAM_SAMPLE_RATE || (isV3 ? '24000' : '22050'), 10),
  };

  if (isV3) {
    // v3-only params - pitch/loudness/enable_preprocessing are NOT supported and will error
    body.temperature = parseFloat(process.env.SARVAM_TEMPERATURE || '0.6');
  } else {
    // v2-only params - temperature has no effect on v2
    body.pitch = parseFloat(process.env.SARVAM_PITCH || '0');
    body.loudness = parseFloat(process.env.SARVAM_LOUDNESS || '1.0');
    body.enable_preprocessing = true;
  }

  const response = await axios.post('https://api.sarvam.ai/text-to-speech', body, {
    headers: {
      'api-subscription-key': process.env.SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  // Sarvam returns base64-encoded audio in `audios[0]`
  const audioBase64 = response.data.audios[0];
  const buffer = Buffer.from(audioBase64, 'base64');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);

  return { path: outPath, characterCount: text.length };
}

module.exports = { generateVoiceover };
