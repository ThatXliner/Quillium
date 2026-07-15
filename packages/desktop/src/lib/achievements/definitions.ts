/**
 * definitions.ts — Achievement badge catalog.
 *
 * The catalog is intentionally data-only so milestone rules and the badge UI
 * cannot drift apart as new achievements are added.
 */

export type AchievementCategory = "words" | "streak" | "sprints";

export type AchievementDefinition = {
    id: string;
    category: AchievementCategory;
    title: string;
    description: string;
    threshold: number;
    symbol: string;
};

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
    {
        id: "words-1000",
        category: "words",
        title: "First Thousand",
        description: "Reach 1,000 words in a draft",
        threshold: 1_000,
        symbol: "✦",
    },
    {
        id: "words-5000",
        category: "words",
        title: "Five Thousand",
        description: "Reach 5,000 words in a draft",
        threshold: 5_000,
        symbol: "✦",
    },
    {
        id: "words-10000",
        category: "words",
        title: "Long Form",
        description: "Reach 10,000 words in a draft",
        threshold: 10_000,
        symbol: "✦",
    },
    {
        id: "words-25000",
        category: "words",
        title: "Halfway There",
        description: "Reach 25,000 words in a draft",
        threshold: 25_000,
        symbol: "✦",
    },
    {
        id: "words-50000",
        category: "words",
        title: "Novel Length",
        description: "Reach 50,000 words in a draft",
        threshold: 50_000,
        symbol: "✦",
    },
    {
        id: "streak-3",
        category: "streak",
        title: "Finding a Rhythm",
        description: "Write for 3 days in a row",
        threshold: 3,
        symbol: "◒",
    },
    {
        id: "streak-7",
        category: "streak",
        title: "Week of Words",
        description: "Write for 7 days in a row",
        threshold: 7,
        symbol: "◒",
    },
    {
        id: "streak-14",
        category: "streak",
        title: "Two-Week Flow",
        description: "Write for 14 days in a row",
        threshold: 14,
        symbol: "◒",
    },
    {
        id: "streak-30",
        category: "streak",
        title: "Daily Practice",
        description: "Write for 30 days in a row",
        threshold: 30,
        symbol: "◒",
    },
    {
        id: "sprints-1",
        category: "sprints",
        title: "Off the Blocks",
        description: "Complete your first writing sprint",
        threshold: 1,
        symbol: "↗",
    },
    {
        id: "sprints-10",
        category: "sprints",
        title: "Sprint Regular",
        description: "Complete 10 writing sprints",
        threshold: 10,
        symbol: "↗",
    },
    {
        id: "sprints-25",
        category: "sprints",
        title: "Momentum",
        description: "Complete 25 writing sprints",
        threshold: 25,
        symbol: "↗",
    },
    {
        id: "sprints-50",
        category: "sprints",
        title: "Sprint Master",
        description: "Complete 50 writing sprints",
        threshold: 50,
        symbol: "↗",
    },
] as const;

export function getAchievement(id: string): AchievementDefinition | undefined {
    return ACHIEVEMENTS.find((achievement) => achievement.id === id);
}
