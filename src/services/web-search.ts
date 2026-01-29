// Web Search Service - Serper Only
// Uses Serper API for all searches:
// 1. Archive.org (historical content via site: search)
// 2. Web search (articles with embedded videos, NOT YouTube/TikTok)
// 3. Multiple authoritative sources

import axios from 'axios';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Sites to EXCLUDE (can't download from these)
const EXCLUDED_VIDEO_SITES = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'twitter.com',
  'x.com',
];

// Authoritative sources for videos/content
const VIDEO_SOURCES = [
  'cnn.com',
  'bbc.com',
  'bbc.co.uk',
  'abcnews.go.com',
  'nbcnews.com',
  'cbsnews.com',
  'history.com',
  'britannica.com',
  'archive.org',
  'c-span.org',
  'apnews.com',
  'reuters.com',
  'aljazeera.com',
  'france24.com',
  'dw.com',
  'pbs.org',
  'npr.org',
  'vimeo.com',
  'dailymotion.com',
  'veoh.com',
  'criterionchannel.com',
  'loc.gov',
  'smithsonianmag.com',
  'nationalgeographic.com',
  'theatlantic.com',
  'theguardian.com',
  'nytimes.com',
  'washingtonpost.com',
  'latimes.com',
];

interface VideoSearchResult {
  url: string;
  title: string;
  source: string;
  duration?: number;
  thumbnail?: string;
  snippet?: string;
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
// VIDEO SEARCH (Web pages with videos, NOT YouTube)
// ============================================

export async function searchWebForVideos(
  topic: string,
  maxResults: number = 30
): Promise<VideoSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set`);
    return [];
  }

  const results: VideoSearchResult[] = [];

  try {
    // Step 1: Search Archive.org for historical videos
    console.log(`[Serper] Step 1: Searching Archive.org for "${topic}" videos...`);
    const archiveResults = await searchArchiveVideos(topic);
    for (const r of archiveResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${archiveResults.length} Archive.org videos`);

    // Step 2: Search web for pages WITH videos (excluding YouTube/TikTok)
    console.log(`[Serper] Step 2: Searching web for "${topic}" (excluding YouTube/TikTok)...`);
    const webResults = await searchWebPagesWithVideos(topic);
    for (const r of webResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${webResults.length} web pages with videos`);

    // Step 3: Search specific video-friendly sites
    console.log(`[Serper] Step 3: Searching video sources (Vimeo, Dailymotion, etc.)...`);
    const altPlatformResults = await searchAlternativeVideoPlatforms(topic);
    for (const r of altPlatformResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${altPlatformResults.length} alternative platform videos`);

    // Step 4: Search British Pathé and other historical sources
    console.log(`[Serper] Step 4: Searching historical video archives...`);
    const historicalResults = await searchHistoricalVideoArchives(topic);
    for (const r of historicalResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${historicalResults.length} historical archive videos`);

  } catch (error: any) {
    console.error(`[Serper] Video search failed:`, error.message);
  }

  console.log(`[Serper] Total unique videos: ${results.length}`);
  return results.slice(0, maxResults);
}

// Search Archive.org videos via Serper
async function searchArchiveVideos(topic: string): Promise<VideoSearchResult[]> {
  try {
    // Multiple queries to get more Archive.org results
    const queries = [
      `site:archive.org "${topic}" video`,
      `site:archive.org "${topic}" newsreel OR footage OR film`,
      `site:archive.org/details "${topic}"`,
    ];

    const results: VideoSearchResult[] = [];

    for (const query of queries) {
      if (results.length >= 15) break;

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, num: 20 },
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
        if (results.length >= 15) break;

        // Extract Archive.org identifier
        const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
        if (!match) continue;

        const identifier = match[1];

        // Skip if already have this
        if (results.find(r => r.url.includes(identifier))) continue;

        try {
          // Get metadata to find actual video file
          const metaResponse = await axios.get(
            `https://archive.org/metadata/${identifier}`,
            { timeout: 10000 }
          );

          const files = metaResponse.data?.files || [];
          const metadata = metaResponse.data?.metadata || {};

          // Find MP4 file
          const videoFile = files.find((f: any) =>
            f.name?.endsWith('.mp4') && f.source === 'derivative'
          ) || files.find((f: any) => f.name?.endsWith('.mp4'));

          if (videoFile) {
            results.push({
              url: `https://archive.org/download/${identifier}/${videoFile.name}`,
              title: metadata.title || item.title || identifier,
              source: 'archive.org',
              thumbnail: `https://archive.org/services/img/${identifier}`,
              snippet: item.snippet,
            });
          }
        } catch (e) {
          // Skip items with metadata errors
        }
      }
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Archive video search failed:`, error.message);
    return [];
  }
}

// Search web pages that contain videos (CNN, BBC, History.com, etc.)
async function searchWebPagesWithVideos(topic: string): Promise<VideoSearchResult[]> {
  try {
    // Build exclusion string
    const exclusions = EXCLUDED_VIDEO_SITES.map(s => `-site:${s}`).join(' ');

    // Search for web pages with video content
    const queries = [
      `"${topic}" video ${exclusions}`,
      `"${topic}" footage OR clip ${exclusions}`,
      `"${topic}" watch ${exclusions}`,
    ];

    const results: VideoSearchResult[] = [];

    for (const query of queries) {
      if (results.length >= 20) break;

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, num: 15 },
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

        // Skip excluded sites
        if (EXCLUDED_VIDEO_SITES.some(s => domain.includes(s.replace('www.', '')))) {
          continue;
        }

        // Skip if already have this URL
        if (results.find(r => r.url === item.link)) continue;

        results.push({
          url: item.link,
          title: item.title,
          source: domain,
          snippet: item.snippet,
          thumbnail: item.sitelinks?.[0]?.link,
        });
      }
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Web video search failed:`, error.message);
    return [];
  }
}

