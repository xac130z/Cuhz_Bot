const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.cjs'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
        rules: {
            ...js.configs.recommended.rules,
            // Keep existing cleanup work visible without hiding correctness
            // errors such as undefined names, unreachable code or bad scopes.
            'no-unused-vars': 'warn',
            'no-useless-escape': 'warn',
        },
    },
];
