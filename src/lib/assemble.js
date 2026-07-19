const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Stretches/trims a silent video clip to match its narration audio length,
 * then muxes the two together into one scene clip with sound.
 */
async function muxSceneAudioVideo(videoPath, audioPath, outPath) {
  const audioDuration = await getDuration(audioPath);
  const videoDuration = await getDuration(videoPath);

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    if (videoDuration < audioDuration) {
      // Loop the video if the generated clip is shorter than the narration
      command
        .input(videoPath)
        .inputOptions(['-stream_loop', '-1'])
        .input(audioPath)
        .outputOptions(['-c:v libx264', '-c:a aac', '-shortest', `-t ${audioDuration}`]);
    } else {
      command
        .input(videoPath)
        .input(audioPath)
        .outputOptions(['-c:v libx264', '-c:a aac', `-t ${audioDuration}`]);
    }

    command
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

/**
 * Concatenates all scene clips (in order) into the final episode video.
 */
async function concatScenes(sceneClipPaths, outPath) {
  const listFile = path.join(path.dirname(outPath), 'concat_list.txt');
  const fileContent = sceneClipPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(listFile, fileContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

module.exports = { muxSceneAudioVideo, concatScenes, getDuration };
