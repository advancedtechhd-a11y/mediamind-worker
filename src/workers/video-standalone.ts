// VIDEO WORKER - Standalone Service (Port 3001)
// Searches: 50+ video sources using SearXNG (self-hosted, unlimited)

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { searchWeb, searchVideos, searchSite } from '../utils/searxng.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.VIDEO_WORKER_PORT || 3001;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Blacklist of unrelated terms that indicate completely off-topic results
const BLACKLIST_TERMS = [
  'ufo', 'alien', 'fashion week', 'runway', 'model walk', 'cooking recipe',
  'makeup tutorial', 'unboxing', 'asmr', 'minecraft', 'fortnite', 'gaming',
  'crypto', 'bitcoin', 'nft', 'workout', 'yoga', 'meditation', 'mukbang',
  'tiktok compilation', 'funny cats', 'funny dogs', 'prank', 'challenge',
  'react to', 'reaction video'
];

// Check if a result is relevant to the topic
function isRelevant(title: string, topic: string): boolean {
  if (!title || !topic) return false;

  const titleLower = title.toLowerCase();
  const topicLower = topic.toLowerCase();

  // Check for blacklisted terms (completely unrelated content)
  for (const blacklisted of BLACKLIST_TERMS) {
    if (titleLower.includes(blacklisted) && !topicLower.includes(blacklisted)) {
      return false;
    }
  }

  // Extract keywords from topic (words > 2 chars, excluding common/filler words)
  const stopWords = [
    'the', 'and', 'for', 'was', 'were', 'are', 'how', 'what', 'who', 'when', 'where', 'why',
    'did', 'does', 'has', 'have', 'had', 'been', 'being', 'with', 'from', 'about', 'into',
    'that', 'this', 'these', 'those', 'happen', 'happened', 'happens', 'happening',
    'start', 'started', 'starts', 'begin', 'began', 'become', 'became', 'make', 'made',
    'explained', 'explain', 'story', 'history', 'documentary', 'video', 'full', 'complete'
  ];
  const keywords = topicLower.split(/\s+/).filter(word => word.length > 2 && !stopWords.includes(word));

  if (keywords.length === 0) return true; // If no keywords extracted, allow it

  // Check how many keywords appear in the title (also check for partial matches for longer words)
  const matchCount = keywords.filter(keyword => {
    // Direct match
    if (titleLower.includes(keyword)) return true;
    // For words 6+ chars, check if title contains the root (first 5 chars)
    if (keyword.length >= 6 && titleLower.includes(keyword.slice(0, 5))) return true;
    return false;
  }).length;

  // Require at least 35% of keywords to match (balanced filtering)
  const minMatches = Math.max(1, Math.ceil(keywords.length * 0.35));

  // For single important keyword topics, just need that one word
  if (keywords.length === 1) {
    return matchCount >= 1;
  }

  // For 2-word topics, need at least 1 match
  if (keywords.length === 2) {
    return matchCount >= 1;
  }

  return matchCount >= minMatches;
}

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

  // Include known video platforms/patterns
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
// SEARCH SOURCES (Using SearXNG)
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

      for (const doc of docs.slice(0, 25)) {
        await delay(150);
        try {
          const meta = await axios.get(`https://archive.org/metadata/${doc.identifier}`, { timeout: 10000 });
          const files = meta.data?.files || [];
          const videoFile = files.find((f: any) =>
            f.name?.endsWith('.mp4') || f.name?.endsWith('.webm') || f.name?.endsWith('.ogv')
          );

          if (videoFile) {
            const title = doc.title || doc.identifier;
            // RELEVANCE CHECK for Archive.org
            if (isRelevant(title, topic)) {
              results.push({
                url: `https://archive.org/download/${doc.identifier}/${videoFile.name}`,
                title: title,
                source: 'archive.org',
                thumbnail: `https://archive.org/services/img/${doc.identifier}`,
                priority: 1,
                license: 'public_domain',
              });
            }
          }
        } catch (e: any) { /* skip */ }
      }
    } catch (e: any) {
      console.log(`[Video] Archive.org query failed: ${e.message}`);
    }
  }

  console.log(`[Video] Archive.org found: ${results.length}`);
  return results;
}

