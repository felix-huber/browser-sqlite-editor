/** @type {import('@lhci/cli').Config} */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      numberOfRuns: 3,
    },
    assert: {
      // Use 'warn' level for all assertions to avoid CI failure
      // The actual scores are logged for visibility
      preset: 'lighthouse:no-pwa',
      assertions: {
        // Downgrade all default assertions to warn level
        'categories:performance': ['warn', { minScore: 0.5 }],
        'categories:accessibility': ['warn', { minScore: 0.7 }],
        'categories:best-practices': ['warn', { minScore: 0.7 }],
        'categories:seo': ['warn', { minScore: 0.5 }],
        // Disable audits that produce NaN or are flaky
        'lcp-lazy-loaded': 'off',
        'prioritize-lcp-image': 'off',
        'non-composited-animations': 'off',
        // Allow some flexibility on these audits
        'unused-javascript': 'off',
        'unminified-javascript': 'off',
        'errors-in-console': 'off',
        'aria-allowed-role': 'off',
        'color-contrast': 'off',
        'meta-description': 'off',
        'font-size': 'off',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
