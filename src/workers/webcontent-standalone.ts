// WEB CONTENT WORKER - Standalone Service (Port 3003)
// Searches ANY website → Takes screenshots using Playwright
// News, blogs, databases, forums, reports, etc.

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const PORT = process.env.WEBCONTENT_WORKER_PORT || 3003;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let browser: Browser | null = null;

// Initialize browser on startup
async function initBrowser() {
  if (!browser) {
    console.log('[WebContent] Launching Playwright browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('[WebContent] Browser ready');
  }
  return browser;
}

// ============================================
// SCREENSHOT FUNCTION
// ============================================

async function takeScreenshot(url: string, outputPath: string): Promise<boolean> {
  try {
    const b = await initBrowser();
    const page = await b.newPage();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: outputPath,
      fullPage: false,
      type: 'jpeg',
      quality: 85
    });

    await page.close();
    return true;
  } catch (e: any) {
    console.log(`[WebContent] Screenshot failed for ${url}: ${e.message}`);
    return false;
  }
}

// Upload screenshot to Supabase
async function uploadScreenshot(filePath: string, storagePath: string): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(filePath);

    const { error } = await supabase.storage
      .from('mediamind')
      .upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: true });

    if (error) return null;

    const { data: { publicUrl } } = supabase.storage.from('mediamind').getPublicUrl(storagePath);

    fs.unlinkSync(filePath);
    return publicUrl;
  } catch (e) {
    return null;
  }
}

// ============================================
// SEARCH SOURCES
// ============================================

// 1. News Search
async function searchNews(topic: string, queries: string[]) {
  console.log('[WebContent] Searching news...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const response = await axios.post('https://google.serper.dev/news',
        { q: query, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const item of response.data?.news || []) {
        results.push({
          url: item.link,
          title: item.title,
          source: item.source || new URL(item.link).hostname,
          snippet: item.snippet,
          date: item.date,
          type: 'news',
        });
      }
    } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
  }

  console.log(`[WebContent] News found: ${results.length}`);
  return results;
}

// 2. Historical Newspapers
async function searchHistoricalNewspapers(topic: string, queries: string[]) {
  console.log('[WebContent] Searching historical newspapers...');
  const results: any[] = [];

  const sources = [
    { site: 'chroniclingamerica.loc.gov', name: 'Library of Congress' },
    { site: 'newspapers.com', name: 'Newspapers.com' },
  ];

  for (const source of sources) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const response = await axios.post('https://google.serper.dev/search',
          { q: `site:${source.site} "${query}"`, num: 20 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: source.name,
            snippet: item.snippet,
            type: 'newspaper',
          });
        }
      } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
    }
  }

  console.log(`[WebContent] Historical newspapers found: ${results.length}`);
  return results;
}

// 3. Blogs & Articles
async function searchBlogsAndArticles(topic: string, queries: string[]) {
  console.log('[WebContent] Searching blogs & articles...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const response = await axios.post('https://google.serper.dev/search',
        { q: `"${query}" blog OR article OR report OR analysis`, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const item of response.data?.organic || []) {
        const domain = new URL(item.link).hostname.replace('www.', '');
        results.push({
          url: item.link,
          title: item.title,
          source: domain,
          snippet: item.snippet,
          type: 'article',
        });
      }
    } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
  }

  console.log(`[WebContent] Blogs/articles found: ${results.length}`);
  return results;
}

// 4. Authoritative Sources
async function searchAuthoritativeSources(topic: string, queries: string[]) {
  console.log('[WebContent] Searching authoritative sources...');
  const results: any[] = [];

  const authSites = [
    'history.com',
    'britannica.com',
    'wikipedia.org',
    'bbc.com',
    'cnn.com',
    'nytimes.com',
    'theguardian.com',
  ];

  for (const site of authSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const response = await axios.post('https://google.serper.dev/search',
          { q: `site:${site} "${query}"`, num: 10 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          // Filter junk URLs
          if (item.link.includes('/search?') || item.link.includes('/this-day-in-history/')) continue;

          results.push({
            url: item.link,
            title: item.title,
            source: site.split('.')[0],
            snippet: item.snippet,
            type: 'authoritative',
          });
        }
      } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
    }
  }

  console.log(`[WebContent] Authoritative sources found: ${results.length}`);
  return results;
}

