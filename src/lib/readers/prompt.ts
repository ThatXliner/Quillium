import type { Chattiness, ReaderPersona } from "./presets";

const CHATTINESS_DIRECTIVES: Record<Chattiness, string> = {
    quiet:
        "IMPORTANT: Only comment if you genuinely have something worth saying. Flag only issues that significantly harm the writing. If the passage is solid, say nothing.",
    normal:
        "Comment on issues worth the writer's attention. Be selective but don't hold back on meaningful observations.",
    verbose:
        "Be thorough. Flag everything you notice from your perspective, even minor issues.",
};

/**
 * Build the persona prefix to prepend to a mode's system prompt.
 * Returns the identity block + chattiness directive as a single string.
 */
export function buildPersonaPrompt(persona: ReaderPersona): string {
    return `You are the ${persona.name}, a reader who ${persona.instruction} You read from this specific perspective and your feedback reflects this lens.

${CHATTINESS_DIRECTIVES[persona.chattiness]}

`;
}
