// WEB CONTENT WORKER - Standalone Service (Port 3003)
// Searches: 30+ web sources using SearXNG → Takes screenshots
import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { searchWeb, searchNews, searchSite } from '../utils/searxng.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.WEBCONTENT_WORKER_PORT || 3003;
app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let browser = null;
let browserError = null;
// Initialize browser on startup
async function initBrowser() {
    if (!browser) {
        console.log('[WebContent] Launching Playwright browser...');
        try {
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
            browserError = null;
            console.log('[WebContent] Browser ready');
        }
        catch (error) {
            browserError = error.message;
            console.error('[WebContent] Failed to launch browser:', error.message);
            throw error;
        }
    }
    return browser;
}
// ============================================
// COOKIE/POPUP/PAYWALL HANDLING
// ============================================
// Domains known to have hard paywalls - skip screenshot
const PAYWALL_DOMAINS = [
    'wsj.com', 'ft.com', 'economist.com', 'barrons.com', 'telegraph.co.uk',
    'thetimes.co.uk', 'washingtonpost.com', 'nytimes.com', 'bostonglobe.com',
    'latimes.com', 'chicagotribune.com', 'theathletic.com', 'hbr.org'
];
function hasPaywall(url) {
    try {
        const domain = new URL(url).hostname.replace('www.', '');
        return PAYWALL_DOMAINS.some(pw => domain.includes(pw));
    }
    catch {
        return false;
    }
}
async function dismissCookiePopups(page) {
    // Comprehensive list of cookie/consent selectors
    const dismissSelectors = [
        // Accept buttons
        'button[id*="accept"]', 'button[class*="accept"]', 'button[class*="consent"]',
        'button:has-text("Accept")', 'button:has-text("Accept All")', 'button:has-text("Accept all")',
        'button:has-text("Accept Cookies")', 'button:has-text("Accept cookies")',
        'button:has-text("I Agree")', 'button:has-text("I agree")', 'button:has-text("Agree")',
        'button:has-text("OK")', 'button:has-text("Got it")', 'button:has-text("Allow")',
        'button:has-text("Allow All")', 'button:has-text("Allow all")',
        'button:has-text("Continue")', 'button:has-text("Confirm")',
        'button:has-text("Yes")', 'button:has-text("Understood")',
        // Common cookie banner IDs/classes
        '#onetrust-accept-btn-handler', '#accept-cookies', '#cookie-accept',
        '#gdpr-accept', '#consent-accept', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '.cc-accept', '.cc-dismiss', '.cc-btn', '.cookie-accept', '.gdpr-accept',
        '[data-testid="cookie-accept"]', '[data-action="accept"]',
        // Close buttons on modals
        '[aria-label="Close"]', '[aria-label="Dismiss"]', '[aria-label="close"]',
        'button[class*="close"]', '.modal-close', '.popup-close', '.overlay-close',
        // Newsletter/subscription popups
        'button:has-text("No thanks")', 'button:has-text("Not now")', 'button:has-text("Maybe later")',
        'button:has-text("Skip")', 'button:has-text("Dismiss")', 'button:has-text("Close")',
        '.newsletter-close', '.popup-dismiss', '.modal-dismiss',
        // Age verification
        'button:has-text("I am over 18")', 'button:has-text("Enter")', 'button:has-text("Yes, I am")',
    ];
    for (const selector of dismissSelectors) {
        try {
            const element = await page.$(selector);
            if (element && await element.isVisible()) {
                await element.click();
                await page.waitForTimeout(200);
            }
        }
        catch (e) { /* ignore */ }
    }
    // Also try to hide common overlay elements via JavaScript injection
    try {
        await page.addScriptTag({
            content: `
        (function() {
          var overlays = document.querySelectorAll(
            '[class*="cookie"], [class*="consent"], [class*="gdpr"], [class*="modal"], ' +
            '[class*="popup"], [class*="overlay"], [id*="cookie"], [id*="consent"], ' +
            '[id*="gdpr"], [id*="modal"], [id*="popup"]'
          );
          overlays.forEach(function(el) {
            if (el.style) {
              el.style.display = 'none';
              el.style.visibility = 'hidden';
            }
          });
          document.querySelectorAll('[style*="position: fixed"]').forEach(function(el) {
            var text = (el.innerText || '').toLowerCase();
            if (text.indexOf('cookie') >= 0 || text.indexOf('privacy') >= 0 || text.indexOf('consent') >= 0 ||
                text.indexOf('subscribe') >= 0 || text.indexOf('newsletter') >= 0) {
              el.style.display = 'none';
            }
          });
        })();
      `
        });
    }
    catch (e) { /* ignore */ }
}
// ============================================
// SCREENSHOT FUNCTION
// ============================================
async function takeScreenshot(url, outputPath) {
    // Skip known paywall sites
    if (hasPaywall(url)) {
        console.log(`[WebContent] Skipping paywall site: ${url}`);
        return false;
    }
    try {
        const b = await initBrowser();
        const page = await b.newPage();
        // Set a realistic user agent
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        // Wait for page to render
        await page.waitForTimeout(2000);
        // Dismiss cookie popups (first pass)
        await dismissCookiePopups(page);
        await page.waitForTimeout(500);
        // Scroll down slightly to trigger lazy loading and then back up
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(500);
        await page.mouse.wheel(0, -300);
        // Dismiss any popups that appeared after scrolling
        await dismissCookiePopups(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: outputPath, fullPage: false, type: 'jpeg', quality: 85 });
        await page.close();
        return true;
    }
    catch (e) {
        console.log(`[WebContent] Screenshot failed for ${url}: ${e.message}`);
        return false;
    }
}
async function uploadScreenshot(filePath, storagePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const { error } = await supabase.storage.from('mediamind').upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: true });
        if (error)
            return null;
        const { data: { publicUrl } } = supabase.storage.from('mediamind').getPublicUrl(storagePath);
        fs.unlinkSync(filePath);
        return publicUrl;
    }
    catch (e) {
        return null;
    }
}
// ============================================
// SEARCH SOURCES (Using SearXNG)
// ============================================
// 1. News Search
async function searchNewsArticles(topic, queries) {
    console.log('[WebContent] Searching news...');
    const results = [];
    for (const query of queries) {
        try {
            const searchResults = await searchNews(query, 40);
            for (const item of searchResults) {
                results.push({
                    url: item.url,
                    title: item.title,
                    source: item.engine || 'news',
                    snippet: item.content,
                    date: item.publishedDate,
                    type: 'news',
                });
            }
        }
        catch (e) {
            console.error(`[WebContent] News error: ${e.message}`);
        }
    }
    console.log(`[WebContent] News found: ${results.length}`);
    return results;
}
// 2. Historical Newspapers
async function searchHistoricalNewspapers(topic, queries) {
    console.log('[WebContent] Searching historical newspapers...');
    const results = [];
    const sources = [
        { site: 'chroniclingamerica.loc.gov', name: 'Library of Congress' },
        { site: 'newspapers.com', name: 'Newspapers.com' },
        { site: 'news.google.com/newspapers', name: 'Google News Archive' },
        { site: 'trove.nla.gov.au/newspaper', name: 'Trove Australia' },
        { site: 'britishnewspaperarchive.co.uk', name: 'British Newspaper Archive' },
    ];
    for (const source of sources) {
        for (const query of queries.slice(0, 2)) {
            try {
                const searchResults = await searchSite(source.site, query, 20);
                for (const item of searchResults) {
                    results.push({
                        url: item.url,
                        title: item.title,
                        source: source.name,
                        snippet: item.content,
                        type: 'newspaper',
                    });
                }
            }
            catch (e) {
                console.error(`[WebContent] Newspaper (${source.name}) error: ${e.message}`);
            }
        }
    }
    console.log(`[WebContent] Historical newspapers found: ${results.length}`);
    return results;
}
// 3. Authoritative Sources
async function searchAuthoritativeSources(topic, queries) {
    console.log('[WebContent] Searching authoritative sources...');
    const results = [];
    const authSites = [
        // Reference
        'wikipedia.org', 'britannica.com', 'history.com',
        // Major News
        'bbc.com', 'cnn.com', 'nytimes.com', 'theguardian.com', 'reuters.com',
        'apnews.com', 'npr.org', 'washingtonpost.com', 'theatlantic.com',
        // International News
        'aljazeera.com', 'dw.com', 'france24.com', 'abc.net.au',
        // US News
        'usatoday.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'foxnews.com',
        'politico.com', 'axios.com', 'thehill.com', 'vox.com',
        // UK News
        'independent.co.uk', 'mirror.co.uk', 'dailymail.co.uk', 'express.co.uk',
        // Business/Finance News
        'bloomberg.com', 'cnbc.com', 'forbes.com', 'businessinsider.com',
        // Tech News
        'wired.com', 'theverge.com', 'arstechnica.com',
        // Magazine/Long-form
        'newyorker.com', 'time.com', 'newsweek.com', 'rollingstone.com',
    ];
    for (const site of authSites) {
        for (const query of queries.slice(0, 2)) {
            try {
                const searchResults = await searchSite(site, query, 10);
                for (const item of searchResults) {
                    if (item.url.includes('/search?'))
                        continue;
                    results.push({
                        url: item.url,
                        title: item.title,
                        source: site.split('.')[0],
                        snippet: item.content,
                        type: 'authoritative',
                    });
                }
            }
            catch (e) {
                console.error(`[WebContent] Auth source (${site}) error: ${e.message}`);
            }
        }
    }
    console.log(`[WebContent] Authoritative sources found: ${results.length}`);
    return results;
}
// 4. Blogs & Articles
async function searchBlogsAndArticles(topic, queries) {
    console.log('[WebContent] Searching blogs & articles...');
    const results = [];
    for (const query of queries) {
        try {
            const searchResults = await searchWeb(`${query} blog article analysis report`, 40);
            for (const item of searchResults) {
                const domain = new URL(item.url).hostname.replace('www.', '');
                results.push({
                    url: item.url,
                    title: item.title,
                    source: domain,
                    snippet: item.content,
                    type: 'article',
                });
            }
        }
        catch (e) {
            console.error(`[WebContent] Blogs/articles error: ${e.message}`);
        }
    }
    console.log(`[WebContent] Blogs/articles found: ${results.length}`);
    return results;
}
// 5. Topic-specific sites
async function searchTopicSpecificSites(topic, queries, topicType) {
    console.log(`[WebContent] Searching topic-specific sites for ${topicType}...`);
    const results = [];
    const siteMappings = {
        'crime': [
            { site: 'fbi.gov', name: 'FBI' },
            { site: 'justice.gov', name: 'DOJ' },
            { site: 'courtlistener.com', name: 'CourtListener' },
        ],
        'celebrity': [
            { site: 'imdb.com', name: 'IMDb' },
            { site: 'people.com', name: 'People' },
            { site: 'biography.com', name: 'Biography' },
        ],
        'history': [
            { site: 'history.com', name: 'History' },
            { site: 'historynet.com', name: 'HistoryNet' },
            { site: 'worldhistory.org', name: 'World History' },
        ],
        'sports': [
            { site: 'espn.com', name: 'ESPN' },
            { site: 'sports-reference.com', name: 'Sports Reference' },
        ],
        'military': [
            { site: 'defense.gov', name: 'DoD' },
            { site: 'militarytimes.com', name: 'Military Times' },
        ],
        'science': [
            { site: 'nasa.gov', name: 'NASA' },
            { site: 'nature.com', name: 'Nature' },
        ],
    };
    const sites = siteMappings[topicType] || [];
    for (const siteObj of sites) {
        for (const query of queries.slice(0, 2)) {
            try {
                const searchResults = await searchSite(siteObj.site, query, 15);
                for (const item of searchResults) {
                    results.push({
                        url: item.url,
                        title: item.title,
                        source: siteObj.name,
                        snippet: item.content,
                        type: 'topic_specific',
                    });
                }
            }
            catch (e) {
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
    console.log(`[WebContent Worker] Using SearXNG (unlimited searches)`);
    try {
        // Search all sources in parallel
        const [news, newspapers, authoritative, blogs, topicSpecific] = await Promise.all([
            searchNewsArticles(topic, searchQueries),
            searchHistoricalNewspapers(topic, searchQueries),
            searchAuthoritativeSources(topic, searchQueries),
            searchBlogsAndArticles(topic, searchQueries),
            searchTopicSpecificSites(topic, searchQueries, topicType || 'general'),
        ]);
        // Combine and deduplicate
        const allResults = [...news, ...newspapers, ...authoritative, ...blogs, ...topicSpecific];
        const unique = allResults.filter((item, index, self) => index === self.findIndex(t => t.url === item.url));
        console.log(`[WebContent Worker] Total unique pages: ${unique.length}`);
        console.log(`[WebContent Worker] Breakdown: News=${news.length}, Newspapers=${newspapers.length}, Authoritative=${authoritative.length}, Blogs=${blogs.length}, TopicSpecific=${topicSpecific.length}`);
        // Take screenshots and save to Supabase
        if (projectId && takeScreenshots) {
            const tempDir = `/tmp/mediamind/${projectId}/screenshots`;
            fs.mkdirSync(tempDir, { recursive: true });
            let saved = 0;
            const maxScreenshots = 100;
            for (const page of unique.slice(0, maxScreenshots)) {
                try {
                    const contentId = uuidv4();
                    const screenshotPath = path.join(tempDir, `${contentId}.jpg`);
                    const success = await takeScreenshot(page.url, screenshotPath);
                    let hostedUrl = page.url;
                    if (success) {
                        const storagePath = `webcontent/${projectId}/${contentId}.jpg`;
                        const uploadedUrl = await uploadScreenshot(screenshotPath, storagePath);
                        if (uploadedUrl)
                            hostedUrl = uploadedUrl;
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
                }
                catch (e) { /* skip */ }
            }
            console.log(`[WebContent Worker] Saved ${saved} screenshots to database`);
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
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
    }
    catch (error) {
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
        search_engine: 'SearXNG (self-hosted)',
    });
});
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  WEB CONTENT WORKER running on port ${PORT}`);
    console.log(`  Search Engine: SearXNG (unlimited)`);
    console.log(`  Sources: 30+ across 5 categories`);
    console.log(`========================================\n`);
    initBrowser().catch(err => {
        console.error('[WebContent] Browser initialization failed, will retry on first request');
    });
});
process.on('SIGINT', async () => {
    if (browser)
        await browser.close();
    process.exit();
});
//# sourceMappingURL=webcontent-standalone.js.map