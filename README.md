# remove-unused-vars

Remove more unused variables. Highly experimental.

> [!WARNING]
>
> There's a reason linters don't fix the unused variables, even with a flag like `--unsafe` or `--fix-dangerously`.

Modern linters can fix a lot of issues automatically, but don't always remove all unused variables and types (again, for
good reason!). However, removing everything the linter finds and then run QA and review what needs to be reverted can
save a lot of time. Needless to say, Git's your friend here.

Don't use e.g. `eslint --fix` or `biome lint --write` when piping to `remove-unused-vars`, otherwise the positions to
remove things might not match up. Use the linter first to have it remove whatever it can, then proceed with the
command(s) below.

> [!TIP]
>
> Use this with [Knip](https://knip.dev) for a cruel code crusher experience.

## Install

```sh
npm install -D remove-unused-vars
```

## Pipe JSON

Pipe the JSON-formatted output of the linter to `remove-unused-vars`

Add to `package.json#scripts`, modify the commands below and make sure to use local linter configuration.

### ESLint

```sh
eslint --rule 'no-unused-vars: error' --quiet -f json | remove-unused-vars
```

### typescript-eslint

```sh
eslint --rule 'no-unused-vars: off' --rule '@typescript-eslint/no-unused-vars: error' --quiet -f json | remove-unused-vars
```

### Biome

```sh
biome lint --only correctness/noUnusedVariables --reporter json | remove-unused-vars
```

### oxlint

```sh
oxlint -A all -D '@typescript-eslint/no-unused-vars' -f json | remove-unused-vars
```

## From JSON file

Alternatively, provide a JSON file as the first argument to `remove-unused-vars`, for example:

```sh
oxlint -A all -D '@typescript-eslint/no-unused-vars' -f json > unused-vars.json
remove-unused-vars unused-vars.json
```

## Without installation

Use something like this without installing `remove-unused-vars`:

```
npm run --silent lint -- --quiet --format json | npx -y remove-unused-vars
```
