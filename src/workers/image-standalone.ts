// IMAGE WORKER - Standalone Service (Port 3002)
// Searches: 40+ image sources from config file

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
const PORT = process.env.IMAGE_WORKER_PORT || 3002;

app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SERPER_API_KEY = process.env.SERPER_API_KEY;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load sources config
let sourcesConfig: any = null;
try {
  const configPath = path.join(__dirname, '../config/sources.json');
  sourcesConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log('[Image] Loaded sources config');
} catch (e) {
  console.log('[Image] Config not found, using defaults');
}

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
              license: 'public_domain',
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

// 2. Public Domain Sources (LOC, NYPL, Rawpixel, etc.)
async function searchPublicDomain(topic: string, queries: string[]) {
  console.log('[Image] Searching public domain sources...');
  const results: any[] = [];

  const publicDomainSites = sourcesConfig?.image?.tier1_public_domain?.slice(1) || [
    { name: 'Library of Congress', searchPattern: 'site:loc.gov/pictures' },
    { name: 'National Archives', searchPattern: 'site:catalog.archives.gov photograph OR image' },
    { name: 'Rawpixel Public Domain', searchPattern: 'site:rawpixel.com public domain' },
    { name: 'NYPL Digital Collections', searchPattern: 'site:digitalcollections.nypl.org' },
    { name: 'Wellcome Collection', searchPattern: 'site:wellcomecollection.org/images' },
    { name: 'Old Book Illustrations', searchPattern: 'site:oldbookillustrations.com' },
    { name: 'Biodiversity Heritage Library', searchPattern: 'site:biodiversitylibrary.org' },
  ];

  for (const site of publicDomainSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${site.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: site.name,
            priority: 1,
            license: 'public_domain',
          });
        }
      } catch (e: any) {
        console.error(`[Image] Public domain (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Image] Public domain found: ${results.length}`);
  return results;
}

// 3. Wikimedia Commons
async function searchWikimedia(topic: string, queries: string[]) {
  console.log('[Image] Searching Wikimedia Commons...');
  const results: any[] = [];

  for (const query of queries) {
    try {
      await delay(300);
      const searchQuery = `site:commons.wikimedia.org/wiki/File: ${query}`;
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 30 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      for (const item of response.data?.organic || []) {
        results.push({
          url: item.link,
          title: item.title,
          source: 'wikimedia',
          priority: 1,
          license: 'creative_commons',
        });
      }
    } catch (e: any) {
      console.error(`[Image] Wikimedia search error: ${e.message}`);
    }
  }

  console.log(`[Image] Wikimedia found: ${results.length}`);
  return results;
}

// 4. Free Stock Photos (Unsplash, Pexels, Pixabay, etc.)
async function searchFreeStock(topic: string, queries: string[]) {
  console.log('[Image] Searching free stock photo sites...');
  const results: any[] = [];

  const freeStockSites = sourcesConfig?.image?.tier2_creative_commons || [
    { name: 'Unsplash', searchPattern: 'site:unsplash.com/photos' },
    { name: 'Pexels', searchPattern: 'site:pexels.com/photo' },
    { name: 'Pixabay', searchPattern: 'site:pixabay.com/photos' },
    { name: 'StockSnap', searchPattern: 'site:stocksnap.io' },
    { name: 'Burst', searchPattern: 'site:burst.shopify.com' },
    { name: 'Kaboompics', searchPattern: 'site:kaboompics.com' },
    { name: 'Reshot', searchPattern: 'site:reshot.com' },
    { name: 'ISO Republic', searchPattern: 'site:isorepublic.com' },
    { name: 'Gratisography', searchPattern: 'site:gratisography.com' },
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
          results.push({
            url: item.link,
            title: item.title,
            source: site.name,
            priority: 2,
            license: 'creative_commons',
          });
        }
      } catch (e: any) {
        console.error(`[Image] Free stock (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Image] Free stock found: ${results.length}`);
  return results;
}

// 5. Flickr Commons
async function searchFlickr(topic: string, queries: string[]) {
  console.log('[Image] Searching Flickr...');
  const results: any[] = [];

  for (const query of queries.slice(0, 3)) {
    try {
      await delay(300);
      // Search Flickr Commons specifically for public domain/CC images
      const searchQuery = `site:flickr.com/photos ${query} commons OR creativecommons`;
      const response = await axios.post('https://google.serper.dev/search',
        { q: searchQuery, num: 20 },
        { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      for (const item of response.data?.organic || []) {
        results.push({
          url: item.link,
          title: item.title,
          source: 'flickr',
          priority: 2,
          license: 'creative_commons',
        });
      }
    } catch (e: any) {
      console.error(`[Image] Flickr error: ${e.message}`);
    }
  }

  console.log(`[Image] Flickr found: ${results.length}`);
  return results;
}

// 6. Museum Collections (Smithsonian, Met, Getty, etc.)
async function searchMuseums(topic: string, queries: string[]) {
  console.log('[Image] Searching museum collections...');
  const results: any[] = [];

  const museums = sourcesConfig?.image?.tier3_museums || [
    { name: 'Smithsonian', searchPattern: 'site:si.edu/openaccess' },
    { name: 'Met Museum', searchPattern: 'site:metmuseum.org/art/collection' },
    { name: 'Getty Museum', searchPattern: 'site:getty.edu/art/collection' },
    { name: 'Rijksmuseum', searchPattern: 'site:rijksmuseum.nl/en/collection' },
    { name: 'British Museum', searchPattern: 'site:britishmuseum.org/collection' },
    { name: 'Europeana', searchPattern: 'site:europeana.eu/item' },
    { name: 'Paris Musées', searchPattern: 'site:parismuseescollections.paris.fr' },
    { name: 'Art Institute Chicago', searchPattern: 'site:artic.edu/artworks' },
    { name: 'Cleveland Museum', searchPattern: 'site:clevelandart.org/art' },
    { name: 'National Gallery', searchPattern: 'site:nga.gov/collection' },
    { name: 'Yale Art Gallery', searchPattern: 'site:artgallery.yale.edu/collection' },
    { name: 'MoMA', searchPattern: 'site:moma.org/collection' },
  ];

  for (const museum of museums) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${museum.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 10 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: museum.name,
            priority: 3,
            license: 'open_access',
          });
        }
      } catch (e: any) {
        console.error(`[Image] Museum (${museum.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Image] Museums found: ${results.length}`);
  return results;
}

