import { PUBLIC_INSECURE_API_KEY } from "$env/static/public";
import { createOpenAI } from "@ai-sdk/openai";

export const openai = createOpenAI({ apiKey: PUBLIC_INSECURE_API_KEY });
