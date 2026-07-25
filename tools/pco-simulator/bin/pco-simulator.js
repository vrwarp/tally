#!/usr/bin/env node
/**
 * Runs the simulator from source with tsx, so the container needs no build step.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/server.ts');

const child = spawn('npx', ['tsx', entry], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
