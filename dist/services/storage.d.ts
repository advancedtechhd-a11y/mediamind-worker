export declare function uploadToStorage(filePath: string, storagePath: string): Promise<string | null>;
export declare function uploadFromUrl(sourceUrl: string, storagePath: string): Promise<string | null>;
export declare function deleteFromStorage(storagePath: string): Promise<boolean>;
export declare function listFiles(folderPath: string): Promise<string[]>;
//# sourceMappingURL=storage.d.ts.map