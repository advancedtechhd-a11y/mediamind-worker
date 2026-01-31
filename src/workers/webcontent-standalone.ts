// WEB CONTENT WORKER - Standalone Service (Port 3003)
// Searches: 30+ web sources → Takes screenshots using Playwright

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { chromium, Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.WEBCONTENT_WORKER_PORT || 3003;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load sources config
let sourcesConfig: any = null;
try {
  const configPath = path.join(__dirname, '../config/sources.json');
  sourcesConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log('[WebContent] Loaded sources config');
} catch (e) {
  console.log('[WebContent] Config not found, using defaults');
}

let browser: Browser | null = null;
let browserError: string | null = null;

// Initialize browser on startup
async function initBrowser() {
  if (!browser) {
    console.log('[WebContent] Launching Playwright browser...');
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
      browserError = null;
      console.log('[WebContent] Browser ready');
    } catch (error: any) {
      browserError = error.message;
      console.error('[WebContent] Failed to launch browser:', error.message);
      console.error('[WebContent] Full error:', error);
      throw error;
    }
  }
  return browser;
}

// ============================================
// COOKIE/POPUP DISMISSAL
// ============================================

async function dismissCookiePopups(page: any): Promise<void> {
  // Common cookie consent button selectors
  const dismissSelectors = [
    // Cookie consent - Accept buttons
    'button[id*="accept"]',
    'button[id*="cookie"]',
    'button[class*="accept"]',
    'button[class*="consent"]',
    'button[class*="agree"]',
    '[class*="cookie"] button',
    '[class*="consent"] button',
    '[class*="gdpr"] button',
    '[id*="cookie"] button',
    '[id*="consent"] button',
    // Common text matches
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("I Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Agree")',
    'button:has-text("OK")',
    'button:has-text("Got it")',
    'button:has-text("Allow")',
    'button:has-text("Allow All")',
    'button:has-text("Continue")',
    'button:has-text("Reject Non-Essential")',
    // Links that dismiss
    'a:has-text("Accept")',
    'a:has-text("I Accept")',
    // Close buttons on modals
    '[class*="modal"] [class*="close"]',
    '[class*="popup"] [class*="close"]',
    '[class*="banner"] [class*="close"]',
    '[class*="notice"] [class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="Dismiss"]',
    'button[class*="close"]',
    // Specific common frameworks
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    '.cc-accept',
    '.cc-dismiss',
    '#cookieConsent button',
    '.cookie-notice button',
    '.privacy-notice button',
    // Additional common patterns
    '[data-testid="cookie-accept"]',
    '[data-cy="cookie-accept"]',
    '.accept-cookies',
    '.cookie-accept',
    '#accept-cookies',
    '.js-accept-cookies',
    '.cookie-bar__button',
    '.cookie-banner__button',
    '#cookie-accept-btn',
    '.gdpr-accept',
    '#gdpr-accept',
  ];

  for (const selector of dismissSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await page.waitForTimeout(300);
      }
    } catch (e) {
      // Ignore - button might not exist or be clickable
    }
  }
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
    await page.waitForTimeout(1500);

    // Dismiss cookie popups and banners
    await dismissCookiePopups(page);
    await page.waitForTimeout(500);

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
    } catch (e: any) { console.error(`[WebContent] News error: ${e.message}`); }
  }

  console.log(`[WebContent] News found: ${results.length}`);
  return results;
}

// 2. Historical Newspapers (Expanded)
async function searchHistoricalNewspapers(topic: string, queries: string[]) {
  console.log('[WebContent] Searching historical newspapers...');
  const results: any[] = [];

  const sources = sourcesConfig?.webcontent?.historical_newspapers || [
    { site: 'chroniclingamerica.loc.gov', name: 'Library of Congress' },
    { site: 'newspapers.com', name: 'Newspapers.com' },
    { site: 'news.google.com/newspapers', name: 'Google News Archive' },
    { site: 'newspaperarchive.com', name: 'Newspaper Archive' },
    { site: 'britishnewspaperarchive.co.uk', name: 'British Newspaper Archive' },
    { site: 'trove.nla.gov.au/newspaper', name: 'Trove Australia' },
    { site: 'fultonhistory.com', name: 'Fulton History NY' },
    { site: 'cdnc.ucr.edu', name: 'California Digital Newspaper' },
  ];

  for (const source of sources) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `site:${source.site} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 20 },
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
      } catch (e: any) {
        console.error(`[WebContent] Newspaper (${source.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[WebContent] Historical newspapers found: ${results.length}`);
  return results;
}

// 3. Authoritative Sources (Expanded)
async function searchAuthoritativeSources(topic: string, queries: string[]) {
  console.log('[WebContent] Searching authoritative sources...');
  const results: any[] = [];

  const authSites = sourcesConfig?.webcontent?.authoritative?.map((s: any) => s.site) || [
    'wikipedia.org',
    'britannica.com',
    'history.com',
    'bbc.com',
    'cnn.com',
    'nytimes.com',
    'theguardian.com',
    'reuters.com',
    'apnews.com',
    'npr.org',
    'washingtonpost.com',
    'theatlantic.com',
  ];

  for (const site of authSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `site:${site} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 10 },
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
      } catch (e: any) {
        console.error(`[WebContent] Auth source (${site}) error: ${e.message}`);
      }
    }
  }

  console.log(`[WebContent] Authoritative sources found: ${results.length}`);
  return results;
}

