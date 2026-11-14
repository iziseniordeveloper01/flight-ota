// Re-export generated types (User, Airport, Prisma namespace...) so apps import only from '@ota/db'.
export * from './generated/prisma/client.js';
export { createPrismaClient, type CreatePrismaClientOptions } from './client.js';