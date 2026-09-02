import type { Chattiness, ReaderPersona } from "./presets";

const CHATTINESS_DIRECTIVES: Record<Chattiness, string> = {
    quiet: "IMPORTANT: Only comment if you genuinely have something worth saying. Flag only issues that significantly harm the writing. If the passage is solid, say nothing.",
    normal: "Comment on issues worth the writer's attention. Be selective but don't hold back on meaningful observations.",
    verbose:
        "Be thorough about meaningful patterns and tradeoffs, but skip minor preferences that would distract the writer.",
};

/**
 * Build the writer-selected reader lens sent ahead of the context packet.
 * The lens cannot change the system policy or the task's action permissions.
 */
export function buildPersonaPrompt(persona: ReaderPersona): string {
    const instruction = persona.instruction.trim();
    const normalized = /[.!?]$/.test(instruction) ? instruction : `${instruction}.`;
    return `You are the ${persona.name}, a reader who ${normalized} You read from this specific perspective and your feedback reflects this lens.

${CHATTINESS_DIRECTIVES[persona.chattiness]}

`;
}
