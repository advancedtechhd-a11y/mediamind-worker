// MediaMind Image Worker - With Qwen Relevance Filtering
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForImages } from '../services/web-search.js';
import { uploadFromUrl } from '../services/storage.js';
import { validateImageRelevance, validateImageBatch } from '../services/claude.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Filter images by relevance using Qwen (much cheaper than Claude)
const FILTER_BY_RELEVANCE = process.env.FILTER_IMAGES_BY_RELEVANCE === 'true';

export async function processImageResearch(projectId: string, topic: string, maxResults: number) {
  console.log(`\n[Image] Starting: "${topic}"`);

  try {
    // Search for more images if filtering is enabled
    const searchMultiplier = FILTER_BY_RELEVANCE ? 4 : 2;
    const searchResults = await searchWebForImages(topic, maxResults * searchMultiplier);
    console.log(`[Image] Found ${searchResults.length} images`);

    // Filter by relevance using Qwen (batch for efficiency)
    let imagesToProcess = searchResults;
    if (FILTER_BY_RELEVANCE && searchResults.length > 0) {
      console.log(`[Image] Filtering by relevance using Qwen...`);
      const imagesToCheck = searchResults.slice(0, Math.min(searchResults.length, maxResults * 3)).map((img, idx) => ({
        url: img.url,
        id: String(idx),
      }));

      const relevanceResults = await validateImageBatch(topic, imagesToCheck);
      const relevantIndices = new Set(
        relevanceResults
          .filter(r => r.relevant && r.score >= 0.5)
          .map(r => parseInt(r.id))
      );

      imagesToProcess = searchResults.filter((_, idx) => relevantIndices.has(idx));
      console.log(`[Image] ${imagesToProcess.length}/${searchResults.length} images are relevant`);
    }

    let saved = 0;
    for (const image of imagesToProcess) {
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

    // Update project counts
    await supabase.from('projects').update({
      image_count: saved,
    }).eq('id', projectId);

    console.log(`[Image] Done: ${saved} images`);
    return { success: true, count: saved };

  } catch (e: any) {
    console.error(`[Image] Fatal: ${e.message}`);
    return { success: false, error: e.message };
  }
}
