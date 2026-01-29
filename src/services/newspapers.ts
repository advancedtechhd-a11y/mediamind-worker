// Historical Newspapers Service
// Searches Library of Congress, Archive.org, and Europeana for newspaper scans

import axios from 'axios';

interface NewspaperResult {
  url: string;
  title: string;
  source: string;
  date?: string;
  publication?: string;
}

// ============================================
// SEARCH ALL NEWSPAPER SOURCES
// ============================================

export async function searchHistoricalNewspapers(
  topic: string,
  maxResults: number = 10
): Promise<NewspaperResult[]> {
  const results: NewspaperResult[] = [];

  // Search in parallel
  const [locResults, archiveResults] = await Promise.all([
    searchChroniclingAmerica(topic, Math.ceil(maxResults / 2)),
    searchArchiveNewspapers(topic, Math.ceil(maxResults / 2)),
  ]);

  results.push(...locResults, ...archiveResults);

  // Deduplicate
  const unique = results.filter((r, idx) =>
    results.findIndex(x => x.url === r.url) === idx
  );

  return unique.slice(0, maxResults);
}

// ============================================
// LIBRARY OF CONGRESS - CHRONICLING AMERICA
// ============================================

async function searchChroniclingAmerica(
  topic: string,
  maxResults: number = 5
): Promise<NewspaperResult[]> {
  try {
    // Chronicling America API (1770-1963 US newspapers)
    const searchUrl = `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=${encodeURIComponent(topic)}&format=json&page=1`;

    const response = await axios.get(searchUrl, { timeout: 15000 });
    const items = response.data?.items || [];

    const results: NewspaperResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      if (item.url) {
        // Get the PDF/JP2 image URL
        const imageUrl = item.url.replace('.json', '.pdf');

        results.push({
          url: `https://chroniclingamerica.loc.gov${item.url.replace('.json', '/thumbnail.jpg')}`,
          title: item.title || 'Historical Newspaper',
          source: 'Library of Congress',
          date: item.date,
          publication: item.title?.split(' (')[0] || 'Unknown',
        });
      }
    }

    console.log(`   [LOC] Found ${results.length} newspaper pages`);
    return results;

  } catch (error: any) {
    console.error(`   [LOC] Chronicling America search failed: ${error.message}`);
    return [];
  }
}

// ============================================
// ARCHIVE.ORG NEWSPAPERS
// ============================================

async function searchArchiveNewspapers(
  topic: string,
  maxResults: number = 5
): Promise<NewspaperResult[]> {
  try {
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(topic)}+collection:newspapers&fl=identifier,title,date,description&rows=${maxResults}&output=json`;

    const response = await axios.get(searchUrl, { timeout: 15000 });
    const items = response.data?.response?.docs || [];

    const results: NewspaperResult[] = [];

    for (const item of items) {
      try {
        // Get metadata to find image files
        const metaResponse = await axios.get(
          `https://archive.org/metadata/${item.identifier}`,
          { timeout: 10000 }
        );

        const files = metaResponse.data?.files || [];
        const imageFile = files.find((f: any) =>
          f.name?.match(/\.(jpg|jpeg|png|gif)$/i) && !f.name?.includes('thumb')
        );

        if (imageFile) {
          results.push({
            url: `https://archive.org/download/${item.identifier}/${imageFile.name}`,
            title: item.title || 'Historical Newspaper',
            source: 'Archive.org',
            date: item.date,
          });
        }
      } catch (e) {
        // Skip items with errors
      }
    }

    console.log(`   [Archive.org] Found ${results.length} newspaper scans`);
    return results;

  } catch (error: any) {
    console.error(`   [Archive.org] Newspaper search failed: ${error.message}`);
    return [];
  }
}

// ============================================
// EUROPEANA NEWSPAPERS (European historical)
// ============================================

async function searchEuropeanaNewspapers(
  topic: string,
  maxResults: number = 5
): Promise<NewspaperResult[]> {
  const apiKey = process.env.EUROPEANA_API_KEY;
  if (!apiKey) return [];

  try {
    const searchUrl = `https://api.europeana.eu/record/v2/search.json?wskey=${apiKey}&query=${encodeURIComponent(topic)}&qf=TYPE:TEXT&qf=DATA_PROVIDER:*newspaper*&rows=${maxResults}`;

    const response = await axios.get(searchUrl, { timeout: 15000 });
    const items = response.data?.items || [];

    const results: NewspaperResult[] = [];

    for (const item of items) {
      const imageUrl = item.edmPreview?.[0] || item.edmIsShownBy?.[0];
      if (imageUrl) {
        results.push({
          url: imageUrl,
          title: item.title?.[0] || 'European Newspaper',
          source: 'Europeana',
          date: item.year?.[0],
          publication: item.dataProvider?.[0],
        });
      }
    }

    console.log(`   [Europeana] Found ${results.length} newspaper pages`);
    return results;

  } catch (error: any) {
    console.error(`   [Europeana] Newspaper search failed: ${error.message}`);
    return [];
  }
}
