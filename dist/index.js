// MediaMind Worker Service - Simplified (No Redis)
// Processes research requests directly
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
const app = express();
const PORT = process.env.PORT || 3002;
// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
// Track active jobs for cancellation
const activeJobs = new Map();
// Middleware
app.use(cors());
app.use(express.json());
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'mediamind-worker', version: '1.0.0' });
});
// Import workers
import { processVideoResearch } from './workers/video.worker.js';
import { processImageResearch } from './workers/image.worker.js';
import { processNewsResearch } from './workers/news.worker.js';
// Import search functions for testing
import { searchAllMedia, searchWebForVideos, searchWebForImages, searchHistoricalNewspapers, searchWebForNews } from './services/web-search.js';
// POST /v1/research - Full research
app.post('/v1/research', async (req, res) => {
    const { topic, options = {} } = req.body;
    if (!topic) {
        return res.status(400).json({ success: false, error: 'Topic is required' });
    }
    const projectId = uuidv4();
    const slug = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}-${projectId.slice(0, 8)}`;
    console.log(`\n========================================`);
    console.log(`[Research] "${topic}"`);
    console.log(`[Project] ${projectId}`);
    console.log(`========================================\n`);
    try {
        // Create project
        await supabase.from('projects').insert({
            id: projectId,
            topic,
            slug,
            status: 'processing',
            started_at: new Date().toISOString(),
        });
        // Register job for cancellation tracking
        activeJobs.set(projectId, { cancelled: false });
        // Return immediately, process in background
        res.json({
            success: true,
            project: { id: projectId, slug, topic, status: 'processing' },
        });
        // Process all in parallel (background)
        const maxImages = options.max_images || 200;
        const maxVideos = options.max_videos || 100;
        const maxNews = options.max_news || 100;
        Promise.all([
            processImageResearch(projectId, topic, maxImages),
            processVideoResearch(projectId, topic, maxVideos),
            processNewsResearch(projectId, topic, maxNews),
        ]).then(async () => {
            const job = activeJobs.get(projectId);
            if (job?.cancelled) {
                console.log(`\n[Research] Cancelled: ${projectId}\n`);
                return;
            }
            await supabase.from('projects').update({
                status: 'completed',
                completed_at: new Date().toISOString(),
            }).eq('id', projectId);
            console.log(`\n[Research] Completed: ${projectId}\n`);
        }).catch(async (err) => {
            const job = activeJobs.get(projectId);
            if (job?.cancelled)
                return;
            await supabase.from('projects').update({
                status: 'failed',
                error_message: err.message,
            }).eq('id', projectId);
            console.error(`[Research] Failed: ${err.message}`);
        }).finally(() => {
            activeJobs.delete(projectId);
        });
    }
    catch (error) {
        console.error(`[Research] Error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// DELETE /v1/project/:id - Cancel/Stop a research
app.delete('/v1/project/:id', async (req, res) => {
    const { id } = req.params;
    // Mark job as cancelled
    const job = activeJobs.get(id);
    if (job) {
        job.cancelled = true;
        console.log(`[Research] Cancelling job: ${id}`);
    }
    // Update project status
    await supabase.from('projects').update({
        status: 'cancelled',
        error_message: 'Cancelled by user',
    }).eq('id', id);
    res.json({ success: true, message: 'Research cancelled' });
});
// POST /v1/videos - Videos only
app.post('/v1/videos', async (req, res) => {
    const { topic, max_results = 10 } = req.body;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const projectId = uuidv4();
    await supabase.from('projects').insert({ id: projectId, topic, slug: `vid-${projectId.slice(0, 8)}`, status: 'processing', started_at: new Date().toISOString() });
    res.json({ success: true, project_id: projectId, status: 'processing' });
    processVideoResearch(projectId, topic, max_results).then(() => {
        supabase.from('projects').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', projectId);
    });
});
// POST /v1/images - Images only
app.post('/v1/images', async (req, res) => {
    const { topic, max_results = 30 } = req.body;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const projectId = uuidv4();
    await supabase.from('projects').insert({ id: projectId, topic, slug: `img-${projectId.slice(0, 8)}`, status: 'processing', started_at: new Date().toISOString() });
    res.json({ success: true, project_id: projectId, status: 'processing' });
    processImageResearch(projectId, topic, max_results).then(() => {
        supabase.from('projects').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', projectId);
    });
});
// POST /v1/news - News only
app.post('/v1/news', async (req, res) => {
    const { topic, max_results = 15 } = req.body;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const projectId = uuidv4();
    await supabase.from('projects').insert({ id: projectId, topic, slug: `news-${projectId.slice(0, 8)}`, status: 'processing', started_at: new Date().toISOString() });
    res.json({ success: true, project_id: projectId, status: 'processing' });
    processNewsResearch(projectId, topic, max_results).then(() => {
        supabase.from('projects').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', projectId);
    });
});
// GET /v1/project/:id
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
            news: media?.filter(m => ['newspaper_scan', 'article_screenshot'].includes(m.type)) || [],
        },
    });
});
// ============================================
// TEST ENDPOINTS (Search only, no DB save)
// ============================================
// GET /v1/test/search?topic=al%20capone - Test combined search
app.get('/v1/test/search', async (req, res) => {
    const topic = req.query.topic;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required (?topic=...)' });
    console.log(`\n========================================`);
    console.log(`[TEST] Combined search: "${topic}"`);
    console.log(`========================================\n`);
    try {
        const results = await searchAllMedia(topic);
        res.json({
            success: true,
            topic,
            summary: {
                videos: results.videos.length,
                images: results.images.length,
                newspapers: results.newspapers.length,
                news: results.news.length,
                total: results.videos.length + results.images.length + results.newspapers.length + results.news.length,
            },
            results,
        });
    }
    catch (error) {
        console.error(`[TEST] Error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// GET /v1/test/videos?topic=... - Test video search only
app.get('/v1/test/videos', async (req, res) => {
    const topic = req.query.topic;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const results = await searchWebForVideos(topic, 10);
    res.json({ success: true, topic, count: results.length, results });
});
// GET /v1/test/images?topic=... - Test image search only
app.get('/v1/test/images', async (req, res) => {
    const topic = req.query.topic;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const results = await searchWebForImages(topic, 15);
    res.json({ success: true, topic, count: results.length, results });
});
// GET /v1/test/newspapers?topic=... - Test newspaper search only
app.get('/v1/test/newspapers', async (req, res) => {
    const topic = req.query.topic;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const results = await searchHistoricalNewspapers(topic, 10);
    res.json({ success: true, topic, count: results.length, results });
});
// GET /v1/test/news?topic=... - Test news search only
app.get('/v1/test/news', async (req, res) => {
    const topic = req.query.topic;
    if (!topic)
        return res.status(400).json({ success: false, error: 'Topic required' });
    const results = await searchWebForNews(topic, 10);
    res.json({ success: true, topic, count: results.length, results });
});
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  MediaMind Worker v1.0.0`);
    console.log(`  Port: ${PORT}`);
    console.log(`========================================\n`);
});
//# sourceMappingURL=index.js.map