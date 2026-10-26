// persistenceError.ts. An append failure leaves the draft's event history uncertain.
export class PersistenceError extends Error {
    constructor(cause: unknown) {
        super(
            "Your latest changes could not be saved. Keep this draft open to preserve your work.",
            { cause },
        );
        this.name = "PersistenceError";
    }
}
