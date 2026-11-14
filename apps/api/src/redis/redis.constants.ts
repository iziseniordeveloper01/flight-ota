// A Symbol token avoids name clashes when we inject the client anywhere in the app.
// Own file so redis.module.ts and json-cache.service.ts can both import it without a cycle.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
