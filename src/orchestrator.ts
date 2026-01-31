// ORCHESTRATOR - Main Entry Point
// Coordinates all 4 workers, generates Claude queries, combines results

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { checkQwenHealth, checkWhisperHealth } from './services/modal.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize clients with error handling
let supabase: any = null;
let anthropic: any = null;

try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('[Orchestrator] Supabase client initialized');
  } else {
    console.warn('[Orchestrator] WARNING: Supabase credentials missing');
  }
} catch (e: any) {
  console.error('[Orchestrator] Supabase init error:', e.message);
}

try {
  anthropic = new Anthropic();
  console.log('[Orchestrator] Anthropic client initialized');
} catch (e: any) {
  console.error('[Orchestrator] Anthropic init error:', e.message);
}

// Worker URLs (internal network on same server)
const WORKERS = {
  video: process.env.VIDEO_WORKER_URL || 'http://localhost:3001',
  image: process.env.IMAGE_WORKER_URL || 'http://localhost:3002',
  webcontent: process.env.WEBCONTENT_WORKER_URL || 'http://localhost:3003',
  ffmpeg: process.env.FFMPEG_WORKER_URL || 'http://localhost:3004',
};

// ============================================
// CLAUDE QUERY GENERATOR
// ============================================

async function generateSearchQueries(topic: string): Promise<{
  videoQueries: string[];
  imageQueries: string[];
  webQueries: string[];
  topicType: string;
}> {
  console.log(`[Orchestrator] Generating sentence-based queries for "${topic}"...`);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `For the topic "${topic}", generate specific SENTENCE-based search queries.

IMPORTANT: Generate FULL SENTENCES, not individual keywords. Each query should be specific and descriptive.

Example for "2008 recession":
- "2008 financial crisis documentary explaining the causes"
- "Lehman Brothers collapse and bankruptcy footage"
- "subprime mortgage crisis housing market crash"
- "Wall Street bailout 2008 government response"

Return JSON:
{
  "videoQueries": [5 specific sentence queries for finding relevant video footage and documentaries],
  "imageQueries": [5 specific sentence queries for finding relevant historical photos and images],
  "topicType": "history" | "crime" | "celebrity" | "finance" | "politics" | "science" | "military" | "disaster" | "general"
}

Make each query SPECIFIC - include the main topic plus context words.
Return ONLY valid JSON.`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Orchestrator] Generated queries:`, JSON.stringify(parsed, null, 2));
      return {
        videoQueries: parsed.videoQueries || [`${topic} documentary`, `${topic} footage explained`],
        imageQueries: parsed.imageQueries || [`${topic} historical photos`, `${topic} images`],
        webQueries: [topic], // Tavily handles this directly - no expansion needed
        topicType: parsed.topicType || 'general',
      };
    }
  } catch (error: any) {
    console.error(`[Orchestrator] Claude query generation failed: ${error.message}`);
  }

  // Fallback to sentence-based queries
  return {
    videoQueries: [
      `${topic} documentary explaining`,
      `${topic} historical footage`,
      `${topic} news coverage report`,
    ],
    imageQueries: [
      `${topic} historical photographs`,
      `${topic} archival images`,
      `${topic} photos documentary`,
    ],
    webQueries: [topic], // Tavily handles directly
    topicType: 'general',
  };
}

// ============================================
// MAIN RESEARCH ENDPOINT
// ============================================

app.post('/v1/research', async (req, res) => {
  const { topic, options = {} } = req.body;

  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }

  const projectId = uuidv4();
  const slug = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}-${projectId.slice(0, 8)}`;

  console.log(`\n========================================`);
  console.log(`[Orchestrator] NEW RESEARCH: "${topic}"`);
  console.log(`[Orchestrator] Project ID: ${projectId}`);
  console.log(`========================================\n`);

  try {
    // Create project
    console.log(`[Orchestrator] Creating project in Supabase...`);
    console.log(`[Orchestrator] SUPABASE_URL: ${process.env.SUPABASE_URL}`);

    const { data: insertData, error: insertError } = await supabase.from('projects').insert({
      id: projectId,
      topic,
      slug,
      status: 'processing',
      started_at: new Date().toISOString(),
    }).select();

    if (insertError) {
      console.error(`[Orchestrator] Supabase INSERT ERROR: ${JSON.stringify(insertError)}`);
      return res.status(500).json({ success: false, error: `Database error: ${insertError.message}` });
    }

    console.log(`[Orchestrator] Project created successfully: ${JSON.stringify(insertData)}`);

    // Return immediately, process in background
    res.json({
      success: true,
      project: { id: projectId, slug, topic, status: 'processing' },
    });

    // Background processing
    (async () => {
      try {
        // Step 1: Generate smart search queries using Claude
        const queries = await generateSearchQueries(topic);

        // Step 2: Call all workers in PARALLEL
        console.log(`[Orchestrator] Starting all 4 workers in parallel...`);

        const workerPromises = [
          // Video Worker - uses sentence-based queries
          axios.post(`${WORKERS.video}/search`, {
            projectId,
            topic,
            queries: queries.videoQueries, // Sentence queries like "2008 financial crisis documentary"
          }, { timeout: 300000 }).catch(e => {
            console.log(`[Orchestrator] Video worker error: ${e.message}`);
            return { data: { count: 0 } };
          }),

          // Image Worker - uses sentence-based queries
          axios.post(`${WORKERS.image}/search`, {
            projectId,
            topic,
            queries: queries.imageQueries, // Sentence queries like "2008 recession historical photos"
          }, { timeout: 300000 }).catch(e => {
            console.log(`[Orchestrator] Image worker error: ${e.message}`);
            return { data: { count: 0 } };
          }),

          // Web Content Worker - Tavily handles topic directly (AI-optimized)
          axios.post(`${WORKERS.webcontent}/search`, {
            projectId,
            topic, // Tavily searches this directly - no query expansion needed
            topicType: queries.topicType,
            takeScreenshots: true,
          }, { timeout: 600000 }).catch(e => {
            console.log(`[Orchestrator] WebContent worker error: ${e.message}`);
            return { data: { count: 0 } };
          }),
        ];

        const [videoResult, imageResult, webResult] = await Promise.all(workerPromises);

        console.log(`\n========================================`);
        console.log(`[Orchestrator] RESULTS SUMMARY`);
        console.log(`  Videos: ${videoResult.data?.count || 0}`);
        console.log(`  Images: ${imageResult.data?.count || 0}`);
        console.log(`  Web Content: ${webResult.data?.count || 0}`);
        console.log(`========================================\n`);

        // Update project status
        await supabase.from('projects').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          video_count: videoResult.data?.count || 0,
          image_count: imageResult.data?.count || 0,
          news_count: webResult.data?.count || 0,
        }).eq('id', projectId);

        console.log(`[Orchestrator] Research completed: ${projectId}`);

      } catch (error: any) {
        console.error(`[Orchestrator] Background processing error: ${error.message}`);
        await supabase.from('projects').update({
          status: 'failed',
          error_message: error.message,
        }).eq('id', projectId);
      }
    })();

  } catch (error: any) {
    console.error(`[Orchestrator] Error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PROCESS VIDEO CLIPS ENDPOINT
// ============================================

app.post('/v1/process-video', async (req, res) => {
  const { projectId, mediaId, videoUrl, clips } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl required' });
  }

  try {
    const result = await axios.post(`${WORKERS.ffmpeg}/process`, {
      projectId,
      mediaId,
      videoUrl,
      clips,
    }, { timeout: 600000 });

    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET PROJECT RESULTS
// ============================================

app.get('/v1/project/:id', async (req, res) => {
  const { id } = req.params;

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single();
  if (!project) return res.status(404).json({ success: false, error: 'Not found' });

  const { data: media } = await supabase.from('media').select('*').eq('project_id', id);
  const { data: clips } = await supabase.from('clips').select('*').eq('project_id', id);

  res.json({
    success: true,
    project,
    results: {
      images: media?.filter((m: any) => m.type === 'image') || [],
      videos: (media?.filter((m: any) => m.type === 'video') || []).map((v: any) => ({
        ...v,
        clips: clips?.filter((c: any) => c.media_id === v.id) || [],
      })),
      webContent: media?.filter((m: any) => ['newspaper_scan', 'article_screenshot'].includes(m.type)) || [],
    },
  });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  const workerStatus: Record<string, string> = {};
  const workerDetails: Record<string, any> = {};

  for (const [name, url] of Object.entries(WORKERS)) {
    try {
      const response = await axios.get(`${url}/health`, { timeout: 5000 });
      workerStatus[name] = response.data?.status || 'ok';
      workerDetails[name] = response.data;
    } catch {
      workerStatus[name] = 'offline';
    }
  }

  // Check Modal services (Qwen and Whisper)
  const [qwenHealthy, whisperHealthy] = await Promise.all([
    checkQwenHealth().catch(() => false),
    checkWhisperHealth().catch(() => false),
  ]);

  res.json({
    status: 'ok',
    service: 'mediamind-orchestrator',
    workers: workerStatus,
    modalServices: {
      qwenVision: qwenHealthy ? 'ok' : 'offline',
      whisperTranscribe: whisperHealthy ? 'ok' : 'offline',
    },
    details: workerDetails,
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  MEDIAMIND ORCHESTRATOR`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Workers:`);
  console.log(`    Video:      ${WORKERS.video}`);
  console.log(`    Image:      ${WORKERS.image}`);
  console.log(`    WebContent: ${WORKERS.webcontent}`);
  console.log(`    FFmpeg:     ${WORKERS.ffmpeg}`);
  console.log(`========================================\n`);
});
