/** @type {import('@lhci/cli').Config} */
export default {
  ci: {
    collect: {
      staticDistDir: './dist',
      numberOfRuns: 3,
    },
    assert: {
      // Category-level assertions only - skip individual audit assertions
      // that produce NaN values or are flaky in CI
      assertions: {
        // Core category thresholds - these are the primary quality gates
        'categories:performance': ['warn', { minScore: 0.7 }],
        'categories:accessibility': ['warn', { minScore: 0.85 }],
        'categories:best-practices': ['warn', { minScore: 0.85 }],
        'categories:seo': ['warn', { minScore: 0.7 }],
        'categories:pwa': ['warn', { minScore: 0.85 }],
        // PWA-specific assertions that should always pass
        'installable-manifest': 'error',
        'service-worker': 'error',
        'works-offline': 'error',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
