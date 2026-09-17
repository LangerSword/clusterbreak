/**
 * Bridge to the simulation engine (`sim/` package).
 *
 * The engine is pure TypeScript with no runtime dependencies, so the frontend
 * imports its source directly — one package, no build step, no drift between
 * what the tests verify and what the UI runs.
 */
export * from "../../sim/src/index";
