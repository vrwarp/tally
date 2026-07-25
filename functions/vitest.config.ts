import { defineConfig } from 'vitest/config';

/**
 * The functions package is tested in complete isolation: no emulator, no
 * network, no Firebase credentials. Every module that touches the outside world
 * (`fetch`, Firestore) takes it as an injected dependency, so the suite is a
 * plain Node unit run.
 */
export default defineConfig({
  test: {
    name: 'functions',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
