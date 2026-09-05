# VEYVO project instructions

## Release publishing authorization

The user explicitly authorizes Codex to commit and push completed, tested VEYVO version changes to the configured `origin` repository (`https://github.com/PepiBikerBTW/VEYVO.git`) without requesting confirmation for each push.

- Push only changes belonging to the VEYVO project.
- Run proportionate tests before publishing.
- Never commit secrets, credentials, `.env` files, `node_modules`, or local build output.
- Use the existing `main` branch unless the user requests a different branch.
- Report the pushed commit and version after publishing.
- This authorization covers normal version publishing only; destructive Git operations, history rewrites, repository deletion, visibility changes, and credential changes still require explicit approval.
