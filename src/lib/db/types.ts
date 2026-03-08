export type DocumentMeta = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    wordCount: number;
    previewText: string;
    tags: string[];
};

export type DocumentRecord = DocumentMeta & { stateJson: string };

export type RawDocumentRow = {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    word_count: number;
    preview_text: string;
    tags: string;
    state_json: string;
};
