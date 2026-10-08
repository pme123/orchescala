# Project Development

The following chapters describe the tasks to support the project development.

We provide a `helper.scala` script that helps you with the most common tasks.

In general, you can type `./helper.scala x` to get a list of available commands.

And then you can type `./helper.scala <command>` to get help for a specific command.

The `version` is optional and defaults to `1`.

## helper.scala
This file will be replaced with `./helper.scala update`. However, you need to set there the 
subprojects you want to use.

```scala
#!/usr/bin/env -S scala shebang
// DO NOT ADJUST. This file is replaced by `./helper.scala update`.
//> using dep mycompany::mycompany-orchescala-helper:0.1.0-SNAPSHOT

import mycompany.orchescala.helper.*

lazy val projectName: String = "mycompany-myProject"
lazy val subProjects = Seq(
  "accounting",
  "hr"
)

@main
def run(command: String, arguments: String*): Unit =
  CompanyDevHelper(projectName, subProjects).run(command, arguments*)
```
### subProjects
Compile time can be optimized by using subprojects - this makes the project a bit more complex, 
as for each subProject, a SBT module is created.

`./helper.scala update` will generate this file but preserve the project name and subprojects.

## update
Whenever you have changes in the `company-orchescala` project or in one of your dependencies, 
you can update the project with the following command:

Usage / example:
```bash
./helper.scala update
```

This will create or update your project with the latest changes.

Files that contain the `DO NOT ADJUST` comment will be replaced.
If you do adjust them, remove this comment. 
You will get a warning, but the file will not be replaced.

## publish

Creates a new Release for the BPMN project and publishes to the repository(e.g. Artifactory)

@:callout(info)
If you want to provide the documentation on a WebDAV server, 
you need a `CompanyDevHelper.devConfig.publishConfig` configuration.

@:@

Usage:
```
./helper.scala publish <VERSION>
```

Example:
```
./helper.scala publish 0.2.5
```

The following steps are executed:
- Check if there are no SNAPSHOTs as dependencies.
  - Release your dependencies first.
- Check if the `CHANGELOG.md` is updated.
  - Check and adjust manually `CHANGELOG.md`.
  - Remove `//---DRAFT start` / `//---DRAFT end`.
  - Run the command again.
