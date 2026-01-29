// Web Search Service
// Searches the web for videos, images, articles, and historical newspapers using Serper API
// Uses Google site search to bypass Archive.org API rate limits

import axios from 'axios';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface VideoSearchResult {
  url: string;
  title: string;
  source: string;
  duration?: number;
  thumbnail?: string;
  archiveId?: string; // For Archive.org items
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
  imageUrl?: string; // Direct link to newspaper page image
}

// ============================================
// VIDEO SEARCH
// ============================================

export async function searchWebForVideos(
  topic: string,
  maxResults: number = 20
): Promise<VideoSearchResult[]> {
  const results: VideoSearchResult[] = [];

  try {
    // Search Archive.org via Serper (Google) - no rate limits!
    console.log(`[WebSearch] Searching Archive.org via Serper for: ${topic}`);
    const archiveResults = await searchArchiveViaSerper(topic, 'video');
    for (const r of archiveResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }
    console.log(`[WebSearch] Found ${archiveResults.length} Archive.org videos`);

    // Search Pexels for stock videos (modern footage)
    const pexelsResults = await searchPexelsVideos(topic);
    for (const r of pexelsResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }
    console.log(`[WebSearch] Found ${pexelsResults.length} Pexels videos`);

  } catch (error: any) {
    console.error(`[WebSearch] Video search failed:`, error.message);
  }

  console.log(`[WebSearch] Found ${results.length} total unique videos`);
  return results.slice(0, maxResults);
}

async function searchPexelsVideos(query: string): Promise<VideoSearchResult[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.log(`[Pexels] API key not set, skipping video search`);
    return [];
  }

  try {
    const response = await axios.get(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=10`,
      {
        headers: { Authorization: apiKey },
        timeout: 15000,
      }
    );

    const videos = response.data?.videos || [];
    return videos.map((v: any) => {
      // Get the HD or SD video file
      const videoFile = v.video_files?.find((f: any) => f.quality === 'hd' && f.width <= 1280)
        || v.video_files?.find((f: any) => f.quality === 'sd')
        || v.video_files?.[0];

      return {
        url: videoFile?.link || '',
        title: v.url?.split('/').pop() || query,
        source: 'pexels',
        duration: v.duration,
        thumbnail: v.image,
      };
    }).filter((v: VideoSearchResult) => v.url);
  } catch (error: any) {
    console.error(`[Pexels] Video search failed:`, error.message);
    return [];
  }
}

async function searchSerperVideos(query: string): Promise<VideoSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set, skipping`);
    return [];
  }

  try {
    const response = await axios.post(
      'https://google.serper.dev/videos',
      { q: query, num: 10 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const videos = response.data?.videos || [];
    return videos.map((v: any) => ({
      url: v.link,
      title: v.title,
      source: extractDomain(v.link),
      duration: parseDuration(v.duration),
      thumbnail: v.imageUrl,
    }));
  } catch (error: any) {
    console.error(`[Serper] Video search failed:`, error.message);
    return [];
  }
}

// ============================================
// SERPER-BASED ARCHIVE.ORG SEARCH (NO RATE LIMITS!)
// ============================================

async function searchArchiveViaSerper(
  query: string,
  mediaType: 'video' | 'image' = 'video'
): Promise<VideoSearchResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set, skipping Archive.org search`);
    return [];
  }

  try {
    // Build search query for Archive.org
    const searchQuery = mediaType === 'video'
      ? `site:archive.org "${query}" video OR film OR newsreel OR footage`
      : `site:archive.org "${query}" photo OR image OR photograph`;

    console.log(`[Serper] Searching: ${searchQuery}`);

    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: searchQuery, num: 20 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    const results: VideoSearchResult[] = [];

    for (const item of organic) {
      // Extract Archive.org identifier from URL
      // URLs look like: https://archive.org/details/identifier
      const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
      if (!match) continue;

      const identifier = match[1];

      // Get the direct video/image URL
      try {
        // Only make ONE metadata request per item (efficient)
        const metaResponse = await axios.get(
          `https://archive.org/metadata/${identifier}`,
          { timeout: 10000 }
        );

        const files = metaResponse.data?.files || [];
        const metadata = metaResponse.data?.metadata || {};

        if (mediaType === 'video') {
          // Find MP4 file (prefer derivative/smaller files)
          const videoFile = files.find((f: any) =>
            f.name?.endsWith('.mp4') && f.source === 'derivative'
          ) || files.find((f: any) => f.name?.endsWith('.mp4'));

          if (videoFile) {
            results.push({
              url: `https://archive.org/download/${identifier}/${videoFile.name}`,
              title: metadata.title || item.title || identifier,
              source: 'archive.org',
              archiveId: identifier,
              thumbnail: `https://archive.org/services/img/${identifier}`,
            });
          }
        } else {
          // Find image file
          const imageFile = files.find((f: any) =>
            /\.(jpg|jpeg|png|gif)$/i.test(f.name) && f.source !== 'metadata'
          );

          if (imageFile) {
            results.push({
              url: `https://archive.org/download/${identifier}/${imageFile.name}`,
              title: metadata.title || item.title || identifier,
              source: 'archive.org',
              archiveId: identifier,
              thumbnail: `https://archive.org/services/img/${identifier}`,
            });
          }
        }
      } catch (e) {
        // Skip items with metadata errors
        console.log(`[Archive.org] Skipping ${identifier}: metadata fetch failed`);
      }

      // Limit to 10 results to avoid too many metadata requests
      if (results.length >= 10) break;
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Archive.org search failed:`, error.message);
    return [];
  }
}

// ============================================
// HISTORICAL NEWSPAPER SEARCH (via Serper)
// ============================================

export async function searchHistoricalNewspapers(
  topic: string,
  maxResults: number = 10
): Promise<NewspaperResult[]> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] API key not set, skipping newspaper search`);
    return [];
  }

  const results: NewspaperResult[] = [];

  try {
    // Search Chronicling America (Library of Congress newspapers)
    const chroniclingQuery = `site:chroniclingamerica.loc.gov "${topic}"`;
    console.log(`[Serper] Searching newspapers: ${chroniclingQuery}`);

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
      // Extract date and newspaper name from URL/title
      // URLs look like: https://chroniclingamerica.loc.gov/lccn/sn84026749/1920-01-15/ed-1/seq-1/
      const dateMatch = item.link?.match(/\/(\d{4}-\d{2}-\d{2})\//);

      results.push({
        url: item.link,
        title: item.title,
        source: 'chroniclingamerica.loc.gov',
        date: dateMatch ? dateMatch[1] : undefined,
        snippet: item.snippet,
        // Convert page URL to image URL
        imageUrl: item.link?.replace(/\/$/, '') + '.jp2',
      });
    }

    // Also search Archive.org newspapers
    const archiveQuery = `site:archive.org "${topic}" newspaper OR "news clipping" OR gazette`;
    console.log(`[Serper] Searching Archive.org newspapers: ${archiveQuery}`);

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

  } catch (error: any) {
    console.error(`[Serper] Newspaper search failed:`, error.message);
  }

  console.log(`[WebSearch] Found ${results.length} newspaper results`);
  return results.slice(0, maxResults);
}

