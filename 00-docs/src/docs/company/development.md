# Development

This describes the development process of the company project (`mycompany-orchescala/helper.scala`).

Make sure `helper.scala` is executable:

```bash
cd ~/dev-mycompany/mycompany-orchescala
chmod +x helper.scala
```

@:callout(info)
To update this project, use `cd ..` and then `./helperCompany init` - see  [Init Company].
@:@

## update

```bash
./helper.scala update
```
Updates the company project itself. If `PublishConfig.apiDocPath` points to a local
[orch-doc](https://github.com/z9nai/orch-doc) checkout, it also builds orch-doc's single-file
API page and stores it as `04-helper/src/main/resources/OrchDocApi.html` (`PublishConfig.apiHtmlResource`).
Once the company helper is published with it, every project's `./helper.scala update` writes this
page as `03-api/OpenApi.html` and `03-api/PostmanOpenApi.html` instead of the Redoc shells - the
page loads the yml named like itself - and `./helper.scala publish` uploads exactly these files.

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

@:callout(info)
At the moment this is based on using **Postman** and a **WebDAV** server.

So get in touch if you have a different setup.
@:@

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
@:callout(warning)
Be aware that this overwrites `release.md`
@:@

If `PublishConfig.apiDocPath` points to a local [orch-doc](https://github.com/z9nai/orch-doc)
checkout, `prepareDocs` ends with a local preview of the new documentation site: the orch-spec
catalog is regenerated, the site assembled (this company and its siblings) and served - the URL
is printed at the end (`Preview ready: http://localhost:3004/`). The server keeps running after
the command; the next `prepareDocs` replaces it. A failure in the catalog or the sibling
repos does not stop the preview, it is printed and the preview continues with what is available.

- Manually adjust the Release Notes _release.md_ - and check the result in the local preview
  (run `prepareDocs` again, or `npm run site` in orch-doc).

### publishDocs
Release the company documentation.

```bash
./helper.scala publishDocs
```

Builds the documentation site (this company and its siblings, the project APIs at their released
versions, orch-spec) into `00-docs/site` and uploads it to `/site` on the WebDAV server. `/site`
is never deleted as a whole: the projects' own folders (`/site/<company>/<project>/`, published
by each project) and the classic sites of older releases (`/site/<company>/<tag>/`) stay - only
`assets/` and `spec/` are replaced. Needs `PublishConfig.apiDocPath` (the orch-doc checkout).

- Check the result on your Company Documentation Page (`<documentationUrl>/site/#/<company>`).
