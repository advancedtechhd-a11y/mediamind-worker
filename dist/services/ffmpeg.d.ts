export declare function downloadVideo(url: string, outputPath: string): Promise<boolean>;
export declare function detectAudio(videoPath: string): Promise<boolean>;
export declare function extractAudio(videoPath: string, audioPath: string): Promise<boolean>;
export declare function extractFrames(videoPath: string, outputDir: string, intervalSeconds?: number): Promise<string[]>;
export declare function extractClip(videoPath: string, outputPath: string, startSeconds: number, endSeconds: number): Promise<boolean>;
export declare function getVideoDuration(videoPath: string): Promise<number | null>;
export declare function getVideoInfo(videoPath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    hasAudio: boolean;
} | null>;
//# sourceMappingURL=ffmpeg.d.ts.map