// ============================================
// IMAGE SEARCH
// ============================================

export async function searchWebForImages(
  topic: string,
  maxResults: number = 30
): Promise<ImageSearchResult[]> {
  const results: ImageSearchResult[] = [];

  try {
    // 1. Archive.org historical images via Serper (most valuable for documentaries)
    console.log(`[WebSearch] Searching Archive.org images via Serper for: ${topic}`);
    const archiveResults = await searchArchiveImagesViaSerper(topic);
    for (const r of archiveResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }
    console.log(`[WebSearch] Found ${archiveResults.length} Archive.org images`);

    // 2. Serper general image search (finds images across the web)
    const serperResults = await searchSerperImages(`${topic} historical photo`);
    for (const r of serperResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }

    // 3. Wikimedia Commons (public domain images)
    const wikiResults = await searchWikimediaImages(topic);
    for (const r of wikiResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }

    // 4. Pexels (modern stock photos)
    const pexelsResults = await searchPexelsImages(topic);
    for (const r of pexelsResults) {
      if (!results.find(existing => existing.url === r.url)) {
        results.push(r);
      }
    }

  } catch (error: any) {
    console.error(`[WebSearch] Image search failed:`, error.message);
  }

  console.log(`[WebSearch] Found ${results.length} total unique images`);
  return results.slice(0, maxResults);
}