- Check that the version is free in the release repository (the first of `reposConfig`) - and that
  the credentials work: a `HEAD` on the pom of each module, before anything is built or uploaded.
  - A taken version fails at the upload, after the docs and the Docker image went out (the image tag
    of the existing release overwritten). Remove the half-finished version there, or release the next.
  - The poms are those of the generated build: `<name>-<module>` for every module of `build.sbt` (the
    sub projects of the domain too; the company's with the Scala suffix) under the `organization` - all
    read from the build's own files (`project/ProjectDef.scala`, `build.sbt`, `project/Settings.scala`).
    A module with a `name` of its own is not covered by the check.
  - Where the check can not tell (a GitLab group registry, a token that may not read the project, no
    credentials), it asks. Without a terminal (a pipeline) the answer is no and the release stops - a
    GitLab pipeline with its job token is not asked; a pipeline with a deploy token says yes with
    `ORCHESCALA_PUBLISH_YES=true` - to these GitLab questions only, the check of the version and of the
    next version stay.
  - Wrong credentials are found with Artifactory (401/403). GitLab answers 404 for a package the
    token may not read - so the project of a project registry is asked first. Does it not show the
    project (a wrong token - or a deploy token, which may not read it), or is the registry a group's,
    the release goes on only when you confirm. The job token of a pipeline is GitLab's
    own, it is not probed.
- Push the `develop` branch - the one outward step before the build: the documentation takes the
  references from the remote. It pushes committed work only (the tree is clean), a next try pushes nothing.
- Adjust the version in `ProjectDef.scala` and `ApiProjectCreator.scala`.
- Build everything locally (`sbt package packageSrc makePom` - what `publish` packages, without
  `publishLocal`'s copy in `~/.ivy2/local` that would shadow the repository; the Docker image of the
  worker with `worker / Docker / publishLocal`; the documentation with `ApiProjectCreator.scala`).
  - Nothing is uploaded yet: a release version is immutable in the repository (e.g. Artifactory).
    If a step fails here, you fix it and run the command again with the same version - that holds for
    every failure before the upload to the repository (the build, the docs, the WebDAV upload).
- Uploads the documentation to a WebDAV-webserver (optional).
  - On purpose before the repository: the webserver takes a version again, the repository does not.
    A release that fails at the upload is repeated with the same version - its docs are uploaded again.
  - Known side effect: if the upload fails afterwards, the docs of a version that was never released
    stay on the webserver until the release is repeated.
- Publish the project to the repository (`worker / Docker / publish`, then `publish`).
  - This sbt run repeats the packaging (compiler and Docker reuse their caches) and uploads -
    what is left to fail here is the upload itself (credentials, network, a taken version). The image
    is built again for the push (sbt-native-packager): a Docker failure there is late - after the docs.
  - The Docker image is pushed first - its tag can be overwritten, the artifacts can not.
  - `publish` uploads module by module: fails it midway, the modules uploaded so far are in the
    repository - this is the one case that still needs the version removed there before the next try.
    The console names them (the poms found in the repository).
  - Fails `publish` after the Docker push, the image with the version's tag is in the registry
    without its artifacts - the next try overwrites it.
  - `develop` is pushed before the build (the documentation needs the remote) - a release that fails
    afterwards leaves it pushed. It is committed work only, the next try pushes nothing.
  - The Docker image is built again for the push (sbt-native-packager rebuilds it for `Docker / publish`):
    a Docker failure there - a base image that can not be pulled, the registry - comes after the docs.
- Before the first sbt run of a release with a Docker image, `docker buildx version` must work when the
  images are built for a platform (the default) - otherwise the release stops right there, with the
  way to get `buildx`.
- A snapshot (`x.y.z-SNAPSHOT`) is overwritable in the repository: it skips the check of the version and
  keeps its rewritten version in the tree, as before - the retry with the same version is for releases.
- A release that fails before its git step restores the files it rewrote (the versions, generated
  docs) - so the next try with the same version starts from a clean working tree. The `CHANGELOG.md`
  and untracked files stay as they are - also when you abort it (Ctrl-C: sbt gets it too, the restore
  waits up to 30 seconds for it to end, then ends it). A second Ctrl-C in that time, or a kill, skips the
  restore. Should it fail, `git status` shows the files, `git checkout HEAD -- <files>` restores them.
- Merge the branch (`develop`) into `master`.
- Tag the GIT repository with the version.
- Increase the version to the next minor _SNAPSHOT_ version.


## deploy
Deploys the BPMN project to the local Camunda server and runs the Simulation you're working on.

@:callout(info)
**Be aware** that `CompanyDevHelper.devConfig.postmanConfig` must be defined.

At the moment, only deployment via _Postman Collection_ is supported (using Camunda REST API to deploy).
@:@

Usage:
```
./helper.scala deploy [simulation]
```

Example:
```
./helper.scala deploy MyProcessSimulation
```

The following steps are executed:
- Publishes Local (`sbt publishLocal`)
- runs the _deploy-collection_ of _Postman_
- runs a Simulation (optional)

## Generate Process/-Elements
To handle name conventions and to avoid errors, we generate as much as possible.

So it is essential, not to change the generated names.

The following generators are provided:

### process
Creates a new Process.

Usage:
```
./helper.scala process <processName> [version: Int]
```

Example:
```
./helper.scala process myProcess 1
```

This creates the following files:
```
// the BPMN
src           - main -> myproject-myProcessV1.bpmn
// the domain In -> Out
02-bpmn       - main -> mycompany.myproject.bpmn.myProcess.v1.MyProcess      
// the Simulation        
03-simulation - test -> mycompany.myproject.simulation.MyProcessSimulation           
// the InitWorker    
03-worker     - main -> mycompany.myproject.worker.myProcess.v1.MyProcessWorker  
              - test -> mycompany.myproject.worker.myProcess.v1.MyProcessWorkerTest 
```

### processFromSpec
Creates a Process from the exports of _Orch Spec_ - the BPMN and the Scala classes.

Usage:
```
./helper.scala processFromSpec [bpmnExport] [scalaExport] | orchspec:…
```

The simplest way: in _Orch Spec_ _Export_ > **Process from Spec** - it copies the whole command
with the BPMN, the Scala classes and the DMN tables of the DMN decisions in one argument
(`orchspec:` + base64url(gzip(JSON))).
Paste it in the terminal of your project and press Enter:
```
./helper.scala processFromSpec orchspec:H4sIAPO9vGoCA-0cW3IbN_IqKCW1ll…
```
No files and no SharePoint login needed - the command contains everything.

Without arguments, the helper asks for the exports - copy them in _Orch Spec_ (_Export_ > _BPMN_ / _Scala_ > _Kopieren_):
```
./helper.scala processFromSpec
1/2 BPMN - in Orch Spec: Export > BPMN > Kopieren, then press Enter here (or paste it here):
  ✓ myproject-myProcessV1 (Camunda 7)
2/2 Scala classes - in Orch Spec: Export > Scala > Kopieren, then press Enter here (or paste it here - finish with a line END):
  ✓ 5 files
```
Enter takes the export from the clipboard (macOS: `pbpaste`, Windows: `Get-Clipboard`, Linux: `wl-paste`/`xclip`).
You can also paste it into the terminal - but a terminal may cut long lines of a paste, so the clipboard is safer.

Or with the exported files:
```
./helper.scala processFromSpec ~/Downloads/myproject-myProcess-bpmn-c7.bpmn ~/Downloads/myproject-myProcess-scala.scala
```

The names (process, version, object) come from the process id of the BPMN - the same way _Orch Spec_ derives them
(`myproject-myProcessV2` -> `myProcess`, `v2`, `MyProcess` - the version is in the package, not in the name).
An existing process object keeps its name (_Orch Spec_ exports it under the name it knows from the domain,
e.g. `MyProcessV2`) - but only while its file exists. Delete `MyProcessV2.scala` and the next run creates `MyProcess.scala`.

This creates the same files as `process`, but with the content of the specification:
```
// the BPMN - to camunda8 if it is a Camunda 8 diagram; without BPMN export the template
src           - main -> myproject-myProcessV1.bpmn
// the DMN tables of the DMN decisions - next to the BPMN, with their file name in the project
src           - main -> myproject-myProcessV1-MyDecisionDmn.dmn
// the domain - In, Out, InConfig, InitIn of the specification (In gets the inConfig)
01-domain     - main -> mycompany.myproject.domain.myProcess.v1.MyProcess
// the interactions (UserTasks, CustomTasks, DMN Decisions, Signals, Messages) and the classes in schema/
01-domain     - main -> mycompany.myproject.domain.myProcess.v1.MyUserTaskUT
                        mycompany.myproject.domain.myProcess.v1.schema.MyClass
// the Simulation
03-simulation - test -> mycompany.myproject.simulation.MyProcessSimulation
// the InitWorker and a Worker for each CustomTask, Signal and Message
03-worker     - main -> mycompany.myproject.worker.myProcess.v1.MyProcessWorker
              - test -> mycompany.myproject.worker.myProcess.v1.MyProcessWorkerTest
```

`In` gets the `inConfig` (`extends WithConfig[InConfig]`) - an enum `In` in each of its cases.
It is the one field of the domain classes with a default: `inConfig: Option[InConfig] = None`.

The types of the process object are in the order `In`, `InitIn`, `InConfig`, `Out` - then the other
types of the object (e.g. `enum CustomProcessStatus`).

**Re-run.** Existing files are not overwritten - they are compared with _Orch Spec_ (`UNCHANGED` / `DIFFERS`).
The process object is the exception - _Orch Spec_ is merged into it (`UPDATED`):
- `In`, `Out` and the other types of the export replace the ones with the same name
  (unless they only differ in blanks and line breaks); a missing one goes to its place in the order above.
- `InConfig` and `InitIn` only get the fields they miss - what is there (own mocks, examples) stays.
  A new field without default also goes into their `example` (with the value of the export) - otherwise it would not compile.
- Imports are only added if the name is not imported yet (from wherever) and not visible through the package clause.
- Everything else stays as it is: the package clause, `descr`, `processLabels`, the examples of the process, comments.
- An existing process object without `processLabels` gets them from the export - the init worker sets `callingProcessKeyDE/FR` from them.
- A new process object gets `descr` and `processLabels` from the export (`// descr: …`, `// processLabels: de | fr`).
  Do not delete an existing one to run again - only an existing one keeps what is not in _Orch Spec_.

Defaults are only in the `InConfig`. An optional field of `In` with a default in _Orch Spec_ stays an `Option` -
the `InitIn` gets the same field as required, and the InitWorker sets it in `customInit`:
```scala
override def customInit(in: In): InitIn =
  InitIn(
    fee = in.fee.getOrElse(90)
  )
```

The other fields of the `InitIn` are `???` - and without such defaults the whole `customInit` is `???`.
Not the example: that would run with its values - `???` fails until it is implemented, like the generated
custom and service task workers.

The process is registered in the `WorkerApp` and in the `ApiProjectCreator`:
```scala
object WorkerApp extends CompanyWorkerApp:
  workers(
    myProcessWorkers,
    ..
  )
  ..
  private lazy val myProcessWorkers =
    import mycompany.myproject.worker.myProcess.v1.*
    Seq(
      MyProcessWorker(),
      MyCustomTaskWorker(),
    )
  end myProcessWorkers
end WorkerApp
```
```scala
object ApiProjectCreator extends CompanyApiCreator:
  ..
  document(
    myProcessApi,
    ..
  )
  ..
  private lazy val myProcessApi =
    import mycompany.myproject.domain.myProcess.v1.*
    api(MyProcess.example)(
      MyUserTaskUT.example,
      MyCustomTask.example,
    )
  end myProcessApi
end ApiProjectCreator
```
The entry and the block go in alphabetically - next to their alphabetical neighbour, the order of the others stays
(in `document(…)` it is the order of the API documentation).

If one of them has not this form (`workers(` / `document(` and `end WorkerApp` / `end ApiProjectCreator`),
the snippet is printed - add it manually.

The package of the Scala classes must be `<projectPackage>.domain.<processName>.v<version>` -
so company and project of the process in _Orch Spec_ must match the project.
If it differs from the names of the BPMN, you get a warning (the Scala classes win).

Existing files are never overwritten - so you can run it again after changes in _Orch Spec_:
- new classes, workers and tests are created,
- new workers and interactions are added to the `WorkerApp` and the `ApiProjectCreator`,
- the classes and the BPMN are compared with _Orch Spec_ - `UNCHANGED`, or
  `DIFFERS from Orch Spec` (for the process object only the types of the export - `In`, `Out`, `InConfig`, `InitIn` -
  and the imports, the rest is implementation).

To take a new version of a class or of the BPMN: delete it and run the command again - or merge it manually.

### customTask
Creates a new Custom Task.

Usage:
```
./helper.scala customTask <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala customTask myProcess MyCustomTask 1
```

This creates the following files:
```
// the domain In -> Out
02-bpmn   - main -> mycompany.myproject.bpmn.myProcess.v1.MyCustomTask   
// the CustomWorker
03-worker - main -> mycompany.myproject.worker.myProcess.v1.MyCustomTaskWorker  
          - test -> mycompany.myproject.worker.myProcess.v1.MyCustomTaskWorkerTest    
``` 

### serviceTask
Creates a new Service Task.

Usage:
```
./helper.scala serviceTask <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala serviceTask myProcess MyServiceTask 1
```

This creates the following files:
```
// the domain In -> Out (ServiceIn -> ServiceOut)
02-bpmn   - main -> mycompany.myproject.bpmn.myProcess.v1.MyServiceTask
// the ServiceWorker
03-worker - main -> mycompany.myproject.worker.myProcess.v1.MyServiceTaskWorker  
          - test -> mycompany.myproject.worker.myProcess.v1.MyServiceTaskWorkerTest    
```

### userTask
Creates a new User Task.

Usage:
```
./helper.scala userTask <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala userTask myProcess MyUserTask 1
```

This creates the following files:
```
// the domain In -> Out
02-bpmn - main -> mycompany.myproject.bpmn.myProcess.v1.MyUserTask      
```

### decision
Creates a new Decision.

Usage:
```
./helper.scala decision <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala decision myProcess MyDecision 1
```

This creates the following files:
```
// the domain In -> Out
02-bpmn - main -> mycompany.myproject.bpmn.myProcess.v1.MyDecision      
```

### signalEvent
Creates a new Signal Event.

Usage:
```
./helper.scala signalEvent <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala signalEvent myProcess MySignalEvent 1
```

This creates the following files:
```
// the domain In -> NoOutput
02-bpmn - main -> mycompany.myproject.bpmn.myProcess.v1.MySignalEvent   
// the ValidationWorker    
03-worker     - main -> mycompany.myproject.worker.myProcess.v1.MySignalEventWorker  
              - test -> mycompany.myproject.worker.myProcess.v1.MySignalEventWorkerTest 
   
```

### messageEvent
Creates a new Message Event.

Usage:
```
./helper.scala messageEvent <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala messageEvent myProcess MyMessageEvent 1
```

This creates the following files:
```
// the domain In -> NoOutput
02-bpmn - main -> mycompany.myproject.bpmn.myProcess.v1.MyMessageEvent   
// the ValidationWorker    
03-worker     - main -> mycompany.myproject.worker.myProcess.v1.MyMessageEventWorker  
              - test -> mycompany.myproject.worker.myProcess.v1.MyMessageEventWorkerTest 
```

### timerEvent
Creates a new Timer Event.

Usage:
```
./helper.scala timerEvent <processName> <bpmnName> [version: Int]
```

Example:
```
./helper.scala timerEvent myProcess MyTimerEvent 1
```

This creates the following files:
```
// the domain NoInput -> NoOutput
02-bpmn - main -> mycompany.myproject.bpmn.myProcess.v1.MyTimerEvent      
```

## Docker
To run the Camunda Server locally, you can use `docker-compose`.

@:callout(info)
**Precondition**: 
- You have to have `docker` and `docker-compose` installed.
- You need to have a `docker-compose.yml` in `dev-company/docker` directory.
- Adjust the `CompanyDevHelper.devConfig.dockerConfig` configuration.

@:@

### dockerUp
Starts the server with `docker-compose`.

@:callout(info)
Check your company settings in `DockerHelper` before running this command.
@:@

Usage / example:
```
./helper.scala dockerUp
```

### dockerStop
Stops the server with `docker-compose`.

Usage / example:
```
./helper.scala dockerStop
```

### dockerDown
Stops and removes the server with `docker-compose`. 

**Be aware** that all data will be lost - you have to deploy again.

Usage / example:
```
./helper.scala dockerDown
```
