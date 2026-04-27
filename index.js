import express from 'express';
import { Innertube, UniversalCache, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

const app = express();
const PORT = process.env.PORT || 3000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 🔹 Fetch text
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// 🔹 Parse master
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

// 🔹 Parse media
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

// 🔹 Format
function format(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

// 🔹 FAST session
async function createFastSession() {
  return Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true
  });
}

// 🔹 RELIABLE session (PoToken)
async function createReliableSession() {
  const { JSDOM } = await import("jsdom");
  const { BG } = await import("bgutils-js");

  const tmp = await Innertube.create({ retrieve_player: false });
  const visitorData = tmp.session.context.client.visitorData;

  const dom = new JSDOM('<!DOCTYPE html><html></html>', {
    url: "https://www.youtube.com/",
    userAgent: UA
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location
  });

  const challenge = await BG.Challenge.create({
    fetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: "O43z0dpjhgX20SCx4KAo"
  });

  if (challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue) {
    new Function(
      challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
    )();
  }

  const poToken = await BG.PoToken.generate({
    program: challenge.program,
    globalName: challenge.globalName,
    bgConfig: { fetch, globalObj: globalThis }
  });

  return Innertube.create({
    po_token: poToken.poToken,
    visitor_data: visitorData,
    cache: new UniversalCache(false),
    generate_session_locally: true
  });
}

// 🔥 CORE FUNCTION
async function getDuration(yt, videoId) {
  let info;
  const clients = ["IOS", "ANDROID", "TV_EMBEDDED"];

  for (const client of clients) {
    try {
      info = await yt.actions.execute('/player', {
        videoId,
        client,
        parse: true
      });

      if (info?.streaming_data?.hls_manifest_url) break;

    } catch {}
  }

  const hls = info?.streaming_data?.hls_manifest_url;
  if (!hls) throw new Error("NO_HLS");

  const master = await fetchText(hls);
  const variants = parseMaster(master, hls);

  if (!variants.length) throw new Error("NO_VARIANTS");

  const media = await fetchText(variants[0]);
  const { targetDuration, lastSq } = parseMedia(media);

  if (!targetDuration || lastSq === null) throw new Error("PARSE_ERROR");

  return Math.floor((lastSq + 1) * targetDuration);
}

// 🔥 API ROUTE
app.get('/:videoId', async (req, res) => {
  const videoId = req.params.videoId;

  try {
    const yt = await createFastSession();
    const seconds = await getDuration(yt, videoId);

    return res.json({
      videoId,
      seconds,
      minutes: Math.floor(seconds / 60),
      hours: Math.floor(seconds / 3600),
      formatted: format(seconds)
    });

  } catch (err) {
    try {
      // 🔥 fallback to PoToken
      const yt = await createReliableSession();
      const seconds = await getDuration(yt, videoId);

      return res.json({
        videoId,
        seconds,
        minutes: Math.floor(seconds / 60),
        hours: Math.floor(seconds / 3600),
        formatted: format(seconds),
        mode: "PoToken"
      });

    } catch (err2) {
      return res.json({
        status: "ERROR",
        message: err2.message
      });
    }
  }
});

app.get('/', (req, res) => {
  res.send('PRO YT API (PoToken + HLS) 🚀');
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
