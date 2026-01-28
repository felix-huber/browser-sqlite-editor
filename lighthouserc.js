/** @type {import('@lhci/cli').Config} */
export default {
  ci: {
    collect: {
      staticDistDir: './dist',
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        // Core category thresholds
        'categories:pwa': ['error', { minScore: 0.9 }],
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.8 }],
        // PWA-specific assertions
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
