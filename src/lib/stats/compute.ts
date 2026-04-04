export interface WritingStats {
    words: number;
    chars: number;
    sentences: number;
    paragraphs: number;
    readingTimeMinutes: number;
    avgSentenceLength: number;
    avgWordLength: number;
    vocabularyDiversity: number;
    readabilityGrade: number;
}

function countSyllables(word: string): number {
    const lower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (lower.length === 0) return 1;

    // Count vowel groups
    const vowelGroups = lower.match(/[aeiou]+/g);
    let count = vowelGroups ? vowelGroups.length : 1;

    // Subtract 1 for silent e at end
    if (lower.endsWith("e") && count > 1) {
        count--;
    }

    return Math.max(1, count);
}

function getWords(text: string): string[] {
    return text.split(/\s+/).filter((w) => w.length > 0);
}

function countSentences(text: string): number {
    if (text.trim().length === 0) return 0;

    // Split on sentence-ending punctuation, handling abbreviations roughly
    // by requiring the punctuation to be followed by whitespace+capital or end of string
    const sentences = text
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    return sentences.length;
}

function countParagraphs(text: string): number {
    if (text.trim().length === 0) return 0;

    const paragraphs = text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    return Math.max(paragraphs.length, 1);
}

function roundToHalf(n: number): number {
    return Math.round(n * 2) / 2;
}

function roundToOneDecimal(n: number): number {
    return Math.round(n * 10) / 10;
}

export function computeStats(text: string): WritingStats {
    const words = getWords(text);
    const wordCount = words.length;
    const chars = text.length;
    const sentences = countSentences(text);
    const paragraphs = countParagraphs(text);

    const readingTimeMinutes = roundToHalf(wordCount / 238);

    const avgSentenceLength = sentences > 0 ? roundToOneDecimal(wordCount / sentences) : 0;

    const totalWordChars = words.reduce((sum, w) => sum + w.length, 0);
    const avgWordLength = wordCount > 0 ? roundToOneDecimal(totalWordChars / wordCount) : 0;

    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    const vocabularyDiversity =
        wordCount > 0 ? Math.round((uniqueWords.size / wordCount) * 100) : 0;

    // Flesch-Kincaid grade level
    const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const readabilityGrade =
        wordCount > 0 && sentences > 0
            ? Math.round(
                  0.39 * (wordCount / sentences) + 11.8 * (totalSyllables / wordCount) - 15.59,
              )
            : 0;

    return {
        words: wordCount,
        chars,
        sentences,
        paragraphs,
        readingTimeMinutes,
        avgSentenceLength,
        avgWordLength,
        vocabularyDiversity,
        readabilityGrade,
    };
}
