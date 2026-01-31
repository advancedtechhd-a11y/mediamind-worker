// VIDEO WORKER - Standalone Service (Port 3001)
// Searches: 50+ video sources from config file

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.VIDEO_WORKER_PORT || 3001;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load sources config
let sourcesConfig: any = null;
try {
  const configPath = path.join(__dirname, '../config/sources.json');
  sourcesConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log('[Video] Loaded sources config');
} catch (e) {
  console.log('[Video] Config not found, using defaults');
}

// Video file extensions to look for
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.ogg', '.avi', '.mov', '.mkv', '.m4v', '.flv', '.wmv', '.3gp', '.mpeg', '.mpg'];
const NON_VIDEO_EXTENSIONS = ['.pdf', '.txt', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.html', '.htm', '.wav', '.mp3', '.aac', '.flac'];

// Check if URL is likely a video
function isVideoUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Exclude non-video files
  if (NON_VIDEO_EXTENSIONS.some(ext => lowerUrl.endsWith(ext))) {
    return false;
  }

  // Include if has video extension
  if (VIDEO_EXTENSIONS.some(ext => lowerUrl.includes(ext))) {
    return true;
  }

  // Include known video platforms/patterns (be generous here)
  const videoPatterns = [
    'britishpathe.com',
    'c-span.org/video',
    'aparchive.com',
    'gettyimages.com/detail/video',
    'criticalpast.com',
    'footagefarm.com',
    'archive.org/details/',
    'commons.wikimedia.org/wiki/File:',
    'pexels.com/video',
    'pixabay.com/videos',
    'videvo.net',
    'coverr.co',
    'mixkit.co',
    'pond5.com',
    'shutterstock.com/video',
    'storyblocks.com/video',
    'artgrid.io',
    'itnsource.com',
    'historicfilms.com',
    'nbcnewsarchives.com',
    '/video/',
    '/watch/',
    '/play/',
    '/embed/',
    '/film/',
    '/footage/',
    '/clip/',
    'movingimage',
    'filmarchive',
    'newsreel',
  ];

  return videoPatterns.some(pattern => lowerUrl.includes(pattern));
}

// ============================================
// SEARCH SOURCES (Priority Order)
// ============================================

// 1. Archive.org (BEST - Public domain, downloadable)
async function searchArchiveOrg(topic: string, queries: string[]) {
  console.log('[Video] Searching Archive.org...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:movies&fl[]=identifier,title,description&sort[]=downloads+desc&rows=50&output=json`;

      const response = await axios.get(searchUrl, {
        headers: { 'User-Agent': 'MediaMind Research Bot/1.0' },
        timeout: 30000,
      });

      const docs = response.data?.response?.docs || [];

      for (const doc of docs.slice(0, 20)) {
        await delay(200);
        try {
          const meta = await axios.get(`https://archive.org/metadata/${doc.identifier}`, { timeout: 10000 });
          const files = meta.data?.files || [];
          const videoFile = files.find((f: any) =>
            f.name?.endsWith('.mp4') || f.name?.endsWith('.webm') || f.name?.endsWith('.ogv')
          );

          if (videoFile) {
            results.push({
              url: `https://archive.org/download/${doc.identifier}/${videoFile.name}`,
              title: doc.title || doc.identifier,
              source: 'archive.org',
              thumbnail: `https://archive.org/services/img/${doc.identifier}`,
              priority: 1,
              license: 'public_domain',
            });
          }
        } catch (e: any) { console.error(`[Video] Error: ${e.message}`); }
      }
    } catch (e: any) {
      console.log(`[Video] Archive.org query failed: ${e.message}`);
    }
  }

  console.log(`[Video] Archive.org found: ${results.length}`);
  return results;
}

// 2. Wikimedia Commons
async function searchWikimedia(topic: string, queries: string[]) {
  console.log('[Video] Searching Wikimedia...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      // Search specifically for video files on Wikimedia
      const searchQuery = `site:commons.wikimedia.org/wiki/File: ${query} filetype:ogv OR filetype:webm OR filetype:mp4`;
      console.log(`[Video] Wikimedia query: ${searchQuery}`);
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 20 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      for (const item of response.data?.organic || []) {
        // Only include actual video file pages
        const url = item.link.toLowerCase();
        if (url.includes('.ogv') || url.includes('.webm') || url.includes('.mp4') || url.includes('file:')) {
          results.push({
            url: item.link,
            title: item.title,
            source: 'wikimedia',
            priority: 1,
            license: 'creative_commons',
          });
        }
      }
    } catch (e: any) {
      console.error(`[Video] Wikimedia error: ${e.message}`);
      if (e.response) console.error(`[Video] Response: ${JSON.stringify(e.response.data)}`);
    }
  }

  console.log(`[Video] Wikimedia found: ${results.length}`);
  return results;
}

