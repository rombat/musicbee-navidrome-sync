export default {
  branches: ['master'],
  plugins: [
    '@semantic-release/commit-analyzer',
    {
      preset: 'eslint',
      releaseRules: [
        { scope: 'no-release', release: false },
        { type: '', release: 'patch' }
      ]
    },
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/npm',
      {
        npmPublish: false
      }
    ],
    [
      '@semantic-release/exec',
      {
        publishCmd: 'npm run build'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: '.dist/musicbee-navidrome-sync.exe'
          }
        ]
      }
    ]
  ]
};
