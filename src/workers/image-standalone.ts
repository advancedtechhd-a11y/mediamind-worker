// IMAGE WORKER - Standalone Service (Port 3002)
// Searches: Archive.org → Wikimedia → Google Images → Flickr → Entire Web

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const app = express();
const PORT = process.env.IMAGE_WORKER_PORT || 3002;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// SEARCH SOURCES (Priority Order)
// ============================================

// 1. Archive.org Images
async function searchArchiveOrg(topic: string, queries: string[]) {
  console.log('[Image] Searching Archive.org...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:image&fl[]=identifier,title&sort[]=downloads+desc&rows=50&output=json`;

      const response = await axios.get(searchUrl, {
        headers: { 'User-Agent': 'MediaMind Research Bot/1.0' },
        timeout: 30000,
      });

      const docs = response.data?.response?.docs || [];

      for (const doc of docs.slice(0, 30)) {
        await delay(150);
        try {
          const meta = await axios.get(`https://archive.org/metadata/${doc.identifier}`, { timeout: 8000 });
          const files = meta.data?.files || [];
          const imageFile = files.find((f: any) => /\.(jpg|jpeg|png|gif)$/i.test(f.name) && !f.name?.includes('thumb'));

          if (imageFile) {
            results.push({
              url: `https://archive.org/download/${doc.identifier}/${imageFile.name}`,
              title: doc.title || doc.identifier,
              source: 'archive.org',
              thumbnail: `https://archive.org/services/img/${doc.identifier}`,
              priority: 1,
            });
          }
        } catch (e: any) { console.error(`[Image] Error: ${e.message}`); }
      }
    } catch (e: any) {
      console.log(`[Image] Archive.org query failed: ${e.message}`);
    }
  }

  console.log(`[Image] Archive.org found: ${results.length}`);
  return results;
}

// 2. Wikimedia Commons
async function searchWikimedia(topic: string, queries: string[]) {
  console.log('[Image] Searching Wikimedia Commons...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const searchQuery = `site:commons.wikimedia.org ${query}`;
      console.log(`[Image] Wikimedia query: ${searchQuery}`);
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 30 },
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
    } catch (e: any) {
      console.error(`[Image] Wikimedia search error: ${e.message}`);
      if (e.response) {
        console.error(`[Image] Serper response status: ${e.response.status}`);
        console.error(`[Image] Serper response data: ${JSON.stringify(e.response.data)}`);
      }
    }
  }

  console.log(`[Image] Wikimedia found: ${results.length}`);
  return results;
}

// 3. Google Images
async function searchGoogleImages(topic: string, queries: string[]) {
  console.log('[Image] Searching Google Images...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const response = await axios.post('https://google.serper.dev/images',
        { q: query, num: 50 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const img of response.data?.images || []) {
        results.push({
          url: img.imageUrl,
          title: img.title,
          source: new URL(img.link || img.imageUrl).hostname.replace('www.', ''),
          width: img.imageWidth,
          height: img.imageHeight,
          thumbnail: img.thumbnailUrl,
          priority: 3,
        });
      }
    } catch (e: any) { console.error(`[Image] Error: ${e.message}`); }
  }

  console.log(`[Image] Google Images found: ${results.length}`);
  return results;
}

// 4. Flickr
async function searchFlickr(topic: string, queries: string[]) {
  console.log('[Image] Searching Flickr...');
  const results: any[] = [];

  for (const query of queries.slice(0, 3)) {
    try {
      await delay(300);
      const searchQuery = `site:flickr.com ${query}`;
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 20 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      for (const item of response.data?.organic || []) {
        results.push({
          url: item.link,
          title: item.title,
          source: 'flickr',
          priority: 4,
        });
      }
    } catch (e: any) {
      console.error(`[Image] Flickr error: ${e.message}`);
      if (e.response) console.error(`[Image] Response: ${JSON.stringify(e.response.data)}`);
    }
  }

  console.log(`[Image] Flickr found: ${results.length}`);
  return results;
}

// 5. Museum & Historical Sites
async function searchMuseums(topic: string, queries: string[]) {
  console.log('[Image] Searching museums & historical sites...');
  const results: any[] = [];

  const sites = [
    'loc.gov',
    'smithsonianmag.com',
    'metmuseum.org',
    'getty.edu',
    'europeana.eu',
  ];

  for (const site of sites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `site:${site} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: site.split('.')[0],
            priority: 5,
          });
        }
      } catch (e: any) {
        console.error(`[Image] Museum (${site}) error: ${e.message}`);
        if (e.response) console.error(`[Image] Response: ${JSON.stringify(e.response.data)}`);
      }
    }
  }

  console.log(`[Image] Museums found: ${results.length}`);
  return results;
}

// 6. Entire Web
async function searchEntireWeb(topic: string, queries: string[]) {
  console.log('[Image] Searching entire web...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const response = await axios.post('https://google.serper.dev/images',
        { q: `"${query}" historical OR vintage OR archive`, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      for (const img of response.data?.images || []) {
        results.push({
          url: img.imageUrl,
          title: img.title,
          source: new URL(img.link || img.imageUrl).hostname.replace('www.', ''),
          width: img.imageWidth,
          height: img.imageHeight,
          priority: 6,
        });
      }
    } catch (e: any) { console.error(`[Image] Error: ${e.message}`); }
  }

  console.log(`[Image] Web search found: ${results.length}`);
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
  console.log(`\n[Image Worker] Starting search for "${topic}"`);
  console.log(`[Image Worker] Queries: ${searchQueries.join(', ')}`);

  try {
    // Search all sources in parallel
    const [archive, wikimedia, google, flickr, museums, web] = await Promise.all([
      searchArchiveOrg(topic, searchQueries),
      searchWikimedia(topic, searchQueries),
      searchGoogleImages(topic, searchQueries),
      searchFlickr(topic, searchQueries),
      searchMuseums(topic, searchQueries),
      searchEntireWeb(topic, searchQueries),
    ]);

    // Combine and deduplicate
    const allResults = [...archive, ...wikimedia, ...google, ...flickr, ...museums, ...web];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    // Sort by priority
    unique.sort((a, b) => a.priority - b.priority);

    console.log(`[Image Worker] Total unique images: ${unique.length}`);

    // Save to Supabase if projectId provided
    if (projectId) {
      let saved = 0;
      for (const image of unique.slice(0, 500)) { // Limit to 500
        try {
          await supabase.from('media').insert({
            id: uuidv4(),
            project_id: projectId,
            type: 'image',
            title: image.title,
            source: image.source,
            source_url: image.url,
            hosted_url: image.url,
            metadata: { width: image.width, height: image.height, priority: image.priority },
          });
          saved++;
        } catch (e: any) { console.error(`[Image] Error: ${e.message}`); }
      }
      console.log(`[Image Worker] Saved ${saved} images to database`);
    }

    res.json({ success: true, count: unique.length, results: unique });
  } catch (error: any) {
    console.error(`[Image Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', worker: 'image', port: PORT });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  IMAGE WORKER running on port ${PORT}`);
  console.log(`========================================\n`);
});
