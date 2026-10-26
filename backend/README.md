# Backend

Django 6 + PostgreSQL API between the frontend and the Data Authentication API. It holds every
assessment, form, document and case; the frontend reads and changes them only through `/api`.

## Development setup

Requires Python 3.14 and PostgreSQL 18 (the installed binaries; no admin rights needed).

```powershell
# 1. Start the project's database. It is a separate instance in your user folder on port 5433,
#    not a Windows service, so start it after each reboot.
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\fnp-postgres\data" `
    -o "-p 5433 -c listen_addresses=127.0.0.1" -l "$env:LOCALAPPDATA\fnp-postgres\postgres.log" start

# 2. Python environment and dependencies (first time only)
py -3.14 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

# 3. Settings: copy .env.example to .env and fill it in (first time only). .env is git-ignored.

# 4. Database schema, then run
.\.venv\Scripts\python manage.py migrate
.\.venv\Scripts\python manage.py seed_demo   # the five demo applicants from ../test-data
.\.venv\Scripts\python manage.py runserver 127.0.0.1:8001

# In a second window: the worker that follows engine runs, so no page waits on the engine.
.\.venv\Scripts\python manage.py follow_runs

# For a testing session, add --noreload: the server then does not restart on code changes.

# seed_demo --reset  reloads the demo applicants from scratch, in one step (development only)
# seed_demo --submit sends the unsubmitted ones to the engine (five billed runs)

