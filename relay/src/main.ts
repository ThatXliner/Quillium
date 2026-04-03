import { createServer } from "./server.js";
import { PORT } from "./env.js";

const server = createServer({ port: PORT });

server.start().then(() => {
    console.log(`Collab relay listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await server.stop();
    process.exit(0);
});