// 4. Blogs & Articles
async function searchBlogsAndArticles(topic: string, queries: string[]) {
  console.log('[WebContent] Searching blogs & articles...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const searchQuery = `${query} blog OR article OR report OR analysis`;
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 30 },
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
    } catch (e: any) {
      console.error(`[WebContent] Blogs/articles error: ${e.message}`);
    }
  }

  console.log(`[WebContent] Blogs/articles found: ${results.length}`);
  return results;
}

// 5. Topic-specific sites (based on topic type)
async function searchTopicSpecificSites(topic: string, queries: string[], topicType: string) {
  console.log(`[WebContent] Searching topic-specific sites for ${topicType}...`);
  const results: any[] = [];

  // Get site mappings from config or use defaults
  const configNiche = sourcesConfig?.webcontent?.niche_specific?.[topicType];

  const defaultSiteMappings: Record<string, {site: string, name: string}[]> = {
    'real_estate': [
      { site: 'zillow.com', name: 'Zillow' },
      { site: 'realtor.com', name: 'Realtor' },
      { site: 'redfin.com', name: 'Redfin' },
      { site: 'trulia.com', name: 'Trulia' },
    ],
    'finance': [
      { site: 'bloomberg.com', name: 'Bloomberg' },
      { site: 'marketwatch.com', name: 'MarketWatch' },
      { site: 'investopedia.com', name: 'Investopedia' },
      { site: 'wsj.com', name: 'WSJ' },
    ],
    'crime': [
      { site: 'fbi.gov', name: 'FBI' },
      { site: 'justice.gov', name: 'DOJ' },
      { site: 'courtlistener.com', name: 'CourtListener' },
      { site: 'law.cornell.edu', name: 'Cornell Law' },
    ],
    'celebrity': [
      { site: 'imdb.com', name: 'IMDb' },
      { site: 'people.com', name: 'People' },
      { site: 'biography.com', name: 'Biography' },
      { site: 'eonline.com', name: 'E! News' },
    ],
    'history': [
      { site: 'history.com', name: 'History' },
      { site: 'historynet.com', name: 'HistoryNet' },
      { site: 'worldhistory.org', name: 'World History' },
    ],
    'horror': [
      { site: 'bloody-disgusting.com', name: 'Bloody Disgusting' },
      { site: 'dreadcentral.com', name: 'Dread Central' },
      { site: 'imdb.com', name: 'IMDb' },
    ],
    'sports': [
      { site: 'espn.com', name: 'ESPN' },
      { site: 'sports-reference.com', name: 'Sports Reference' },
      { site: 'bleacherreport.com', name: 'Bleacher Report' },
    ],
    'military': [
      { site: 'defense.gov', name: 'DoD' },
      { site: 'militarytimes.com', name: 'Military Times' },
      { site: 'warhistoryonline.com', name: 'War History' },
    ],
    'science': [
      { site: 'nasa.gov', name: 'NASA' },
      { site: 'nature.com', name: 'Nature' },
      { site: 'scientificamerican.com', name: 'Scientific American' },
    ],
  };

  const sites = configNiche || defaultSiteMappings[topicType] || [];

  for (const siteObj of sites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `site:${siteObj.site} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: siteObj.name,
            snippet: item.snippet,
            type: 'topic_specific',
          });
        }
      } catch (e: any) {
        console.error(`[WebContent] Topic-specific (${siteObj.site}) error: ${e.message}`);
      }
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
  console.log(`[WebContent Worker] Searching 30+ sources...`);

  try {
    // Search all sources in parallel
    const [news, newspapers, authoritative, blogs, topicSpecific] = await Promise.all([
      searchNews(topic, searchQueries),
      searchHistoricalNewspapers(topic, searchQueries),
      searchAuthoritativeSources(topic, searchQueries),
      searchBlogsAndArticles(topic, searchQueries),
      searchTopicSpecificSites(topic, searchQueries, topicType || 'general'),
    ]);

    // Combine and deduplicate
    const allResults = [...news, ...newspapers, ...authoritative, ...blogs, ...topicSpecific];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    console.log(`[WebContent Worker] Total unique pages: ${unique.length}`);
    console.log(`[WebContent Worker] By type: News=${news.length}, Newspapers=${newspapers.length}, Authoritative=${authoritative.length}, Blogs=${blogs.length}, TopicSpecific=${topicSpecific.length}`);

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

    res.json({
      success: true,
      count: unique.length,
      results: unique,
      breakdown: {
        news: news.length,
        newspapers: newspapers.length,
        authoritative: authoritative.length,
        blogs: blogs.length,
        topic_specific: topicSpecific.length,
      }
    });
  } catch (error: any) {
    console.error(`[WebContent Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: browser ? 'ok' : 'degraded',
    worker: 'webcontent',
    port: PORT,
    browser_ready: !!browser,
    browser_error: browserError,
    sources_loaded: !!sourcesConfig,
    total_sources: sourcesConfig ? '30+' : 'defaults',
  });
});

// Start server first, then try to initialize browser
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  WEB CONTENT WORKER running on port ${PORT}`);
  console.log(`  Sources: 30+ across 5 categories`);
  console.log(`========================================\n`);

  // Initialize browser after server starts
  initBrowser().catch(err => {
    console.error('[WebContent] Browser initialization failed, will retry on first request');
  });
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});
