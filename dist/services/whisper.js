// Whisper Service
// Transcribes audio using Modal Whisper (GPU) or OpenAI Whisper API as fallback
import OpenAI from 'openai';
import fs from 'fs';
import { extractAudio } from './ffmpeg.js';
import { transcribeWithModalWhisper, findRelevantSegmentsWithWhisper } from './modal.js';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
// Use Modal Whisper by default (much cheaper)
const USE_MODAL_WHISPER = process.env.USE_MODAL_WHISPER !== 'false';
// ============================================
// TRANSCRIBE AUDIO (MODAL OR OPENAI)
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
        // For Modal Whisper, we need to upload the audio or provide a URL
        // For now, fall back to OpenAI for local files
        if (USE_MODAL_WHISPER && audioSize <= 25 * 1024 * 1024) {
            console.log(`      Using Modal Whisper (cheaper)...`);
            // Note: Modal expects a URL, not a local file
            // For local files, we'll use OpenAI API
        }
        // Use OpenAI API for local files
        return await transcribeWithOpenAI(audioPath);
    }
    catch (error) {
        console.error(`      Transcription failed: ${error.message}`);
        return [];
    }
}
// ============================================
// TRANSCRIBE FROM URL (MODAL WHISPER)
// ============================================
export async function transcribeFromUrl(audioUrl, topic, language) {
    try {
        console.log(`      Using Modal Whisper for URL transcription...`);
        let result;
        if (topic) {
            // Find relevant segments matching topic
            result = await findRelevantSegmentsWithWhisper(audioUrl, topic, language);
            if (result.error) {
                console.error(`      Modal Whisper error: ${result.error}`);
                return [];
            }
            // Return relevant segments if found
            if (result.relevant_segments && result.relevant_segments.length > 0) {
                return result.relevant_segments.map(seg => ({
                    start: seg.start,
                    end: seg.end,
                    text: seg.text,
                }));
            }
            // Fall back to all segments
            if (result.segments) {
                return result.segments;
            }
        }
        else {
            // Full transcription
            result = await transcribeWithModalWhisper(audioUrl, language);
            if (result.error) {
                console.error(`      Modal Whisper error: ${result.error}`);
                return [];
            }
            if (result.segments) {
                return result.segments;
            }
        }
        // If we only got full text without segments
        if (result.text || result.full_transcript) {
            return [{
                    start: 0,
                    end: 0,
                    text: result.text || result.full_transcript || '',
                }];
        }
        return [];
    }
    catch (error) {
        console.error(`      URL transcription failed: ${error.message}`);
        return [];
    }
}
// ============================================
// TRANSCRIBE WITH OPENAI (FALLBACK)
// ============================================
async function transcribeWithOpenAI(audioPath) {
    const audioSize = fs.statSync(audioPath).size;
    // Check file size (Whisper max is 25MB)
    if (audioSize > 25 * 1024 * 1024) {
        console.log(`      Audio too large for OpenAI, will process in chunks`);
        return await transcribeInChunks(audioPath);
    }
    // Transcribe with Whisper (with retry)
    console.log(`      Sending to OpenAI Whisper API...`);
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
    // For now, we use Modal or OpenAI API
    return [];
}
//# sourceMappingURL=whisper.js.map