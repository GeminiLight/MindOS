#!/usr/bin/env node

import { runMindosCli } from '../src/cli-runtime.js';

await runMindosCli(process.argv.slice(2));
