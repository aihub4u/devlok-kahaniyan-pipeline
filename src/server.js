require('dotenv').config();
const express = require('express');
const { episodeQueue } = require('./queue');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Submit a new episode to the pipeline. See src/data/sample-episode.json for the expected shape.
app.post('/episodes', async (req, res) => {
  const { episodeId, referenceImagePrompt, scenes } = req.body;

  if (!episodeId || !referenceImagePrompt || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({
      error: 'episodeId, referenceImagePrompt, and a non-empty scenes[] array are required',
    });
  }

  const job = await episodeQueue.add('generate-episode', req.body, {
    attempts: 1, // keep at 1 while you're testing cost per run; raise later for resilience
  });

  res.json({ jobId: job.id, status: 'queued' });
});

// Check progress/result of a submitted job
app.get('/episodes/:jobId', async (req, res) => {
  const job = await episodeQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });

  const state = await job.getState();
  res.json({
    id: job.id,
    state,
    progress: job.progress,
    returnValue: job.returnvalue,
    failedReason: job.failedReason,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Devlok Kahaniyan API listening on port ${PORT}`));
