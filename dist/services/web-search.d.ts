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
export declare function searchWebForVideos(topic: string, _maxResults?: number): Promise<VideoSearchResult[]>;
export declare function searchWebForImages(topic: string, _maxResults?: number): Promise<ImageSearchResult[]>;
export declare function searchWebForNews(topic: string, _maxResults?: number): Promise<NewsSearchResult[]>;
export declare function searchHistoricalNewspapers(topic: string, _maxResults?: number): Promise<NewspaperResult[]>;
export interface CombinedSearchResults {
    videos: VideoSearchResult[];
    images: ImageSearchResult[];
    newspapers: NewspaperResult[];
    news: NewsSearchResult[];
}
export declare function searchAllMedia(topic: string): Promise<CombinedSearchResults>;
export {};
//# sourceMappingURL=web-search.d.ts.map