// Search Vimeo, Dailymotion, and other alternative platforms
async function searchAlternativeVideoPlatforms(topic: string): Promise<VideoSearchResult[]> {
  try {
    const platforms = [
      { site: 'vimeo.com', name: 'Vimeo' },
      { site: 'dailymotion.com', name: 'Dailymotion' },
      { site: 'rumble.com', name: 'Rumble' },
      { site: 'odysee.com', name: 'Odysee' },
    ];

    const results: VideoSearchResult[] = [];

    for (const platform of platforms) {
      if (results.length >= 10) break;

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${platform.site} "${topic}"`, num: 5 },
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
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Alternative platform search failed:`, error.message);
    return [];
  }
}

// Search British Pathé, AP Archive, Reuters, etc.
async function searchHistoricalVideoArchives(topic: string): Promise<VideoSearchResult[]> {
  try {
    const archives = [
      { site: 'britishpathe.com', name: 'British Pathé' },
      { site: 'aparchive.com', name: 'AP Archive' },
      { site: 'gettyimages.com/videos', name: 'Getty Videos' },
      { site: 'c-span.org/video', name: 'C-SPAN' },
      { site: 'loc.gov', name: 'Library of Congress' },
    ];

    const results: VideoSearchResult[] = [];

    for (const archive of archives) {
      if (results.length >= 10) break;

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${archive.site} "${topic}"`, num: 5 },
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
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Historical archive search failed:`, error.message);
    return [];
  }
}

// ============================================
// IMAGE SEARCH (More sources, more results)
// ============================================

