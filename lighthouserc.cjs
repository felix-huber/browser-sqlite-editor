/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      // Only test index.html - offline.html and stats.html (visualizer) are not user-facing pages
      url: ['http://localhost/index.html'],
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
        // Disable flaky/NaN-producing audits and audits not applicable to SPA
        'unused-javascript': 'off', // SPA bundles load full app upfront; tree-shaking already applied
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
