// Web Search Service - Archive.org Native API + Serper
// 1. Archive.org - Native API (better results, no Google indexing issues)
// 2. Serper - Web search, news, images (excluding YouTube/TikTok)
// 3. No limits - fetch everything found

import axios from 'axios';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Delay helper to avoid rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// User agent for Archive.org (be a good citizen)
const ARCHIVE_USER_AGENT = 'MediaMind Research Bot/1.0 (automated research tool)';

// Sites to EXCLUDE (can't download from these)
const EXCLUDED_SITES = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'twitter.com',
  'x.com',
];

interface VideoSearchResult {
  url: string;
  title: string;
  source: string;
  duration?: number;
  thumbnail?: string;
  snippet?: string;
  identifier?: string;
}

interface ImageSearchResult {
  url: string;
  title: string;
  source: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

interface NewsSearchResult {
  url: string;
  title: string;
  source: string;
  snippet?: string;
  date?: string;
}

interface NewspaperResult {
  url: string;
  title: string;
  source: string;
  date?: string;
  snippet?: string;
  imageUrl?: string;
}

// ============================================
// ARCHIVE.ORG NATIVE API (Videos & Images)
// ============================================

// Search Archive.org using their native API - much better than Serper site: search
async function searchArchiveOrgVideos(topic: string): Promise<VideoSearchResult[]> {
  console.log(`[Archive.org] Searching videos for "${topic}"...`);

  const results: VideoSearchResult[] = [];

  try {
    // Search for movies/videos (mediatype goes IN the query, not as separate param)
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(topic)}+AND+mediatype:movies&fl[]=identifier,title,description,mediatype&sort[]=downloads+desc&rows=100&output=json`;

    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': ARCHIVE_USER_AGENT },
      timeout: 30000,
    });

    const docs = response.data?.response?.docs || [];
    console.log(`[Archive.org] Found ${docs.length} video items`);

    // Process results (limit to first 50 to avoid timeout)
    const maxToProcess = Math.min(docs.length, 50);
    for (let i = 0; i < maxToProcess; i++) {
      const doc = docs[i];

      // Add small delay to be nice to Archive.org
      await delay(200);

      try {
        // Get metadata to find actual video file
        const metaResponse = await axios.get(
          `https://archive.org/metadata/${doc.identifier}`,
          {
            headers: { 'User-Agent': ARCHIVE_USER_AGENT },
            timeout: 15000,
          }
        );

        const files = metaResponse.data?.files || [];
        const metadata = metaResponse.data?.metadata || {};

        // Find MP4 file (prefer derivative/smaller files)
        const videoFile = files.find((f: any) =>
          f.name?.endsWith('.mp4') && f.source === 'derivative'
        ) || files.find((f: any) => f.name?.endsWith('.mp4'));

        if (videoFile) {
          results.push({
            url: `https://archive.org/download/${doc.identifier}/${videoFile.name}`,
            title: metadata.title || doc.title || doc.identifier,
            source: 'archive.org',
            thumbnail: `https://archive.org/services/img/${doc.identifier}`,
            snippet: typeof metadata.description === 'string'
              ? metadata.description.slice(0, 200)
              : Array.isArray(metadata.description)
                ? metadata.description[0]?.slice(0, 200)
                : undefined,
            identifier: doc.identifier,
          });
          console.log(`[Archive.org] Added video: ${doc.title?.slice(0, 50)}...`);
        }
      } catch (e: any) {
        // Skip items with errors, continue with others
        console.log(`[Archive.org] Skipped ${doc.identifier}: ${e.message}`);
      }
    }

  } catch (error: any) {
    console.error(`[Archive.org] Video search failed:`, error.message);
  }

  console.log(`[Archive.org] Total videos found: ${results.length}`);
  return results;
}

