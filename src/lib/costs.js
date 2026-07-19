/**
 * Cost estimates, NOT exact billing.
 *
 * The pipeline only calls Replicate for STILL IMAGES now (no AI video generation model),
 * so the only Replicate cost is per-image. Sarvam bills by characters. Neither API returns
 * a live dollar figure in its response, so this estimates using rates YOU set in .env,
 * based on what you see on your own Replicate/Sarvam billing dashboards.
 *
 * If a rate is left at 0 (unconfigured), that line just shows as "not configured"
 * rather than a misleading ₹0/$0.
 */

function getRates() {
  return {
    sarvamPer1000Chars: parseFloat(process.env.SARVAM_COST_PER_1000_CHARS || '0'),
    replicateImagePerImage: parseFloat(process.env.REPLICATE_IMAGE_COST_PER_IMAGE || '0'),
    currency: process.env.COST_CURRENCY || 'USD',
  };
}

function estimateSarvamCost(characterCount) {
  const { sarvamPer1000Chars } = getRates();
  if (!sarvamPer1000Chars) return null;
  return (characterCount / 1000) * sarvamPer1000Chars;
}

// Flux Schnell (and most Replicate image models) bill a flat rate per image generated.
function estimateReplicateImageCost(imageCount = 1) {
  const { replicateImagePerImage } = getRates();
  if (!replicateImagePerImage) return null;
  return imageCount * replicateImagePerImage;
}

function sum(values) {
  const known = values.filter((v) => v != null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

module.exports = { getRates, estimateSarvamCost, estimateReplicateImageCost, sum };
