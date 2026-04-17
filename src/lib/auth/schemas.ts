/**
 * schemas.ts — Form validation schemas for auth forms.
 */
import { z } from "zod";

export const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    displayName: z.string().min(1, "Display name is required").max(50, "Display name too long"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

export const displayNameSchema = z.object({
    displayName: z
        .string()
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name must be 50 characters or less")
        .regex(
            /^[a-zA-Z0-9\s\-']+$/,
            "Name can only contain letters, numbers, spaces, hyphens, and apostrophes",
        )
        .transform((s) => s.trim()),
});

export type DisplayNameInput = z.infer<typeof displayNameSchema>;