// 7. Historical Photo Archives
async function searchHistoricalArchives(topic: string, queries: string[]) {
  console.log('[Image] Searching historical photo archives...');
  const results: any[] = [];

  const historicalSites = sourcesConfig?.image?.tier4_historical || [
    { name: 'Shorpy Historical Photos', searchPattern: 'site:shorpy.com' },
    { name: 'Vintage Images', searchPattern: 'site:vintag.es' },
    { name: 'Rare Historical Photos', searchPattern: 'site:rarehistoricalphotos.com' },
    { name: 'History in Pictures', searchPattern: 'site:historyinpictures.com' },
    { name: 'Old Photos Archive', searchPattern: 'site:oldphotoarchive.com' },
  ];

  for (const site of historicalSites) {
    for (const query of queries.slice(0, 2)) {
      try {
        await delay(300);
        const searchQuery = `${site.searchPattern} ${query}`;
        const response = await axios.post('https://google.serper.dev/search',
          { q: searchQuery, num: 15 },
          { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        for (const item of response.data?.organic || []) {
          results.push({
            url: item.link,
            title: item.title,
            source: site.name,
            priority: 4,
            license: 'mixed',
          });
        }
      } catch (e: any) {
        console.error(`[Image] Historical (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Image] Historical archives found: ${results.length}`);
  return results;
}

// 8. Google Images (General Search)
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
          priority: 5,
          license: 'unknown',
        });
      }
    } catch (e: any) { console.error(`[Image] Google Images error: ${e.message}`); }
  }

  console.log(`[Image] Google Images found: ${results.length}`);
  return results;
}

// 9. Stock Photo Sites (Getty, Shutterstock, Alamy - for reference)
async function searchStockPhotos(topic: string, queries: string[]) {
  console.log('[Image] Searching stock photo sites...');
  const results: any[] = [];

  const stockSites = sourcesConfig?.image?.tier5_stock || [
    { name: 'Getty Images', searchPattern: 'site:gettyimages.com' },
    { name: 'Shutterstock', searchPattern: 'site:shutterstock.com' },
    { name: 'Alamy', searchPattern: 'site:alamy.com' },
    { name: 'Adobe Stock', searchPattern: 'site:stock.adobe.com' },
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
          results.push({
            url: item.link,
            title: item.title,
            source: site.name,
            priority: 6,
            license: 'commercial',
          });
        }
      } catch (e: any) {
        console.error(`[Image] Stock (${site.name}) error: ${e.message}`);
      }
    }
  }

  console.log(`[Image] Stock photos found: ${results.length}`);
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
  console.log(`[Image Worker] Searching 40+ sources across 6 tiers...`);

  try {
    // Search all sources in parallel
    const [archive, publicDomain, wikimedia, freeStock, flickr, museums, historical, google, stock] = await Promise.all([
      searchArchiveOrg(topic, searchQueries),
      searchPublicDomain(topic, searchQueries),
      searchWikimedia(topic, searchQueries),
      searchFreeStock(topic, searchQueries),
      searchFlickr(topic, searchQueries),
      searchMuseums(topic, searchQueries),
      searchHistoricalArchives(topic, searchQueries),
      searchGoogleImages(topic, searchQueries),
      searchStockPhotos(topic, searchQueries),
    ]);

    // Combine and deduplicate
    const allResults = [...archive, ...publicDomain, ...wikimedia, ...freeStock, ...flickr, ...museums, ...historical, ...google, ...stock];
    const unique = allResults.filter((item, index, self) =>
      index === self.findIndex(t => t.url === item.url)
    );

    // Sort by priority
    unique.sort((a, b) => a.priority - b.priority);

    console.log(`[Image Worker] Total unique images: ${unique.length}`);
    console.log(`[Image Worker] By tier: Archive.org=${archive.length}, PublicDomain=${publicDomain.length}, Wikimedia=${wikimedia.length}, FreeStock=${freeStock.length}, Flickr=${flickr.length}, Museums=${museums.length}, Historical=${historical.length}, Google=${google.length}, Stock=${stock.length}`);

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
            metadata: {
              width: image.width,
              height: image.height,
              priority: image.priority,
              license: image.license,
            },
          });
          saved++;
        } catch (e: any) { console.error(`[Image] Error: ${e.message}`); }
      }
      console.log(`[Image Worker] Saved ${saved} images to database`);
    }

    res.json({
      success: true,
      count: unique.length,
      results: unique,
      breakdown: {
        archive_org: archive.length,
        public_domain: publicDomain.length,
        wikimedia: wikimedia.length,
        free_stock: freeStock.length,
        flickr: flickr.length,
        museums: museums.length,
        historical: historical.length,
        google_images: google.length,
        stock_photos: stock.length,
      }
    });
  } catch (error: any) {
    console.error(`[Image Worker] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    worker: 'image',
    port: PORT,
    sources_loaded: !!sourcesConfig,
    total_sources: sourcesConfig ? '40+' : 'defaults',
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  IMAGE WORKER running on port ${PORT}`);
  console.log(`  Sources: 40+ across 6 tiers`);
  console.log(`========================================\n`);
});
