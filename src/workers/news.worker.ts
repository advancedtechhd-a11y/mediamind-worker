// MediaMind News Worker - Simplified
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForNews } from '../services/web-search.js';
import { searchHistoricalNewspapers } from '../services/newspapers.js';
import { takeScreenshot } from '../services/screenshot.js';
import { uploadToStorage, uploadFromUrl } from '../services/storage.js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/mediamind';

export async function processNewsResearch(projectId: string, topic: string, maxResults: number) {
  console.log(`\n[News] Starting: "${topic}"`);

  const jobDir = path.join(TEMP_DIR, `${projectId}_news`);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  let saved = 0;

  try {
    // Historical newspapers
    const newspapers = await searchHistoricalNewspapers(topic, Math.floor(maxResults / 3));
    console.log(`[News] Found ${newspapers.length} newspapers`);

    for (const paper of newspapers) {
      try {
        const newsId = uuidv4();
        const storagePath = `news/${projectId}/scans/${newsId}.jpg`;
        const hostedUrl = await uploadFromUrl(paper.url, storagePath);

        if (hostedUrl) {
          await supabase.from('media').insert({
            id: newsId,
            project_id: projectId,
            type: 'newspaper_scan',
            title: paper.title,
            source: paper.source,
            source_url: paper.url,
            hosted_url: hostedUrl,
            storage_path: storagePath,
            metadata: { date: paper.date, publication: paper.publication },
          });
          saved++;
          console.log(`[News] Saved newspaper: ${paper.title?.slice(0, 40)}`);
        }
      } catch (e: any) {
        console.error(`[News] Newspaper error: ${e.message}`);
      }
    }

    // Modern articles - screenshots
    const articles = await searchWebForNews(topic, maxResults);
    console.log(`[News] Found ${articles.length} articles`);

    for (const article of articles.slice(0, Math.ceil(maxResults * 0.6))) {
      if (saved >= maxResults) break;

      try {
        const newsId = uuidv4();
        const screenshotPath = path.join(jobDir, `${newsId}.png`);

        const success = await takeScreenshot(article.url, screenshotPath);
        if (success && fs.existsSync(screenshotPath)) {
          const storagePath = `news/${projectId}/screenshots/${newsId}.png`;
          const hostedUrl = await uploadToStorage(screenshotPath, storagePath);

          if (hostedUrl) {
            await supabase.from('media').insert({
              id: newsId,
              project_id: projectId,
              type: 'article_screenshot',
              title: article.title,
              description: article.snippet,
              source: article.source,
              source_url: article.url,
              hosted_url: hostedUrl,
              storage_path: storagePath,
              metadata: { date: article.date, captured_at: new Date().toISOString() },
            });
            saved++;
            console.log(`[News] Saved screenshot: ${article.source}`);
          }
          fs.unlinkSync(screenshotPath);
        }
      } catch (e: any) {
        console.error(`[News] Screenshot error: ${e.message}`);
      }
    }

    // Cleanup
    try { fs.rmSync(jobDir, { recursive: true }); } catch(e) {}

    console.log(`[News] Done: ${saved} items`);
    return { success: true, count: saved };

  } catch (e: any) {
    console.error(`[News] Fatal: ${e.message}`);
    return { success: false, error: e.message };
  }
}
