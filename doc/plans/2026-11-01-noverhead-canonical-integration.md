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

## Upstream merge verification

Upstream 1a6017d6460267ad89d7e1784e2b521c28d8e9ac was merged after the
first local merge. Three content conflicts were resolved by retaining the
upstream durable-send/account ownership logic and using createUuid for IDs.
The task pause refetch retains cached state; retry timing now belongs to the
new upstream query client. Two inherited test assertions were changed to test
that a refetch occurred rather than override the shared retry count.

441 affected tests are green: the first run passed 437 and exposed four
retry-count assertion failures; after the assertion adjustment all 218
IssueDetail tests passed again. UUID, TaskChatComposer and IssueChatThread
tests already passed in that first run. UI typecheck and production build
passed on the upstream merge. Upstream itself contains whitespace warnings;
the custom delta is checked separately against origin/master.

Consolidation has not completed. An attempted PowerShell move of the scratch
checkout stopped at a package link. Its tracked files were restored by a
non-destructive copy; git status again shows only the original untracked
publish/ and tools/PaperclipExport/ directories. The partial archival copy is
retained. An atomic directory move then returned access denied. No worktree
registration, branch or source directory was deleted. Do not claim the final
WorkSpace relocation or single-checkout acceptance until separately verified.

## Verified consolidation checkpoint

The primary repository was subsequently moved atomically to
`C:/Users/NOverhead/WorkSpace/Paperclip`. Git repaired the linked-worktree
metadata; the former master checkout was detached, then the primary checkout
switched to existing master at 4eaa0e1139. The fork received that commit by a
normal fast-forward push and its live ref was verified.

All five linked checkouts are now inactive preserved file directories at
their original paths. Their .git marker files and full worktree metadata
(including staged indexes) are stored under
`D:/Backups/Paperclip-261-20261101`; stale registrations were pruned only after
those backups and a complete canonical-master.bundle were verified. No source
files, ignored artifacts, untracked exports or branch refs were removed.
The scratch directory's rename remains denied, so its original path is kept
as an archive rather than forcing a move. Its partial archival copy also stays.

`git worktree list` now contains exactly one entry: the WorkSpace primary
checkout on master. All other local branch refs remain for historical/PR
preservation, not active development. The separate Paperclip-UBL repository
is deployment evidence with dirty configuration, not a source checkout; it
remains intact. The live Compose project's working directory is
`WorkSpace/NOverhead/Provisioning/Local`, and Paperclip mounts only its named
data volume. No live deployment or data migration occurred.

Paket/workspace links are being rebuilt from the frozen upstream lockfile for
the canonical path. This does not establish Node-onboarding or E2E acceptance.