// 3. Free Stock Video Sites (Pexels, Pixabay, Videvo, etc.)
async function searchFreeStockVideo(topic: string, queries: string[]) {
  console.log('[Video] Searching free stock video sites...');
  const results: any[] = [];

  const freeStockSites = sourcesConfig?.video?.tier2_creative_commons || [
    { name: 'Pexels Video', searchPattern: 'site:pexels.com/video' },
    { name: 'Pixabay Video', searchPattern: 'site:pixabay.com/videos' },
    { name: 'Videvo', searchPattern: 'site:videvo.net' },
    { name: 'Coverr', searchPattern: 'site:coverr.co' },
    { name: 'Mixkit', searchPattern: 'site:mixkit.co/free-stock-video' },
  ];

  for (const site of freeStockSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${site.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          if (isVideoUrl(item.link)) {
            results.push({
              url: item.link,
              title: item.title,
              source: site.name,
              priority: 2,
              license: 'creative_commons',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] Free stock (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] Free stock video found: ${results.length}`);
  return results;
}

// 4. Historical Archives (British Pathé, C-SPAN, LOC, AP, Reuters, etc.)
async function searchHistoricalArchives(topic: string, queries: string[]) {
  console.log('[Video] Searching historical archives...');
  const results: any[] = [];

  const archives = sourcesConfig?.video?.tier3_historical_archives || [
    { name: 'British Pathé', searchPattern: 'site:britishpathe.com/asset' },
    { name: 'C-SPAN', searchPattern: 'site:c-span.org/video' },
    { name: 'Library of Congress', searchPattern: 'site:loc.gov/item film OR video' },
    { name: 'AP Archive', searchPattern: 'site:aparchive.com/metadata' },
    { name: 'Reuters Archive', searchPattern: 'site:reuters.com video archive' },
    { name: 'ITN Source', searchPattern: 'site:itnsource.com' },
    { name: 'Critical Past', searchPattern: 'site:criticalpast.com' },
    { name: 'Footage Farm', searchPattern: 'site:footagefarm.com' },
    { name: 'Historic Films', searchPattern: 'site:historicfilms.com' },
    { name: 'NBC News Archives', searchPattern: 'site:nbcnewsarchives.com' },
    { name: 'CBS News Archives', searchPattern: 'site:cbsnews.com/video' },
    { name: 'BBC Archive', searchPattern: 'site:bbc.com video archive footage' },
    { name: 'Europeana Video', searchPattern: 'site:europeana.eu video OR film' },
    { name: 'BFI National Archive', searchPattern: 'site:bfi.org.uk/archive' },
    { name: 'National Archives', searchPattern: 'site:catalog.archives.gov video OR film' },
  ];

  for (const archive of archives) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${archive.searchPattern} ${query} video OR film OR footage`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          // Filter: only include if URL looks like a video page
          if (isVideoUrl(item.link)) {
            results.push({
              url: item.link,
              title: item.title,
              source: archive.name,
              priority: 3,
              license: 'mixed',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] Archive (${archive.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] Historical archives found: ${results.length}`);
  return results;
}

// 5. News & Documentary Sources
async function searchNewsDocumentary(topic: string, queries: string[]) {
  console.log('[Video] Searching news & documentary sources...');
  const results: any[] = [];

  const newsSources = sourcesConfig?.video?.tier4_news_documentary || [
    { name: 'History Channel', searchPattern: 'site:history.com/videos' },
    { name: 'Documentary Storm', searchPattern: 'site:documentarystorm.com' },
    { name: 'Top Documentary Films', searchPattern: 'site:topdocumentaryfilms.com' },
    { name: 'Smithsonian Channel', searchPattern: 'site:smithsonianchannel.com/videos' },
    { name: 'National Geographic', searchPattern: 'site:nationalgeographic.com/videos' },
    { name: 'PBS Video', searchPattern: 'site:pbs.org/video' },
  ];

  for (const source of newsSources) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${source.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          if (isVideoUrl(item.link)) {
            results.push({
              url: item.link,
              title: item.title,
              source: source.name,
              priority: 4,
              license: 'editorial',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] News/Doc (${source.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] News/Documentary found: ${results.length}`);
  return results;
}

// 6. Stock Footage (Getty, Shutterstock, Pond5, etc.)
async function searchStockFootage(topic: string, queries: string[]) {
  console.log('[Video] Searching stock footage sites...');
  const results: any[] = [];

  const stockSites = sourcesConfig?.video?.tier5_stock_footage || [
    { name: 'Getty Images Video', searchPattern: 'site:gettyimages.com/detail/video' },
    { name: 'Shutterstock Video', searchPattern: 'site:shutterstock.com/video' },
    { name: 'Pond5', searchPattern: 'site:pond5.com' },
    { name: 'Artgrid', searchPattern: 'site:artgrid.io' },
    { name: 'Storyblocks', searchPattern: 'site:storyblocks.com/video' },
  ];

  for (const site of stockSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${site.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          if (isVideoUrl(item.link)) {
            results.push({
              url: item.link,
              title: item.title,
              source: site.name,
              priority: 5,
              license: 'commercial',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] Stock (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] Stock footage found: ${results.length}`);
  return results;
}

// 7. Entire Web (Any website with videos - fallback)
async function searchEntireWeb(topic: string, queries: string[]) {
  console.log('[Video] Searching entire web...');
  const results: any[] = [];

  const excludedSites = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'vimeo.com'];
  const exclusions = excludedSites.map(s => `-site:${s}`).join(' ');

  for (const query of queries) {
    try {
      await delay(300);
      const searchQuery = `${query} video OR footage OR documentary ${exclusions}`;
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const item of response.data?.organic || []) {
        const domain = new URL(item.link).hostname.replace('www.', '');
        if (excludedSites.some(s => domain.includes(s))) continue;

        // Only include if URL looks like a video page (not PDFs, docs, etc.)
        if (isVideoUrl(item.link)) {
          results.push({
            url: item.link,
            title: item.title,
            source: domain,
            priority: 6,
            license: 'unknown',
          });
        }
      }
    } catch (e: any) {
      console.error(`[Video] Web search error: ${e.message}`);
    }
  }

  console.log(`[Video] Web search found: ${results.length}`);
  return results;
}

// ============================================
// MAIN SEARCH ENDPOINT
// ============================================

app.post('/search', async (req, res) => {
  const { projectId, topic, queries } = req.body;

  if (!topic) {
    return res.status(400).json({ error: 'Topic required' });
  }

  const searchQueries = queries || [topic];
  console.log(`\n[Video Worker] Starting search for "${topic}"`);
  console.log(`[Video Worker] Queries: ${searchQueries.join(', ')}`);
  console.log(`[Video Worker] Searching 50+ sources across 6 tiers...`);

  try {
    // Search all sources in priority order (parallel for speed)
    const [archive, wikimedia, freeStock, historical, newsDoc, stockFootage, web] = await Promise.all([
      searchArchiveOrg(topic, searchQueries),
      searchWikimedia(topic, searchQueries),
      searchFreeStockVideo(topic, searchQueries),
      searchHistoricalArchives(topic, searchQueries),
      searchNewsDocumentary(topic, searchQueries),
      searchStockFootage(topic, searchQueries),
      searchEntireWeb(topic, searchQueries),
    ]);

    // Combine and deduplicate
    const allResults = [...archive, ...wikimedia, ...freeStock, ...historical, ...newsDoc, ...stockFootage, ...web];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    // Sort by priority
    unique.sort((a, b) => a.priority - b.priority);

    console.log(`[Video Worker] Total unique videos: ${unique.length}`);
    console.log(`[Video Worker] By tier: Archive.org=${archive.length}, Wikimedia=${wikimedia.length}, FreeStock=${freeStock.length}, Historical=${historical.length}, NewsDoc=${newsDoc.length}, StockFootage=${stockFootage.length}, Web=${web.length}`);

    // Save to Supabase if projectId provided
    if (projectId) {
      let saved = 0;
      for (const video of unique) {
        try {
          await supabase.from('media').insert({
            id: uuidv4(),
            project_id: projectId,
            type: 'video',
            title: video.title,
            source: video.source,
            source_url: video.url,
            hosted_url: video.url,
            metadata: {
              thumbnail: video.thumbnail,
              priority: video.priority,
              license: video.license,
            },
          });
          saved++;
        } catch (e: any) { console.error(`[Video] Error: ${e.message}`); }
      }
      console.log(`[Video Worker] Saved ${saved} videos to database`);
    }

    res.json({
      success: true,
      count: unique.length,
      results: unique,
      breakdown: {
        archive_org: archive.length,
        wikimedia: wikimedia.length,
        free_stock: freeStock.length,
        historical_archives: historical.length,
        news_documentary: newsDoc.length,
        stock_footage: stockFootage.length,
        web_search: web.length,
      }
    });
  } catch (error: any) {
    console.error(`[Video Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    worker: 'video',
    port: PORT,
    sources_loaded: !!sourcesConfig,
    total_sources: sourcesConfig ? '50+' : 'defaults',
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  VIDEO WORKER running on port ${PORT}`);
  console.log(`  Sources: 50+ across 6 tiers`);
  console.log(`========================================\n`);
});
