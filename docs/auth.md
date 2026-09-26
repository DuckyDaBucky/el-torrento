# Authentication

Clerk handles Google sign-in. The server stores the Clerk user id, not a homemade password.

Bootstrap: the first successful sign-in whose verified email is `hasnainmn7@gmail.com` becomes the only owner, and that Clerk user id is what later checks use. A later Google account with the same address does not replace it unless an owner recovery step says so.

Everyone else is `viewer` until User Management invites them. There is no list of family emails in git.

Owner routes and viewer routes are separate. A viewer cannot call guest, deploy, or credential APIs. Revoked and suspended users lose stream authorization on the next request.

Mutations the admin UI offers are sent to the private management worker described in `el-torrento-infra`. This app never holds the Proxmox mutation token.
