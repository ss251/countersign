#!/usr/bin/env node
import { main } from "./main.ts";
main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
