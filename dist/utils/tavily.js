// Tavily Search Utility
// AI-optimized web search for relevant articles and news
import { tavily } from '@tavily/core';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
// Initialize Tavily client
const client = tavily({ apiKey: TAVILY_API_KEY });
// Search for articles/news with AI-optimized relevance
export async function searchArticles(query, maxResults = 10) {
    if (!TAVILY_API_KEY) {
        console.error('[Tavily] API key not configured');
        return [];
    }
    try {
        console.log(`[Tavily] Searching: "${query}"`);
        const response = await client.search(query, {
            maxResults: maxResults,
            searchDepth: 'advanced',
            includeAnswer: false,
        });
        const results = (response.results || []).map((r) => ({
            url: r.url,
            title: r.title,
            content: r.content || '',
            score: r.score || 0,
            publishedDate: r.publishedDate,
        }));
        console.log(`[Tavily] Found ${results.length} results (scores: ${results.map(r => r.score.toFixed(2)).join(', ')})`);
        return results;
    }
    catch (error) {
        console.error(`[Tavily] Search error: ${error.message}`);
        return [];
    }
}
// Search specifically for news articles
export async function searchNews(query, maxResults = 10) {
    if (!TAVILY_API_KEY) {
        console.error('[Tavily] API key not configured');
        return [];
    }
    try {
        console.log(`[Tavily] Searching news: "${query}"`);
        const response = await client.search(`${query} news report article`, {
            maxResults: maxResults,
            searchDepth: 'advanced',
            includeAnswer: false,
        });
        const results = (response.results || []).map((r) => ({
            url: r.url,
            title: r.title,
            content: r.content || '',
            score: r.score || 0,
            publishedDate: r.publishedDate,
        }));
        console.log(`[Tavily] Found ${results.length} news results`);
        return results;
    }
    catch (error) {
        console.error(`[Tavily] News search error: ${error.message}`);
        return [];
    }
}
// Search specific site via Tavily
export async function searchSite(site, query, maxResults = 5) {
    return searchArticles(`site:${site} ${query}`, maxResults);
}
// Health check
export async function checkHealth() {
    if (!TAVILY_API_KEY)
        return false;
    try {
        const response = await client.search('test', { maxResults: 1 });
        return response.results?.length > 0;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=tavily.js.map