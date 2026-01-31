// Modal Services
// Connects to Qwen2-VL and Whisper deployed on Modal

import axios from 'axios';

// Modal endpoints
const QWEN_ENDPOINT = 'https://advancedtechhd-a11y--qwen-vision-analyze.modal.run';
const WHISPER_ENDPOINT = 'https://advancedtechhd-a11y--whisper-transcribe-transcribe.modal.run';

// ============================================
// QWEN IMAGE ANALYSIS (97% cheaper than Claude)
// ============================================

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
export async function analyzeImageWithQwen(
  imageUrl: string,
  topic: string
): Promise<QwenImageResult> {
  try {
    const response = await axios.post(
      QWEN_ENDPOINT,
      {
        topic,
        image_url: imageUrl,
      },
      {
        timeout: 60000, // 60s timeout
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return {
      relevant: response.data.relevant === true,
      confidence: response.data.confidence || 0,
      description: response.data.description || '',
      error: response.data.error,
    };
  } catch (error: any) {
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
export async function analyzeImageBatchWithQwen(
  images: Array<{ url: string; id: string }>,
  topic: string
): Promise<QwenBatchResult[]> {
  try {
    const response = await axios.post(
      QWEN_ENDPOINT,
      {
        topic,
        images: images,
      },
      {
        timeout: 300000, // 5 min for batch
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return response.data.results || [];
  } catch (error: any) {
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

// ============================================
// WHISPER TRANSCRIPTION (Modal GPU)
// ============================================

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
export async function transcribeWithModalWhisper(
  audioUrl: string,
  language?: string
): Promise<WhisperResult> {
  try {
    const response = await axios.post(
      WHISPER_ENDPOINT,
      {
        audio_url: audioUrl,
        language,
      },
      {
        timeout: 600000, // 10 min for long videos
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error(`      Modal Whisper failed: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Transcribe and find segments relevant to a topic
 * Uses keyword matching on Modal side
 */
export async function findRelevantSegmentsWithWhisper(
  audioUrl: string,
  topic: string,
  language?: string
): Promise<WhisperResult> {
  try {
    const response = await axios.post(
      WHISPER_ENDPOINT,
      {
        audio_url: audioUrl,
        topic,
        language,
      },
      {
        timeout: 600000, // 10 min
        headers: { 'Content-Type': 'application/json' },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error(`      Modal Whisper segment search failed: ${error.message}`);
    return { error: error.message };
  }
}

// ============================================
// HEALTH CHECKS
// ============================================

export async function checkQwenHealth(): Promise<boolean> {
  try {
    const response = await axios.get(
      'https://advancedtechhd-a11y--qwen-vision-health.modal.run',
      { timeout: 10000 }
    );
    return response.data.status === 'ok';
  } catch {
    return false;
  }
}

export async function checkWhisperHealth(): Promise<boolean> {
  try {
    const response = await axios.get(
      'https://advancedtechhd-a11y--whisper-transcribe-health.modal.run',
      { timeout: 10000 }
    );
    return response.data.status === 'ok';
  } catch {
    return false;
  }
}
