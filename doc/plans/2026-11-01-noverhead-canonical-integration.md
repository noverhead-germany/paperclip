# NOverhead canonical Paperclip integration

Owner authorization: use the existing master checkout, preserve every history,
then consolidate to one development checkout in the NOverhead WorkSpace.
Operational tracking: NOverhead ADO #261.

## Preserved inputs

- master: 0227b5599af26bf1269c8c2478846ea802635d01.
- fix/ui-send-on-insecure-lan-origin: 77ce39200ba87e9017ab9a3890fce0fccd59a1e5.
- Fork noverhead/master: b649bd454fce0c5d9aed64e6b75eb302b5d255ba.
- Upstream origin/master fetched at 1a6017d646 (2026-11-01).
- All six local branch tips and their complete history are retained in a
  verified Git bundle at D:/Backups/Paperclip-261-20261101/before-integration.bundle.
- No branch or worktree has been removed, no published history rewritten.

## First merge boundary

Merge the existing insecure-origin fix into master. Automatic merge has no
conflicts. It retains both parents and the existing composer pause/refetch fix.
Validation: two UUID tests and 263 composer/task tests passed; production UI
build passed (existing CSS, config-loader and chunk-size warnings).
UI typecheck passed after building the existing shared/Plugin SDK declarations.
The global token gate reports 106 pre-existing violations; the merge changes
UUID calls and introduces no style/token values. No unrelated style cleanup is
included. Full server/workspace qualification is not claimed for this UI merge.
The Windows root postinstall failed to create an excluded-plugin directory
symlink (EPERM); the scoped UI dependency build and checks succeeded afterward.

## Consolidation constraints

Two older worktrees contain uncommitted data: the scratch PaperclipExport
checkout has untracked publish/tools content; composer-imagebase has staged
IssueDetail changes and a modified lockfile. Preserve those before retirement.
The master checkout's node_modules is a junction into the old primary checkout.
The running Paperclip container uses a named data volume, no source bind mount.
No source relocation or runtime deployment is part of this first merge.

The separately inspected upstream PR #13428 is open, unmerged and currently
not mergeable. Its head belongs to TMaYaD/paperclip, not the NOverhead fork;
do not alter it or claim it is the local fix branch's PR. Connector searches
found no PR for head:noverhead-germany in paperclipai/paperclip or in the fork.

## Integration direction

The current master already contains upstream custom-gateway onboarding
(fbaf3c6ed2). Reuse its connection and environment-test gates when implementing
NOverhead Node; a new tile alone must never count as connectivity. Complete
canonical history integration and source-path checks before implementation.