// 2. SearXNG Video Search (aggregates Google, Bing, DuckDuckGo videos)
async function searchSearXNGVideos(topic: string, queries: string[]) {
  console.log('[Video] Searching via SearXNG video category...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      const searchResults = await searchVideos(`${query} historical footage documentary`, 50);

      for (const item of searchResults) {
        // RELEVANCE CHECK: Only include if title matches topic
        if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
          results.push({
            url: item.url,
            title: item.title,
            source: item.engine || 'searxng',
            thumbnail: item.thumbnail,
            priority: 2,
            license: 'unknown',
          });
        }
      }
    } catch (e: any) {
      console.error(`[Video] SearXNG video search error: ${e.message}`);
    }
  }

  console.log(`[Video] SearXNG videos found: ${results.length}`);
  return results;
}

// 3. Free Stock Video Sites
async function searchFreeStockVideo(topic: string, queries: string[]) {
  console.log('[Video] Searching free stock video sites...');
  const results: any[] = [];

  const freeStockSites = [
    { name: 'Pexels Video', site: 'pexels.com/video' },
    { name: 'Pixabay Video', site: 'pixabay.com/videos' },
    { name: 'Videvo', site: 'videvo.net' },
    { name: 'Coverr', site: 'coverr.co' },
    { name: 'Mixkit', site: 'mixkit.co' },
  ];

  for (const stock of freeStockSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        const searchResults = await searchSite(stock.site, query, 15);

        for (const item of searchResults) {
          // RELEVANCE CHECK for stock sites
          if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
            results.push({
              url: item.url,
              title: item.title,
              source: stock.name,
              priority: 2,
              license: 'creative_commons',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] Free stock (${stock.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] Free stock video found: ${results.length}`);
  return results;
}

// 4. Historical Archives
async function searchHistoricalArchives(topic: string, queries: string[]) {
  console.log('[Video] Searching historical archives...');
  const results: any[] = [];

  const archives = [
    { name: 'British Pathé', site: 'britishpathe.com' },
    { name: 'C-SPAN', site: 'c-span.org/video' },
    { name: 'Library of Congress', site: 'loc.gov/item' },
    { name: 'AP Archive', site: 'aparchive.com' },
    { name: 'Reuters', site: 'reuters.com/video' },
    { name: 'ITN Source', site: 'itnsource.com' },
    { name: 'Critical Past', site: 'criticalpast.com' },
    { name: 'Footage Farm', site: 'footagefarm.com' },
    { name: 'Historic Films', site: 'historicfilms.com' },
    { name: 'NBC Archives', site: 'nbcnewsarchives.com' },
    { name: 'CBS News', site: 'cbsnews.com/video' },
    { name: 'BBC Archive', site: 'bbc.com/archive' },
    { name: 'Europeana', site: 'europeana.eu' },
    { name: 'BFI', site: 'bfi.org.uk' },
    { name: 'National Archives', site: 'catalog.archives.gov' },
  ];

  for (const archive of archives) {
    for (const query of queries.slice(0, 2)) {
      try {
        const searchResults = await searchSite(archive.site, `${query} video film footage`, 15);

        for (const item of searchResults) {
          // RELEVANCE CHECK for historical archives
          if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
            results.push({
              url: item.url,
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

  const newsSources = [
    { name: 'History Channel', site: 'history.com/videos' },
    { name: 'Smithsonian', site: 'smithsonianchannel.com' },
    { name: 'National Geographic', site: 'nationalgeographic.com/videos' },
    { name: 'PBS', site: 'pbs.org/video' },
    { name: 'Documentary Storm', site: 'documentarystorm.com' },
    { name: 'Top Documentary', site: 'topdocumentaryfilms.com' },
  ];

  for (const source of newsSources) {
    for (const query of queries.slice(0, 2)) {
      try {
        const searchResults = await searchSite(source.site, query, 15);

        for (const item of searchResults) {
          // RELEVANCE CHECK for news/documentary
          if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
            results.push({
              url: item.url,
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

// 6. Stock Footage Sites
async function searchStockFootage(topic: string, queries: string[]) {
  console.log('[Video] Searching stock footage sites...');
  const results: any[] = [];

  const stockSites = [
    { name: 'Getty Video', site: 'gettyimages.com/videos' },
    { name: 'Shutterstock Video', site: 'shutterstock.com/video' },
    { name: 'Pond5', site: 'pond5.com' },
    { name: 'Artgrid', site: 'artgrid.io' },
    { name: 'Storyblocks', site: 'storyblocks.com/video' },
  ];

  for (const stock of stockSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        const searchResults = await searchSite(stock.site, query, 15);

        for (const item of searchResults) {
          // RELEVANCE CHECK for stock footage
          if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
            results.push({
              url: item.url,
              title: item.title,
              source: stock.name,
              priority: 5,
              license: 'commercial',
            });
          }
        }
      } catch (e: any) {
        console.error(`[Video] Stock (${stock.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Video] Stock footage found: ${results.length}`);
  return results;
}

// 7. General Web Search for Videos
async function searchWebVideos(topic: string, queries: string[]) {
  console.log('[Video] Searching general web for videos...');
  const results: any[] = [];

  const excludedDomains = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'dailymotion.com'];

  for (const query of queries) {
    try {
      const searchResults = await searchWeb(`${query} video footage documentary -youtube -tiktok -dailymotion`, 40);

      for (const item of searchResults) {
        const domain = new URL(item.url).hostname.replace('www.', '');
        if (excludedDomains.some(d => domain.includes(d))) continue;

        // RELEVANCE CHECK: Only include if title matches topic
        if (isVideoUrl(item.url) && isRelevant(item.title, topic)) {
          results.push({
            url: item.url,
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

  console.log(`[Video] Web videos found: ${results.length}`);
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
  console.log(`[Video Worker] Using SearXNG (unlimited searches)`);

  try {
    // Search all sources in parallel
    const [archive, searxngVideos, freeStock, historical, newsDoc, stockFootage, webVideos] = await Promise.all([
      searchArchiveOrg(topic, searchQueries),
      searchSearXNGVideos(topic, searchQueries),
      searchFreeStockVideo(topic, searchQueries),
      searchHistoricalArchives(topic, searchQueries),
      searchNewsDocumentary(topic, searchQueries),
      searchStockFootage(topic, searchQueries),
      searchWebVideos(topic, searchQueries),
    ]);

    // Combine and deduplicate
    const allResults = [...archive, ...searxngVideos, ...freeStock, ...historical, ...newsDoc, ...stockFootage, ...webVideos];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    // Sort by priority
    unique.sort((a, b) => a.priority - b.priority);

    console.log(`[Video Worker] Total unique videos: ${unique.length}`);
    console.log(`[Video Worker] Breakdown: Archive=${archive.length}, SearXNG=${searxngVideos.length}, FreeStock=${freeStock.length}, Historical=${historical.length}, NewsDoc=${newsDoc.length}, Stock=${stockFootage.length}, Web=${webVideos.length}`);

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
        } catch (e: any) { /* skip duplicates */ }
      }
      console.log(`[Video Worker] Saved ${saved} videos to database`);
    }

    res.json({
      success: true,
      count: unique.length,
      results: unique,
      breakdown: {
        archive_org: archive.length,
        searxng_videos: searxngVideos.length,
        free_stock: freeStock.length,
        historical_archives: historical.length,
        news_documentary: newsDoc.length,
        stock_footage: stockFootage.length,
        web_search: webVideos.length,
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
    search_engine: 'SearXNG (self-hosted)',
    sources: '50+',
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  VIDEO WORKER running on port ${PORT}`);
  console.log(`  Search Engine: SearXNG (unlimited)`);
  console.log(`  Sources: 50+ across 7 categories`);
  console.log(`========================================\n`);
});
