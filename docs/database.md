# Database

The El Torrento app uses **SQLite** (`ELTORRENTO_DB`, default `data/app.sqlite` on the apps VM disk).

Compose does not run Postgres. `DATABASE_URL` is not read. Backups copy the SQLite file. Tests may point `ELTORRENTO_DB` at `:memory:` or a temp file.

Do not add a second database beside this one unless the app is migrated and SQLite is removed from the running path.