export async function searchWebForImages(
  topic: string,
  maxResults: number = 50
): Promise<ImageSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set`);
    return [];
  }

  const results: ImageSearchResult[] = [];

  try {
    // Step 1: Search Archive.org for historical images
    console.log(`[Serper] Step 1: Searching Archive.org for "${topic}" images...`);
    const archiveResults = await searchArchiveImages(topic);
    for (const r of archiveResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${archiveResults.length} Archive.org images`);

    // Step 2: Search Google Images
    console.log(`[Serper] Step 2: Searching Google Images for "${topic}"...`);
    const googleResults = await searchGoogleImages(topic);
    for (const r of googleResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${googleResults.length} Google images`);

    // Step 3: Search Wikimedia Commons
    console.log(`[Serper] Step 3: Searching Wikimedia Commons for "${topic}"...`);
    const wikimediaResults = await searchWikimediaImages(topic);
    for (const r of wikimediaResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${wikimediaResults.length} Wikimedia images`);

    // Step 4: Search Flickr Commons
    console.log(`[Serper] Step 4: Searching Flickr for "${topic}"...`);
    const flickrResults = await searchFlickrImages(topic);
    for (const r of flickrResults) {
      if (!results.find(e => e.url === r.url)) results.push(r);
    }
    console.log(`[Serper] Found ${flickrResults.length} Flickr images`);

  } catch (error: any) {
    console.error(`[Serper] Image search failed:`, error.message);
  }

  console.log(`[Serper] Total unique images: ${results.length}`);
  return results.slice(0, maxResults);
}

// Search Archive.org images via Serper
async function searchArchiveImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    const queries = [
      `site:archive.org "${topic}" photo OR photograph`,
      `site:archive.org "${topic}" image OR picture`,
    ];

    const results: ImageSearchResult[] = [];

    for (const query of queries) {
      if (results.length >= 15) break;

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: query, num: 15 },
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
        const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
        if (!match) continue;

        const identifier = match[1];
        if (results.find(r => r.url.includes(identifier))) continue;

        try {
          const metaResponse = await axios.get(
            `https://archive.org/metadata/${identifier}`,
            { timeout: 10000 }
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
              url: `https://archive.org/download/${identifier}/${imageFile.name}`,
              title: metadata.title || item.title || identifier,
              source: 'archive.org',
              thumbnail: `https://archive.org/services/img/${identifier}`,
            });
          }
        } catch (e) {
          // Skip items with metadata errors
        }
      }
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Archive image search failed:`, error.message);
    return [];
  }
}

// Search Google images via Serper
async function searchGoogleImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    const response = await axios.post(
      'https://google.serper.dev/images',
      { q: topic, num: 30 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const images = response.data?.images || [];
    return images.map((img: any) => ({
      url: img.imageUrl,
      title: img.title,
      source: extractDomain(img.link || img.imageUrl),
      width: img.imageWidth,
      height: img.imageHeight,
      thumbnail: img.thumbnailUrl,
    }));
  } catch (error: any) {
    console.error(`[Serper] Google image search failed:`, error.message);
    return [];
  }
}

// Search Wikimedia Commons
async function searchWikimediaImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:commons.wikimedia.org "${topic}"`, num: 10 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    return organic.map((item: any) => ({
      url: item.link,
      title: item.title,
      source: 'Wikimedia Commons',
    }));
  } catch (error: any) {
    console.error(`[Serper] Wikimedia search failed:`, error.message);
    return [];
  }
}

