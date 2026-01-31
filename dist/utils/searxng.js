// SearXNG Search Utility
// Replaces Serper API with self-hosted SearXNG
import axios from 'axios';
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://bcgcoss4c40k8kgsoc0sw40g.46.224.208.101.sslip.io';
// General web search
export async function searchWeb(query, num = 30) {
    try {
        const response = await axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: query,
                format: 'json',
                categories: 'general',
            },
            timeout: 20000,
        });
        return (response.data?.results || []).slice(0, num).map((r) => ({
            url: r.url,
            title: r.title,
            content: r.content,
            engine: r.engine || (r.engines || []).join(', '),
            score: r.score,
            publishedDate: r.publishedDate,
        }));
    }
    catch (error) {
        console.error(`[SearXNG] Web search error: ${error.message}`);
        return [];
    }
}
// Image search
export async function searchImages(query, num = 50) {
    try {
        const response = await axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: query,
                format: 'json',
                categories: 'images',
            },
            timeout: 20000,
        });
        return (response.data?.results || []).slice(0, num).map((r) => ({
            url: r.url,
            title: r.title,
            img_src: r.img_src || r.thumbnail,
            thumbnail: r.thumbnail,
            source: r.engine,
            engine: r.engine,
        }));
    }
    catch (error) {
        console.error(`[SearXNG] Image search error: ${error.message}`);
        return [];
    }
}
// Video search
export async function searchVideos(query, num = 30) {
    try {
        const response = await axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: query,
                format: 'json',
                categories: 'videos',
            },
            timeout: 20000,
        });
        return (response.data?.results || []).slice(0, num).map((r) => ({
            url: r.url,
            title: r.title,
            content: r.content,
            engine: r.engine,
            thumbnail: r.thumbnail || r.img_src,
        }));
    }
    catch (error) {
        console.error(`[SearXNG] Video search error: ${error.message}`);
        return [];
    }
}
// News search - searches multiple engines and strategies for maximum coverage
export async function searchNews(query, num = 50) {
    const allResults = [];
    try {
        // Strategy 1: Direct news category search
        const newsPromise = axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: query,
                format: 'json',
                categories: 'news',
            },
            timeout: 20000,
        }).catch(() => ({ data: { results: [] } }));
        // Strategy 2: News with different phrasing
        const recentNewsPromise = axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: `${query} latest news report`,
                format: 'json',
                categories: 'news',
            },
            timeout: 20000,
        }).catch(() => ({ data: { results: [] } }));
        // Strategy 3: General web search for news articles
        const webNewsPromise = axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: `${query} news article report breaking`,
                format: 'json',
                categories: 'general',
            },
            timeout: 20000,
        }).catch(() => ({ data: { results: [] } }));
        // Strategy 4: Search major news sites directly
        const majorNewsSites = ['bbc.com', 'cnn.com', 'nytimes.com', 'reuters.com', 'theguardian.com', 'apnews.com'];
        const siteSearchPromise = axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: `${query} (site:${majorNewsSites.join(' OR site:')})`,
                format: 'json',
                categories: 'general',
            },
            timeout: 20000,
        }).catch(() => ({ data: { results: [] } }));
        // Strategy 5: Historical/archival news
        const archiveNewsPromise = axios.get(`${SEARXNG_URL}/search`, {
            params: {
                q: `${query} newspaper article archive history`,
                format: 'json',
                categories: 'general',
            },
            timeout: 20000,
        }).catch(() => ({ data: { results: [] } }));
        // Run all searches in parallel
        const [newsRes, recentRes, webRes, siteRes, archiveRes] = await Promise.all([
            newsPromise, recentNewsPromise, webNewsPromise, siteSearchPromise, archiveNewsPromise
        ]);
        allResults.push(...(newsRes.data?.results || []));
        allResults.push(...(recentRes.data?.results || []));
        allResults.push(...(webRes.data?.results || []));
        allResults.push(...(siteRes.data?.results || []));
        allResults.push(...(archiveRes.data?.results || []));
    }
    catch (error) {
        console.error(`[SearXNG] News search error: ${error.message}`);
    }
    // Deduplicate by URL
    const unique = allResults.filter((item, index, self) => index === self.findIndex(t => t.url === item.url));
    console.log(`[SearXNG] News search found ${unique.length} unique results`);
    return unique.slice(0, num).map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content,
        engine: r.engine || (r.engines || []).join(', '),
        publishedDate: r.publishedDate,
    }));
}
// Site-specific search (like site:example.com query)
export async function searchSite(site, query, num = 20) {
    const fullQuery = `site:${site} ${query}`;
    return searchWeb(fullQuery, num);
}
// Site-specific IMAGE search (returns actual image URLs)
export async function searchSiteImages(site, query, num = 30) {
    const fullQuery = `site:${site} ${query}`;
    return searchImages(fullQuery, num);
}
// Health check
export async function checkHealth() {
    try {
        const response = await axios.get(`${SEARXNG_URL}/search`, {
            params: { q: 'test', format: 'json' },
            timeout: 5000,
        });
        return response.status === 200;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=searxng.js.map