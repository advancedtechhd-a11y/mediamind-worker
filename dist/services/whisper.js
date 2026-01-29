// Whisper Service
// Transcribes audio using OpenAI Whisper API
import OpenAI from 'openai';
import fs from 'fs';
import { extractAudio } from './ffmpeg.js';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
// ============================================
// TRANSCRIBE AUDIO
// ============================================
export async function transcribeAudio(videoPath, audioPath) {
    try {
        // Extract audio from video
        console.log(`      Extracting audio...`);
        const audioExtracted = await extractAudio(videoPath, audioPath);
        if (!audioExtracted || !fs.existsSync(audioPath)) {
            console.error(`      Failed to extract audio`);
            return [];
        }
        const audioSize = fs.statSync(audioPath).size;
        console.log(`      Audio extracted: ${(audioSize / 1024 / 1024).toFixed(2)}MB`);
        // Check file size (Whisper max is 25MB)
        if (audioSize > 25 * 1024 * 1024) {
            console.log(`      Audio too large, will process in chunks`);
            return await transcribeInChunks(audioPath);
        }
        // Transcribe with Whisper (with retry)
        console.log(`      Sending to Whisper API...`);
        let response;
        let retries = 3;
        while (retries > 0) {
            try {
                response = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(audioPath),
                    model: 'whisper-1',
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment'],
                });
                break; // Success
            }
            catch (err) {
                retries--;
                if (retries === 0)
                    throw err;
                console.log(`      Whisper retry (${3 - retries}/3)...`);
                await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
            }
        }
        if (!response) {
            console.error(`      Whisper failed after retries`);
            return [];
        }
        // Extract segments with timestamps
        const segments = [];
        if (response.segments) {
            for (const seg of response.segments) {
                segments.push({
                    start: seg.start,
                    end: seg.end,
                    text: seg.text.trim(),
                });
            }
        }
        else if (response.text) {
            // No timestamps available, return full text as single segment
            segments.push({
                start: 0,
                end: 0, // Unknown
                text: response.text,
            });
        }
        console.log(`      Transcribed ${segments.length} segments`);
        return segments;
    }
    catch (error) {
        console.error(`      Transcription failed: ${error.message}`);
        return [];
    }
}
// ============================================
// TRANSCRIBE LARGE FILES IN CHUNKS
// ============================================
async function transcribeInChunks(audioPath) {
    // For now, just transcribe what we can
    // TODO: Implement proper chunking with ffmpeg
    console.log(`      Large file transcription not yet implemented, skipping`);
    return [];
}
// ============================================
// TRANSCRIBE WITH LOCAL WHISPER (Optional)
// ============================================
export async function transcribeWithLocalWhisper(audioPath) {
    // This would use a local Whisper model via whisper.cpp or faster-whisper
    // For now, we use the OpenAI API
    return [];
}
//# sourceMappingURL=whisper.js.map