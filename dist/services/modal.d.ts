interface QwenImageResult {
    relevant: boolean;
    confidence: number;
    description: string;
    error?: string;
}
interface QwenBatchResult {
    id: string;
    relevant: boolean;
    confidence: number;
    description: string;
    error?: string;
}
/**
 * Analyze a single image for relevance to a topic
 * Cost: ~$0.0001 per image vs $0.006 with Claude
 */
export declare function analyzeImageWithQwen(imageUrl: string, topic: string): Promise<QwenImageResult>;
/**
 * Analyze multiple images in batch
 * More efficient than individual calls
 */
export declare function analyzeImageBatchWithQwen(images: Array<{
    url: string;
    id: string;
}>, topic: string): Promise<QwenBatchResult[]>;
interface WhisperSegment {
    start: number;
    end: number;
    text: string;
    matched_keywords?: string[];
}
interface WhisperResult {
    text?: string;
    full_transcript?: string;
    segments?: WhisperSegment[];
    relevant_segments?: WhisperSegment[];
    language?: string;
    total_segments?: number;
    error?: string;
}
/**
 * Transcribe audio from URL using Modal Whisper
 * Cost: ~$0.001/minute vs $0.006/minute with OpenAI
 */
export declare function transcribeWithModalWhisper(audioUrl: string, language?: string): Promise<WhisperResult>;
/**
 * Transcribe and find segments relevant to a topic
 * Uses keyword matching on Modal side
 */
export declare function findRelevantSegmentsWithWhisper(audioUrl: string, topic: string, language?: string): Promise<WhisperResult>;
export declare function checkQwenHealth(): Promise<boolean>;
export declare function checkWhisperHealth(): Promise<boolean>;
export {};
//# sourceMappingURL=modal.d.ts.map