module.exports = {
  branches: ['master'],
  plugins: [
    '@semantic-release/commit-analyzer',
    {
      preset: 'eslint',
      releaseRules: [
        { scope: 'no-release', release: false },
        { type: 'chore', release: 'patch' },
        { type: '', release: 'patch' }
      ]
    },
    [
      '@semantic-release/release-notes-generator',
      {
        changelogTitle: 'MBNDS CHANGELOG'
      }
    ],
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        npmPublish: false
      }
    ],
    [
      '@semantic-release/exec',
      {
        publishCmd: 'npm run build ${nextRelease.version}'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [{ path: '.dist/musicbee-navidrome-sync_${nextRelease.version}.exe', label: 'MBNDS v${nextRelease.version}' }]
      }
    ],
    [
      '@semantic-release/git',
      {
        message: 'chore(release): set `package.json` to ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
        assets: ['package.json', 'CHANGELOG.md']
      }
    ]
  ]
};
