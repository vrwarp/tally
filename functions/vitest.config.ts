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
    // Vitest 4 narrowed `restoreMocks` to undoing `vi.spyOn`; a bare `vi.fn()`
    // keeps its calls and its implementation across tests without this. See the
    // longer note in the repository-root vitest config.
    restoreMocks: true,
    mockReset: true,
  },
});
