// MediaMind Image Worker - Simplified
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForImages } from '../services/web-search.js';
import { uploadFromUrl } from '../services/storage.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function processImageResearch(projectId: string, topic: string, maxResults: number) {
  console.log(`\n[Image] Starting: "${topic}"`);

  try {
    const searchResults = await searchWebForImages(topic, maxResults * 2);
    console.log(`[Image] Found ${searchResults.length} images`);

    let saved = 0;
    for (const image of searchResults) {
      if (saved >= maxResults) break;

      try {
        const imageId = uuidv4();
        const storagePath = `images/${projectId}/${imageId}.jpg`;

        const hostedUrl = await uploadFromUrl(image.url, storagePath);
        if (!hostedUrl) continue;

        await supabase.from('media').insert({
          id: imageId,
          project_id: projectId,
          type: 'image',
          title: image.title,
          source: image.source,
          source_url: image.url,
          hosted_url: hostedUrl,
          storage_path: storagePath,
          metadata: { width: image.width, height: image.height },
        });

        saved++;
        console.log(`[Image] Saved ${saved}/${maxResults}`);

      } catch (e: any) {
        console.error(`[Image] Error: ${e.message}`);
      }
    }

    console.log(`[Image] Done: ${saved} images`);
    return { success: true, count: saved };

  } catch (e: any) {
    console.error(`[Image] Fatal: ${e.message}`);
    return { success: false, error: e.message };
  }
}
