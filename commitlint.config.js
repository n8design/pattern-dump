// No tool attribution in commits (CONTRIBUTING.md, Commits and branches): a Co-authored-by or
// Claude-Session trailer, or a "Generated with Claude" line, fails the commit.
const TRAILER = /^(co-authored-by|claude-session)\s*:/im;
const GENERATED = /generated with \[?claude/i;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{
    rules: {
      'no-tool-attribution': ({ raw }) => {
        const text = raw ?? '';
        return [!TRAILER.test(text) && !GENERATED.test(text),
          'no tool attribution: remove Co-authored-by, Claude-Session and "Generated with" lines'];
      },
    },
  }],
  rules: {
    'header-max-length': [2, 'always', 72],
    'no-tool-attribution': [2, 'always'],
  },
};
