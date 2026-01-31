export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}
export declare function transcribeAudio(videoPath: string, audioPath: string): Promise<TranscriptSegment[]>;
export declare function transcribeFromUrl(audioUrl: string, topic?: string, language?: string): Promise<TranscriptSegment[]>;
export declare function transcribeWithLocalWhisper(audioPath: string): Promise<TranscriptSegment[]>;
//# sourceMappingURL=whisper.d.ts.map