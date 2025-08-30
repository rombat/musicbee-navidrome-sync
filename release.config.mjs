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
      '@semantic-release/changelog',
      {
        changelogTitle: 'MBNDS CHANGELOG'
      }
    ],
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
    ],
    [
      '@semantic-release/git',
      {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template variables
        message: 'chore(release): set `package.json` to ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
        assets: ['package.json', 'CHANGELOG.md']
      }
    ]
  ]
};