# Tests (creates and drops a throwaway test database)
.\.venv\Scripts\python -m pytest
```

The database admin login (`fnp_admin`) is in `%LOCALAPPDATA%\fnp-postgres\admin-credentials.txt`;
the app itself connects as `fnp_app`, which owns only the `fnp` database.

### Admin site (`/admin/`)

Django's admin site is for staff accounts, which sign in with a password (the app's own sign-in has
none). Create one, then open http://127.0.0.1:8001/admin/:

```powershell
.\.venv\Scripts\python manage.py createsuperuser   # asks for an email and a password
```

Staff can browse every record, but case data and the audit trail are read-only (`cases/admin.py`):
the only changes possible are a user's active status, a user's role, and department names. National
ID numbers are never shown.

**Giving or removing reviewer (admin) access:** under Users, open the user and set **Role** to
Reviewer or Applicant, or tick several users and pick an action from the list. Each change is
recorded in the audit trail, and the user is signed out, so their next sign-in opens the app for the
new role. Your own account, staff accounts and the built-in `admin` account keep their role. A
reviewer can never rule on or decide their own application. Outside development, run `manage.py collectstatic` and
serve `staticfiles/` from the reverse proxy for the admin's stylesheets.

The reviewer's own **Admin panel** in the app (`/reviewer/admin`: user and assessment counts, the
user list) reads `/api/admin/*` (`cases/views/admin_panel.py`) and needs no staff account.

### Layout

```
config/                 settings (all secrets and environment-specific values come from .env)
cases/models.py         the schema: constraints and indexes live here and in migrations/
cases/migrations/       0003 loads the departments and questionnaire v1 (cases/data/)
cases/data/             reference data: questionnaire v1 and the demo applicants
cases/workflow.py       the only code that changes a case's stage (submit, follow the engine, rule, decide)
cases/adapt.py          engine requests and responses in and out (engine URLs never reach the browser)
cases/scoring.py        scoring for cases the reviewer accepted after flags
cases/catalogue.py      questionnaire versions, evidence rule, engine evidence options (cached)
cases/validation.py     input rules: new assessments, uploaded files
cases/views/            API views; cases/permissions.py holds the access rule every view uses
cases/authentication.py session sign-in (401 when there is none)
cases/middleware.py     refuses oversized request bodies before they are read; the admin site's CSP
cases/admin.py          the admin site at /admin/: read-only case records, staff only
cases/storage.py        deleting stored documents (and their emptied folders)
cases/audit.py          append-only audit trail
cases/fields.py         encrypted field for personal identifiers
cases/management/       seed_demo: loads the demo applicants
cases/tests/            the test suite (conftest.py at the top holds the shared fixtures)
engine/client.py        the only code that calls the Data Authentication API
engine/fixtures/        real engine responses, used by the tests instead of the live engine
media/                  uploaded documents (git-ignored), see below
```

### Roles and departments

There are three kinds of account (`User.role`):

- **User** (`applicant`): applies, and sees only their own applications.
- **Admin** (`reviewer`): reviews, rules on and decides the cases of the departments given to them
  (`User.departments`), opens applications for those departments, and configures their questions.
  Any other department's case is a 404 to them, as if it did not exist.
- **Super user** (`superuser`): every department, plus the admin panel: accounts (role, an admin's
  departments, whether it may sign in) and departments (add, rename, switch off). The development
  sign-in `admin` is the super user.

The scoping lives in one place, `cases/permissions.py` (`visible_assessments`, `assessment_for`,
`department_to_manage`); every view goes through it.

Each department has its **own questionnaire** (`QuestionnaireVersion.department`, one edition in
force per department). A draft follows its department's edition in force; a submitted case keeps the
edition it was submitted under. Publishing a department's questions reaches only that department's
drafts. A new department starts with no questions (or, if chosen, a copy of another department's)
and takes no applications until it has some. A department switched off takes no new applications;
its cases carry on. Migration 0014 gave every department a copy of the questionnaire then in force;
0015 then left those questions with banking only (and with any department that had an application
in progress), the others starting empty. Each department remembers the edition it started from
(`Department.starting_version`), which "Restore published model" goes back to.

**Several admins in one department.** A submitted case is reviewed by one of them
(`Assessment.reviewer`): the first to take it (`POST .../claim`), or the first to act on it. Only
they rule on it, send it on and decide it; the others read it and are refused (409, naming who has
it). They can release it; the super user can take it over or give it to another admin of the
department. Every check runs on the case's locked row, so two admins acting at once are taken one
after the other. Cases an admin can no longer act on (department taken away, switched off, made a
user) go back to the queue in the same transaction as the change.

**Two admins editing one department's questions.** One at a time (`QuestionnaireLock`): the first
change takes the department's editing lock for that browser tab; others see who is editing and read
the questions until it is given back (apply, leave) or lapses after
`QUESTIONNAIRE_LOCK_IDLE_SECONDS` (default 15 minutes) without word from the editor. The super user
can take it over. Publishing checks the lock as well as the version the edit was made from.

### Endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `GET/POST/DELETE /api/session` | anyone | Who is signed in (`role` applicant/reviewer, `access` user/admin/superuser, the reviewer's `departments`) / sign in (development rule) / sign out |
| `GET /api/catalogue` | signed in | Questions, rules and evidence options: an assessment's (`?assessment=`) or a department's (`?department=`) |
| `GET /api/departments` | signed in | Applicants: the departments taking applications. Reviewers: the ones they work on |
| `GET/PUT /api/questionnaire` | admin, super user | One department's question settings (`?department=`, or `department` in the body); saving publishes a new version |
| `GET /api/questionnaire/impact` | admin, super user | What applying would reach on that department's unsubmitted forms |
| `POST/DELETE /api/questionnaire/lock` | admin, super user | Take (or keep alive, or `takeOver`) / give back the editing lock on a department's questions |
| `POST/DELETE /api/assessments/{id}/claim` | admin, super user | Take the case to review it (`takeOver`: the super user) / give it back |
| `GET/POST /api/assessments/{id}/assign` | super user | Who the case can be given to / give it to one of them |
| `GET /api/admin/overview`, `GET /api/admin/users` | super user | The admin panel: counts, and accounts (`?role=applicant/admin/superuser/reviewer`) |
| `GET/PATCH /api/admin/users/{id}` | super user | One account; change its role, an admin's departments, or whether it may sign in (audited; a changed role signs it out) |
| `GET/POST /api/admin/departments`, `PATCH /api/admin/departments/{key}` | super user | Departments: list, add (`startFrom` another department's questions), rename or switch off |
| `GET /api/assessments` | signed in | Applicant: their own. Reviewer: the queue (`?stage=`, `?department=`, `?cursor=`) |
| `POST /api/assessments` | signed in | Reviewer: open one for an applicant (by email). Applicant: start their own (as themselves, dated today; at most 3 unsubmitted at a time) |
| `GET/DELETE /api/assessments/{id}` | owner, reviewer | One assessment / remove before submission (reviewer: any started here; applicant: one they started) |
| `GET/PATCH /api/assessments/{id}/form` | owner, reviewer / owner | The form / save answers |
| `POST /api/assessments/{id}/form/reset` | owner | Start the form over (before submission) |
| `POST /api/assessments/{id}/evidence` | owner | Upload a document (multipart) |
| `DELETE /api/assessments/{id}/evidence/{eid}` | owner | Remove a document |
| `GET /api/assessments/{id}/evidence/{eid}/file` | owner, reviewer | Download a document |
| `POST /api/assessments/{id}/submit` | owner | Send the form and documents to the engine |
| `GET /api/assessments/{id}/case` | owner, reviewer | Stage, report, flags, rulings, score, written assessment, decision (follows a running engine job first) |
| `PUT/DELETE /api/assessments/{id}/rulings/{qid}` | reviewer | Accept or reject a flagged answer / undo it (until the review is sent on) |
| `POST /api/assessments/{id}/complete-review` | reviewer | Once every flagged answer has a ruling: on to scoring if all were accepted (force-score), back to the applicant if any was rejected |
| `POST /api/assessments/{id}/decision` | reviewer | Accept or reject the case, with feedback |
| `POST /api/assessments/{id}/force-score` | reviewer | Ask the engine again to score a case whose flagged answers were all accepted (when it was not scored) |
| `POST /api/assessments/{id}/resubmit` | owner | Send again after the reviewer returned it (new documents for the rejected answers only) |
| `POST /api/assessments/{id}/retry` | owner, reviewer | Send again after an engine failure |
| `GET /api/assessments/{id}/highlights/{name}` | owner, reviewer | An engine-highlighted evidence PDF, passed through |

### Workflow

`cases/workflow.py` is the only code that changes an assessment's stage (diagram at its top).
Engine runs are followed by the `follow_runs` worker, which checks each run in progress at most
once per `ENGINE_POLL_INTERVAL_SECONDS`, longest-unchecked first; only one process follows a run
at a time. Pages then only read the database. If the worker is not running, the case page and the
assessment list move overdue runs on themselves, so a case never stalls, only slower to load. A clear run is scored by the engine and gets its written assessment. When the engine
returns a case, the reviewer rules on every flagged answer (each ruling can be undone), then sends
it on with a button: back to the applicant if any is rejected (no engine call); if all are accepted, the engine is asked to score the same run anyway
(`POST /authentication/force-score` with its `request_id`, our case id as `application_id`, and
`is_score_forced: true`), and the case comes to the decision with the engine's score and written
assessment. If the engine refuses or cannot be reached, the case goes to the decision unscored with
the reason, and the reviewer can ask again from the decision page. `ENGINE_FORCE_SCORE=false` turns
this off (accepted cases then go to the decision unscored). Only the engine scores. Engine URLs and request ids never
reach the browser (`cases/adapt.py` rewrites every link; a test fails if one slips through).

A run never stays in progress for ever. It is failed, and can be sent again, when: the send
breaks (a send has a hard time limit); the engine reports a failure, no longer knows the run, or
answers with something that cannot be read; or it is still unfinished after
`ENGINE_MAX_RUN_SECONDS` (default one hour).

### Security rules the code follows

- Every endpoint requires a signed-in session unless it says otherwise (401 without one, so the
  frontend returns the user to sign-in), and every view that takes
  an assessment id resolves it through `cases.permissions.assessment_for` (reviewers: any;
  applicants: their own; anyone else gets 404).
- CSRF is enforced on every change, including sign-in. Session cookies are httpOnly and SameSite,
  and Secure whenever `DEBUG` is off.
- Sign-in (`cases/views/session.py`) is the **development rule** — any email, or `admin` for the
  reviewer, no password. Replace that one view before real data is stored.
- No personal data in logs or audit metadata. National ID numbers are encrypted at rest;
  `FIELD_ENCRYPTION_KEY` may list several keys (comma-separated, the first encrypts) for rotation.
- Every change re-checks the case's stage on the locked row, so it cannot race a submit.
- Request bodies larger than an upload may be are refused before they are read. Behind a reverse
  proxy, set the same limit there for bodies sent without a length.

## Engine and test data

- `ENGINE_BASE_URL` in `.env` points at the Data Authentication API. Every `POST
  /authentication/verify` is a billed run: submitting, resubmitting, retrying and
  `seed_demo --submit` each make one.
- The tests never call the engine; they replay the captured responses in `engine/fixtures/`.
- `seed_demo` loads the five demo applicants (answers, details and documents) from
  `../test-data/` through `cases/data/demo_assessments.json`.
- Uploaded documents are stored under `media/evidence/<assessment id>/<random name>`, one folder
  per assessment, never under the name they were uploaded with; each has an `evidence_file` row
  pointing at it. A folder is removed with its assessment's last document. The folder is
  git-ignored and is only ever served through the API's access-checked download.

## Running in production

- **Processes:** the web server and `manage.py follow_runs` (one is enough; it keeps running).
- **Sessions:** run `manage.py clearsessions` daily, so expired sign-ins do not pile up.
- **Several web workers:** set `REDIS_URL` (and `pip install redis`) so they share one cache: rate
  limits then count across all of them, and the engine's evidence options are fetched once.
- **Connections:** each process opens up to `DATABASE_POOL_MAX` (default 10) database connections;
  processes × that must stay under PostgreSQL's `max_connections` (default 100), or put PgBouncer
  in front.
- **Audit retention:** `audit_event` only grows. Decide how long it must be kept; past tens of
  millions of rows, partition it by month so old months can be archived.
