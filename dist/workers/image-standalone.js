// IMAGE WORKER - Standalone Service (Port 3002)
// Searches: 40+ image sources using SearXNG (self-hosted, unlimited)
import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { searchImages, searchSiteImages } from '../utils/searxng.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.IMAGE_WORKER_PORT || 3002;
app.use(express.json());
// Initialize Supabase with error handling
let supabase = null;
try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    }
}
catch (e) {
    console.warn('[Image] Supabase initialization failed');
}
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// ============================================
// SEARCH SOURCES (Using SearXNG)
// ============================================
// 1. Archive.org Images
async function searchArchiveOrg(topic, queries) {
    console.log('[Image] Searching Archive.org...');
    const results = [];
    for (const query of queries) {
        try {
            const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:image&fl[]=identifier,title&sort[]=downloads+desc&rows=50&output=json`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'MediaMind Research Bot/1.0' },
                timeout: 30000,
            });
            const docs = response.data?.response?.docs || [];
            for (const doc of docs.slice(0, 30)) {
                await delay(100);
                try {
                    const meta = await axios.get(`https://archive.org/metadata/${doc.identifier}`, { timeout: 8000 });
                    const files = meta.data?.files || [];
                    const imageFile = files.find((f) => /\.(jpg|jpeg|png|gif)$/i.test(f.name) && !f.name?.includes('thumb'));
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
                }
                catch (e) { /* skip */ }
            }
        }
        catch (e) {
            console.log(`[Image] Archive.org query failed: ${e.message}`);
        }
    }
    console.log(`[Image] Archive.org found: ${results.length}`);
    return results;
}
// 2. SearXNG Image Search (aggregates Google, Bing, DuckDuckGo images)
async function searchSearXNGImages(topic, queries) {
    console.log('[Image] Searching via SearXNG image category...');
    const results = [];
    for (const query of queries) {
        try {
            const searchResults = await searchImages(`${query} historical photograph`, 100);
            for (const item of searchResults) {
                if (item.img_src) {
                    results.push({
                        url: item.img_src,
                        title: item.title,
                        source: item.engine || 'searxng',
                        thumbnail: item.thumbnail || item.img_src,
                        priority: 2,
                        license: 'unknown',
                    });
                }
            }
        }
        catch (e) {
            console.error(`[Image] SearXNG image search error: ${e.message}`);
        }
    }
    console.log(`[Image] SearXNG images found: ${results.length}`);
    return results;
}
// 3. Public Domain Sources - use IMAGE search for actual image URLs
async function searchPublicDomain(topic, queries) {
    console.log('[Image] Searching public domain sources...');
    const results = [];
    const publicDomainSites = [
        { name: 'Library of Congress', site: 'loc.gov' },
        { name: 'National Archives', site: 'archives.gov' },
        { name: 'Rawpixel', site: 'rawpixel.com' },
        { name: 'NYPL Digital', site: 'digitalcollections.nypl.org' },
        { name: 'Wellcome Collection', site: 'wellcomecollection.org' },
    ];
    for (const site of publicDomainSites) {
        for (const query of queries.slice(0, 2)) {
            try {
                // Use image search to get actual image URLs
                const searchResults = await searchSiteImages(site.site, query, 25);
                for (const item of searchResults) {
                    if (item.img_src) {
                        results.push({
                            url: item.img_src,
                            title: item.title,
                            source: site.name,
                            thumbnail: item.thumbnail || item.img_src,
                            priority: 1,
                            license: 'public_domain',
                        });
                    }
                }
            }
            catch (e) {
                console.error(`[Image] Public domain (${site.name}) error: ${e.message}`);
            }
        }
    }
    console.log(`[Image] Public domain found: ${results.length}`);
    return results;
}
// 4. Wikimedia Commons - use IMAGE search
async function searchWikimedia(topic, queries) {
    console.log('[Image] Searching Wikimedia Commons...');
    const results = [];
    for (const query of queries) {
        try {
            // Use image search for Wikimedia to get actual image URLs
            const searchResults = await searchSiteImages('commons.wikimedia.org', query, 50);
            for (const item of searchResults) {
                if (item.img_src) {
                    results.push({
                        url: item.img_src,
                        title: item.title,
                        source: 'wikimedia',
                        thumbnail: item.thumbnail || item.img_src,
                        priority: 1,
                        license: 'creative_commons',
                    });
                }
            }
        }
        catch (e) {
            console.error(`[Image] Wikimedia error: ${e.message}`);
        }
    }
    console.log(`[Image] Wikimedia found: ${results.length}`);
    return results;
}
// 5. Museum Collections - use IMAGE search for actual image URLs
async function searchMuseums(topic, queries) {
    console.log('[Image] Searching museum collections...');
    const results = [];
    const museums = [
        { name: 'Smithsonian', site: 'si.edu' },
        { name: 'Met Museum', site: 'metmuseum.org' },
        { name: 'Getty Museum', site: 'getty.edu' },
        { name: 'Rijksmuseum', site: 'rijksmuseum.nl' },
        { name: 'British Museum', site: 'britishmuseum.org' },
        { name: 'Europeana', site: 'europeana.eu' },
        { name: 'Art Institute Chicago', site: 'artic.edu' },
        { name: 'Cleveland Museum', site: 'clevelandart.org' },
        { name: 'National Gallery', site: 'nga.gov' },
        { name: 'MoMA', site: 'moma.org' },
    ];
    for (const museum of museums) {
        for (const query of queries.slice(0, 2)) {
            try {
                // Use image search to get actual image URLs
                const searchResults = await searchSiteImages(museum.site, query, 20);
                for (const item of searchResults) {
                    if (item.img_src) {
                        results.push({
                            url: item.img_src,
                            title: item.title,
                            source: museum.name,
                            thumbnail: item.thumbnail || item.img_src,
                            priority: 3,
                            license: 'open_access',
                        });
                    }
                }
            }
            catch (e) {
                console.error(`[Image] Museum (${museum.name}) error: ${e.message}`);
            }
        }
    }
    console.log(`[Image] Museums found: ${results.length}`);
    return results;
}
// 6. Historical Photo Archives - use IMAGE search
async function searchHistoricalArchives(topic, queries) {
    console.log('[Image] Searching historical photo archives...');
    const results = [];
    const historicalSites = [
        { name: 'Shorpy', site: 'shorpy.com' },
        { name: 'Rare Historical Photos', site: 'rarehistoricalphotos.com' },
        { name: 'Vintage Photos', site: 'vintag.es' },
        { name: 'History in Pictures', site: 'historyinpictures.com' },
    ];
    for (const site of historicalSites) {
        for (const query of queries.slice(0, 2)) {
            try {
                // Use image search to get actual image URLs
                const searchResults = await searchSiteImages(site.site, query, 25);
                for (const item of searchResults) {
                    if (item.img_src) {
                        results.push({
                            url: item.img_src,
                            title: item.title,
                            source: site.name,
                            thumbnail: item.thumbnail || item.img_src,
                            priority: 4,
                            license: 'mixed',
                        });
                    }
                }
            }
            catch (e) {
                console.error(`[Image] Historical (${site.name}) error: ${e.message}`);
            }
        }
    }
    console.log(`[Image] Historical archives found: ${results.length}`);
    return results;
}
// 7. Flickr Commons - use IMAGE search
async function searchFlickr(topic, queries) {
    console.log('[Image] Searching Flickr...');
    const results = [];
    for (const query of queries.slice(0, 3)) {
        try {
            // Use image search to get actual image URLs from Flickr
            const searchResults = await searchSiteImages('flickr.com', `${query} commons`, 30);
            for (const item of searchResults) {
                if (item.img_src) {
                    results.push({
                        url: item.img_src,
                        title: item.title,
                        source: 'flickr',
                        thumbnail: item.thumbnail || item.img_src,
                        priority: 2,
                        license: 'creative_commons',
                    });
                }
            }
        }
        catch (e) {
            console.error(`[Image] Flickr error: ${e.message}`);
        }
    }
    console.log(`[Image] Flickr found: ${results.length}`);
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
    console.log(`[Image Worker] Using SearXNG (unlimited searches)`);
    try {
        // Search all sources in parallel
        const [archive, searxngImages, publicDomain, wikimedia, museums, historical, flickr] = await Promise.all([
            searchArchiveOrg(topic, searchQueries),
            searchSearXNGImages(topic, searchQueries),
            searchPublicDomain(topic, searchQueries),
            searchWikimedia(topic, searchQueries),
            searchMuseums(topic, searchQueries),
            searchHistoricalArchives(topic, searchQueries),
            searchFlickr(topic, searchQueries),
        ]);
        // Combine and deduplicate
        const allResults = [...archive, ...searxngImages, ...publicDomain, ...wikimedia, ...museums, ...historical, ...flickr];
        const unique = allResults.filter((item, index, self) => index === self.findIndex(t => t.url === item.url));
        // Sort by priority
        unique.sort((a, b) => a.priority - b.priority);
        console.log(`[Image Worker] Total unique images: ${unique.length}`);
        console.log(`[Image Worker] Breakdown: Archive=${archive.length}, SearXNG=${searxngImages.length}, PublicDomain=${publicDomain.length}, Wikimedia=${wikimedia.length}, Museums=${museums.length}, Historical=${historical.length}, Flickr=${flickr.length}`);
        // Save to Supabase if projectId provided
        if (projectId) {
            let saved = 0;
            for (const image of unique.slice(0, 500)) {
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
                            thumbnail: image.thumbnail,
                            priority: image.priority,
                            license: image.license,
                        },
                    });
                    saved++;
                }
                catch (e) { /* skip duplicates */ }
            }
            console.log(`[Image Worker] Saved ${saved} images to database`);
        }
        res.json({
            success: true,
            count: unique.length,
            results: unique,
            breakdown: {
                archive_org: archive.length,
                searxng_images: searxngImages.length,
                public_domain: publicDomain.length,
                wikimedia: wikimedia.length,
                museums: museums.length,
                historical: historical.length,
                flickr: flickr.length,
            }
        });
    }
    catch (error) {
        console.error(`[Image Worker] Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        worker: 'image',
        port: PORT,
        search_engine: 'SearXNG (self-hosted)',
        sources: '40+',
    });
});
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  IMAGE WORKER running on port ${PORT}`);
    console.log(`  Search Engine: SearXNG (unlimited)`);
    console.log(`  Sources: 40+ across 7 categories`);
    console.log(`========================================\n`);
});
//# sourceMappingURL=image-standalone.js.map