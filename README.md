# sexy00.cc profile sync

This private repository runs an independent profile synchronization job for `sexy00.cc`.

- Source: the configured public EDC product feed used by the existing sync script.
- Destination: `https://sexy00.cc/api/profile-sync`.
- Schedule: every six hours at 04:30, 10:30, 16:30, and 22:30 UTC.
- Manual run: GitHub Actions → **Sync public profiles to sexy00.cc** → **Run workflow**.

The workflow uses repository secrets and does not share runtime settings with `sexyning.cc`.
