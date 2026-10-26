import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { z } from "zod";

export const LiveRoleSchema = z.enum(["viewer", "commenter", "editor"]);
export type LiveRole = z.infer<typeof LiveRoleSchema>;
export const MESSAGE_COMMENT = 4;
export const CUSTOM_ACCESS = 3;
export const CUSTOM_COMMENT_RESULT = 4;
export const ACCESS_CHANGED_CODE = 4003;

const ScopeSchema = z
    .array(
        z
            .object({
                annotationId: z.string().min(1).max(256),
                versionId: z.string().min(1).max(256),
            })
            .strict(),
    )
    .max(16);
const PositionSchema = z.array(z.number().int().min(0).max(255)).min(1).max(512);
const CommandBase = z.object({
    requestId: z.string().uuid(),
    roomEpoch: z.string().uuid(),
    scope: ScopeSchema,
    message: z.string().trim().min(1).max(10000),
});
export const CommentCommandSchema = z.discriminatedUnion("kind", [
    CommandBase.extend({
        kind: z.literal("createComment"),
        start: PositionSchema,
        end: PositionSchema,
    }).strict(),
    CommandBase.extend({
        kind: z.literal("replyToComment"),
        annotationId: z.string().min(1).max(256),
    }).strict(),
]);
export type CommentCommand = z.infer<typeof CommentCommandSchema>;
export type CommentScope = z.infer<typeof ScopeSchema>;

export function encodeCommentCommand(command: CommentCommand): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_COMMENT);
    encoding.writeVarString(encoder, JSON.stringify(CommentCommandSchema.parse(command)));
    return encoding.toUint8Array(encoder);
}

export function decodeCommentCommand(decoder: decoding.Decoder): CommentCommand {
    const command = CommentCommandSchema.parse(JSON.parse(decoding.readVarString(decoder)));
    if (decoding.hasContent(decoder)) throw new Error("Trailing comment data");
    return command;
}
