// MediaMind News Worker - With Playwright Screenshots
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { chromium } from 'playwright';
import { searchWebForNews, searchHistoricalNewspapers } from '../services/web-search.js';
import * as fs from 'fs';
import * as path from 'path';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
// Take screenshot of a URL
async function takeScreenshot(browser, url, outputPath) {
    const page = await browser.newPage();
    try {
        // Set viewport for consistent screenshots
        await page.setViewportSize({ width: 1280, height: 800 });
        // Navigate with timeout
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });
        // Wait a bit for content to load
        await page.waitForTimeout(2000);
        // Take screenshot
        await page.screenshot({
            path: outputPath,
            fullPage: false, // Just viewport, not full page
            type: 'jpeg',
            quality: 85
        });
        return true;
    }
    catch (e) {
        console.error(`[News] Screenshot failed for ${url}: ${e.message}`);
        return false;
    }
    finally {
        await page.close();
    }
}
// Upload screenshot to Supabase
async function uploadScreenshot(filePath, storagePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const { error } = await supabase.storage
            .from('mediamind')
            .upload(storagePath, fileBuffer, {
            contentType: 'image/jpeg',
            upsert: true
        });
        if (error) {
            console.error(`[News] Upload error: ${error.message}`);
            return null;
        }
        const { data: { publicUrl } } = supabase.storage
            .from('mediamind')
            .getPublicUrl(storagePath);
        // Clean up local file
        fs.unlinkSync(filePath);
        return publicUrl;
    }
    catch (e) {
        console.error(`[News] Upload failed: ${e.message}`);
        return null;
    }
}
export async function processNewsResearch(projectId, topic, maxResults) {
    console.log(`\n[News] Starting: "${topic}"`);
    let saved = 0;
    let browser = null;
    // Create temp directory for screenshots
    const tempDir = `/tmp/mediamind/${projectId}/screenshots`;
    fs.mkdirSync(tempDir, { recursive: true });
    try {
        // Launch browser once for all screenshots
        console.log('[News] Launching browser...');
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('[News] Browser ready');
        // Historical newspapers (from Serper -> Archive.org/LOC)
        const newspapers = await searchHistoricalNewspapers(topic, Math.ceil(maxResults / 2));
        console.log(`[News] Found ${newspapers.length} newspapers`);
        for (const paper of newspapers) {
            if (saved >= maxResults)
                break;
            try {
                const newsId = uuidv4();
                let hostedUrl = paper.imageUrl || paper.url;
                // If no image URL, take screenshot
                if (!paper.imageUrl && browser) {
                    const screenshotPath = path.join(tempDir, `${newsId}.jpg`);
                    const success = await takeScreenshot(browser, paper.url, screenshotPath);
                    if (success) {
                        const storagePath = `news/${projectId}/${newsId}.jpg`;
                        const uploadedUrl = await uploadScreenshot(screenshotPath, storagePath);
                        if (uploadedUrl) {
                            hostedUrl = uploadedUrl;
                        }
                    }
                }
                await supabase.from('media').insert({
                    id: newsId,
                    project_id: projectId,
                    type: 'newspaper_scan',
                    title: paper.title,
                    source: paper.source,
                    source_url: paper.url,
                    hosted_url: hostedUrl,
                    storage_path: hostedUrl.includes('supabase') ? `news/${projectId}/${newsId}.jpg` : null,
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
                let hostedUrl = article.url;
                // Take screenshot of article
                if (browser) {
                    const screenshotPath = path.join(tempDir, `${newsId}.jpg`);
                    const success = await takeScreenshot(browser, article.url, screenshotPath);
                    if (success) {
                        const storagePath = `news/${projectId}/${newsId}.jpg`;
                        const uploadedUrl = await uploadScreenshot(screenshotPath, storagePath);
                        if (uploadedUrl) {
                            hostedUrl = uploadedUrl;
                            console.log(`[News] Screenshot saved: ${article.title?.slice(0, 30)}...`);
                        }
                    }
                }
                await supabase.from('media').insert({
                    id: newsId,
                    project_id: projectId,
                    type: 'article_screenshot',
                    title: article.title,
                    source: article.source,
                    source_url: article.url,
                    hosted_url: hostedUrl,
                    storage_path: hostedUrl.includes('supabase') ? `news/${projectId}/${newsId}.jpg` : null,
                    metadata: {
                        date: article.date,
                        snippet: article.snippet,
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
    finally {
        // Always close browser
        if (browser) {
            await browser.close();
            console.log('[News] Browser closed');
        }
        // Clean up temp directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        catch { }
    }
}
//# sourceMappingURL=news.worker.js.map