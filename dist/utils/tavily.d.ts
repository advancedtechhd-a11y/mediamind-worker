export interface TavilyResult {
    url: string;
    title: string;
    content: string;
    score: number;
    publishedDate?: string;
}
export declare function searchArticles(query: string, maxResults?: number): Promise<TavilyResult[]>;
export declare function searchNews(query: string, maxResults?: number): Promise<TavilyResult[]>;
export declare function searchSite(site: string, query: string, maxResults?: number): Promise<TavilyResult[]>;
export declare function checkHealth(): Promise<boolean>;
//# sourceMappingURL=tavily.d.ts.map