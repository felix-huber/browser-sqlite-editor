/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      numberOfRuns: 3,
    },
    assert: {
      // Use recommended preset - this is a PWA with offline support
      preset: 'lighthouse:recommended',
      assertions: {
        // Error-level assertions for real enforcement (scores already 99%+)
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        // Disable only flaky/NaN-producing audits
        'lcp-lazy-loaded': 'off',
        'prioritize-lcp-image': 'off',
        'non-composited-animations': 'off',
        'network-dependency-tree-insight': 'off', // New audit, flaky score=0
        // Keep enabled: color-contrast, aria-allowed-role (now fixed)
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
