// MediaMind News Worker - Simplified (No Playwright required)
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { searchWebForNews, searchHistoricalNewspapers } from '../services/web-search.js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
export async function processNewsResearch(projectId, topic, maxResults) {
    console.log(`\n[News] Starting: "${topic}"`);
    let saved = 0;
    try {
        // Historical newspapers (from Serper -> Archive.org/LOC)
        const newspapers = await searchHistoricalNewspapers(topic, Math.ceil(maxResults / 2));
        console.log(`[News] Found ${newspapers.length} newspapers`);
        for (const paper of newspapers) {
            if (saved >= maxResults)
                break;
            try {
                const newsId = uuidv4();
                await supabase.from('media').insert({
                    id: newsId,
                    project_id: projectId,
                    type: 'newspaper_scan',
                    title: paper.title,
                    source: paper.source,
                    source_url: paper.url,
                    hosted_url: paper.imageUrl || paper.url, // Use image URL if available
                    metadata: {
                        date: paper.date,
                        snippet: paper.snippet,
                    },
                });
                saved++;
                console.log(`[News] Saved newspaper ${saved}: ${paper.title?.slice(0, 40)}...`);
            }
            catch (e) {
                console.error(`[News] Newspaper error: ${e.message}`);
            }
        }
        // Modern news articles
        const articles = await searchWebForNews(topic, maxResults);
        console.log(`[News] Found ${articles.length} articles`);
        for (const article of articles) {
            if (saved >= maxResults)
                break;
            try {
                const newsId = uuidv4();
                await supabase.from('media').insert({
                    id: newsId,
                    project_id: projectId,
                    type: 'article_screenshot', // We'll show it as article card
                    title: article.title,
                    source: article.source,
                    source_url: article.url,
                    hosted_url: article.url, // Link to original article
                    metadata: {
                        date: article.date,
                        snippet: article.snippet,
                        needs_screenshot: true, // Flag for later processing
                    },
                });
                saved++;
                console.log(`[News] Saved article ${saved}: ${article.source}`);
            }
            catch (e) {
                console.error(`[News] Article error: ${e.message}`);
            }
        }
        // Update project counts
        await supabase.from('projects').update({
            news_count: saved,
        }).eq('id', projectId);
        console.log(`[News] Done: ${saved} items`);
        return { success: true, count: saved };
    }
    catch (e) {
        console.error(`[News] Fatal: ${e.message}`);
        return { success: false, error: e.message };
    }
}
//# sourceMappingURL=news.worker.js.map