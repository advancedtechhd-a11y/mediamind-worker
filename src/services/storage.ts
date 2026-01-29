// Storage Service
// Uploads media to Supabase Storage

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'mediamind';

// ============================================
// UPLOAD FILE TO STORAGE
// ============================================

export async function uploadToStorage(
  filePath: string,
  storagePath: string
): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = getContentType(filePath);

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`      Storage upload failed:`, error.message);
      return null;
    }

    // Get public URL
    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    return data.publicUrl;

  } catch (error: any) {
    console.error(`      Storage upload error:`, error.message);
    return null;
  }
}

// ============================================
// UPLOAD FROM URL (Download then upload)
// ============================================

export async function uploadFromUrl(
  sourceUrl: string,
  storagePath: string
): Promise<string | null> {
  try {
    const axios = (await import('axios')).default;

    const response = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, response.data, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`      Storage upload failed:`, error.message);
      return null;
    }

    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    return data.publicUrl;

  } catch (error: any) {
    console.error(`      Upload from URL failed:`, error.message);
    return null;
  }
}

// ============================================
// DELETE FROM STORAGE
// ============================================

export async function deleteFromStorage(storagePath: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([storagePath]);

    return !error;
  } catch (error) {
    return false;
  }
}

// ============================================
// LIST FILES IN PATH
// ============================================

export async function listFiles(folderPath: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folderPath);

    if (error) return [];

    return data.map(file => `${folderPath}/${file.name}`);
  } catch (error) {
    return [];
  }
}

// ============================================
// HELPERS
// ============================================

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
