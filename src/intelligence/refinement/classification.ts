/**
 * Rule-based classification module.
 *
 * Pure functions that classify creators, extract topics, detect language,
 * and generate summaries WITHOUT requiring an LLM. This is the v1 offline
 * fallback; LLM-enhanced classification will be layered on in a future phase.
 */

// ---------------------------------------------------------------------------
// Category taxonomy
// ---------------------------------------------------------------------------

export const CATEGORY_TAXONOMY = [
    'music',
    'gaming',
    'comedy',
    'education',
    'lifestyle',
    'sports',
    'tech',
    'fashion',
    'food',
    'art',
    'dance',
    'fitness',
    'beauty',
    'travel',
    'news',
    'business',
    'entertainment',
    'other',
] as const;

export type Category = (typeof CATEGORY_TAXONOMY)[number];

/**
 * Keyword lists per category. Each array contains lowercase stems/words
 * that signal the category.
 */
const CATEGORY_KEYWORDS: Record<Category, string[]> = {
    music: [
        'music', 'musician', 'singer', 'rapper', 'dj', 'producer', 'beat',
        'album', 'song', 'track', 'hip-hop', 'hip hop', 'afrobeat', 'afrobeats',
        'r&b', 'rnb', 'gospel', 'jazz', 'pop', 'rock', 'folk', 'classical',
        'audio', 'studio', 'recording', 'vocal', 'songwriter', 'compose',
        'melody', 'rhythm', 'guitar', 'piano', 'drum', 'bass', 'mixtape',
        'concert', 'tour', 'spotify', 'soundcloud', 'vinyl',
    ],
    gaming: [
        'gaming', 'gamer', 'esports', 'streamer', 'twitch', 'game',
        'playstation', 'xbox', 'nintendo', 'pc gaming', 'mobile gaming',
        'fps', 'moba', 'rpg', 'mmorpg', 'battle royale', 'fortnite',
        'valorant', 'league of legends', 'cod', 'minecraft', 'roblox',
        'guild', 'clan', 'tournament', 'competitive', 'speedrun',
    ],
    comedy: [
        'comedy', 'comedian', 'funny', 'humor', 'humour', 'joke', 'skit',
        'sketch', 'standup', 'stand-up', 'parody', 'satire', 'meme',
        'laugh', 'hilarious', 'comic',
    ],
    education: [
        'education', 'teacher', 'tutor', 'learn', 'course', 'tutorial',
        'lecture', 'university', 'student', 'academic', 'knowledge',
        'study', 'lesson', 'curriculum', 'exam', 'school', 'training',
        'workshop', 'mentor', 'edtech', 'stem',
    ],
    lifestyle: [
        'lifestyle', 'vlog', 'vlogger', 'daily', 'routine', 'life',
        'motivation', 'inspiration', 'wellness', 'mindfulness',
        'self-care', 'self care', 'productivity', 'minimalist',
        'home', 'family', 'parenting', 'relationship',
    ],
    sports: [
        'sports', 'athlete', 'football', 'soccer', 'basketball', 'cricket',
        'tennis', 'boxing', 'mma', 'ufc', 'wrestling', 'rugby', 'baseball',
        'volleyball', 'swimming', 'running', 'marathon', 'olympics',
        'championship', 'league', 'coach', 'training',
    ],
    tech: [
        'tech', 'technology', 'software', 'developer', 'programming',
        'code', 'coding', 'web3', 'blockchain', 'crypto', 'ai',
        'artificial intelligence', 'machine learning', 'data science',
        'startup', 'saas', 'app', 'gadget', 'review', 'cybersecurity',
        'devops', 'cloud', 'open source', 'api', 'fintech',
    ],
    fashion: [
        'fashion', 'style', 'outfit', 'clothing', 'designer', 'model',
        'runway', 'couture', 'streetwear', 'accessory', 'jewelry',
        'vintage', 'thrift', 'wardrobe', 'trend', 'ootd',
    ],
    food: [
        'food', 'cooking', 'chef', 'recipe', 'baking', 'restaurant',
        'cuisine', 'foodie', 'meal', 'kitchen', 'gourmet', 'vegan',
        'vegetarian', 'nutrition', 'diet', 'drink', 'cocktail',
        'coffee', 'tea', 'wine', 'beer',
    ],
    art: [
        'art', 'artist', 'painting', 'drawing', 'illustration', 'digital art',
        'sculpture', 'photography', 'photographer', 'design', 'graphic design',
        'creative', 'gallery', 'exhibition', 'canvas', 'sketch',
        'watercolor', 'oil painting', 'mural', 'graffiti', 'nft',
    ],
    dance: [
        'dance', 'dancer', 'choreography', 'choreographer', 'ballet',
        'hip hop dance', 'contemporary', 'salsa', 'afro dance', 'afrodance',
        'breakdance', 'twerk', 'dance challenge', 'tiktok dance',
    ],
    fitness: [
        'fitness', 'gym', 'workout', 'exercise', 'bodybuilding',
        'crossfit', 'yoga', 'pilates', 'cardio', 'strength',
        'personal trainer', 'weight loss', 'muscle', 'health',
        'nutrition', 'supplement', 'protein',
    ],
    beauty: [
        'beauty', 'makeup', 'skincare', 'cosmetic', 'nail', 'hair',
        'hairstyle', 'barber', 'salon', 'grooming', 'tutorial',
        'glam', 'contour', 'foundation', 'lipstick', 'serum',
    ],
    travel: [
        'travel', 'traveler', 'traveller', 'adventure', 'explore',
        'destination', 'tourism', 'backpack', 'flight', 'hotel',
        'resort', 'beach', 'mountain', 'hiking', 'road trip',
        'wanderlust', 'nomad', 'digital nomad', 'expat',
    ],
    news: [
        'news', 'journalist', 'reporter', 'breaking', 'headline',
        'politics', 'current events', 'media', 'press', 'editorial',
        'opinion', 'analysis', 'investigation', 'broadcast',
    ],
    business: [
        'business', 'entrepreneur', 'ceo', 'founder', 'startup',
        'marketing', 'sales', 'finance', 'investment', 'venture',
        'consulting', 'strategy', 'leadership', 'management',
        'ecommerce', 'e-commerce', 'brand', 'revenue', 'growth',
    ],
    entertainment: [
        'entertainment', 'celebrity', 'movie', 'film', 'tv', 'television',
        'series', 'netflix', 'actor', 'actress', 'director', 'producer',
        'hollywood', 'nollywood', 'bollywood', 'podcast', 'show',
        'reality tv', 'drama', 'anime', 'manga', 'cosplay',
    ],
    other: [],
};

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Common stopwords per language. A text that contains a higher density of
 * stopwords from a particular language is classified as that language.
 */
