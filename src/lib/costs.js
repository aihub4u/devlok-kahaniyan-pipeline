/**
 * Cost estimates, NOT exact billing.
 *
 * Replicate bills by actual compute time and Sarvam bills by characters, but neither
 * API returns a live dollar figure in the response. So this estimates cost using rates
 * YOU set in .env, based on what you see on your own Replicate/Sarvam billing dashboards.
 *
 * If a rate is left at 0 (unconfigured), that line just shows as "not configured"
 * rather than a misleading ₹0.
 */

function getRates() {
  return {
    sarvamPer1000Chars: parseFloat(process.env.SARVAM_COST_PER_1000_CHARS || '0'),
    replicateImagePerSec: parseFloat(process.env.REPLICATE_IMAGE_COST_PER_SEC || '0'),
    replicateVideoPerSec: parseFloat(process.env.REPLICATE_VIDEO_COST_PER_SEC || '0'),
    currency: process.env.COST_CURRENCY || 'INR',
  };
}

function estimateSarvamCost(characterCount) {
  const { sarvamPer1000Chars } = getRates();
  if (!sarvamPer1000Chars) return null;
  return (characterCount / 1000) * sarvamPer1000Chars;
}

function estimateReplicateCost(predictTimeSeconds, type) {
  const rates = getRates();
  const rate = type === 'image' ? rates.replicateImagePerSec : rates.replicateVideoPerSec;
  if (!rate || predictTimeSeconds == null) return null;
  return predictTimeSeconds * rate;
}

function sum(values) {
  const known = values.filter((v) => v != null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

module.exports = { getRates, estimateSarvamCost, estimateReplicateCost, sum };
