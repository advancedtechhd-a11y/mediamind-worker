// Claude Service
// Analyzes transcripts and frames to find relevant content

import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import fs from 'fs';
import { analyzeImageWithQwen, analyzeImageBatchWithQwen } from './modal.js';

// Use Qwen for image analysis by default (97% cheaper)
const USE_QWEN_FOR_IMAGES = process.env.USE_QWEN_FOR_IMAGES !== 'false';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

// ============================================
// ANALYZE TRANSCRIPT FOR RELEVANT SEGMENTS
// ============================================

export async function analyzeTranscript(
  topic: string,
  transcript: TranscriptSegment[]
): Promise<RelevantSegment[]> {
  try {
    // Format transcript with timestamps
    const transcriptText = transcript
      .map(seg => `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text}`)
      .join('\n');

    const prompt = `You are analyzing a video transcript to find segments relevant to the topic: "${topic}"

Here is the transcript with timestamps:

${transcriptText}

Find ALL segments that discuss or relate to "${topic}". For each relevant segment:
1. Identify the start and end timestamps
2. Write a brief description of what that segment discusses
3. Rate its relevance from 0.0 to 1.0 (1.0 = directly about the topic, 0.5 = tangentially related)

Only include segments with relevance >= 0.5

Respond in JSON format:
{
  "segments": [
    {
      "start_seconds": 30,
      "end_seconds": 75,
      "description": "Description of what this segment covers",
      "relevance_score": 0.9
    }
  ]
}

If no relevant segments found, return: { "segments": [] }`;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`      Could not parse Claude response`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const segments: RelevantSegment[] = (parsed.segments || []).map((seg: any) => ({
      start: seg.start_seconds,
      end: seg.end_seconds,
      description: seg.description,
      relevanceScore: seg.relevance_score,
    }));

    return segments;

  } catch (error: any) {
    console.error(`      Claude transcript analysis failed: ${error.message}`);
    return [];
  }
}

// ============================================
// ANALYZE FRAMES FOR RELEVANT CONTENT
// ============================================

export async function analyzeFrames(
  topic: string,
  framePaths: string[]
): Promise<RelevantSegment[]> {
  try {
    // Limit to max 20 frames to control costs
    const framesToAnalyze = framePaths.slice(0, 20);
    const frameInterval = framePaths.length > 20
      ? Math.floor(framePaths.length / 20)
      : 1;

    console.log(`      Analyzing ${framesToAnalyze.length} frames...`);

    // Convert frames to base64
    const frameImages = framesToAnalyze.map((framePath, idx) => {
      const imageData = fs.readFileSync(framePath);
      const base64 = imageData.toString('base64');
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/jpeg' as const,
          data: base64,
        },
      };
    });

    // Create content array with text prompt and images
    const content: any[] = [
      {
        type: 'text',
        text: `You are analyzing video frames to find content relevant to: "${topic}"

These are ${framesToAnalyze.length} frames from a video, taken at regular intervals.
Frame 1 = start of video, Frame ${framesToAnalyze.length} = near the end.

Analyze all frames and identify ranges where the content is relevant to "${topic}".

For each relevant range:
1. Identify start and end frame numbers
2. Describe what's shown in those frames
3. Rate relevance from 0.0 to 1.0

Only include ranges with relevance >= 0.5

Respond in JSON:
{
  "ranges": [
    {
      "start_frame": 3,
      "end_frame": 7,
      "description": "Shows ancient Roman architecture",
      "relevance_score": 0.85
    }
  ]
}

If nothing relevant, return: { "ranges": [] }`,
      },
      ...frameImages,
    ];

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`      Could not parse Claude response`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Convert frame ranges to time ranges
    // Assuming 5 seconds per frame (based on extraction interval)
    const SECONDS_PER_FRAME = 5;
    const segments: RelevantSegment[] = (parsed.ranges || []).map((range: any) => ({
      start: (range.start_frame - 1) * SECONDS_PER_FRAME * frameInterval,
      end: range.end_frame * SECONDS_PER_FRAME * frameInterval,
      description: range.description,
      relevanceScore: range.relevance_score,
    }));

    return segments;

  } catch (error: any) {
    console.error(`      Claude frame analysis failed: ${error.message}`);
    return [];
  }
}

// ============================================
// VALIDATE IMAGE RELEVANCE
// ============================================

export async function validateImageRelevance(
  topic: string,
  imageUrl: string
): Promise<{ relevant: boolean; score: number; description: string }> {
  // Use Qwen by default (97% cheaper: ~$0.0001 vs $0.006 per image)
  if (USE_QWEN_FOR_IMAGES) {
    return await validateImageWithQwen(topic, imageUrl);
  }
  return await validateImageWithClaude(topic, imageUrl);
}

/**
 * Validate image using Qwen2-VL on Modal (97% cheaper)
 */
async function validateImageWithQwen(
  topic: string,
  imageUrl: string
): Promise<{ relevant: boolean; score: number; description: string }> {
  try {
    const result = await analyzeImageWithQwen(imageUrl, topic);
    return {
      relevant: result.relevant && result.confidence >= 0.5,
      score: result.confidence,
      description: result.description,
    };
  } catch (error: any) {
    console.error(`      Qwen image validation failed: ${error.message}`);
    // Fall back to Claude
    return await validateImageWithClaude(topic, imageUrl);
  }
}

/**
 * Validate multiple images in batch using Qwen (more efficient)
 */
export async function validateImageBatch(
  topic: string,
  imageUrls: Array<{ url: string; id: string }>
): Promise<Array<{ id: string; relevant: boolean; score: number; description: string }>> {
  if (USE_QWEN_FOR_IMAGES) {
    try {
      const results = await analyzeImageBatchWithQwen(imageUrls, topic);
      return results.map(r => ({
        id: r.id,
        relevant: r.relevant && r.confidence >= 0.5,
        score: r.confidence,
        description: r.description,
      }));
    } catch (error: any) {
      console.error(`      Qwen batch validation failed: ${error.message}`);
    }
  }

  // Fall back to individual Claude calls
  const results = [];
  for (const img of imageUrls) {
    const result = await validateImageWithClaude(topic, img.url);
    results.push({ id: img.id, ...result });
  }
  return results;
}

/**
 * Validate image using Claude (fallback, more expensive)
 */
async function validateImageWithClaude(
  topic: string,
  imageUrl: string
): Promise<{ relevant: boolean; score: number; description: string }> {
  try {
    // Download image and convert to base64
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const base64 = Buffer.from(imageResponse.data).toString('base64');

    // Detect media type from content-type header or URL
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    const contentType = imageResponse.headers['content-type'];
    if (contentType?.includes('png')) mediaType = 'image/png';
    else if (contentType?.includes('gif')) mediaType = 'image/gif';
    else if (contentType?.includes('webp')) mediaType = 'image/webp';

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: 'text',
            text: `Is this image relevant to the topic: "${topic}"?

Respond in JSON:
{
  "relevant": true/false,
  "score": 0.0-1.0,
  "description": "Brief description of what the image shows"
}`,
          },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        relevant: parsed.relevant === true && parsed.score >= 0.5,
        score: parsed.score || 0,
        description: parsed.description || '',
      };
    }

    return { relevant: false, score: 0, description: '' };

  } catch (error: any) {
    console.error(`      Claude image validation failed: ${error.message}`);
    return { relevant: false, score: 0, description: '' };
  }
}

// ============================================
// HELPERS
// ============================================

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
