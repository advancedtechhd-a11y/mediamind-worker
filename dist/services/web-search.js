// Web Search Service - Serper Only
// Uses Serper API for all searches:
// 1. Archive.org (historical content via site: search)
// 2. Web search (modern content via Google)
import axios from 'axios';
const SERPER_API_KEY = process.env.SERPER_API_KEY;
// ============================================
// VIDEO SEARCH (Serper Only)
// ============================================
export async function searchWebForVideos(topic, maxResults = 20) {
    if (!SERPER_API_KEY) {
        console.log(`[Serper] API key not set`);
        return [];
    }
    const results = [];
    try {
        // Step 1: Search Archive.org for historical videos
        console.log(`[Serper] Step 1: Searching Archive.org for "${topic}" videos...`);
        const archiveResults = await searchArchiveVideos(topic);
        for (const r of archiveResults) {
            if (!results.find(e => e.url === r.url))
                results.push(r);
        }
        console.log(`[Serper] Found ${archiveResults.length} Archive.org videos`);
        // Step 2: Search Google for web videos
        console.log(`[Serper] Step 2: Searching web for "${topic}" videos...`);
        const webResults = await searchGoogleVideos(topic);
        for (const r of webResults) {
            if (!results.find(e => e.url === r.url))
                results.push(r);
        }
        console.log(`[Serper] Found ${webResults.length} web videos`);
    }
    catch (error) {
        console.error(`[Serper] Video search failed:`, error.message);
    }
    console.log(`[Serper] Total unique videos: ${results.length}`);
    return results.slice(0, maxResults);
}
// Search Archive.org videos via Serper
async function searchArchiveVideos(topic) {
    try {
        const query = `site:archive.org "${topic}" video OR film OR newsreel OR footage`;
        const response = await axios.post('https://google.serper.dev/search', { q: query, num: 15 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const organic = response.data?.organic || [];
        const results = [];
        for (const item of organic) {
            // Extract Archive.org identifier
            const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
            if (!match)
                continue;
            const identifier = match[1];
            try {
                // Get metadata to find actual video file
                const metaResponse = await axios.get(`https://archive.org/metadata/${identifier}`, { timeout: 10000 });
                const files = metaResponse.data?.files || [];
                const metadata = metaResponse.data?.metadata || {};
                // Find MP4 file
                const videoFile = files.find((f) => f.name?.endsWith('.mp4') && f.source === 'derivative') || files.find((f) => f.name?.endsWith('.mp4'));
                if (videoFile) {
                    results.push({
                        url: `https://archive.org/download/${identifier}/${videoFile.name}`,
                        title: metadata.title || item.title || identifier,
                        source: 'archive.org',
                        thumbnail: `https://archive.org/services/img/${identifier}`,
                    });
                }
            }
            catch (e) {
                // Skip items with metadata errors
            }
            if (results.length >= 10)
                break;
        }
        return results;
    }
    catch (error) {
        console.error(`[Serper] Archive video search failed:`, error.message);
        return [];
    }
}
// Search Google videos via Serper
async function searchGoogleVideos(topic) {
    try {
        const response = await axios.post('https://google.serper.dev/videos', { q: topic, num: 15 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const videos = response.data?.videos || [];
        return videos.map((v) => ({
            url: v.link,
            title: v.title,
            source: extractDomain(v.link),
            duration: parseDuration(v.duration),
            thumbnail: v.imageUrl,
        }));
    }
    catch (error) {
        console.error(`[Serper] Google video search failed:`, error.message);
        return [];
    }
}
// ============================================
// IMAGE SEARCH (Serper Only)
// ============================================
export async function searchWebForImages(topic, maxResults = 30) {
    if (!SERPER_API_KEY) {
        console.log(`[Serper] API key not set`);
        return [];
    }
    const results = [];
    try {
        // Step 1: Search Archive.org for historical images
        console.log(`[Serper] Step 1: Searching Archive.org for "${topic}" images...`);
        const archiveResults = await searchArchiveImages(topic);
        for (const r of archiveResults) {
            if (!results.find(e => e.url === r.url))
                results.push(r);
        }
        console.log(`[Serper] Found ${archiveResults.length} Archive.org images`);
        // Step 2: Search Google for web images
        console.log(`[Serper] Step 2: Searching web for "${topic}" images...`);
        const webResults = await searchGoogleImages(topic);
        for (const r of webResults) {
            if (!results.find(e => e.url === r.url))
                results.push(r);
        }
        console.log(`[Serper] Found ${webResults.length} web images`);
    }
    catch (error) {
        console.error(`[Serper] Image search failed:`, error.message);
    }
    console.log(`[Serper] Total unique images: ${results.length}`);
    return results.slice(0, maxResults);
}
// Search Archive.org images via Serper
async function searchArchiveImages(topic) {
    try {
        const query = `site:archive.org "${topic}" photo OR photograph OR image OR portrait`;
        const response = await axios.post('https://google.serper.dev/search', { q: query, num: 15 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const organic = response.data?.organic || [];
        const results = [];
        for (const item of organic) {
            const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
            if (!match)
                continue;
            const identifier = match[1];
            try {
                const metaResponse = await axios.get(`https://archive.org/metadata/${identifier}`, { timeout: 10000 });
                const files = metaResponse.data?.files || [];
                const metadata = metaResponse.data?.metadata || {};
                // Find image file
                const imageFile = files.find((f) => /\.(jpg|jpeg|png|gif)$/i.test(f.name) &&
                    f.source !== 'metadata' &&
                    !f.name?.includes('thumb'));
                if (imageFile) {
                    results.push({
                        url: `https://archive.org/download/${identifier}/${imageFile.name}`,
                        title: metadata.title || item.title || identifier,
                        source: 'archive.org',
                        thumbnail: `https://archive.org/services/img/${identifier}`,
                    });
                }
            }
            catch (e) {
                // Skip items with metadata errors
            }
            if (results.length >= 10)
                break;
        }
        return results;
    }
    catch (error) {
        console.error(`[Serper] Archive image search failed:`, error.message);
        return [];
    }
}
// Search Google images via Serper
async function searchGoogleImages(topic) {
    try {
        const response = await axios.post('https://google.serper.dev/images', { q: topic, num: 20 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const images = response.data?.images || [];
        return images.map((img) => ({
            url: img.imageUrl,
            title: img.title,
            source: extractDomain(img.link || img.imageUrl),
            width: img.imageWidth,
            height: img.imageHeight,
            thumbnail: img.thumbnailUrl,
        }));
    }
    catch (error) {
        console.error(`[Serper] Google image search failed:`, error.message);
        return [];
    }
}
// ============================================
// NEWS SEARCH (Serper Only)
// ============================================
export async function searchWebForNews(topic, maxResults = 15) {
    if (!SERPER_API_KEY) {
        console.log(`[Serper] API key not set`);
        return [];
    }
    const results = [];
    try {
        // Step 1: Google News search
        console.log(`[Serper] Searching news for "${topic}"...`);
        const response = await axios.post('https://google.serper.dev/news', { q: topic, num: maxResults }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const news = response.data?.news || [];
        for (const n of news) {
            results.push({
                url: n.link,
                title: n.title,
                source: n.source || extractDomain(n.link),
                snippet: n.snippet,
                date: n.date,
            });
        }
        console.log(`[Serper] Found ${news.length} news articles`);
        // Step 2: General article search
        console.log(`[Serper] Searching articles for "${topic}"...`);
        const articleResponse = await axios.post('https://google.serper.dev/search', { q: `${topic} article`, num: 10 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const organic = articleResponse.data?.organic || [];
        for (const o of organic) {
            if (!results.find(r => r.url === o.link)) {
                results.push({
                    url: o.link,
                    title: o.title,
                    source: extractDomain(o.link),
                    snippet: o.snippet,
                });
            }
        }
    }
    catch (error) {
        console.error(`[Serper] News search failed:`, error.message);
    }
    return results.slice(0, maxResults);
}
// ============================================
// HISTORICAL NEWSPAPER SEARCH (Serper Only)
// ============================================
export async function searchHistoricalNewspapers(topic, maxResults = 10) {
    if (!SERPER_API_KEY) {
        console.log(`[Serper] API key not set`);
        return [];
    }
    const results = [];
    try {
        // Search Chronicling America (Library of Congress)
        console.log(`[Serper] Searching Chronicling America for "${topic}"...`);
        const chroniclingQuery = `site:chroniclingamerica.loc.gov "${topic}"`;
        const chroniclingResponse = await axios.post('https://google.serper.dev/search', { q: chroniclingQuery, num: 10 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const chroniclingResults = chroniclingResponse.data?.organic || [];
        for (const item of chroniclingResults) {
            const dateMatch = item.link?.match(/\/(\d{4}-\d{2}-\d{2})\//);
            results.push({
                url: item.link,
                title: item.title,
                source: 'chroniclingamerica.loc.gov',
                date: dateMatch ? dateMatch[1] : undefined,
                snippet: item.snippet,
                imageUrl: item.link?.replace(/\/$/, '') + '.jp2',
            });
        }
        console.log(`[Serper] Found ${chroniclingResults.length} Chronicling America results`);
        // Search Archive.org newspapers
        console.log(`[Serper] Searching Archive.org newspapers for "${topic}"...`);
        const archiveQuery = `site:archive.org "${topic}" newspaper OR gazette OR "news clipping"`;
        const archiveResponse = await axios.post('https://google.serper.dev/search', { q: archiveQuery, num: 10 }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });
        const archiveResults = archiveResponse.data?.organic || [];
        for (const item of archiveResults) {
            if (!results.find(r => r.url === item.link)) {
                const identifier = item.link?.match(/archive\.org\/details\/([^\/\?]+)/)?.[1];
                results.push({
                    url: item.link,
                    title: item.title,
                    source: 'archive.org',
                    snippet: item.snippet,
                    imageUrl: identifier ? `https://archive.org/services/img/${identifier}` : undefined,
                });
            }
        }
        console.log(`[Serper] Found ${archiveResults.length} Archive.org newspaper results`);
    }
    catch (error) {
        console.error(`[Serper] Newspaper search failed:`, error.message);
    }
    console.log(`[Serper] Total newspapers: ${results.length}`);
    return results.slice(0, maxResults);
}
export async function searchAllMedia(topic, options) {
    const opts = {
        maxVideos: options?.maxVideos ?? 10,
        maxImages: options?.maxImages ?? 15,
        maxNewspapers: options?.maxNewspapers ?? 10,
        maxNews: options?.maxNews ?? 10,
    };
    console.log(`\n========================================`);
    console.log(`[Serper] COMBINED SEARCH: "${topic}"`);
    console.log(`========================================\n`);
    // Run all searches in parallel
    const [videos, images, newspapers, news] = await Promise.all([
        searchWebForVideos(topic, opts.maxVideos),
        searchWebForImages(topic, opts.maxImages),
        searchHistoricalNewspapers(topic, opts.maxNewspapers),
        searchWebForNews(topic, opts.maxNews),
    ]);
    console.log(`\n========================================`);
    console.log(`[Serper] RESULTS SUMMARY`);
    console.log(`  Videos: ${videos.length}`);
    console.log(`  Images: ${images.length}`);
    console.log(`  Newspapers: ${newspapers.length}`);
    console.log(`  News: ${news.length}`);
    console.log(`  TOTAL: ${videos.length + images.length + newspapers.length + news.length}`);
    console.log(`========================================\n`);
    return { videos, images, newspapers, news };
}
// ============================================
// HELPERS
// ============================================
function extractDomain(url) {
    try {
        const domain = new URL(url).hostname.replace('www.', '');
        return domain;
    }
    catch {
        return 'unknown';
    }
}
function parseDuration(durationStr) {
    if (!durationStr)
        return undefined;
    const parts = durationStr.split(':').map(p => parseInt(p));
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return undefined;
}
//# sourceMappingURL=web-search.js.map