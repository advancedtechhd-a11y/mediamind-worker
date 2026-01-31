// Modal Services
// Connects to Qwen2-VL and Whisper deployed on Modal
import axios from 'axios';
// Modal endpoints
const QWEN_ENDPOINT = 'https://advancedtechhd-a11y--qwen-vision-analyze.modal.run';
const WHISPER_ENDPOINT = 'https://advancedtechhd-a11y--whisper-transcribe-transcribe.modal.run';
/**
 * Analyze a single image for relevance to a topic
 * Cost: ~$0.0001 per image vs $0.006 with Claude
 */
export async function analyzeImageWithQwen(imageUrl, topic) {
    try {
        const response = await axios.post(QWEN_ENDPOINT, {
            topic,
            image_url: imageUrl,
        }, {
            timeout: 60000, // 60s timeout
            headers: { 'Content-Type': 'application/json' },
        });
        return {
            relevant: response.data.relevant === true,
            confidence: response.data.confidence || 0,
            description: response.data.description || '',
            error: response.data.error,
        };
    }
    catch (error) {
        console.error(`      Qwen analysis failed: ${error.message}`);
        return {
            relevant: false,
            confidence: 0,
            description: '',
            error: error.message,
        };
    }
}
/**
 * Analyze multiple images in batch
 * More efficient than individual calls
 */
export async function analyzeImageBatchWithQwen(images, topic) {
    try {
        const response = await axios.post(QWEN_ENDPOINT, {
            topic,
            images: images,
        }, {
            timeout: 300000, // 5 min for batch
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data.results || [];
    }
    catch (error) {
        console.error(`      Qwen batch analysis failed: ${error.message}`);
        return images.map(img => ({
            id: img.id,
            relevant: false,
            confidence: 0,
            description: '',
            error: error.message,
        }));
    }
}
/**
 * Transcribe audio from URL using Modal Whisper
 * Cost: ~$0.001/minute vs $0.006/minute with OpenAI
 */
export async function transcribeWithModalWhisper(audioUrl, language) {
    try {
        const response = await axios.post(WHISPER_ENDPOINT, {
            audio_url: audioUrl,
            language,
        }, {
            timeout: 600000, // 10 min for long videos
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data;
    }
    catch (error) {
        console.error(`      Modal Whisper failed: ${error.message}`);
        return { error: error.message };
    }
}
/**
 * Transcribe and find segments relevant to a topic
 * Uses keyword matching on Modal side
 */
export async function findRelevantSegmentsWithWhisper(audioUrl, topic, language) {
    try {
        const response = await axios.post(WHISPER_ENDPOINT, {
            audio_url: audioUrl,
            topic,
            language,
        }, {
            timeout: 600000, // 10 min
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data;
    }
    catch (error) {
        console.error(`      Modal Whisper segment search failed: ${error.message}`);
        return { error: error.message };
    }
}
// ============================================
// HEALTH CHECKS
// ============================================
export async function checkQwenHealth() {
    try {
        const response = await axios.get('https://advancedtechhd-a11y--qwen-vision-health.modal.run', { timeout: 10000 });
        return response.data.status === 'ok';
    }
    catch {
        return false;
    }
}
export async function checkWhisperHealth() {
    try {
        const response = await axios.get('https://advancedtechhd-a11y--whisper-transcribe-health.modal.run', { timeout: 10000 });
        return response.data.status === 'ok';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=modal.js.map