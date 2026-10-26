/**
 * schemas.ts -- Relay error codes.
 *
 * Live Room validation is shared through @quillium/share/collab-contract.
 */
/**
 * Error codes returned to client on auth failure.
 * Per D-33: Invalid/expired JWTs rejected immediately.
 */
export const AuthErrorCode = {
    AUTH_REQUIRED: 4001,
    AUTH_INVALID: 4002,
    AUTH_EXPIRED: 4003,
    PERMISSION_DENIED: 4004,
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

/**
 * Error codes for persistence failures.
 * Per D-42: Client receives error code and can retry or surface to user.
 */
export const PersistErrorCode = {
    PERSIST_FAILED: 5001,
    PERSIST_TIMEOUT: 5002,
    PERSIST_CONFLICT: 5003,
} as const;

export type PersistErrorCode = (typeof PersistErrorCode)[keyof typeof PersistErrorCode];
