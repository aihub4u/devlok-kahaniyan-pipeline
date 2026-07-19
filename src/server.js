require('dotenv').config();
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { generateEpisode } = require('./pipeline');

const app = express();
app.use(express.json({ limit: '2mb' }));

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

// Serve the frontend UI at "/"
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve generated videos so the frontend can preview/download them
app.use('/videos', express.static(path.resolve(OUTPUT_DIR)));

// Simple in-memory job tracking - no Redis needed.
// Good enough for a solo creator submitting episodes one at a time.
// Note: this resets if the server restarts, and only works with a single server
// instance (fine on Render's free/starter tier, which runs one instance anyway).
const jobs = new Map();

app.post('/episodes', (req, res) => {
  const episodeData = req.body;

  if (!episodeData.episodeId || !episodeData.referenceImagePrompt || !Array.isArray(episodeData.scenes) || episodeData.scenes.length === 0) {
    return res.status(400).json({
      error: 'episodeId, referenceImagePrompt, and a non-empty scenes[] array are required',
    });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { state: 'processing', progress: 0, message: 'Starting', result: null, error: null });

  // Fire and forget - the request returns immediately, generation happens in the background
  generateEpisode(episodeData, (pct, message) => {
    const job = jobs.get(jobId);
    job.progress = pct;
    job.message = message;
  })
    .then((result) => {
      const job = jobs.get(jobId);
      job.state = 'completed';
      // Convert the local file path into a URL the frontend <video> tag can load
      const relativePath = path.relative(path.resolve(OUTPUT_DIR), result.finalOutputPath);
      job.result = { videoUrl: `/videos/${relativePath.split(path.sep).join('/')}` };
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      job.state = 'failed';
      job.error = err.message;
    });

  res.json({ jobId, status: 'queued' });
});

app.get('/episodes/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Devlok Kahaniyan running at http://localhost:${PORT}`));