// Search Archive.org for images via Serper
async function searchArchiveImagesViaSerper(query: string): Promise<ImageSearchResult[]> {
  if (!SERPER_API_KEY) return [];

  try {
    const searchQuery = `site:archive.org "${query}" photo OR photograph OR image OR portrait`;

    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: searchQuery, num: 15 },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const organic = response.data?.organic || [];
    const results: ImageSearchResult[] = [];

    for (const item of organic) {
      const match = item.link?.match(/archive\.org\/details\/([^\/\?]+)/);
      if (!match) continue;

      const identifier = match[1];

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

      if (results.length >= 10) break;
    }

    return results;
  } catch (error: any) {
    console.error(`[Serper] Archive.org image search failed:`, error.message);
    return [];
  }
}

async function searchSerperImages(query: string): Promise<ImageSearchResult[]> {
  if (!SERPER_API_KEY) return [];

  try {
    const response = await axios.post(
      'https://google.serper.dev/images',
      { q: query, num: 10 },
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
    console.error(`[Serper] Image search failed:`, error.message);
    return [];
  }
}

async function searchWikimediaImages(query: string): Promise<ImageSearchResult[]> {
  try {
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=10&format=json&origin=*`;

    const response = await axios.get(searchUrl, { timeout: 15000 });
    const items = response.data?.query?.search || [];

    const results: ImageSearchResult[] = [];

    for (const item of items.slice(0, 5)) {
      try {
        const title = item.title;
        const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size&format=json&origin=*`;

        const infoResponse = await axios.get(infoUrl, { timeout: 10000 });
        const pages = infoResponse.data?.query?.pages || {};
        const pageData = Object.values(pages)[0] as any;
        const imageInfo = pageData?.imageinfo?.[0];

        if (imageInfo?.url) {
          results.push({
            url: imageInfo.url,
            title: title.replace('File:', ''),
            source: 'wikimedia',
            width: imageInfo.width,
            height: imageInfo.height,
          });
        }
      } catch (e) {
        // Skip items with errors
      }
    }

    return results;
  } catch (error: any) {
    console.error(`[Wikimedia] Image search failed:`, error.message);
    return [];
  }
}

async function searchPexelsImages(query: string): Promise<ImageSearchResult[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await axios.get(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10`,
      {
        headers: { Authorization: apiKey },
        timeout: 15000,
      }
    );

    const photos = response.data?.photos || [];
    return photos.map((p: any) => ({
      url: p.src?.large || p.src?.original,
      title: p.alt || query,
      source: 'pexels',
      width: p.width,
      height: p.height,
      thumbnail: p.src?.small,
    }));
  } catch (error: any) {
    console.error(`[Pexels] Image search failed:`, error.message);
    return [];
  }
}

// ============================================
// NEWS/ARTICLE SEARCH
// ============================================

export async function searchWebForNews(
  topic: string,
  maxResults: number = 15
): Promise<NewsSearchResult[]> {
  const results: NewsSearchResult[] = [];

  try {
    // Serper News Search
    if (SERPER_API_KEY) {
      const response = await axios.post(
        'https://google.serper.dev/news',
        { q: topic, num: maxResults },
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
        results.push({
          url: n.link,
          title: n.title,
          source: n.source || extractDomain(n.link),
          snippet: n.snippet,
          date: n.date,
        });
      }
    }

    // Serper regular search for articles
    if (SERPER_API_KEY) {
      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: `${topic} article`, num: 10 },
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const organic = response.data?.organic || [];
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

  } catch (error: any) {
    console.error(`[WebSearch] News search failed:`, error.message);
  }

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
    maxVideos: options?.maxVideos ?? 10,
    maxImages: options?.maxImages ?? 15,
    maxNewspapers: options?.maxNewspapers ?? 10,
    maxNews: options?.maxNews ?? 10,
  };

  console.log(`\n[WebSearch] === COMBINED SEARCH: "${topic}" ===`);

  // Run all searches in parallel for speed
  const [videos, images, newspapers, news] = await Promise.all([
    searchWebForVideos(topic, opts.maxVideos),
    searchWebForImages(topic, opts.maxImages),
    searchHistoricalNewspapers(topic, opts.maxNewspapers),
    searchWebForNews(topic, opts.maxNews),
  ]);

  console.log(`\n[WebSearch] === RESULTS SUMMARY ===`);
  console.log(`  Videos: ${videos.length}`);
  console.log(`  Images: ${images.length}`);
  console.log(`  Newspapers: ${newspapers.length}`);
  console.log(`  News/Articles: ${news.length}`);
  console.log(`  TOTAL: ${videos.length + images.length + newspapers.length + news.length}`);

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

  // Format: "10:30" or "1:30:00"
  const parts = durationStr.split(':').map(p => parseInt(p));
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}
