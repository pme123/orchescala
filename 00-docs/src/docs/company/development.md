# Development

This describes the development process of the company project (`mycompany-orchescala/helper.scala`).

Make sure `helper.scala` is executable:

```bash
cd ~/dev-mycompany/mycompany-orchescala
chmod +x helper.scala
```

> [!NOTE]
> To update this project, use `cd ..` and then `./helperCompany init` - see  [Init Company].

## update

```bash
./helper.scala update
```
Updates the company project itself (build files, wrappers, `00-docs` scaffolding).

The API page every project ships (`03-api/OpenApi.html` and `03-api/PostmanOpenApi.html`, written
by the project's `./helper.scala update` and uploaded by its `publish`) comes with orchescala:
the documentation app in `04-orch-doc` is built into the `orchescala-orch-doc` jar, a dependency
of the helper - nothing to build or configure in the company. The page loads the yml named like
itself.

## publish

Creates a new Release for the Company project (`company-orchescala`) and publishes to the repository(e.g. Artifactory)

Usage:
```
./helper.scala publish <VERSION>
```

Example:
```
./helper.scala publish 0.2.5
```
The same steps are executed as for the `publish` command in any project.
See [project publish](../development/projectDev.md#publish).

## Company Documentation
This is a semi-automatic process. This should be done either to prepare a Release or after a Release.

> [!NOTE]
> At the moment this is based on using **Postman** and a **WebDAV** server.
>
> So get in touch if you have a different setup.

Do the following steps:

- Open the `company-orchescala` project in your IDE.
- Configure the Release - edit `00-docs/CONFIG.conf`.
- Copy the actual Production Versions of the Release (`00-docs/VERSIONS.conf`) to `00-docs/VERSIONS_PREVIOUS.conf` from [Postman].
- Copy the new Versions of the Release to `00-docs/VERSIONS.conf` from [Postman].
```
    // START VERSIONS
    // Workers
    companyAccountingWorkerVersion = "1.8.11" 
    ...
    // Project
    companyAccountingVersion = "0.8.11" 
    ...
    
    // END VERSIONS
```
See [Deploy the Projects]

### prepareDocs
Prepare the company documentation.

```bash
./helper.scala prepareDocs
```
> [!WARNING]
> Be aware that this overwrites `release.md`

`prepareDocs` ends with a local preview of the documentation site: the site is assembled into
`00-docs/site` (this company and its siblings, the project APIs at their released versions,
orch-spec with its catalog, orch-ops) and served - the URL is printed (`Preview ready: http://localhost:3004/`)
and the command keeps running until you stop it with Ctrl-C. A failure in the spec catalog or
the sibling repos does not stop the preview, it is printed and the preview continues with what is
available. Everything needed ships with orchescala; Node.js is only used for the orch-spec
catalog (skipped without it).

The preview port is 3004 by default. A company changes it in its `CompanyOrchescalaDevHelper`, e.g.
when two companies preview on the same machine:

```scala
override protected def docsPreviewPort: Int = 3003
```

Each company has a folder for orch-spec and one for orch-ops: `00-docs/testdata/spec` and
`00-docs/testdata/ops`. `prepareDocs` creates them, and the preview shows the path on the start
screen of both apps (with a copy button - in the folder dialog on macOS paste it with ⌘⇧G). A browser
cannot be given a folder, so it is linked once per preview port; the browser remembers it afterwards.
Other folders:

```scala
override protected def docsSpecDir: os.Path = os.home / "specs" / "my-company"
override protected def docsOpsDir: os.Path  = os.home / "ops" / "my-company"
```

- Manually adjust the Release Notes _release.md_ - and check the result in the local preview
  (run `prepareDocs` again, or `npm run site` in orch-doc).

### publishDocs
Release the company documentation.

```bash
./helper.scala publishDocs
```

Builds the documentation site (this company and its siblings, the project APIs at their released
versions, orch-spec, orch-ops) into `00-docs/site` and uploads it to `/site` on the WebDAV server. `/site`
is never deleted as a whole: the projects' own folders (`/site/<company>/<project>/`, published
by each project) and the classic sites of older releases (`/site/<company>/<tag>/`) stay - only
`assets/`, `spec/` and `ops/` are replaced. Needs Java and git only - Node.js just for the orch-spec catalog.

The site links two apps in its top bar: **Spec** (`spec/`, process specifications) and **Ops**
(`ops/`, the recurring errors in operation with their workarounds - a counter per error, search,
status tags, screenshots). Orch Ops keeps its data in a shared folder of its own (local or
SharePoint), chosen in the app - the site only serves the app.

> [!NOTE]
> The documentation apps (Orch Doc, Orch Spec, Orch Ops) are licensed under the
> [Business Source License 1.1](https://github.com/pme123/orchescala/blob/master/04-orch-doc/LICENSE):
> non-production use is free, production use - publishing the site for a company - needs a license
> from z9nai GmbH.

- Check the result on your Company Documentation Page (`<documentationUrl>/site/#/<company>`).
