import express from 'express';
import { Innertube, UniversalCache, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

const app = express();
const PORT = process.env.PORT || 3000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 🔹 Custom fetch (acts like real browser)
async function customFetch(input, init) {
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      "origin": "https://www.youtube.com",
      "referer": "https://www.youtube.com/"
    }
  });
}

// 🔹 Create session
async function createSession() {
  return Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    fetch: customFetch
  });
}

// 🔹 Fetch text
async function fetchText(url) {
  const res = await customFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// 🔹 Parse HLS master
function parseMaster(text, baseUrl) {
  const lines = text.split('\n');
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const url = lines[i + 1]?.trim();
      if (url && !url.startsWith("#")) {
        variants.push(new URL(url, baseUrl).toString());
      }
    }
  }
  return variants;
}

// 🔹 Parse HLS media
function parseMedia(text) {
  const lines = text.split('\n');
  let targetDuration = 0;
  let lastSq = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-TARGETDURATION")) {
      targetDuration = parseFloat(line.split(":")[1]);
    }

    if (!line.startsWith("#") && line.includes("/sq/")) {
      const match = /\/sq\/(\d+)\//.exec(line);
      if (match) lastSq = parseInt(match[1]);
    }
  }

  return { targetDuration, lastSq };
}

// 🔹 Parse DASH (simple)
function parseDash(xml) {
  const match = /mediaPresentationDuration="PT(\d+)S"/.exec(xml);
  if (match) return parseInt(match[1]);
  return null;
}

// 🔹 Format
function format(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

// 🔹 MAIN LOGIC
async function getDuration(yt, videoId) {
  let info;

  const clients = [
    "WEB",
    "WEB_EMBEDDED_PLAYER",
    "ANDROID_EMBEDDED_PLAYER",
    "ANDROID",
    "IOS",
    "TV_EMBEDDED"
  ];

  for (const client of clients) {
    try {
      info = await yt.actions.execute('/player', {
        videoId,
        client,
        parse: true
      });

      if (info?.streaming_data) break;
    } catch {}
  }

  const streaming = info?.streaming_data;

  // 🔥 1. TRY HLS (LIVE BEST)
  if (streaming?.hls_manifest_url) {
    try {
      const master = await fetchText(streaming.hls_manifest_url);
      const variants = parseMaster(master, streaming.hls_manifest_url);

      if (variants.length) {
        const media = await fetchText(variants[0]);
        const { targetDuration, lastSq } = parseMedia(media);

        if (targetDuration && lastSq !== null) {
          return Math.floor((lastSq + 1) * targetDuration);
        }
      }
    } catch {}
  }

  // 🔥 2. TRY DASH
  if (streaming?.dash_manifest_url) {
    try {
      const xml = await fetchText(streaming.dash_manifest_url);
      const seconds = parseDash(xml);
      if (seconds) return seconds;
    } catch {}
  }

  // 🔥 3. FALLBACK (VOD)
  const fallback = parseInt(info?.video_details?.length_seconds || 0);
  if (fallback) return fallback;

  throw new Error("NO_DURATION");
}

// 🔥 API
app.get('/:videoId', async (req, res) => {
  const videoId = req.params.videoId;

  try {
    const yt = await createSession();
    const seconds = await getDuration(yt, videoId);

    return res.json({
      videoId,
      seconds,
      minutes: Math.floor(seconds / 60),
      hours: Math.floor(seconds / 3600),
      formatted: format(seconds)
    });

  } catch (err) {
    return res.json({
      status: "ERROR",
      message: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.send('YT HLS + DASH API (Stable) 🚀');
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