// Search Archive.org for images
async function searchArchiveOrgImages(topic: string): Promise<ImageSearchResult[]> {
  console.log(`[Archive.org] Searching images for "${topic}"...`);

  const results: ImageSearchResult[] = [];

  try {
    // Search for images (mediatype goes IN the query, not as separate param)
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(topic)}+AND+mediatype:image&fl[]=identifier,title,mediatype&sort[]=downloads+desc&rows=50&output=json`;

    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': ARCHIVE_USER_AGENT },
      timeout: 30000,
    });

    const docs = response.data?.response?.docs || [];
    console.log(`[Archive.org] Found ${docs.length} image items`);

    for (const doc of docs) {
      if (doc.mediatype !== 'image') continue;

      await delay(300);

      try {
        const metaResponse = await axios.get(
          `https://archive.org/metadata/${doc.identifier}`,
          {
            headers: { 'User-Agent': ARCHIVE_USER_AGENT },
            timeout: 10000,
          }
        );

        const files = metaResponse.data?.files || [];
        const metadata = metaResponse.data?.metadata || {};

        // Find image file
        const imageFile = files.find((f: any) =>
          /\.(jpg|jpeg|png|gif)$/i.test(f.name) &&
          f.source !== 'metadata' &&
          !f.name?.includes('thumb')
        );

        if (imageFile) {
          results.push({
            url: `https://archive.org/download/${doc.identifier}/${imageFile.name}`,
            title: metadata.title || doc.title || doc.identifier,
            source: 'archive.org',
            thumbnail: `https://archive.org/services/img/${doc.identifier}`,
          });
        }
      } catch (e) {
        // Skip errors
      }
    }

  } catch (error: any) {
    console.error(`[Archive.org] Image search failed:`, error.message);
  }

  console.log(`[Archive.org] Total images found: ${results.length}`);
  return results;
}

// ============================================
// VIDEO SEARCH (Archive.org + Web)
// ============================================

export async function searchWebForVideos(topic: string, _maxResults?: number): Promise<VideoSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Search] Serper API key not set`);
    return [];
  }

  const results: VideoSearchResult[] = [];

  try {
    // Step 1: Archive.org Native API (BEST source for videos)
    console.log(`[Video] Step 1: Searching Archive.org...`);
    const archiveResults = await searchArchiveOrgVideos(topic);
    for (const r of archiveResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 2: Search web for pages WITH videos (excluding YouTube/TikTok)
    console.log(`[Video] Step 2: Searching web (excluding YouTube/TikTok)...`);
    const webResults = await searchWebPagesWithVideos(topic);
    for (const r of webResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 3: Alternative platforms (Vimeo, Dailymotion, etc.)
    console.log(`[Video] Step 3: Searching alternative platforms...`);
    const altResults = await searchAlternativeVideoPlatforms(topic);
    for (const r of altResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 4: Historical archives (British Pathé, C-SPAN, etc.)
    console.log(`[Video] Step 4: Searching historical archives...`);
    const histResults = await searchHistoricalVideoArchives(topic);
    for (const r of histResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

  } catch (error: any) {
    console.error(`[Video] Search failed:`, error.message);
  }

  console.log(`[Video] Total unique videos: ${results.length}`);
  return results; // No limit - return everything
}

// Search web pages that contain videos (CNN, BBC, etc.)
async function searchWebPagesWithVideos(topic: string): Promise<VideoSearchResult[]> {
  try {
    const exclusions = EXCLUDED_SITES.map(s => `-site:${s}`).join(' ');

    const queries = [
      `"${topic}" video ${exclusions}`,
      `"${topic}" footage OR clip ${exclusions}`,
    ];

    const results: VideoSearchResult[] = [];

    for (const query of queries) {
      await delay(500);

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, num: 30 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const organic = response.data?.organic || [];

      for (const item of organic) {
        const domain = extractDomain(item.link);
        if (EXCLUDED_SITES.some(s => domain.includes(s.replace('www.', '')))) continue;
        if (results.find(r => r.url === item.link)) continue;

        results.push({
          url: item.link,
          title: item.title,
          source: domain,
          snippet: item.snippet,
        });
      }
    }

    console.log(`[Video] Found ${results.length} web pages with videos`);
    return results;
  } catch (error: any) {
    console.error(`[Video] Web search failed:`, error.message);
    return [];
  }
}

// Search Vimeo, Dailymotion, etc.
async function searchAlternativeVideoPlatforms(topic: string): Promise<VideoSearchResult[]> {
  const platforms = [
    { site: 'vimeo.com', name: 'Vimeo' },
    { site: 'dailymotion.com', name: 'Dailymotion' },
    { site: 'rumble.com', name: 'Rumble' },
    { site: 'odysee.com', name: 'Odysee' },
  ];

  const results: VideoSearchResult[] = [];

  for (const platform of platforms) {
    try {
      await delay(500);

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${platform.site} "${topic}"`, num: 20 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const organic = response.data?.organic || [];
      for (const item of organic) {
        results.push({
          url: item.link,
          title: item.title,
          source: platform.name,
          snippet: item.snippet,
        });
      }

      console.log(`[Video] Found ${organic.length} on ${platform.name}`);
    } catch (e: any) {
      console.log(`[Video] ${platform.name} search failed: ${e.message}`);
    }
  }

  return results;
}

