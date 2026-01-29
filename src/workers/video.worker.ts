// MediaMind Video Worker - Simplified
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForVideos } from '../services/web-search.js';
import { downloadVideo, detectAudio, extractFrames, extractClip, getVideoDuration } from '../services/ffmpeg.js';
import { transcribeAudio } from '../services/whisper.js';
import { analyzeTranscript, analyzeFrames } from '../services/claude.js';
import { uploadToStorage } from '../services/storage.js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/mediamind';

export async function processVideoResearch(projectId: string, topic: string, maxResults: number) {
  console.log(`\n[Video] Starting: "${topic}"`);

  const jobDir = path.join(TEMP_DIR, projectId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  try {
    // Search for videos
    const searchResults = await searchWebForVideos(topic, maxResults * 2);
    console.log(`[Video] Found ${searchResults.length} videos`);

    let processed = 0;
    for (const video of searchResults.slice(0, maxResults)) {
      try {
        const videoId = uuidv4();
        const videoPath = path.join(jobDir, `${videoId}.mp4`);

        // Download
        console.log(`[Video] Downloading: ${video.title?.slice(0, 50)}...`);
        const downloaded = await downloadVideo(video.url, videoPath);
        if (!downloaded) continue;

        // Upload video FIRST so we can view it
        const storagePath = `videos/${projectId}/${videoId}.mp4`;
        const hostedUrl = await uploadToStorage(videoPath, storagePath);
        console.log(`[Video] Uploaded: ${hostedUrl}`);

        // Check audio
        const hasAudio = await detectAudio(videoPath);

        // Save to DB immediately (so we can view it)
        await supabase.from('media').insert({
          id: videoId,
          project_id: projectId,
          type: 'video',
          title: video.title,
          source: video.source,
          source_url: video.url,
          hosted_url: hostedUrl,
          storage_path: storagePath,
          metadata: { has_audio: hasAudio, analyzed: false },
        });

        // Now do AI analysis in background
        let relevantSegments: any[] = [];
        try {
          if (hasAudio) {
            const audioPath = path.join(jobDir, `${videoId}.mp3`);
            const transcript = await transcribeAudio(videoPath, audioPath);
            if (transcript.length > 0) {
              relevantSegments = await analyzeTranscript(topic, transcript);
            }
            try { fs.unlinkSync(audioPath); } catch(e) {}
          } else {
            const framesDir = path.join(jobDir, `${videoId}_frames`);
            const frames = await extractFrames(videoPath, framesDir, 5);
            if (frames.length > 0) {
              relevantSegments = await analyzeFrames(topic, frames);
            }
            try { fs.rmSync(framesDir, { recursive: true }); } catch(e) {}
          }

          // Update DB with analysis results
          await supabase.from('media').update({
            metadata: { has_audio: hasAudio, analyzed: true, segments: relevantSegments.length },
          }).eq('id', videoId);

          // Extract clips if relevant segments found
          for (const seg of relevantSegments) {
            const clipId = uuidv4();
            const clipPath = path.join(jobDir, `${clipId}.mp4`);
            await extractClip(videoPath, clipPath, seg.start, seg.end);

            if (fs.existsSync(clipPath)) {
              const clipStoragePath = `videos/${projectId}/clips/${clipId}.mp4`;
              const clipUrl = await uploadToStorage(clipPath, clipStoragePath);

              await supabase.from('clips').insert({
                id: clipId,
                media_id: videoId,
                project_id: projectId,
                start_time: `${Math.floor(seg.start / 60)}:${Math.floor(seg.start % 60).toString().padStart(2, '0')}`,
                end_time: `${Math.floor(seg.end / 60)}:${Math.floor(seg.end % 60).toString().padStart(2, '0')}`,
                duration_seconds: Math.round(seg.end - seg.start),
                description: seg.description,
                relevance_score: seg.relevanceScore,
                hosted_url: clipUrl,
                storage_path: clipStoragePath,
                extraction_method: hasAudio ? 'transcript' : 'frames',
                metadata: {
                  preserve_original_audio: hasAudio, // Use original audio as B-roll
                  transcript_match: hasAudio,
                  source_has_audio: hasAudio,
                },
              });
              fs.unlinkSync(clipPath);
            }
          }
        } catch (analysisError: any) {
          console.error(`[Video] Analysis error: ${analysisError.message}`);
        }

        try { fs.unlinkSync(videoPath); } catch(e) {}
        processed++;
        console.log(`[Video] Saved: ${video.title?.slice(0, 50)}`);

      } catch (e: any) {
        console.error(`[Video] Error: ${e.message}`);
      }
    }

    // Cleanup
    try { fs.rmSync(jobDir, { recursive: true }); } catch(e) {}

    console.log(`[Video] Done: ${processed} videos`);
    return { success: true, count: processed };

  } catch (e: any) {
    console.error(`[Video] Fatal: ${e.message}`);
    return { success: false, error: e.message };
  }
}
