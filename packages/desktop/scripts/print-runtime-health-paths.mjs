#!/usr/bin/env node
import { getArchiveValidationFiles } from './runtime-health-contract.mjs';

for (const file of getArchiveValidationFiles()) {
  console.log(file);
}
