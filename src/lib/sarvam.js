const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Generates narration audio for one block of text using Sarvam TTS.
 * Docs: https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
 * Returns the local file path of the saved .wav audio.
 */
async function generateVoiceover(text, outPath) {
  const response = await axios.post(
    'https://api.sarvam.ai/text-to-speech',
    {
      inputs: [text],
      target_language_code: process.env.SARVAM_LANGUAGE_CODE || 'hi-IN',
      speaker: process.env.SARVAM_VOICE || 'meera',
      model: process.env.SARVAM_TTS_MODEL || 'bulbul:v2',
      pitch: 0,
      pace: 0.95,       // slightly slower - better for a kids' storytelling pace
      loudness: 1.0,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    },
    {
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  // Sarvam returns base64-encoded audio in `audios[0]`
  const audioBase64 = response.data.audios[0];
  const buffer = Buffer.from(audioBase64, 'base64');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);

  return outPath;
}

module.exports = { generateVoiceover };
