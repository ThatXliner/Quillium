/**
 * index.ts -- Relay server entry point.
 *
 * WebSocket relay server for Quillium Omni real-time collaboration.
 * Per D-71: Uses native WebSocket + Yjs sync protocol.
 *
 * See: .planning/phases/07.5-yjs-migration/07.5-RESEARCH.md for architecture.
 */
import "dotenv/config";
import { createLogger } from "./logger.js";
import { createRelayServer } from "./server.js";

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const logger = createLogger("relay");

const { httpServer, close } = createRelayServer();

httpServer.listen(PORT, HOST, () => {
    logger.info(`Yjs WebSocket relay listening on ${HOST}:${PORT}`);
    logger.info(`Health check: http://${HOST}:${PORT}/health`);
});

let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, closing server...`);

    const forceExit = setTimeout(() => {
        logger.warn("Graceful shutdown timed out");
        process.exit(1);
    }, 10_000);

    try {
        await close();
    } finally {
        clearTimeout(forceExit);
    }
    logger.info("Server closed");
    process.exit(0);
}

process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((e) => {
        logger.error("Shutdown error:", e);
        process.exit(1);
    });
});

process.on("SIGINT", () => {
    shutdown("SIGINT").catch((e) => {
        logger.error("Shutdown error:", e);
        process.exit(1);
    });
});
