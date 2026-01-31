export interface SearchResult {
    url: string;
    title: string;
    content?: string;
    engine?: string;
    score?: number;
    thumbnail?: string;
    img_src?: string;
    publishedDate?: string;
}
export interface ImageResult {
    url: string;
    title: string;
    img_src: string;
    thumbnail?: string;
    source?: string;
    engine?: string;
}
export declare function searchWeb(query: string, num?: number): Promise<SearchResult[]>;
export declare function searchImages(query: string, num?: number): Promise<ImageResult[]>;
export declare function searchVideos(query: string, num?: number): Promise<SearchResult[]>;
export declare function searchNews(query: string, num?: number): Promise<SearchResult[]>;
export declare function searchSite(site: string, query: string, num?: number): Promise<SearchResult[]>;
export declare function searchSiteImages(site: string, query: string, num?: number): Promise<ImageResult[]>;
export declare function checkHealth(): Promise<boolean>;
//# sourceMappingURL=searxng.d.ts.map