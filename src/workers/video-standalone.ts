// VIDEO WORKER - Standalone Service (Port 3001)
// Searches: Archive.org → Wikimedia → Web → Historical Archives

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const PORT = process.env.VIDEO_WORKER_PORT || 3001;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
          const videoFile = files.find((f: any) => f.name?.endsWith('.mp4'));

          if (videoFile) {
            results.push({
              url: `https://archive.org/download/${doc.identifier}/${videoFile.name}`,
              title: doc.title || doc.identifier,
              source: 'archive.org',
              thumbnail: `https://archive.org/services/img/${doc.identifier}`,
              priority: 1,
            });
          }
        } catch (e) {}
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
      const response = await axios.post('https://google.serper.dev/search',
        { q: `site:commons.wikimedia.org "${query}" video OR film`, num: 20 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      for (const item of response.data?.organic || []) {
        results.push({
          url: item.link,
          title: item.title,
          source: 'wikimedia',
          priority: 2,
        });
      }
    } catch (e) {}
  }

  console.log(`[Video] Wikimedia found: ${results.length}`);
  return results;
}

// 3. Historical Archives (British Pathé, C-SPAN, LOC, AP)
async function searchHistoricalArchives(topic: string, queries: string[]) {
  console.log('[Video] Searching historical archives...');
  const results: any[] = [];

  const archives = [
    { site: 'britishpathe.com', name: 'British Pathé' },
    { site: 'c-span.org/video', name: 'C-SPAN' },
    { site: 'loc.gov', name: 'Library of Congress' },
    { site: 'aparchive.com', name: 'AP Archive' },
  ];

  for (const archive of archives) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const response = await axios.post('https://google.serper.dev/search',
          { q: `site:${archive.site} "${query}"`, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: archive.name,
            priority: 3,
          });
        }
      } catch (e) {}
    }
  }

  console.log(`[Video] Historical archives found: ${results.length}`);
  return results;
}

// 4. Entire Web (Any website with videos)
async function searchEntireWeb(topic: string, queries: string[]) {
  console.log('[Video] Searching entire web...');
  const results: any[] = [];

  const excludedSites = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com'];
  const exclusions = excludedSites.map(s => `-site:${s}`).join(' ');

  for (const query of queries) {
    try {
      await delay(300);
      const response = await axios.post('https://google.serper.dev/search',
        { q: `"${query}" video OR footage OR documentary ${exclusions}`, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const item of response.data?.organic || []) {
        const domain = new URL(item.link).hostname.replace('www.', '');
        if (excludedSites.some(s => domain.includes(s))) continue;

        results.push({
          url: item.link,
          title: item.title,
          source: domain,
          priority: 4,
        });
      }
    } catch (e) {}
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

  try {
    // Search all sources in priority order
    const [archive, wikimedia, historical, web] = await Promise.all([
      searchArchiveOrg(topic, searchQueries),
      searchWikimedia(topic, searchQueries),
      searchHistoricalArchives(topic, searchQueries),
      searchEntireWeb(topic, searchQueries),
    ]);

    // Combine and deduplicate
    const allResults = [...archive, ...wikimedia, ...historical, ...web];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    // Sort by priority
    unique.sort((a, b) => a.priority - b.priority);

    console.log(`[Video Worker] Total unique videos: ${unique.length}`);

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
            metadata: { thumbnail: video.thumbnail, priority: video.priority },
          });
          saved++;
        } catch (e) {}
      }
      console.log(`[Video Worker] Saved ${saved} videos to database`);
    }

    res.json({ success: true, count: unique.length, results: unique });
  } catch (error: any) {
    console.error(`[Video Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', worker: 'video', port: PORT });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  VIDEO WORKER running on port ${PORT}`);
  console.log(`========================================\n`);
});
