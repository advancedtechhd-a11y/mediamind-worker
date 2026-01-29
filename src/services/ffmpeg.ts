// FFmpeg Service
// Video download, audio detection, frame extraction, clip extraction

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const execPromise = promisify(exec);

// ============================================
// DOWNLOAD VIDEO
// ============================================

export async function downloadVideo(url: string, outputPath: string): Promise<boolean> {
  try {
    console.log(`      Downloading from: ${url.slice(0, 80)}...`);

    // Use yt-dlp for YouTube, Vimeo, and other video platforms
    if (isVideoSite(url)) {
      return await downloadWithYtDlp(url, outputPath);
    }

    // Direct download for other URLs (Archive.org, Pexels, etc.)
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 180000, // 3 minute timeout
      maxContentLength: 500 * 1024 * 1024, // 500MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    fs.writeFileSync(outputPath, response.data);

    return fs.existsSync(outputPath);
  } catch (error: any) {
    console.error(`      Download failed: ${error.message}`);
    return false;
  }
}

function isVideoSite(url: string): boolean {
  const videoSites = [
    'youtube.com', 'youtu.be',
    'vimeo.com',
    'dailymotion.com',
    'twitter.com', 'x.com',
    'facebook.com', 'fb.watch',
    'tiktok.com',
    'instagram.com'
  ];
  return videoSites.some(site => url.includes(site));
}

async function downloadWithYtDlp(url: string, outputPath: string): Promise<boolean> {
  try {
    // Download best quality up to 720p, max 5 minutes
    const cmd = `yt-dlp -f "best[height<=720]" --max-filesize 200M -o "${outputPath}" --no-playlist "${url}"`;

    await execPromise(cmd, { timeout: 300000 }); // 5 min timeout

    return fs.existsSync(outputPath);
  } catch (error: any) {
    console.error(`      yt-dlp failed: ${error.message}`);
    return false;
  }
}

// ============================================
// DETECT AUDIO
// ============================================

export async function detectAudio(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execPromise(
      `ffprobe -i "${videoPath}" -show_streams -select_streams a -loglevel error`
    );
    return stdout.trim().length > 0;
  } catch (error) {
    // No audio stream found
    return false;
  }
}

// ============================================
// EXTRACT AUDIO
// ============================================

export async function extractAudio(videoPath: string, audioPath: string): Promise<boolean> {
  try {
    await execPromise(
      `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`
    );
    return fs.existsSync(audioPath);
  } catch (error: any) {
    console.error(`      Audio extraction failed: ${error.message}`);
    return false;
  }
}

// ============================================
// EXTRACT FRAMES
// ============================================

export async function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 5
): Promise<string[]> {
  try {
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get video duration
    const duration = await getVideoDuration(videoPath);
    if (!duration) {
      console.error(`      Could not get video duration`);
      return [];
    }

    // Extract frames at interval
    const fps = 1 / intervalSeconds;
    await execPromise(
      `ffmpeg -i "${videoPath}" -vf "fps=${fps}" "${outputDir}/frame_%04d.jpg" -y`
    );

    // Get list of extracted frames
    const frames = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => path.join(outputDir, f));

    console.log(`      Extracted ${frames.length} frames (1 per ${intervalSeconds}s)`);
    return frames;

  } catch (error: any) {
    console.error(`      Frame extraction failed: ${error.message}`);
    return [];
  }
}

// ============================================
// EXTRACT CLIP
// ============================================

export async function extractClip(
  videoPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number
): Promise<boolean> {
  try {
    const duration = endSeconds - startSeconds;

    await execPromise(
      `ffmpeg -i "${videoPath}" -ss ${startSeconds} -t ${duration} -c:v libx264 -c:a aac "${outputPath}" -y`
    );

    return fs.existsSync(outputPath);
  } catch (error: any) {
    console.error(`      Clip extraction failed: ${error.message}`);
    return false;
  }
}

// ============================================
// GET VIDEO INFO
// ============================================

export async function getVideoDuration(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? null : duration;
  } catch (error) {
    return null;
  }
}

export async function getVideoInfo(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
} | null> {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -show_entries format=duration -of json "${videoPath}"`
    );

    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] || {};
    const format = data.format || {};

    const hasAudio = await detectAudio(videoPath);

    return {
      duration: parseFloat(format.duration || stream.duration || '0'),
      width: stream.width || 0,
      height: stream.height || 0,
      hasAudio,
    };
  } catch (error) {
    return null;
  }
}