// Search British Pathé, C-SPAN, etc.
async function searchHistoricalVideoArchives(topic: string): Promise<VideoSearchResult[]> {
  const archives = [
    { site: 'britishpathe.com', name: 'British Pathé' },
    { site: 'c-span.org/video', name: 'C-SPAN' },
    { site: 'loc.gov', name: 'Library of Congress' },
    { site: 'aparchive.com', name: 'AP Archive' },
  ];

  const results: VideoSearchResult[] = [];

  for (const archive of archives) {
    try {
      await delay(500);

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${archive.site} "${topic}"`, num: 20 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const organic = response.data?.organic || [];
      for (const item of organic) {
        results.push({
          url: item.link,
          title: item.title,
          source: archive.name,
          snippet: item.snippet,
        });
      }

      console.log(`[Video] Found ${organic.length} on ${archive.name}`);
    } catch (e: any) {
      console.log(`[Video] ${archive.name} search failed: ${e.message}`);
    }
  }

  return results;
}

// ============================================
// IMAGE SEARCH (Archive.org + Google + Others)
// ============================================

export async function searchWebForImages(topic: string, _maxResults?: number): Promise<ImageSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Search] Serper API key not set`);
    return [];
  }

  const results: ImageSearchResult[] = [];

  try {
    // Step 1: Archive.org images
    console.log(`[Image] Step 1: Searching Archive.org...`);
    const archiveResults = await searchArchiveOrgImages(topic);
    for (const r of archiveResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 2: Google Images via Serper
    console.log(`[Image] Step 2: Searching Google Images...`);
    const googleResults = await searchGoogleImages(topic);
    for (const r of googleResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 3: Wikimedia Commons
    console.log(`[Image] Step 3: Searching Wikimedia Commons...`);
    const wikimediaResults = await searchWikimediaImages(topic);
    for (const r of wikimediaResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

    // Step 4: Flickr
    console.log(`[Image] Step 4: Searching Flickr...`);
    const flickrResults = await searchFlickrImages(topic);
    for (const r of flickrResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }

  } catch (error: any) {
    console.error(`[Image] Search failed:`, error.message);
  }

  console.log(`[Image] Total unique images: ${results.length}`);
  return results; // No limit - return everything
}

async function searchGoogleImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    const response = await axios.post(
      'https://google.serper.dev/images',
      { q: topic, num: 100 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const images = response.data?.images || [];
    console.log(`[Image] Found ${images.length} Google images`);

    return images.map((img: any) => ({
      url: img.imageUrl,
      title: img.title,
      source: extractDomain(img.link || img.imageUrl),
      width: img.imageWidth,
      height: img.imageHeight,
      thumbnail: img.thumbnailUrl,
    }));
  } catch (error: any) {
    console.error(`[Image] Google search failed:`, error.message);
    return [];
  }
}

async function searchWikimediaImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    await delay(500);

    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:commons.wikimedia.org "${topic}"`, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    console.log(`[Image] Found ${organic.length} Wikimedia images`);

    return organic.map((item: any) => ({
      url: item.link,
      title: item.title,
      source: 'Wikimedia Commons',
    }));
  } catch (error: any) {
    console.error(`[Image] Wikimedia search failed:`, error.message);
    return [];
  }
}

async function searchFlickrImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    await delay(500);

    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:flickr.com "${topic}"`, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    console.log(`[Image] Found ${organic.length} Flickr images`);

    return organic.map((item: any) => ({
      url: item.link,
      title: item.title,
      source: 'Flickr',
    }));
  } catch (error: any) {
    console.error(`[Image] Flickr search failed:`, error.message);
    return [];
  }
}

// ============================================
// NEWS SEARCH
// ============================================

export async function searchWebForNews(topic: string, _maxResults?: number): Promise<NewsSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Search] Serper API key not set`);
    return [];
  }

  const results: NewsSearchResult[] = [];

  try {
    // Step 1: Google News
    console.log(`[News] Step 1: Searching Google News...`);
    const response = await axios.post(
      'https://google.serper.dev/news',
      { q: topic, num: 50 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const news = response.data?.news || [];
    for (const n of news) {
      const domain = extractDomain(n.link);
      if (EXCLUDED_SITES.some(s => domain.includes(s.replace('www.', '')))) continue;

      results.push({
        url: n.link,
        title: n.title,
        source: n.source || domain,
        snippet: n.snippet,
        date: n.date,
      });
    }
    console.log(`[News] Found ${results.length} news articles`);

    // Step 2: General article search
    console.log(`[News] Step 2: Searching articles...`);
    await delay(500);

    const articleResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: topic, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = articleResponse.data?.organic || [];
    for (const o of organic) {
      const domain = extractDomain(o.link);
      if (EXCLUDED_SITES.some(s => domain.includes(s.replace('www.', '')))) continue;
      if (results.find(r => r.url === o.link)) continue;

      results.push({
        url: o.link,
        title: o.title,
        source: domain,
        snippet: o.snippet,
      });
    }

    // Step 3: Authoritative sources
    console.log(`[News] Step 3: Searching authoritative sources...`);
    const authSources = ['history.com', 'britannica.com', 'wikipedia.org'];

    // Filter out junk URLs (search pages, generic pages, tracking links)
    const isJunkUrl = (url: string): boolean => {
      const junkPatterns = [
        '/search?', '/search/',           // Search pages
        '/this-day-in-history/january',   // Generic date pages
        '/this-day-in-history/february',
        '/this-day-in-history/march',
        '/this-day-in-history/april',
        '/this-day-in-history/may',
        '/this-day-in-history/june',
        '/this-day-in-history/july',
        '/this-day-in-history/august',
        '/this-day-in-history/september',
        '/this-day-in-history/october',
        '/this-day-in-history/november',
        '/this-day-in-history/december',
        '/a-year-in-history/',            // Year archive pages
        '/shows/',                         // TV show pages
        '/related',                        // Related articles pages
        'links.e.',                        // Email tracking links
        '/question/',                      // Q&A pages (low quality)
      ];
      return junkPatterns.some(p => url.includes(p));
    };

    for (const source of authSources) {
      await delay(500);

      const sourceResponse = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${source} "${topic}"`, num: 10 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const sourceResults = sourceResponse.data?.organic || [];
      let added = 0;
      for (const s of sourceResults) {
        // Skip junk URLs
        if (isJunkUrl(s.link)) continue;
        if (results.find(r => r.url === s.link)) continue;

        results.push({
          url: s.link,
          title: s.title,
          source: extractDomain(s.link),
          snippet: s.snippet,
        });
        added++;
      }
      console.log(`[News] Found ${added} quality articles from ${source}`);
    }

  } catch (error: any) {
    console.error(`[News] Search failed:`, error.message);
  }

  console.log(`[News] Total unique articles: ${results.length}`);
  return results; // No limit - return everything
}

