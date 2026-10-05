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
- Push the `develop` branch.
- Adjust the version in `ProjectDef.scala` and `ApiProjectCreator.scala`.
- Run `ApiProjectCreator.scala`.
- Publish the project to the repository.
- Uploads the documentation to a WebDAV-webserver (optional).
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
with the BPMN and the Scala classes in one argument (`orchspec:` + base64url(gzip(JSON))).
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

This creates the same files as `process`, but with the content of the specification:
```
// the BPMN - to camunda8 if it is a Camunda 8 diagram; without BPMN export the template
src           - main -> myproject-myProcessV1.bpmn
// the domain - In, Out, InConfig, InitIn of the specification (In gets the inConfig)
01-domain     - main -> mycompany.myproject.domain.myProcess.v1.MyProcess
// the interactions (UserTasks, CustomTasks, Signals, Messages) and the classes in schema/
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
- Imports are only added if the name is not imported yet (from wherever) and not visible through the package clause.
- Everything else stays as it is: the package clause, `descr`, `processLabels`, the examples of the process, comments.
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
