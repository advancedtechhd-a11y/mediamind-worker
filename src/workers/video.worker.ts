// MediaMind Video Worker - Simplified (No FFmpeg required)
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForVideos } from '../services/web-search.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function processVideoResearch(projectId: string, topic: string, maxResults: number) {
  console.log(`\n[Video] Starting: "${topic}"`);

  try {
    // Search for videos
    const searchResults = await searchWebForVideos(topic, maxResults * 2);
    console.log(`[Video] Found ${searchResults.length} videos`);

    let saved = 0;
    for (const video of searchResults) {
      if (saved >= maxResults) break;

      try {
        const videoId = uuidv4();

        // Save video reference (source URL) - no download needed
        await supabase.from('media').insert({
          id: videoId,
          project_id: projectId,
          type: 'video',
          title: video.title,
          source: video.source,
          source_url: video.url,
          hosted_url: video.url, // Use source URL directly
          metadata: {
            thumbnail: video.thumbnail,
            duration: video.duration,
            needs_download: true, // Flag for later processing
          },
        });

        saved++;
        console.log(`[Video] Saved ${saved}/${maxResults}: ${video.title?.slice(0, 40)}...`);

      } catch (e: any) {
        console.error(`[Video] Error: ${e.message}`);
      }
    }

    // Update project counts
    await supabase.from('projects').update({
      video_count: saved,
    }).eq('id', projectId);

    console.log(`[Video] Done: ${saved} videos`);
    return { success: true, count: saved };

  } catch (e: any) {
    console.error(`[Video] Fatal: ${e.message}`);
    return { success: false, error: e.message };
  }
}
