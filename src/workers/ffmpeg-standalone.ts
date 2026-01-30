// FFMPEG WORKER - Standalone Service (Port 3004)
// Downloads videos → Extracts clips → Transcodes → Uploads to Supabase

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const execPromise = promisify(exec);

const app = express();
const PORT = process.env.FFMPEG_WORKER_PORT || 3004;

app.use(express.json({ limit: '50mb' }));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// ============================================
// VIDEO DOWNLOAD
// ============================================

async function downloadVideo(url: string, outputPath: string): Promise<boolean> {
  try {
    console.log(`[FFmpeg] Downloading: ${url.slice(0, 80)}...`);

    // Direct download for most URLs
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 300000, // 5 min timeout
      maxContentLength: 1024 * 1024 * 1024, // 1GB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    fs.writeFileSync(outputPath, response.data);
    console.log(`[FFmpeg] Downloaded: ${(response.data.length / 1024 / 1024).toFixed(2)} MB`);

    return fs.existsSync(outputPath);
  } catch (error: any) {
    console.error(`[FFmpeg] Download failed: ${error.message}`);
    return false;
  }
}

// ============================================
// VIDEO INFO
// ============================================

async function getVideoInfo(videoPath: string): Promise<{ duration: number; width: number; height: number } | null> {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of json "${videoPath}"`
    );

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] || {};
    const format = data.format || {};

    return {
      duration: parseFloat(format.duration || '0'),
      width: stream.width || 0,
      height: stream.height || 0,
    };
  } catch (error) {
    return null;
  }
}

// ============================================
// EXTRACT CLIP
// ============================================

async function extractClip(
  videoPath: string,
  outputPath: string,
  startSeconds: number,
  duration: number
): Promise<boolean> {
  try {
    console.log(`[FFmpeg] Extracting clip: ${startSeconds}s - ${startSeconds + duration}s`);

    await execPromise(
      `ffmpeg -i "${videoPath}" -ss ${startSeconds} -t ${duration} -c:v libx264 -c:a aac -preset fast "${outputPath}" -y`,
      { timeout: 120000 }
    );

    return fs.existsSync(outputPath);
  } catch (error: any) {
    console.error(`[FFmpeg] Clip extraction failed: ${error.message}`);
    return false;
  }
}

// ============================================
// EXTRACT FRAMES (for thumbnail/preview)
// ============================================

async function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 10
): Promise<string[]> {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fps = 1 / intervalSeconds;
    await execPromise(
      `ffmpeg -i "${videoPath}" -vf "fps=${fps}" "${outputDir}/frame_%04d.jpg" -y`,
      { timeout: 300000 }
    );

    const frames = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => path.join(outputDir, f));

    console.log(`[FFmpeg] Extracted ${frames.length} frames`);
    return frames;
  } catch (error: any) {
    console.error(`[FFmpeg] Frame extraction failed: ${error.message}`);
    return [];
  }
}

// ============================================
// UPLOAD TO SUPABASE
// ============================================

async function uploadToSupabase(filePath: string, storagePath: string): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = filePath.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';

    const { error } = await supabase.storage
      .from('mediamind')
      .upload(storagePath, fileBuffer, { contentType, upsert: true });

    if (error) {
      console.error(`[FFmpeg] Upload error: ${error.message}`);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage.from('mediamind').getPublicUrl(storagePath);

    return publicUrl;
  } catch (e: any) {
    console.error(`[FFmpeg] Upload failed: ${e.message}`);
    return null;
  }
}

// ============================================
// PROCESS VIDEO ENDPOINT
// ============================================

app.post('/process', async (req, res) => {
  const { projectId, mediaId, videoUrl, clips } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl required' });
  }

  console.log(`\n[FFmpeg Worker] Processing video: ${videoUrl.slice(0, 80)}...`);

  const tempDir = `/tmp/mediamind/${projectId || 'temp'}/${uuidv4()}`;
  fs.mkdirSync(tempDir, { recursive: true });

  const videoPath = path.join(tempDir, 'source.mp4');
  const results: any[] = [];

  try {
    // Download video
    const downloaded = await downloadVideo(videoUrl, videoPath);
    if (!downloaded) {
      return res.status(400).json({ error: 'Failed to download video' });
    }

    // Get video info
    const info = await getVideoInfo(videoPath);
    if (!info) {
      return res.status(400).json({ error: 'Failed to read video info' });
    }

    console.log(`[FFmpeg] Video info: ${info.duration}s, ${info.width}x${info.height}`);

    // If specific clips requested
    if (clips && clips.length > 0) {
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipId = uuidv4();
        const clipPath = path.join(tempDir, `clip_${i}.mp4`);

        const extracted = await extractClip(videoPath, clipPath, clip.start, clip.duration || 15);

        if (extracted) {
          const storagePath = `clips/${projectId}/${clipId}.mp4`;
          const uploadedUrl = await uploadToSupabase(clipPath, storagePath);

          if (uploadedUrl) {
            // Save clip to database
            await supabase.from('clips').insert({
              id: clipId,
              project_id: projectId,
              media_id: mediaId,
              start_time: clip.start,
              end_time: clip.start + (clip.duration || 15),
              hosted_url: uploadedUrl,
              storage_path: storagePath,
            });

            results.push({
              clipId,
              start: clip.start,
              duration: clip.duration || 15,
              url: uploadedUrl,
            });

            console.log(`[FFmpeg] Clip ${i + 1} saved: ${clip.start}s - ${clip.start + (clip.duration || 15)}s`);
          }
        }
      }
    } else {
      // Auto-extract clips every 30 seconds
      const clipDuration = 15;
      const interval = 30;
      const numClips = Math.min(Math.floor(info.duration / interval), 10);

      for (let i = 0; i < numClips; i++) {
        const startTime = i * interval;
        const clipId = uuidv4();
        const clipPath = path.join(tempDir, `clip_${i}.mp4`);

        const extracted = await extractClip(videoPath, clipPath, startTime, clipDuration);

        if (extracted) {
          const storagePath = `clips/${projectId}/${clipId}.mp4`;
          const uploadedUrl = await uploadToSupabase(clipPath, storagePath);

          if (uploadedUrl) {
            await supabase.from('clips').insert({
              id: clipId,
              project_id: projectId,
              media_id: mediaId,
              start_time: startTime,
              end_time: startTime + clipDuration,
              hosted_url: uploadedUrl,
              storage_path: storagePath,
            });

            results.push({
              clipId,
              start: startTime,
              duration: clipDuration,
              url: uploadedUrl,
            });
          }
        }
      }
    }

    // Extract thumbnail
    const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');
    await execPromise(`ffmpeg -i "${videoPath}" -ss 5 -vframes 1 "${thumbnailPath}" -y`);

    let thumbnailUrl = null;
    if (fs.existsSync(thumbnailPath)) {
      const thumbStoragePath = `thumbnails/${projectId}/${mediaId || uuidv4()}.jpg`;
      thumbnailUrl = await uploadToSupabase(thumbnailPath, thumbStoragePath);
    }

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log(`[FFmpeg Worker] Done: ${results.length} clips extracted`);

    res.json({
      success: true,
      videoInfo: info,
      clips: results,
      thumbnail: thumbnailUrl,
    });

  } catch (error: any) {
    console.error(`[FFmpeg Worker] Error: ${error.message}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// EXTRACT FRAMES ENDPOINT
// ============================================

app.post('/frames', async (req, res) => {
  const { videoUrl, interval = 10, maxFrames = 20 } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl required' });
  }

  const tempDir = `/tmp/mediamind/frames/${uuidv4()}`;
  fs.mkdirSync(tempDir, { recursive: true });

  const videoPath = path.join(tempDir, 'source.mp4');
  const framesDir = path.join(tempDir, 'frames');

  try {
    const downloaded = await downloadVideo(videoUrl, videoPath);
    if (!downloaded) {
      return res.status(400).json({ error: 'Failed to download video' });
    }

    const frames = await extractFrames(videoPath, framesDir, interval);
    const frameUrls: string[] = [];

    for (const framePath of frames.slice(0, maxFrames)) {
      const frameBuffer = fs.readFileSync(framePath);
      const base64 = frameBuffer.toString('base64');
      frameUrls.push(`data:image/jpeg;base64,${base64}`);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({
      success: true,
      count: frameUrls.length,
      frames: frameUrls,
    });

  } catch (error: any) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', worker: 'ffmpeg', port: PORT });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  FFMPEG WORKER running on port ${PORT}`);
  console.log(`========================================\n`);
});