const LANGUAGE_STOPWORDS: Record<string, string[]> = {
    en: ['the', 'and', 'is', 'in', 'to', 'of', 'it', 'for', 'on', 'with', 'that', 'this', 'are', 'was', 'have', 'from', 'but', 'not', 'you', 'they'],
    fr: ['le', 'la', 'les', 'de', 'des', 'un', 'une', 'et', 'est', 'en', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'ce', 'il', 'ne', 'au'],
    pt: ['de', 'que', 'em', 'um', 'para', 'com', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das'],
    sw: ['na', 'ya', 'wa', 'ni', 'kwa', 'la', 'za', 'katika', 'au', 'hii', 'ile', 'hiyo', 'kuwa', 'kama', 'sana', 'yake', 'wake', 'hata', 'bado', 'pia'],
    yo: ['ni', 'ti', 'ati', 'si', 'fun', 'pe', 'kan', 'naa', 'ninu', 'lati', 'pelu', 'oun', 'won', 'emi', 'eyi', 'awon', 'nkan', 'ibi', 'ojo', 'ile'],
    ha: ['da', 'na', 'ya', 'shi', 'ta', 'ba', 'ka', 'ma', 'su', 'ne', 'ga', 'ci', 'ko', 'an', 'yi', 'mai', 'amma', 'idan', 'kuma', 'sai'],
    ig: ['na', 'bu', 'di', 'ka', 'ya', 'gi', 'ha', 'ma', 'si', 'ga', 'ndi', 'otu', 'ihe', 'ike', 'nke', 'maka', 'onye', 'ahu', 'obi', 'eze'],
    zu: ['na', 'ya', 'wa', 'le', 'ka', 'ba', 'ku', 'la', 'uma', 'uku', 'ama', 'izi', 'emi', 'aba', 'oko', 'ili', 'uku', 'isi', 'olu', 'ebi'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a creator into one or more categories from the taxonomy.
 * Uses keyword matching on bio + topics.
 */
export function classifyCreator(data: {
    bio?: string;
    topics?: string[];
    contentTypes?: string[];
}): string[] {
    const textParts: string[] = [];
    if (data.bio) textParts.push(data.bio);
    if (data.topics) textParts.push(...data.topics);
    if (data.contentTypes) textParts.push(...data.contentTypes);

    const text = textParts.join(' ').toLowerCase();

    if (text.trim().length === 0) return ['other'];

    const scores: Array<{ category: Category; score: number }> = [];

    for (const category of CATEGORY_TAXONOMY) {
        if (category === 'other') continue;

        const keywords = CATEGORY_KEYWORDS[category];
        let score = 0;

        for (const keyword of keywords) {
            if (text.includes(keyword)) {
                // Longer keyword matches are worth more
                score += keyword.length >= 6 ? 2 : 1;
            }
        }

        if (score > 0) {
            scores.push({ category, score });
        }
    }

    if (scores.length === 0) return ['other'];

    // Sort by score descending, take top 3
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, 3).map((s) => s.category);
}

/**
 * Extract topics (hashtags, key phrases) from an array of text inputs.
 * Deduplicates and normalises the output.
 */
export function extractTopics(texts: string[]): string[] {
    const topics = new Set<string>();

    for (const text of texts) {
        // Extract hashtags
        const hashtags = text.match(/#(\w+)/g);
        if (hashtags) {
            for (const tag of hashtags) {
                topics.add(tag.replace('#', '').toLowerCase());
            }
        }

        // Extract @mentions as potential topics
        const mentions = text.match(/@(\w+)/g);
        if (mentions) {
            for (const mention of mentions) {
                topics.add(mention.replace('@', '').toLowerCase());
            }
        }

        // Extract capitalised multi-word phrases (likely named entities)
        const namedEntities = text.match(/(?:[A-Z][a-z]+\s+){1,3}[A-Z][a-z]+/g);
        if (namedEntities) {
            for (const entity of namedEntities) {
                topics.add(entity.toLowerCase().trim());
            }
        }

        // Extract words that appear to be key terms (3+ chars, not common stopwords)
        const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const commonStopwords = new Set(LANGUAGE_STOPWORDS.en);
        for (const word of words) {
            const cleaned = word.replace(/[^a-z0-9-]/g, '');
            if (cleaned.length > 3 && !commonStopwords.has(cleaned)) {
                // Only add words that appear unique/meaningful
                // Skip very common words
                if (!['just', 'like', 'some', 'will', 'been', 'than', 'then',
                    'also', 'most', 'more', 'very', 'much', 'each', 'make',
                    'made', 'here', 'there', 'when', 'what', 'which', 'your',
                    'about', 'would', 'could', 'should', 'where', 'their',
                    'them', 'these', 'those', 'other', 'into', 'over', 'after'].includes(cleaned)) {
                    topics.add(cleaned);
                }
            }
        }
    }

    return [...topics].slice(0, 20); // Cap at 20 topics
}

/**
 * Simple heuristic language detection using stopword frequency.
 * Returns an ISO 639-1 code. Defaults to `'en'`.
 */
export function detectLanguage(text: string): string {
    if (!text || text.trim().length === 0) return 'en';

    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

    if (words.length < 3) return 'en'; // Too short to detect reliably

    const scores: Record<string, number> = {};

    for (const [lang, stopwords] of Object.entries(LANGUAGE_STOPWORDS)) {
        const stopwordSet = new Set(stopwords);
        let matches = 0;
        for (const word of words) {
            if (stopwordSet.has(word)) matches++;
        }
        scores[lang] = matches / words.length;
    }

    // Find the language with the highest stopword density
    let bestLang = 'en';
    let bestScore = 0;

    for (const [lang, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestLang = lang;
        }
    }

    // If the best score is too low, default to English
    if (bestScore < 0.05) return 'en';

    return bestLang;
}

/**
 * Generate a summary from a biography or longer text.
 *
 * - If bio is under 280 chars, return it cleaned up.
 * - If longer, truncate at the nearest sentence boundary.
 *
 * This is the rule-based fallback; LLM summarisation ships in a future phase.
 */
export function generateSummary(bio: string, additionalContext?: string): string {
    if (!bio || bio.trim().length === 0) {
        return additionalContext?.trim() ?? '';
    }

    // Clean up the bio
    let cleaned = bio.trim()
        .replace(/\s+/g, ' ')       // collapse whitespace
        .replace(/\n+/g, ' ')       // flatten newlines
        .replace(/\s*\|\s*/g, '. ') // pipe separators → sentences
        .replace(/\s*•\s*/g, '. ')  // bullet separators → sentences
        .replace(/\.{2,}/g, '.')    // collapse dots
        .replace(/\s+/g, ' ')       // re-collapse
        .trim();

    // Append additional context if it adds new info
    if (additionalContext && additionalContext.trim().length > 0) {
        const ctx = additionalContext.trim();
        if (!cleaned.toLowerCase().includes(ctx.toLowerCase().slice(0, 30))) {
            cleaned = `${cleaned}. ${ctx}`;
        }
    }

    if (cleaned.length <= 280) return cleaned;

    // Truncate at sentence boundary
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
    if (!sentences) return cleaned.slice(0, 277) + '...';

    let summary = '';
    for (const sentence of sentences) {
        if ((summary + sentence).length > 280) break;
        summary += sentence;
    }

    return summary.trim() || cleaned.slice(0, 277) + '...';
}
