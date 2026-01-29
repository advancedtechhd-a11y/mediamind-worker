interface NewspaperResult {
    url: string;
    title: string;
    source: string;
    date?: string;
    publication?: string;
}
export declare function searchHistoricalNewspapers(topic: string, maxResults?: number): Promise<NewspaperResult[]>;
export {};
//# sourceMappingURL=newspapers.d.ts.map