// ============================================
// NEWSPAPER SEARCH (Historical)
// ============================================

export async function searchHistoricalNewspapers(topic: string, _maxResults?: number): Promise<NewspaperResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Search] Serper API key not set`);
    return [];
  }

  const results: NewspaperResult[] = [];

  try {
    // Chronicling America (Library of Congress)
    console.log(`[Newspaper] Searching Chronicling America...`);
    const chroniclingResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:chroniclingamerica.loc.gov "${topic}"`, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const chroniclingResults = chroniclingResponse.data?.organic || [];
    for (const item of chroniclingResults) {
      const dateMatch = item.link?.match(/\/(\d{4}-\d{2}-\d{2})\//);
      results.push({
        url: item.link,
        title: item.title,
        source: 'Library of Congress',
        date: dateMatch ? dateMatch[1] : undefined,
        snippet: item.snippet,
        imageUrl: item.link?.replace(/\/$/, '') + '.jp2',
      });
    }
    console.log(`[Newspaper] Found ${chroniclingResults.length} from Chronicling America`);

    // Archive.org newspapers
    await delay(500);
    console.log(`[Newspaper] Searching Archive.org newspapers...`);
    const archiveResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:archive.org "${topic}" newspaper OR gazette`, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const archiveResults = archiveResponse.data?.organic || [];
    for (const item of archiveResults) {
      if (results.find(r => r.url === item.link)) continue;

      const identifier = item.link?.match(/archive\.org\/details\/([^\/\?]+)/)?.[1];
      results.push({
        url: item.link,
        title: item.title,
        source: 'archive.org',
        snippet: item.snippet,
        imageUrl: identifier ? `https://archive.org/services/img/${identifier}` : undefined,
      });
    }
    console.log(`[Newspaper] Found ${archiveResults.length} from Archive.org`);

    // newspapers.com
    await delay(500);
    console.log(`[Newspaper] Searching newspapers.com...`);
    const newspapersResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:newspapers.com "${topic}"`, num: 20 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const newspapersResults = newspapersResponse.data?.organic || [];
    for (const item of newspapersResults) {
      if (results.find(r => r.url === item.link)) continue;

      results.push({
        url: item.link,
        title: item.title,
        source: 'newspapers.com',
        snippet: item.snippet,
      });
    }
    console.log(`[Newspaper] Found ${newspapersResults.length} from newspapers.com`);

  } catch (error: any) {
    console.error(`[Newspaper] Search failed:`, error.message);
  }

  console.log(`[Newspaper] Total newspapers: ${results.length}`);
  return results; // No limit - return everything
}

// ============================================
// COMBINED SEARCH
// ============================================

export interface CombinedSearchResults {
  videos: VideoSearchResult[];
  images: ImageSearchResult[];
  newspapers: NewspaperResult[];
  news: NewsSearchResult[];
}

export async function searchAllMedia(topic: string): Promise<CombinedSearchResults> {
  console.log(`\n========================================`);
  console.log(`[Search] COMBINED SEARCH: "${topic}"`);
  console.log(`[Search] NO LIMITS - Fetching everything`);
  console.log(`========================================\n`);

  // Run all searches in parallel
  const [videos, images, newspapers, news] = await Promise.all([
    searchWebForVideos(topic),
    searchWebForImages(topic),
    searchHistoricalNewspapers(topic),
    searchWebForNews(topic),
  ]);

  console.log(`\n========================================`);
  console.log(`[Search] RESULTS SUMMARY`);
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

function extractDomain(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain;
  } catch {
    return 'unknown';
  }
}