// 5. Topic-specific sites (will be expanded based on topic type)
async function searchTopicSpecificSites(topic: string, queries: string[], topicType: string) {
  console.log(`[WebContent] Searching topic-specific sites for ${topicType}...`);
  const results: any[] = [];

  // Site mappings by topic type
  const siteMappings: Record<string, string[]> = {
    'real_estate': ['zillow.com', 'realtor.com', 'redfin.com', 'trulia.com'],
    'finance': ['bloomberg.com', 'yahoo.com/finance', 'marketwatch.com', 'investopedia.com'],
    'crime': ['fbi.gov', 'justice.gov', 'courtlistener.com'],
    'celebrity': ['imdb.com', 'tmz.com', 'people.com'],
    'history': ['history.com', 'historynet.com', 'worldhistory.org'],
    'horror': ['imdb.com', 'rottentomatoes.com', 'bloody-disgusting.com'],
  };

  const sites = siteMappings[topicType] || [];

  for (const site of sites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const response = await axios.post('https://google.serper.dev/search',
          { q: `site:${site} "${query}"`, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: site.split('.')[0],
            snippet: item.snippet,
            type: 'topic_specific',
          });
        }
      } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
    }
  }

  console.log(`[WebContent] Topic-specific found: ${results.length}`);
  return results;
}

// ============================================
// MAIN SEARCH ENDPOINT
// ============================================

app.post('/search', async (req, res) => {
  const { projectId, topic, queries, topicType, takeScreenshots = true } = req.body;

  if (!topic) {
    return res.status(400).json({ error: 'Topic required' });
  }

  const searchQueries = queries || [topic];
  console.log(`\n[WebContent Worker] Starting search for "${topic}"`);
  console.log(`[WebContent Worker] Queries: ${searchQueries.join(', ')}`);

  try {
    // Search all sources in parallel
    const [news, newspapers, blogs, authoritative, topicSpecific] = await Promise.all([
      searchNews(topic, searchQueries),
      searchHistoricalNewspapers(topic, searchQueries),
      searchBlogsAndArticles(topic, searchQueries),
      searchAuthoritativeSources(topic, searchQueries),
      searchTopicSpecificSites(topic, searchQueries, topicType || 'general'),
    ]);

    // Combine and deduplicate
    const allResults = [...news, ...newspapers, ...blogs, ...authoritative, ...topicSpecific];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    console.log(`[WebContent Worker] Total unique pages: ${unique.length}`);

    // Take screenshots and save to Supabase
    if (projectId && takeScreenshots) {
      const tempDir = `/tmp/mediamind/${projectId}/screenshots`;
      fs.mkdirSync(tempDir, { recursive: true });

      let saved = 0;
      const maxScreenshots = 100; // Limit screenshots

      for (const page of unique.slice(0, maxScreenshots)) {
        try {
          const contentId = uuidv4();
          const screenshotPath = path.join(tempDir, `${contentId}.jpg`);

          const success = await takeScreenshot(page.url, screenshotPath);

          let hostedUrl = page.url;
          if (success) {
            const storagePath = `webcontent/${projectId}/${contentId}.jpg`;
            const uploadedUrl = await uploadScreenshot(screenshotPath, storagePath);
            if (uploadedUrl) hostedUrl = uploadedUrl;
          }

          await supabase.from('media').insert({
            id: contentId,
            project_id: projectId,
            type: page.type === 'newspaper' ? 'newspaper_scan' : 'article_screenshot',
            title: page.title,
            source: page.source,
            source_url: page.url,
            hosted_url: hostedUrl,
            metadata: { snippet: page.snippet, date: page.date, type: page.type },
          });

          saved++;
          console.log(`[WebContent] Saved ${saved}/${maxScreenshots}: ${page.source}`);
        } catch (e: any) { console.error(`[WebContent] Error: ${e.message}`); }
      }

      console.log(`[WebContent Worker] Saved ${saved} screenshots to database`);

      // Cleanup
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }

    res.json({ success: true, count: unique.length, results: unique });
  } catch (error: any) {
    console.error(`[WebContent Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', worker: 'webcontent', port: PORT });
});

// Initialize browser on startup
initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  WEB CONTENT WORKER running on port ${PORT}`);
    console.log(`========================================\n`);
  });
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});
