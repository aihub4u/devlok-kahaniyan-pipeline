require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateEpisode } = require('./pipeline');

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error('Usage: node src/generate.js <path-to-episode.json>');
    console.error('Example: node src/generate.js src/data/sample-episode.json');
    process.exit(1);
  }

  const episodeData = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf-8'));

  console.log(`Generating episode: ${episodeData.episodeId}`);

  const result = await generateEpisode(episodeData, (pct, message) => {
    console.log(`[${pct.toFixed(0)}%] ${message}`);
  });

  console.log(`\nDone! Final video: ${result.finalOutputPath}`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err.message);
  process.exit(1);
});
