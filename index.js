
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/:videoId', async (req, res) => {
  const videoId = req.params.videoId;

  try {
    const data = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38'
          }
        },
        videoId
      })
    }).then(r => r.json());

    // 👇 Get duration in milliseconds
    const durationMs = data.streamingData?.formats?.[0]?.approxDurationMs;

    if (!durationMs) {
      return res.json({
        status: "NO_DURATION",
        raw: data
      });
    }

    // Convert to seconds
    const totalSeconds = Math.floor(parseInt(durationMs) / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds;

    // Format nicely
    const formatted = `${hours}h ${minutes % 60}m ${seconds % 60}s`;

    return res.json({
      videoId,
      seconds,
      minutes,
      hours,
      formatted
    });

  } catch (err) {
    return res.json({
      status: "ERROR",
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
