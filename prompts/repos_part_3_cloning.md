# Task: Optimize Git clone speed in ReposService

## Problem

Cloning repositories via AGEMS is very slow, and repos with LFS time out. Root causes:

1. Full history is cloned (no `--depth`), but for code search agents only need the latest snapshot
2. All blobs are downloaded, including large binaries — no `--filter`
3. `GIT_LFS_SKIP_SMUDGE=1` is set but the LFS process filter can still run on every blob, causing hangs
4. Clone timeout is hardcoded at 240s — too short for large repos

## File to edit

`apps/api/src/modules/repos/repos.service.ts`

## Changes

### 1. Add `--depth=1` to the clone command in `buildCloneCommand`

In the `base` variable, add `--depth 1` so only the latest commit is fetched:

```
const base = `git clone --progress --depth 1 --branch ${repo.branch} --single-branch`;
```

### 2. Add `--filter=blob:limit=1m` to skip large blobs

Add it to the `base` string as well:

```
const base = `git clone --progress --depth 1 --filter=blob:limit=1m --branch ${repo.branch} --single-branch`;
```

This way Git won't download blobs larger than 1 MB (images, binaries, dumps). They'll be lazy-fetched only if explicitly accessed, which won't happen in our code search use case.

### 3. Fully disable LFS filter in `lfsEnv`

Current code:
```ts
const lfsEnv = { GIT_LFS_SKIP_SMUDGE: '1' };
```

Change to pass config overrides via the command and expand the env:

```ts
const lfsEnv = {
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'filter.lfs.smudge',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_KEY_1: 'filter.lfs.process',
  GIT_CONFIG_VALUE_1: '',
  GIT_CONFIG_KEY_2: 'filter.lfs.required',
  GIT_CONFIG_VALUE_2: 'false',
};
```

This completely disables the LFS filter process during clone via environment-based git config overrides (cleaner than `-c` flags, works with all auth types).

### 4. Increase clone timeout from 240s to 600s

In method `cloneRepo`, find:
```ts
await this.spawnGit(cmd, repoId, { timeout: 240_000, env });
```

Change to:
```ts
await this.spawnGit(cmd, repoId, { timeout: 600_000, env });
```

## What NOT to change

- `pullRepo` method — leave `git pull --progress` and its 60s timeout as is (pulls are incremental and fast)
- `applyExcludes` — works fine, leave as is
- `spawnGit` / progress parsing — works correctly, no changes needed
- Prisma schema — no model changes required
- Frontend — no changes needed

## Verification

After changes, `buildCloneCommand` should produce a command like:
```
git clone --progress --depth 1 --filter=blob:limit=1m --branch main --single-branch <url> <path>
```

With env containing all LFS-disabling keys plus `GIT_TERMINAL_PROMPT=0`.