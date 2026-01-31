// ORCHESTRATOR - Main Entry Point
// Coordinates all 4 workers, generates Claude queries, combines results
import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic();
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
async function generateSearchQueries(topic) {
    console.log(`[Orchestrator] Generating expanded search queries for "${topic}"...`);
    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{
                    role: 'user',
                    content: `You are a research query expansion expert. For the topic "${topic}", generate search queries that will find relevant media even when titles use DIFFERENT WORDS than the original topic.

CRITICAL: Think about SYNONYMS, ALTERNATE NAMES, RELATED EVENTS, KEY PEOPLE, and how media titles actually phrase things.

Example expansion for "2008 recession":
- "2008 financial crisis" (synonym)
- "subprime mortgage collapse" (related cause)
- "Lehman Brothers bankruptcy" (key event)
- "housing market crash 2008" (related term)
- "Great Recession documentary" (alternate name)
- "Wall Street bailout 2008" (related event)
- "Bear Stearns collapse" (key event)

Return a JSON object:
{
  "videoQueries": [8-10 queries for videos/documentaries/footage - use synonyms and related terms],
  "imageQueries": [8-10 queries for photos/images - include key people, places, events],
  "webQueries": [8-10 queries for articles/news - cover different angles and related topics],
  "topicType": "history" | "crime" | "celebrity" | "finance" | "politics" | "science" | "military" | "disaster" | "general",
  "keywords": [10-15 individual keywords/phrases that should appear in relevant results - these are used for relevance filtering]
}

The "keywords" array is CRITICAL - include:
- Main topic words and their synonyms
- Names of key people involved
- Names of key places/organizations
- Related events/terms
- Common words used in titles about this topic

Return ONLY valid JSON.`
                }]
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log(`[Orchestrator] Generated expanded queries:`, JSON.stringify(parsed, null, 2));
            return {
                videoQueries: parsed.videoQueries || [topic],
                imageQueries: parsed.imageQueries || [topic],
                webQueries: parsed.webQueries || [topic],
                topicType: parsed.topicType || 'general',
                keywords: parsed.keywords || topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
            };
        }
    }
    catch (error) {
        console.error(`[Orchestrator] Claude query generation failed: ${error.message}`);
    }
    // Fallback to basic queries
    return {
        videoQueries: [topic, `${topic} documentary`, `${topic} footage`, `${topic} explained`],
        imageQueries: [topic, `${topic} photo`, `${topic} historical`, `${topic} images`],
        webQueries: [topic, `${topic} article`, `${topic} history`, `${topic} explained`],
        topicType: 'general',
        keywords: topic.toLowerCase().split(/\s+/).filter(w => w.length > 3),
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
                    // Video Worker
                    axios.post(`${WORKERS.video}/search`, {
                        projectId,
                        topic,
                        queries: queries.videoQueries,
                        keywords: queries.keywords, // AI-generated relevance keywords
                    }, { timeout: 300000 }).catch(e => {
                        console.log(`[Orchestrator] Video worker error: ${e.message}`);
                        return { data: { count: 0 } };
                    }),
                    // Image Worker
                    axios.post(`${WORKERS.image}/search`, {
                        projectId,
                        topic,
                        queries: queries.imageQueries,
                        keywords: queries.keywords,
                    }, { timeout: 300000 }).catch(e => {
                        console.log(`[Orchestrator] Image worker error: ${e.message}`);
                        return { data: { count: 0 } };
                    }),
                    // Web Content Worker
                    axios.post(`${WORKERS.webcontent}/search`, {
                        projectId,
                        topic,
                        queries: queries.webQueries,
                        topicType: queries.topicType,
                        keywords: queries.keywords,
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
            }
            catch (error) {
                console.error(`[Orchestrator] Background processing error: ${error.message}`);
                await supabase.from('projects').update({
                    status: 'failed',
                    error_message: error.message,
                }).eq('id', projectId);
            }
        })();
    }
    catch (error) {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// GET PROJECT RESULTS
// ============================================
app.get('/v1/project/:id', async (req, res) => {
    const { id } = req.params;
    const { data: project } = await supabase.from('projects').select('*').eq('id', id).single();
    if (!project)
        return res.status(404).json({ success: false, error: 'Not found' });
    const { data: media } = await supabase.from('media').select('*').eq('project_id', id);
    const { data: clips } = await supabase.from('clips').select('*').eq('project_id', id);
    res.json({
        success: true,
        project,
        results: {
            images: media?.filter(m => m.type === 'image') || [],
            videos: (media?.filter(m => m.type === 'video') || []).map(v => ({
                ...v,
                clips: clips?.filter(c => c.media_id === v.id) || [],
            })),
            webContent: media?.filter(m => ['newspaper_scan', 'article_screenshot'].includes(m.type)) || [],
        },
    });
});
// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
    const workerStatus = {};
    const workerDetails = {};
    for (const [name, url] of Object.entries(WORKERS)) {
        try {
            const response = await axios.get(`${url}/health`, { timeout: 5000 });
            workerStatus[name] = response.data?.status || 'ok';
            workerDetails[name] = response.data;
        }
        catch {
            workerStatus[name] = 'offline';
        }
    }
    res.json({
        status: 'ok',
        service: 'mediamind-orchestrator',
        workers: workerStatus,
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
//# sourceMappingURL=orchestrator.js.map