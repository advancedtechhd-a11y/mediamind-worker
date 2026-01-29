interface RelevantSegment {
    start: number;
    end: number;
    description: string;
    relevanceScore: number;
}
interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}
export declare function analyzeTranscript(topic: string, transcript: TranscriptSegment[]): Promise<RelevantSegment[]>;
export declare function analyzeFrames(topic: string, framePaths: string[]): Promise<RelevantSegment[]>;
export declare function validateImageRelevance(topic: string, imageUrl: string): Promise<{
    relevant: boolean;
    score: number;
    description: string;
}>;
export {};
//# sourceMappingURL=claude.d.ts.map