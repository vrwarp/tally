# The end-to-end suite, packaged so it runs the same way everywhere.
#
# The whole reason this image exists is WebKit: Playwright's browsers need a
# long tail of system libraries that differ between distributions, and Safari is
# the browser a real youth counselor is most likely to be holding. The official
# Playwright image carries chromium and webkit already built and linked.
#
# Everything the suite needs runs *inside* this container — the Planning Center
# simulator, the Firebase emulators and a production build of the app — so there
# is nothing to wire up and no external service to be unavailable.
FROM mcr.microsoft.com/playwright:v1.62.0-noble

# The Firestore and Auth emulators are Java programs; the Playwright image has
# no JRE.
RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    NODE_ENV=development \
    # Firebase writes its emulator downloads here; keeping it inside the image
    # means a run never has to reach the network for them.
    HOME=/root

WORKDIR /app

# Dependencies first, so a change to a test file does not reinstall the world.
COPY package.json package-lock.json ./
COPY tools/pco-simulator/package.json ./tools/pco-simulator/
RUN npm ci

COPY functions/package.json functions/package-lock.json ./functions/
RUN npm --prefix functions ci

COPY . .

# Compile the Cloud Functions now rather than at run time: the emulator reports
# a missing `lib/` as a warning and then serves nothing, which surfaces much
# later as an unexplained callable timeout.
RUN npm run functions:build

# Pre-download the emulator jars at build time so a run is not at the mercy of
# the network, and fail the build loudly if they cannot be fetched.
RUN npx firebase setup:emulators:firestore \
    && npx firebase setup:emulators:ui

COPY docker/e2e/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Reports and traces land here; mount them out to read a failure.
VOLUME ["/app/playwright-report", "/app/test-results"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