// Search Flickr
async function searchFlickrImages(topic: string): Promise<ImageSearchResult[]> {
  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:flickr.com "${topic}"`, num: 10 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    return organic.map((item: any) => ({
      url: item.link,
      title: item.title,
      source: 'Flickr',
    }));
  } catch (error: any) {
    console.error(`[Serper] Flickr search failed:`, error.message);
    return [];
  }
}

// ============================================
// NEWS SEARCH (More sources)
// ============================================

export async function searchWebForNews(
  topic: string,
  maxResults: number = 30
): Promise<NewsSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set`);
    return [];
  }

  const results: NewsSearchResult[] = [];

  try {
    // Step 1: Google News search
    console.log(`[Serper] Searching news for "${topic}"...`);
    const response = await axios.post(
      'https://google.serper.dev/news',
      { q: topic, num: 20 },
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
      // Skip excluded sites
      if (EXCLUDED_VIDEO_SITES.some(s => domain.includes(s.replace('www.', '')))) {
        continue;
      }
      results.push({
        url: n.link,
        title: n.title,
        source: n.source || domain,
        snippet: n.snippet,
        date: n.date,
      });
    }
    console.log(`[Serper] Found ${results.length} news articles (filtered)`);

    // Step 2: General article search
    console.log(`[Serper] Searching articles for "${topic}"...`);
    const articleResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: `${topic}`, num: 15 },
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
      // Skip excluded sites
      if (EXCLUDED_VIDEO_SITES.some(s => domain.includes(s.replace('www.', '')))) {
        continue;
      }
      if (!results.find(r => r.url === o.link)) {
        results.push({
          url: o.link,
          title: o.title,
          source: domain,
          snippet: o.snippet,
        });
      }
    }

    // Step 3: Search authoritative sources specifically
    console.log(`[Serper] Searching authoritative sources...`);
    const authSources = ['history.com', 'britannica.com', 'wikipedia.org'];
    for (const source of authSources) {
      const sourceResponse = await axios.post(
        'https://google.serper.dev/search',
        { q: `site:${source} "${topic}"`, num: 5 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const sourceResults = sourceResponse.data?.organic || [];
      for (const s of sourceResults) {
        if (!results.find(r => r.url === s.link)) {
          results.push({
            url: s.link,
            title: s.title,
            source: extractDomain(s.link),
            snippet: s.snippet,
          });
        }
      }
    }

  } catch (error: any) {
    console.error(`[Serper] News search failed:`, error.message);
  }

  return results.slice(0, maxResults);
}

// ============================================
// HISTORICAL NEWSPAPER SEARCH
// ============================================

export async function searchHistoricalNewspapers(
  topic: string,
  maxResults: number = 15
): Promise<NewspaperResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set`);
    return [];
  }

  const results: NewspaperResult[] = [];

  try {
    // Search Chronicling America (Library of Congress)
    console.log(`[Serper] Searching Chronicling America for "${topic}"...`);
    const chroniclingQuery = `site:chroniclingamerica.loc.gov "${topic}"`;

    const chroniclingResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: chroniclingQuery, num: 10 },
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
    console.log(`[Serper] Found ${chroniclingResults.length} Chronicling America results`);

    // Search Archive.org newspapers
    console.log(`[Serper] Searching Archive.org newspapers for "${topic}"...`);
    const archiveQuery = `site:archive.org "${topic}" newspaper OR gazette OR "news clipping"`;

    const archiveResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: archiveQuery, num: 10 },
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

    // Search newspapers.com
    console.log(`[Serper] Searching newspapers.com for "${topic}"...`);
    const newspapersResponse = await axios.post(
      'https://google.serper.dev/search',
      { q: `site:newspapers.com "${topic}"`, num: 5 },
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
      if (!results.find(r => r.url === item.link)) {
        results.push({
          url: item.link,
          title: item.title,
          source: 'newspapers.com',
          snippet: item.snippet,
        });
      }
    }
    console.log(`[Serper] Found ${newspapersResults.length} newspapers.com results`);

  } catch (error: any) {
    console.error(`[Serper] Newspaper search failed:`, error.message);
  }

  console.log(`[Serper] Total newspapers: ${results.length}`);
  return results.slice(0, maxResults);
}

// ============================================
// COMBINED SEARCH (ALL MEDIA TYPES)
// ============================================

export interface CombinedSearchResults {
  videos: VideoSearchResult[];
  images: ImageSearchResult[];
  newspapers: NewspaperResult[];
  news: NewsSearchResult[];
}

export async function searchAllMedia(
  topic: string,
  options?: {
    maxVideos?: number;
    maxImages?: number;
    maxNewspapers?: number;
    maxNews?: number;
  }
): Promise<CombinedSearchResults> {
  const opts = {
    maxVideos: options?.maxVideos ?? 30,
    maxImages: options?.maxImages ?? 50,
    maxNewspapers: options?.maxNewspapers ?? 15,
    maxNews: options?.maxNews ?? 30,
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

function extractDomain(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain;
  } catch {
    return 'unknown';
  }
}

function parseDuration(durationStr?: string): number | undefined {
  if (!durationStr) return undefined;

  const parts = durationStr.split(':').map(p => parseInt(p));
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}
